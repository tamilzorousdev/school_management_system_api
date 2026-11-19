import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { monthStartIn, todayIn } from '../../shared/dates';
import { ROLES } from '../access/access.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { Vehicle } from '../transport/entities/vehicle.entity';
import { BusRefDto } from './dto/fleet-ops.dto';
import {
  ChangeDto,
  ChangeQueryDto,
  FleetSettingsDto,
  UpdateFleetSettingsDto,
  UpdateVehiclePlanDto,
} from './dto/fleet-maintenance.dto';
import { ChangeAction, ChangeEntity, FleetEntryChange, FleetSettings } from './entities/fleet-maintenance.entity';
import { isLocked, isMonthEnd } from './maintenance-plan.logic';

export const BUDGET_EXCEEDED_TEMPLATE = 'BUS_BUDGET_EXCEEDED';

export interface CurrentKm {
  km: number | null;
  source: 'tracker' | 'entries' | 'none';
}

const round2 = (value: number) => Math.round(value * 100) / 100;

const formatDay = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

export function changeSummary(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string {
  if (!before && after) return 'Added';
  if (before && !after) return 'Deleted';
  const keys = Object.keys({ ...before, ...after });
  return keys.map((key) => `${key} ${String(before?.[key] ?? '–')} → ${String(after?.[key] ?? '–')}`).join(', ');
}

export function changedFields(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue;
    const old = current[key] ?? null;
    if (String(old) === String(value ?? null)) continue;
    before[key] = old;
    after[key] = value;
  }
  return Object.keys(after).length ? { before, after } : null;
}

@Injectable()
export class FleetBooksService {
  private readonly logger = new Logger('FleetBooks');

  constructor(
    @InjectRepository(FleetSettings) private readonly settingsRepo: Repository<FleetSettings>,
    @InjectRepository(FleetEntryChange) private readonly changesRepo: Repository<FleetEntryChange>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  get timeZone(): string {
    return this.app.timeZone;
  }

  today(): string {
    return todayIn(this.app.timeZone);
  }

  async settings(schoolId: number): Promise<FleetSettings> {
    const found = await this.settingsRepo.findOneBy({ school_id: schoolId });
    if (found) return found;
    await this.settingsRepo.createQueryBuilder().insert().values({ school_id: schoolId }).orIgnore().execute();
    return this.settingsRepo.findOneByOrFail({ school_id: schoolId });
  }

  async view(schoolId: number): Promise<FleetSettingsDto> {
    const row = await this.settings(schoolId);
    return {
      due_soon_km: row.due_soon_km,
      due_soon_days: row.due_soon_days,
      low_mileage_drop_pct: row.low_mileage_drop_pct,
      price_warning_pct: row.price_warning_pct,
      idle_litres_per_hour: Number(row.idle_litres_per_hour),
      pre_trip_check_required: row.pre_trip_check_required,
      locked_until: row.locked_until,
    };
  }

  async update(schoolId: number, dto: UpdateFleetSettingsDto, actor: AuthUser): Promise<FleetSettingsDto> {
    const row = await this.settings(schoolId);
    if (dto.locked_until) {
      if (!isMonthEnd(dto.locked_until)) {
        throw AppException.validation([
          { field: 'locked_until', message: 'locked_until must be the last day of a month' },
        ]);
      }
      if (dto.locked_until >= monthStartIn(this.app.timeZone)) {
        throw AppException.validation([
          { field: 'locked_until', message: 'Only months that have ended can be locked' },
        ]);
      }
    }
    const before = await this.view(schoolId);
    const next: Partial<FleetSettings> = {};
    for (const key of [
      'due_soon_km',
      'due_soon_days',
      'low_mileage_drop_pct',
      'price_warning_pct',
      'idle_litres_per_hour',
      'pre_trip_check_required',
      'locked_until',
    ] as const) {
      if (dto[key] !== undefined) Object.assign(next, { [key]: dto[key] });
    }
    await this.settingsRepo.update(row.id, { ...next, updated_by: actor.id, updated_at: new Date() });
    const after = await this.view(schoolId);
    const diff = changedFields(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
    );
    if (diff) {
      await this.record(schoolId, {
        entity: 'settings',
        entity_id: row.id,
        vehicle_id: null,
        action: dto.locked_until !== undefined && before.locked_until !== after.locked_until ? 'lock' : 'update',
        ...diff,
        actor,
      });
    }
    return after;
  }

  async assertOpen(schoolId: number, dates: (string | null | undefined)[], field: string): Promise<void> {
    const { locked_until: lockedUntil } = await this.settings(schoolId);
    if (!lockedUntil) return;
    if (dates.some((date) => isLocked(date ?? null, lockedUntil))) {
      throw AppException.conflict(
        `Entries up to ${formatDay(lockedUntil)} are locked (${field}). Unlock the month in Maintenance settings to change them.`,
        'MONTH_LOCKED',
      );
    }
  }

  async record(
    schoolId: number,
    entry: {
      entity: ChangeEntity;
      entity_id: number;
      vehicle_id: number | null;
      action: ChangeAction;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
      note?: string | null;
      actor: AuthUser;
    },
  ): Promise<void> {
    await this.changesRepo.save(
      this.changesRepo.create({
        school_id: schoolId,
        entity: entry.entity,
        entity_id: entry.entity_id,
        vehicle_id: entry.vehicle_id,
        action: entry.action,
        before: entry.before,
        after: entry.after,
        note: entry.note ?? null,
        created_by: entry.actor.id,
      }),
    );
  }

  async changes(schoolId: number, query: ChangeQueryDto): Promise<Paginated<ChangeDto>> {
    const qb = this.changesRepo.createQueryBuilder('c').where('c.school_id = :schoolId', { schoolId });
    if (query.entity) qb.andWhere('c.entity = :entity', { entity: query.entity });
    if (query.entity_id) qb.andWhere('c.entity_id = :entityId', { entityId: query.entity_id });
    if (query.vehicle_id) qb.andWhere('c.vehicle_id = :vehicleId', { vehicleId: query.vehicle_id });
    const page = await listQuery(qb, query, {
      searchable: ['c.note', 'c.action', 'c.entity'],
      sortable: { created_at: 'c.created_at' },
      defaultSort: 'created_at',
    });
    const [buses, people] = await Promise.all([
      this.busRefs(page.items.map((row) => row.vehicle_id).filter((id): id is number => id !== null)),
      this.people(page.items.map((row) => row.created_by)),
    ]);
    return {
      ...page,
      items: page.items.map((row) => ({
        id: row.id,
        entity: row.entity,
        entity_id: row.entity_id,
        vehicle: row.vehicle_id ? (buses.get(row.vehicle_id) ?? null) : null,
        action: row.action,
        before: row.before,
        after: row.after,
        note: row.note,
        summary: changeSummary(row.before, row.after),
        changed_by: row.created_by ? (people.get(row.created_by) ?? null) : null,
        at: row.created_at,
      })),
    };
  }

  async bus(schoolId: number, vehicleId: number): Promise<Vehicle> {
    const vehicle = await this.vehicles.findOneBy({ id: vehicleId, school_id: schoolId });
    if (!vehicle) throw AppException.notFound('Bus not found', 'VEHICLE_NOT_FOUND');
    return vehicle;
  }

  async updatePlan(schoolId: number, vehicleId: number, dto: UpdateVehiclePlanDto): Promise<Vehicle> {
    const vehicle = await this.bus(schoolId, vehicleId);
    const changes: Partial<Vehicle> = {};
    if (dto.tank_litres !== undefined) changes.tank_litres = dto.tank_litres;
    if (dto.monthly_budget !== undefined) {
      changes.monthly_budget = dto.monthly_budget;
      changes.budget_alerted_month = null;
    }
    if (Object.keys(changes).length) await this.vehicles.update(vehicle.id, changes);
    await this.checkBudget(schoolId, vehicle.id, this.today());
    return this.bus(schoolId, vehicleId);
  }

  async currentKm(vehicleIds: number[]): Promise<Map<number, CurrentKm>> {
    if (!vehicleIds.length) return new Map();
    const rows: { id: number; tracker: number | null; entries: number | null }[] = await this.dataSource.query(
      `SELECT v.id, v.tracker_odometer_km::float AS tracker,
              GREATEST(
                (SELECT MAX(f.odometer_km) FROM fuel_logs f
                 WHERE f.vehicle_id = v.id AND f.deleted_at IS NULL AND f.status <> 'rejected'),
                (SELECT MAX(t.odometer_km) FROM maintenance_tickets t WHERE t.vehicle_id = v.id AND t.deleted_at IS NULL),
                (SELECT MAX(c.odometer_km) FROM pre_trip_checks c WHERE c.vehicle_id = v.id AND c.deleted_at IS NULL),
                (SELECT MAX(s.last_done_km) FROM maintenance_schedules s WHERE s.vehicle_id = v.id AND s.deleted_at IS NULL)
              )::float AS entries
       FROM vehicles v WHERE v.id = ANY($1)`,
      [[...new Set(vehicleIds)]],
    );
    return new Map<number, CurrentKm>(
      rows.map((row): [number, CurrentKm] => {
        const tracker = row.tracker === null ? null : Number(row.tracker);
        const entries = row.entries === null ? null : Number(row.entries);
        if (tracker !== null && (entries === null || tracker >= entries)) {
          return [Number(row.id), { km: tracker, source: 'tracker' }];
        }
        return [Number(row.id), entries === null ? { km: null, source: 'none' } : { km: entries, source: 'entries' }];
      }),
    );
  }

  async spentInMonth(schoolId: number, vehicleIds: number[] | null, month: string): Promise<Map<number, number>> {
    const from = `${month}-01`;
    const rows: { vehicle_id: number; amount: number }[] = await this.dataSource.query(
      `SELECT vehicle_id, SUM(amount)::float AS amount FROM (
         SELECT vehicle_id, amount FROM fuel_logs
         WHERE school_id = $1 AND deleted_at IS NULL AND status = 'approved'
           AND filled_on >= $2::date AND filled_on < ($2::date + interval '1 month')
         UNION ALL
         SELECT vehicle_id, cost FROM maintenance_tickets
         WHERE school_id = $1 AND deleted_at IS NULL AND status = 'done' AND cost IS NOT NULL
           AND (closed_at AT TIME ZONE $3)::date >= $2::date AND (closed_at AT TIME ZONE $3)::date < ($2::date + interval '1 month')
         UNION ALL
         SELECT vehicle_id, amount FROM vehicle_expenses
         WHERE school_id = $1 AND deleted_at IS NULL
           AND spent_on >= $2::date AND spent_on < ($2::date + interval '1 month')
       ) spend
       ${vehicleIds ? 'WHERE vehicle_id = ANY($4)' : ''}
       GROUP BY vehicle_id`,
      vehicleIds ? [schoolId, from, this.app.timeZone, vehicleIds] : [schoolId, from, this.app.timeZone],
    );
    return new Map(rows.map((row) => [Number(row.vehicle_id), round2(Number(row.amount))]));
  }

  async checkBudget(schoolId: number, vehicleId: number, onDate: string | null): Promise<void> {
    const month = (onDate ?? this.today()).slice(0, 7);
    if (month !== this.today().slice(0, 7)) return;
    const vehicle = await this.vehicles.findOneBy({ id: vehicleId, school_id: schoolId });
    if (!vehicle?.monthly_budget || vehicle.budget_alerted_month === month) return;
    const spent = (await this.spentInMonth(schoolId, [vehicleId], month)).get(vehicleId) ?? 0;
    if (spent <= Number(vehicle.monthly_budget)) return;
    await this.vehicles.update(vehicle.id, { budget_alerted_month: month });
    await this.notifications
      .dispatch({
        template: BUDGET_EXCEEDED_TEMPLATE,
        audience: { roles: [ROLES.TRANSPORT_INCHARGE, ROLES.ADMIN], school_id: schoolId },
        data: {
          bus: `${vehicle.name} (${vehicle.registration_no})`,
          spent: spent.toLocaleString('en-IN'),
          budget: Number(vehicle.monthly_budget).toLocaleString('en-IN'),
          vehicle_id: vehicle.id,
        },
      })
      .catch((error: Error) =>
        this.logger.warn(`Budget alert for ${vehicle.registration_no} not sent: ${error.message}`),
      );
  }

  async busRefs(ids: number[]): Promise<Map<number, BusRefDto>> {
    if (!ids.length) return new Map();
    const rows = await this.vehicles.find({
      where: [...new Set(ids)].map((id) => ({ id })),
      withDeleted: true,
    });
    return new Map(rows.map((row) => [row.id, { id: row.id, registration_no: row.registration_no, name: row.name }]));
  }

  async people(ids: (number | null)[]): Promise<Map<number, { id: number; name: string }>> {
    const wanted = [...new Set(ids.filter((id): id is number => typeof id === 'number'))];
    if (!wanted.length) return new Map();
    const rows: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT id, name FROM users WHERE id = ANY($1)`,
      [wanted],
    );
    return new Map(rows.map((row) => [Number(row.id), { id: Number(row.id), name: row.name }]));
  }
}
