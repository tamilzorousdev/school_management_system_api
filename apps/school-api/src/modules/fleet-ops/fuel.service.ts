import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException, AuthUser, FieldError, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { monthStartIn, todayIn } from '../../shared/dates';
import { ROLES } from '../access/access.catalog';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Vehicle } from '../transport/entities/vehicle.entity';
import { DriverFuelInputDto } from './dto/fleet-maintenance.dto';
import { FuelInputDto, FuelInsightsDto, FuelLogDto, FuelQueryDto, UpdateFuelDto } from './dto/fleet-ops.dto';
import { PaymentMode } from './entities/fleet-maintenance.entity';
import { FuelLog, FuelStatus } from './entities/fuel-log.entity';
import { changedFields, FleetBooksService } from './fleet-books.service';
import { averageKmPerLitre, OdometerReading, odometerProblem, pricePerLitre } from './fleet-ops.logic';
import { FleetVendorsService } from './fleet-vendors.service';
import { FillEconomy, fillEconomy, gpsCheck, mileageDropped, priceWarning } from './maintenance-plan.logic';
import { MaintenanceService } from './maintenance.service';

const ECONOMY_WINDOW_DAYS = 90;
export const LOW_MILEAGE_TEMPLATE = 'BUS_LOW_MILEAGE';
export const FUEL_REVIEW_TEMPLATE = 'FUEL_ENTRY_REVIEWED';

const AUDITED = [
  'vehicle_id',
  'filled_on',
  'litres',
  'amount',
  'odometer_km',
  'station',
  'station_id',
  'bill_file_id',
  'is_full',
  'payment_mode',
] as const;

interface FuelDraft {
  vehicle_id: number;
  filled_on: string;
  litres: number;
  odometer_km: number;
  bill_file_id?: number | null;
  filled_by?: number | null;
  station_id?: number | null;
}

@Injectable()
export class FuelService {
  private readonly logger = new Logger('Fuel');

  constructor(
    @InjectRepository(FuelLog) private readonly logs: Repository<FuelLog>,
    private readonly maintenance: MaintenanceService,
    private readonly books: FleetBooksService,
    private readonly vendors: FleetVendorsService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async list(schoolId: number, query: FuelQueryDto): Promise<Paginated<FuelLogDto>> {
    const qb = this.logs
      .createQueryBuilder('f')
      .leftJoin('vehicles', 'v', 'v.id = f.vehicle_id')
      .where('f.school_id = :schoolId', { schoolId });
    if (query.vehicle_id) qb.andWhere('f.vehicle_id = :vehicle', { vehicle: query.vehicle_id });
    if (query.from) qb.andWhere('f.filled_on >= :from', { from: query.from });
    if (query.to) qb.andWhere('f.filled_on <= :to', { to: query.to });
    if (query.status) qb.andWhere('f.status = :status', { status: query.status });
    if (query.payment_mode) qb.andWhere('f.payment_mode = :mode', { mode: query.payment_mode });
    if (query.reimbursed !== undefined) {
      qb.andWhere(`f.payment_mode = 'driver_paid' AND f.reimbursed_at IS ${query.reimbursed ? 'NOT NULL' : 'NULL'}`);
    }
    const page = await listQuery(qb, query, {
      searchable: ['f.station', 'v.registration_no', 'v.name'],
      sortable: { filled_on: 'f.filled_on', amount: 'f.amount', litres: 'f.litres', odometer_km: 'f.odometer_km' },
      defaultSort: 'filled_on',
    });
    return { ...page, items: await this.present(schoolId, page.items) };
  }

  async insights(schoolId: number, vehicleId?: number): Promise<FuelInsightsDto> {
    const today = todayIn(this.app.timeZone);
    const params: unknown[] = [schoolId, monthStartIn(this.app.timeZone)];
    const busFilter = vehicleId ? `AND vehicle_id = $${params.push(vehicleId)}` : '';
    const [month] = await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'approved' AND filled_on >= $2)::int AS entries,
              COALESCE(SUM(litres) FILTER (WHERE status = 'approved' AND filled_on >= $2), 0)::float AS litres,
              COALESCE(SUM(amount) FILTER (WHERE status = 'approved' AND filled_on >= $2), 0)::float AS amount,
              COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
              COALESCE(SUM(amount) FILTER (WHERE status = 'approved' AND payment_mode = 'driver_paid' AND reimbursed_at IS NULL), 0)::float AS unpaid
       FROM fuel_logs WHERE school_id = $1 AND deleted_at IS NULL ${busFilter}`,
      params,
    );
    const rows = await this.approvedSince(schoolId, today, ECONOMY_WINDOW_DAYS, vehicleId);
    return {
      entries_this_month: month.entries,
      litres_this_month: Math.round(month.litres * 100) / 100,
      amount_this_month: Math.round(month.amount * 100) / 100,
      avg_km_per_litre: averageKmPerLitre(rows),
      pending_approvals: month.pending,
      driver_paid_pending: Math.round(month.unpaid * 100) / 100,
    };
  }

  async get(schoolId: number, id: number): Promise<FuelLogDto> {
    return (await this.present(schoolId, [await this.find(schoolId, id)]))[0]!;
  }

  async create(schoolId: number, dto: FuelInputDto, actor: AuthUser): Promise<FuelLogDto> {
    await this.validate(schoolId, dto);
    const saved = await this.logs.save(
      this.logs.create({
        school_id: schoolId,
        vehicle_id: dto.vehicle_id,
        filled_on: dto.filled_on,
        litres: dto.litres,
        amount: dto.amount,
        odometer_km: dto.odometer_km,
        station_id: dto.station_id ?? null,
        station: (await this.stationName(dto.station_id)) ?? dto.station ?? null,
        bill_file_id: dto.bill_file_id ?? null,
        filled_by: dto.filled_by ?? null,
        is_full: dto.is_full ?? true,
        payment_mode: dto.payment_mode ?? 'cash',
        status: 'approved',
        created_by: actor.id,
      }),
    );
    await this.afterApproved(schoolId, saved);
    return this.get(schoolId, saved.id);
  }

  async createFromDriver(
    schoolId: number,
    vehicle: Vehicle,
    dto: DriverFuelInputDto,
    actor: AuthUser,
  ): Promise<FuelLogDto> {
    const draft = {
      vehicle_id: vehicle.id,
      filled_on: dto.filled_on ?? this.books.today(),
      litres: dto.litres,
      odometer_km: dto.odometer_km,
      bill_file_id: dto.bill_file_id,
      station_id: dto.station_id ?? null,
    };
    await this.validate(schoolId, draft);
    const saved = await this.logs.save(
      this.logs.create({
        school_id: schoolId,
        ...draft,
        amount: dto.amount,
        station: (await this.stationName(dto.station_id)) ?? dto.station ?? null,
        filled_by: actor.id,
        is_full: dto.is_full ?? true,
        payment_mode: dto.payment_mode ?? 'cash',
        status: 'pending',
        created_by: actor.id,
      }),
    );
    return this.get(schoolId, saved.id);
  }

  async forDriver(schoolId: number, vehicleId: number, userId: number): Promise<FuelLogDto[]> {
    const rows = await this.logs.find({
      where: { school_id: schoolId, vehicle_id: vehicleId, filled_by: userId },
      order: { filled_on: 'DESC', id: 'DESC' },
      take: 20,
    });
    return this.present(schoolId, rows);
  }

  async update(schoolId: number, id: number, dto: UpdateFuelDto, actor: AuthUser): Promise<FuelLogDto> {
    const log = await this.find(schoolId, id);
    await this.books.assertOpen(schoolId, [log.filled_on, dto.filled_on], 'filled_on');
    const merged = {
      vehicle_id: dto.vehicle_id ?? log.vehicle_id,
      filled_on: dto.filled_on ?? log.filled_on,
      litres: dto.litres ?? log.litres,
      odometer_km: dto.odometer_km ?? log.odometer_km,
      bill_file_id: dto.bill_file_id === undefined ? undefined : dto.bill_file_id,
      filled_by: dto.filled_by === undefined ? undefined : dto.filled_by,
      station_id: dto.station_id === undefined ? undefined : dto.station_id,
    };
    await this.validate(schoolId, merged, log);
    const changes: Partial<FuelLog> = {};
    for (const key of [...AUDITED, 'filled_by'] as const) {
      if (dto[key] !== undefined) Object.assign(changes, { [key]: dto[key] });
    }
    if (dto.station_id) changes.station = await this.stationName(dto.station_id);
    const diff = changedFields(
      log as unknown as Record<string, unknown>,
      Object.fromEntries(AUDITED.filter((key) => changes[key] !== undefined).map((key) => [key, changes[key]])),
    );
    if (diff) {
      await this.books.record(schoolId, {
        entity: 'fuel',
        entity_id: log.id,
        vehicle_id: log.vehicle_id,
        action: 'update',
        ...diff,
        note: dto.reason ?? null,
        actor,
      });
    }
    await this.logs.save(this.logs.merge(log, changes));
    if (log.status === 'approved') await this.books.checkBudget(schoolId, merged.vehicle_id, merged.filled_on);
    return this.get(schoolId, id);
  }

  async remove(schoolId: number, id: number, actor: AuthUser, reason: string | null): Promise<void> {
    const log = await this.find(schoolId, id);
    await this.books.assertOpen(schoolId, [log.filled_on], 'filled_on');
    await this.books.record(schoolId, {
      entity: 'fuel',
      entity_id: log.id,
      vehicle_id: log.vehicle_id,
      action: 'delete',
      before: Object.fromEntries(AUDITED.map((key) => [key, log[key]])),
      after: null,
      note: reason,
      actor,
    });
    await this.logs.softDelete(log.id);
  }

  async review(
    schoolId: number,
    id: number,
    decision: Extract<FuelStatus, 'approved' | 'rejected'>,
    note: string | null,
    actor: AuthUser,
  ): Promise<FuelLogDto> {
    const log = await this.find(schoolId, id);
    if (log.status !== 'pending') {
      throw AppException.conflict(
        'Only fuel entries waiting for a check can be approved or rejected',
        'FUEL_NOT_PENDING',
      );
    }
    await this.books.assertOpen(schoolId, [log.filled_on], 'filled_on');
    await this.logs.update(log.id, {
      status: decision,
      review_note: note,
      reviewed_by: actor.id,
      reviewed_at: new Date(),
    });
    await this.books.record(schoolId, {
      entity: 'fuel',
      entity_id: log.id,
      vehicle_id: log.vehicle_id,
      action: decision === 'approved' ? 'approve' : 'reject',
      before: { status: 'pending' },
      after: { status: decision },
      note,
      actor,
    });
    const saved = await this.find(schoolId, id);
    if (decision === 'approved') await this.afterApproved(schoolId, saved);
    if (log.filled_by) {
      await this.notifications
        .dispatch({
          template: FUEL_REVIEW_TEMPLATE,
          audience: { user_ids: [log.filled_by] },
          data: {
            litres: String(log.litres),
            filled_on: log.filled_on,
            decision: decision === 'approved' ? 'approved' : 'rejected',
            note: note ?? '',
            fuel_id: log.id,
          },
        })
        .catch((error: Error) => this.logger.warn(`Fuel review ${log.id} not sent: ${error.message}`));
    }
    return this.get(schoolId, id);
  }

  async reimburse(schoolId: number, id: number, actor: AuthUser): Promise<FuelLogDto> {
    const log = await this.find(schoolId, id);
    assertReimbursable(log.payment_mode, log.reimbursed_at, log.status);
    await this.logs.update(log.id, { reimbursed_at: new Date(), reimbursed_by: actor.id });
    await this.books.record(schoolId, {
      entity: 'fuel',
      entity_id: log.id,
      vehicle_id: log.vehicle_id,
      action: 'reimburse',
      before: { reimbursed: false },
      after: { reimbursed: true, amount: log.amount },
      actor,
    });
    return this.get(schoolId, id);
  }

  async normalKmPerLitre(schoolId: number, vehicleId: number, exceptId = 0): Promise<number | null> {
    const rows = await this.dataSource.query(
      `SELECT id, odometer_km::float AS odometer_km, litres::float AS litres, is_full FROM fuel_logs
       WHERE school_id = $1 AND vehicle_id = $2 AND deleted_at IS NULL AND status = 'approved'
         AND filled_on > ($3::date - $4::int) AND id <> $5`,
      [schoolId, vehicleId, this.books.today(), ECONOMY_WINDOW_DAYS, exceptId],
    );
    const values = [...fillEconomy(rows).values()]
      .map((row) => row.km_per_litre)
      .filter((value): value is number => value !== null);
    return values.length
      ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
      : null;
  }

  private async afterApproved(schoolId: number, log: FuelLog): Promise<void> {
    await this.books.checkBudget(schoolId, log.vehicle_id, log.filled_on);
    if (!log.is_full) return;
    const [view] = await this.present(schoolId, [log]);
    const settings = await this.books.settings(schoolId);
    const normal = await this.normalKmPerLitre(schoolId, log.vehicle_id, log.id);
    if (!view || !mileageDropped(view.km_per_litre, normal, settings.low_mileage_drop_pct)) return;
    await this.notifications
      .dispatch({
        template: LOW_MILEAGE_TEMPLATE,
        audience: { roles: [ROLES.TRANSPORT_INCHARGE, ROLES.ADMIN], school_id: schoolId },
        data: {
          bus: `${view.vehicle.name} (${view.vehicle.registration_no})`,
          kmpl: String(view.km_per_litre),
          normal: String(normal),
          drop: String(Math.round((1 - view.km_per_litre! / normal!) * 100)),
          vehicle_id: log.vehicle_id,
          fuel_id: log.id,
        },
      })
      .catch((error: Error) => this.logger.warn(`Low mileage alert ${log.id} not sent: ${error.message}`));
  }

  private async validate(schoolId: number, dto: FuelDraft & { litres?: number }, current?: FuelLog): Promise<void> {
    const vehicle = await this.maintenance.bus(schoolId, dto.vehicle_id);
    await this.books.assertOpen(schoolId, [dto.filled_on], 'filled_on');
    const errors: FieldError[] = [];
    if (dto.filled_on > todayIn(this.app.timeZone)) {
      errors.push({ field: 'filled_on', message: 'filled_on cannot be in the future' });
    }
    if (vehicle.tank_litres && dto.litres > vehicle.tank_litres) {
      errors.push({
        field: 'litres',
        message: `litres cannot be more than the tank of ${vehicle.registration_no} (${vehicle.tank_litres} L)`,
      });
    }
    const [previous, next] = await this.neighbours(schoolId, dto.vehicle_id, dto.filled_on, current?.id ?? 0);
    const odometer = odometerProblem(dto.odometer_km, previous, next);
    if (odometer) errors.push({ field: 'odometer_km', message: odometer });
    if (dto.filled_by) {
      const [person] = await this.dataSource.query(
        `SELECT id FROM users WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [dto.filled_by, schoolId],
      );
      if (!person) errors.push({ field: 'filled_by', message: 'filled_by must be a user of this school' });
    }
    if (errors.length) throw AppException.validation(errors);
    const [duplicate] = await this.dataSource.query(
      `SELECT id FROM fuel_logs WHERE school_id = $1 AND vehicle_id = $2 AND filled_on = $3 AND odometer_km = $4
         AND deleted_at IS NULL AND status <> 'rejected' AND id <> $5`,
      [schoolId, dto.vehicle_id, dto.filled_on, dto.odometer_km, current?.id ?? 0],
    );
    if (duplicate) {
      throw AppException.conflict(
        `${vehicle.registration_no} already has a fuel entry on ${dto.filled_on} at ${dto.odometer_km} km`,
        'FUEL_DUPLICATE',
      );
    }
    await this.vendors.assertUsable(schoolId, dto.station_id, ['fuel_station'], 'station_id');
    if (dto.bill_file_id && dto.bill_file_id !== current?.bill_file_id) {
      await this.files.assertAttachable(dto.bill_file_id, schoolId, 'bill_file_id');
    }
  }

  private async stationName(stationId: number | null | undefined): Promise<string | null> {
    if (!stationId) return null;
    return (await this.vendors.refs([stationId])).get(stationId)?.name ?? null;
  }

  private approvedSince(
    schoolId: number,
    today: string,
    days: number,
    vehicleId?: number,
  ): Promise<{ km: number | null; litres: number }[]> {
    const params: unknown[] = [schoolId];
    const busFilter = vehicleId ? `AND vehicle_id = $${params.push(vehicleId)}` : '';
    return this.dataSource
      .query(
        `SELECT id, vehicle_id, to_char(filled_on, 'YYYY-MM-DD') AS filled_on, odometer_km::float AS odometer_km,
                litres::float AS litres, is_full
         FROM fuel_logs WHERE school_id = $1 AND deleted_at IS NULL AND status = 'approved' ${busFilter}`,
        params,
      )
      .then(
        (
          rows: {
            id: number;
            vehicle_id: number;
            filled_on: string;
            odometer_km: number;
            litres: number;
            is_full: boolean;
          }[],
        ) => {
          const since = new Date(Date.parse(`${today}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
          const result: { km: number | null; litres: number }[] = [];
          for (const vehicle of new Set(rows.map((row) => Number(row.vehicle_id)))) {
            const own = rows
              .filter((row) => Number(row.vehicle_id) === vehicle)
              .map((row) => ({ ...row, id: Number(row.id) }));
            const economy = fillEconomy(own);
            for (const row of own) {
              const value = economy.get(row.id);
              if (row.filled_on <= since || !value?.km_per_litre) continue;
              result.push({ km: Math.round(value.km_per_litre * row.litres * 10) / 10, litres: row.litres });
            }
          }
          return result;
        },
      );
  }

  private async neighbours(
    schoolId: number,
    vehicleId: number,
    filledOn: string,
    exceptId: number,
  ): Promise<[OdometerReading | null, OdometerReading | null]> {
    const query = (comparison: string, order: string) =>
      this.dataSource.query(
        `SELECT odometer_km::float AS odometer_km, to_char(filled_on, 'YYYY-MM-DD') AS filled_on FROM fuel_logs
         WHERE school_id = $1 AND vehicle_id = $2 AND deleted_at IS NULL AND status <> 'rejected' AND id <> $3 AND filled_on ${comparison} $4
         ORDER BY filled_on ${order}, odometer_km ${order} LIMIT 1`,
        [schoolId, vehicleId, exceptId, filledOn],
      ) as Promise<OdometerReading[]>;
    const [[previous], [next]] = await Promise.all([query('<=', 'DESC'), query('>', 'ASC')]);
    return [previous ?? null, next ?? null];
  }

  private async find(schoolId: number, id: number): Promise<FuelLog> {
    const log = await this.logs.findOneBy({ id, school_id: schoolId });
    if (!log) throw AppException.notFound('Fuel entry not found', 'FUEL_LOG_NOT_FOUND');
    return log;
  }

  private async present(schoolId: number, rows: FuelLog[]): Promise<FuelLogDto[]> {
    if (!rows.length) return [];
    const vehicleIds = [...new Set(rows.map((row) => row.vehicle_id))];
    const [buses, files, people, stations, history, settings] = await Promise.all([
      this.books.busRefs(vehicleIds),
      this.files.presentMany(rows.map((row) => row.bill_file_id)),
      this.books.people(rows.flatMap((row) => [row.filled_by, row.reviewed_by])),
      this.vendors.refs(rows.map((row) => row.station_id)),
      this.dataSource.query(
        `SELECT id, vehicle_id, to_char(filled_on, 'YYYY-MM-DD') AS filled_on, odometer_km::float AS odometer_km,
                litres::float AS litres, amount::float AS amount, is_full, status
         FROM fuel_logs WHERE vehicle_id = ANY($1) AND school_id = $2 AND deleted_at IS NULL AND status <> 'rejected'`,
        [vehicleIds, schoolId],
      ) as Promise<
        {
          id: number;
          vehicle_id: number;
          filled_on: string;
          odometer_km: number;
          litres: number;
          amount: number;
          is_full: boolean;
          status: FuelStatus;
        }[]
      >,
      this.books.settings(schoolId),
    ]);
    const economy = new Map<number, FillEconomy>();
    const previousFull = new Map<number, { filled_on: string; odometer_km: number } | null>();
    const averagePrice = new Map<number, number | null>();
    for (const vehicleId of vehicleIds) {
      const own = history
        .filter((row) => Number(row.vehicle_id) === vehicleId)
        .map((row) => ({ ...row, id: Number(row.id) }))
        .sort((a, b) => a.odometer_km - b.odometer_km || a.id - b.id);
      for (const [id, value] of fillEconomy(own)) economy.set(id, value);
      let lastFull: { filled_on: string; odometer_km: number } | null = null;
      for (const row of own) {
        previousFull.set(row.id, lastFull);
        if (row.is_full) lastFull = { filled_on: row.filled_on, odometer_km: row.odometer_km };
      }
      const priced = own.filter((row) => row.status === 'approved').slice(-10);
      const litres = priced.reduce((sum, row) => sum + row.litres, 0);
      averagePrice.set(
        vehicleId,
        litres > 0 ? Math.round((priced.reduce((sum, row) => sum + row.amount, 0) / litres) * 100) / 100 : null,
      );
    }
    const gpsKm = await this.gpsKmBetween(rows, previousFull);
    return rows.map((row) => {
      const person = row.filled_by ? people.get(row.filled_by) : undefined;
      const value = economy.get(row.id) ?? { km_since_last: null, km_per_litre: null };
      const previous = previousFull.get(row.id) ?? null;
      const odometerKm =
        row.is_full && previous ? Math.round((row.odometer_km - previous.odometer_km) * 10) / 10 : null;
      const gps = gpsKm.get(row.id) ?? null;
      return {
        id: row.id,
        vehicle: buses.get(row.vehicle_id) ?? { id: row.vehicle_id, registration_no: '', name: '' },
        filled_on: row.filled_on,
        litres: row.litres,
        amount: row.amount,
        price_per_litre: pricePerLitre(row.amount, row.litres),
        odometer_km: row.odometer_km,
        km_since_last: value.km_since_last,
        km_per_litre: row.status === 'rejected' ? null : value.km_per_litre,
        station: row.station,
        bill_file: row.bill_file_id ? (files.get(row.bill_file_id) ?? null) : null,
        filled_by: person ?? null,
        is_full: row.is_full,
        status: row.status,
        review_note: row.review_note,
        reviewed_by: row.reviewed_by ? (people.get(row.reviewed_by) ?? null) : null,
        payment_mode: row.payment_mode as PaymentMode,
        reimbursed_at: row.reimbursed_at,
        fuel_station: row.station_id ? (stations.get(row.station_id) ?? null) : null,
        price_warning: priceWarning(
          pricePerLitre(row.amount, row.litres),
          averagePrice.get(row.vehicle_id) ?? null,
          settings.price_warning_pct,
        ),
        gps_check:
          row.is_full && previous ? { odometer_km: odometerKm, gps_km: gps, status: gpsCheck(odometerKm, gps) } : null,
        created_at: row.created_at,
      };
    });
  }

  private async gpsKmBetween(
    rows: FuelLog[],
    previousFull: Map<number, { filled_on: string; odometer_km: number } | null>,
  ): Promise<Map<number, number | null>> {
    const wanted = rows
      .filter((row) => row.is_full && previousFull.get(row.id))
      .map((row) => ({
        id: row.id,
        vehicle_id: row.vehicle_id,
        from: previousFull.get(row.id)!.filled_on,
        to: row.filled_on,
      }));
    if (!wanted.length) return new Map();
    const totals: { id: number; km: number | null; trips: number }[] = await this.dataSource.query(
      `SELECT w.id, SUM(t.gps_km)::float AS km, COUNT(t.id)::int AS trips
       FROM jsonb_to_recordset($1::jsonb) AS w(id int, vehicle_id int, "from" date, "to" date)
       LEFT JOIN transport_trips t ON t.vehicle_id = w.vehicle_id AND t.gps_km IS NOT NULL
        AND t.trip_date >= w."from" AND t.trip_date < w."to"
       GROUP BY w.id`,
      [JSON.stringify(wanted)],
    );
    return new Map(totals.map((row) => [Number(row.id), row.trips ? Math.round(Number(row.km) * 10) / 10 : null]));
  }
}

export function assertReimbursable(mode: PaymentMode, reimbursedAt: Date | null, status?: FuelStatus): void {
  if (mode !== 'driver_paid') {
    throw AppException.conflict('Only entries paid by the driver are paid back', 'NOT_DRIVER_PAID');
  }
  if (status && status !== 'approved') {
    throw AppException.conflict('Approve the fuel entry before paying it back', 'FUEL_NOT_APPROVED');
  }
  if (reimbursedAt) throw AppException.conflict('This was already paid back', 'ALREADY_REIMBURSED');
}
