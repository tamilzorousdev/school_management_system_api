import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { monthStartIn } from '../../shared/dates';
import { ROLES } from '../access/access.catalog';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Vehicle } from '../transport/entities/vehicle.entity';
import { DriverProblemDto } from './dto/fleet-maintenance.dto';
import {
  BusRefDto,
  CloseTicketDto,
  CreateTicketDto,
  TicketDto,
  TicketInsightsDto,
  TicketQueryDto,
  UpdateTicketDto,
} from './dto/fleet-ops.dto';
import { MaintenanceTicket } from './entities/maintenance-ticket.entity';
import { changedFields, FleetBooksService } from './fleet-books.service';
import { closedAtFor, faultTicket, VehicleFaultEvent } from './fleet-ops.logic';
import { FleetVendorsService } from './fleet-vendors.service';
import { warrantyMatch, WarrantyTicket } from './maintenance-plan.logic';
import { MaintenanceSchedulesService } from './maintenance-schedules.service';

export const VEHICLE_FAULT_TEMPLATE = 'VEHICLE_FAULT';
export const BUS_PROBLEM_TEMPLATE = 'BUS_PROBLEM_REPORTED';

const MONEY_FIELDS = ['cost', 'parts_cost', 'labour_cost', 'vendor', 'vendor_id', 'bill_file_id'] as const;

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger('Maintenance');

  constructor(
    @InjectRepository(MaintenanceTicket) private readonly tickets: Repository<MaintenanceTicket>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    private readonly notifications: NotificationsService,
    private readonly files: FilesService,
    private readonly books: FleetBooksService,
    private readonly vendors: FleetVendorsService,
    private readonly schedules: MaintenanceSchedulesService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async list(schoolId: number, query: TicketQueryDto): Promise<Paginated<TicketDto>> {
    const qb = this.tickets
      .createQueryBuilder('t')
      .leftJoin(Vehicle, 'v', 'v.id = t.vehicle_id')
      .where('t.school_id = :schoolId', { schoolId });
    if (query.status) qb.andWhere('t.status = :status', { status: query.status });
    if (query.source) qb.andWhere('t.source = :source', { source: query.source });
    if (query.kind) qb.andWhere('t.kind = :kind', { kind: query.kind });
    if (query.category) qb.andWhere('t.category = :category', { category: query.category });
    if (query.off_road !== undefined) {
      qb.andWhere(query.off_road ? "t.off_road = true AND t.status <> 'done'" : 't.off_road = false');
    }
    if (query.vehicle_id) qb.andWhere('t.vehicle_id = :vehicle', { vehicle: query.vehicle_id });
    const page = await listQuery(qb, query, {
      searchable: ['t.title', 't.fault_code', 't.vendor', 'v.registration_no', 'v.name'],
      sortable: { opened_at: 't.opened_at', closed_at: 't.closed_at', cost: 't.cost', status: 't.status' },
      defaultSort: 'opened_at',
    });
    return { ...page, items: await this.present(page.items) };
  }

  async insights(schoolId: number, vehicleId?: number): Promise<TicketInsightsDto> {
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'open')::int AS open,
              COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
              COUNT(*) FILTER (WHERE status = 'done')::int AS done,
              COUNT(*) FILTER (WHERE status <> 'done' AND source = 'obd')::int AS obd_open,
              COUNT(DISTINCT vehicle_id) FILTER (WHERE status <> 'done' AND off_road = true)::int AS off_road,
              COALESCE(SUM(cost) FILTER (WHERE status = 'done' AND (closed_at AT TIME ZONE $2)::date >= $3::date), 0)::float AS cost_this_month
       FROM maintenance_tickets
       WHERE school_id = $1 AND deleted_at IS NULL ${vehicleId ? 'AND vehicle_id = $4' : ''}`,
      [schoolId, this.app.timeZone, monthStartIn(this.app.timeZone), ...(vehicleId ? [vehicleId] : [])],
    );
    return {
      total: row.total,
      open: row.open,
      in_progress: row.in_progress,
      done: row.done,
      obd_open: row.obd_open,
      off_road: row.off_road,
      cost_this_month: Math.round(row.cost_this_month * 100) / 100,
    };
  }

  async get(schoolId: number, id: number): Promise<TicketDto> {
    return (await this.present([await this.find(schoolId, id)]))[0]!;
  }

  async create(schoolId: number, dto: CreateTicketDto, actor: AuthUser): Promise<TicketDto> {
    await this.bus(schoolId, dto.vehicle_id);
    await this.assertLinks(schoolId, dto.vehicle_id, dto);
    const saved = await this.tickets.save(
      this.tickets.create({
        school_id: schoolId,
        vehicle_id: dto.vehicle_id,
        source: 'manual',
        kind: dto.kind ?? (dto.schedule_id ? 'service' : 'repair'),
        category: dto.category ?? null,
        schedule_id: dto.schedule_id ?? null,
        fault_code: dto.fault_code ?? null,
        severity: dto.severity ?? null,
        title: dto.title,
        description: dto.description ?? null,
        status: 'open',
        opened_at: new Date(),
        closed_at: null,
        parts_cost: dto.parts_cost ?? null,
        labour_cost: dto.labour_cost ?? null,
        cost: totalCost(dto.cost, dto.parts_cost, dto.labour_cost, null),
        vendor_id: dto.vendor_id ?? null,
        vendor: (await this.vendorName(schoolId, dto.vendor_id)) ?? dto.vendor ?? null,
        bill_file_id: dto.bill_file_id ?? null,
        photo_file_id: dto.photo_file_id ?? null,
        off_road: dto.off_road ?? false,
        warranty_months: dto.warranty_months ?? null,
        warranty_km: dto.warranty_km ?? null,
        odometer_km: dto.odometer_km ?? null,
        notes: dto.notes ?? null,
        telematics_fault_id: null,
        created_by: actor.id,
      }),
    );
    return this.get(schoolId, saved.id);
  }

  async update(schoolId: number, id: number, dto: UpdateTicketDto, actor: AuthUser): Promise<TicketDto> {
    const ticket = await this.find(schoolId, id);
    if (ticket.status === 'done') await this.books.assertOpen(schoolId, [this.dayOf(ticket.closed_at)], 'closed_at');
    await this.assertLinks(schoolId, ticket.vehicle_id, dto, ticket);
    const changes: Partial<MaintenanceTicket> = {};
    for (const key of [
      'title',
      'description',
      'fault_code',
      'severity',
      'vendor',
      'cost',
      'odometer_km',
      'notes',
      'kind',
      'category',
      'schedule_id',
      'parts_cost',
      'labour_cost',
      'vendor_id',
      'bill_file_id',
      'photo_file_id',
      'off_road',
      'warranty_months',
      'warranty_km',
    ] as const) {
      if (dto[key] !== undefined) Object.assign(changes, { [key]: dto[key] });
    }
    if (dto.vendor_id) changes.vendor = await this.vendorName(schoolId, dto.vendor_id);
    if (dto.parts_cost !== undefined || dto.labour_cost !== undefined) {
      changes.cost = totalCost(
        dto.cost,
        dto.parts_cost === undefined ? ticket.parts_cost : dto.parts_cost,
        dto.labour_cost === undefined ? ticket.labour_cost : dto.labour_cost,
        ticket.cost,
      );
    }
    const closing = dto.status === 'done' && ticket.status !== 'done';
    if (dto.status && dto.status !== ticket.status) {
      changes.status = dto.status;
      changes.closed_at = closedAtFor(ticket.status, dto.status, ticket.closed_at, new Date());
      if (closing) changes.off_road = false;
    }
    await this.audit(schoolId, ticket, changes, actor, dto.notes ?? null);
    await this.tickets.save(this.tickets.merge(ticket, changes));
    if (closing) await this.afterClose(schoolId, await this.find(schoolId, id));
    return this.get(schoolId, id);
  }

  async close(schoolId: number, id: number, dto: CloseTicketDto, actor: AuthUser): Promise<TicketDto> {
    const ticket = await this.find(schoolId, id);
    if (ticket.status === 'done') throw AppException.conflict('This ticket is already closed', 'TICKET_CLOSED');
    await this.assertLinks(schoolId, ticket.vehicle_id, dto, ticket);
    const changes: Partial<MaintenanceTicket> = { status: 'done', closed_at: new Date(), off_road: false };
    for (const key of [
      'cost',
      'vendor',
      'odometer_km',
      'notes',
      'parts_cost',
      'labour_cost',
      'vendor_id',
      'bill_file_id',
      'warranty_months',
      'warranty_km',
    ] as const) {
      if (dto[key] !== undefined) Object.assign(changes, { [key]: dto[key] });
    }
    if (dto.vendor_id) changes.vendor = await this.vendorName(schoolId, dto.vendor_id);
    if (dto.parts_cost !== undefined || dto.labour_cost !== undefined) {
      changes.cost = totalCost(
        dto.cost,
        dto.parts_cost === undefined ? ticket.parts_cost : dto.parts_cost,
        dto.labour_cost === undefined ? ticket.labour_cost : dto.labour_cost,
        ticket.cost,
      );
    }
    await this.audit(schoolId, ticket, changes, actor, null);
    await this.tickets.save(this.tickets.merge(ticket, changes));
    await this.afterClose(schoolId, await this.find(schoolId, id));
    return this.get(schoolId, id);
  }

  async remove(schoolId: number, id: number, actor: AuthUser, reason: string | null): Promise<void> {
    const ticket = await this.find(schoolId, id);
    if (ticket.status === 'done') await this.books.assertOpen(schoolId, [this.dayOf(ticket.closed_at)], 'closed_at');
    await this.books.record(schoolId, {
      entity: 'ticket',
      entity_id: ticket.id,
      vehicle_id: ticket.vehicle_id,
      action: 'delete',
      before: { title: ticket.title, status: ticket.status, cost: ticket.cost, vendor: ticket.vendor },
      after: null,
      note: reason,
      actor,
    });
    await this.tickets.softDelete(ticket.id);
  }

  async reportFromDriver(
    schoolId: number,
    vehicle: Vehicle,
    dto: DriverProblemDto,
    actor: AuthUser,
  ): Promise<TicketDto> {
    if (dto.photo_file_id) await this.files.assertAttachable(dto.photo_file_id, schoolId, 'photo_file_id');
    const saved = await this.tickets.save(
      this.tickets.create({
        school_id: schoolId,
        vehicle_id: vehicle.id,
        source: 'driver',
        kind: 'repair',
        category: dto.category ?? null,
        title: dto.title,
        description: dto.description ?? null,
        status: 'open',
        opened_at: new Date(),
        photo_file_id: dto.photo_file_id ?? null,
        odometer_km: dto.odometer_km ?? null,
        reported_by: actor.id,
        created_by: actor.id,
      }),
    );
    await this.notifyProblem(schoolId, vehicle, dto.title, actor.name ?? 'The driver', saved.id);
    return this.get(schoolId, saved.id);
  }

  async openFromCheck(
    schoolId: number,
    vehicle: Vehicle,
    input: { title: string; description: string; photo_file_id: number | null; odometer_km: number | null },
    actor: AuthUser,
  ): Promise<number> {
    const saved = await this.tickets.save(
      this.tickets.create({
        school_id: schoolId,
        vehicle_id: vehicle.id,
        source: 'driver',
        kind: 'repair',
        title: input.title.slice(0, 150),
        description: input.description.slice(0, 1000),
        status: 'open',
        opened_at: new Date(),
        photo_file_id: input.photo_file_id,
        odometer_km: input.odometer_km,
        reported_by: actor.id,
        created_by: actor.id,
      }),
    );
    await this.notifyProblem(schoolId, vehicle, input.title, actor.name ?? 'The driver', saved.id);
    return saved.id;
  }

  async openCount(schoolId: number, vehicleId: number): Promise<number> {
    return this.tickets.count({
      where: { school_id: schoolId, vehicle_id: vehicleId, status: In(['open', 'in_progress']) },
    });
  }

  async isOffRoad(schoolId: number, vehicleId: number): Promise<boolean> {
    return (
      (await this.tickets.count({
        where: { school_id: schoolId, vehicle_id: vehicleId, off_road: true, status: In(['open', 'in_progress']) },
      })) > 0
    );
  }

  async forBus(schoolId: number, vehicleId: number, open: boolean, limit: number): Promise<TicketDto[]> {
    const rows = await this.tickets.find({
      where: open
        ? { school_id: schoolId, vehicle_id: vehicleId, status: In(['open', 'in_progress']) }
        : { school_id: schoolId, vehicle_id: vehicleId, status: 'done', kind: 'service' },
      order: open ? { opened_at: 'DESC' } : { closed_at: 'DESC' },
      take: limit,
    });
    return this.present(rows);
  }

  async fromTelematics(event: VehicleFaultEvent): Promise<{ accepted: boolean }> {
    const draft = faultTicket(event);
    if (!draft) return { accepted: false };
    const vehicle = await this.vehicles.findOneBy({ device_id: draft.device_id });
    if (!vehicle) return { accepted: false };
    const already = await this.tickets.findOneBy({
      school_id: vehicle.school_id,
      vehicle_id: vehicle.id,
      fault_code: draft.fault_code,
      status: In(['open', 'in_progress']),
    });
    if (already) return { accepted: true };
    const inserted = await this.tickets
      .createQueryBuilder()
      .insert()
      .values({
        school_id: vehicle.school_id,
        vehicle_id: vehicle.id,
        source: 'obd',
        fault_code: draft.fault_code,
        severity: draft.severity,
        title: draft.title,
        description: draft.description,
        status: 'open',
        opened_at: draft.opened_at,
        closed_at: null,
        odometer_km: draft.odometer_km,
        telematics_fault_id: draft.telematics_fault_id,
      })
      .orIgnore()
      .returning('id')
      .execute();
    if (!(inserted.raw as unknown[] | undefined)?.length) return { accepted: true };
    this.logger.log(`Bus ${vehicle.registration_no}: ticket opened for ${draft.fault_code}`);
    await this.notifications
      .dispatch({
        template: VEHICLE_FAULT_TEMPLATE,
        audience: { roles: [ROLES.TRANSPORT_INCHARGE, ROLES.ADMIN], school_id: vehicle.school_id },
        data: {
          bus: `${vehicle.name} (${vehicle.registration_no})`,
          code: draft.fault_code,
          fault: draft.description,
          severity: draft.severity ?? 'medium',
        },
      })
      .catch((error: Error) =>
        this.logger.warn(`VEHICLE_FAULT for ${vehicle.registration_no} not sent: ${error.message}`),
      );
    return { accepted: true };
  }

  async bus(schoolId: number, vehicleId: number): Promise<Vehicle> {
    const vehicle = await this.vehicles.findOneBy({ id: vehicleId, school_id: schoolId });
    if (!vehicle) throw AppException.notFound('Bus not found', 'VEHICLE_NOT_FOUND');
    return vehicle;
  }

  async busRefs(ids: number[]): Promise<Map<number, BusRefDto>> {
    return this.books.busRefs(ids);
  }

  private async afterClose(schoolId: number, ticket: MaintenanceTicket): Promise<void> {
    const closedOn = this.dayOf(ticket.closed_at) ?? this.books.today();
    if (ticket.kind === 'service') {
      await this.schedules.markDone(
        schoolId,
        { schedule_id: ticket.schedule_id, vehicle_id: ticket.vehicle_id, category: ticket.category },
        closedOn,
        ticket.odometer_km,
      );
    }
    await this.books.checkBudget(schoolId, ticket.vehicle_id, closedOn);
  }

  private async audit(
    schoolId: number,
    ticket: MaintenanceTicket,
    changes: Partial<MaintenanceTicket>,
    actor: AuthUser,
    note: string | null,
  ): Promise<void> {
    const money = Object.fromEntries(
      MONEY_FIELDS.filter((key) => changes[key] !== undefined).map((key) => [key, changes[key]]),
    );
    const diff = changedFields(ticket as unknown as Record<string, unknown>, money);
    if (!diff) return;
    await this.books.record(schoolId, {
      entity: 'ticket',
      entity_id: ticket.id,
      vehicle_id: ticket.vehicle_id,
      action: 'update',
      ...diff,
      note,
      actor,
    });
  }

  private async assertLinks(
    schoolId: number,
    vehicleId: number,
    dto: {
      vendor_id?: number | null;
      schedule_id?: number | null;
      bill_file_id?: number | null;
      photo_file_id?: number | null;
    },
    current?: MaintenanceTicket,
  ): Promise<void> {
    await this.vendors.assertUsable(schoolId, dto.vendor_id, ['garage', 'other'], 'vendor_id');
    await this.schedules.assertForBus(schoolId, dto.schedule_id, vehicleId);
    if (dto.bill_file_id && dto.bill_file_id !== current?.bill_file_id) {
      await this.files.assertAttachable(dto.bill_file_id, schoolId, 'bill_file_id');
    }
    if (dto.photo_file_id && dto.photo_file_id !== current?.photo_file_id) {
      await this.files.assertAttachable(dto.photo_file_id, schoolId, 'photo_file_id');
    }
  }

  private async vendorName(schoolId: number, vendorId: number | null | undefined): Promise<string | null> {
    if (!vendorId) return null;
    return (await this.vendors.refs([vendorId])).get(vendorId)?.name ?? null;
  }

  private async notifyProblem(schoolId: number, vehicle: Vehicle, problem: string, by: string, ticketId: number) {
    await this.notifications
      .dispatch({
        template: BUS_PROBLEM_TEMPLATE,
        audience: { roles: [ROLES.TRANSPORT_INCHARGE, ROLES.ADMIN], school_id: schoolId },
        data: { bus: `${vehicle.name} (${vehicle.registration_no})`, problem, by, ticket_id: ticketId },
      })
      .catch((error: Error) =>
        this.logger.warn(`Problem report for ${vehicle.registration_no} not sent: ${error.message}`),
      );
  }

  private dayOf(at: Date | null): string | null {
    return at ? at.toLocaleDateString('en-CA', { timeZone: this.app.timeZone }) : null;
  }

  private async find(schoolId: number, id: number): Promise<MaintenanceTicket> {
    const ticket = await this.tickets.findOneBy({ id, school_id: schoolId });
    if (!ticket) throw AppException.notFound('Maintenance ticket not found', 'TICKET_NOT_FOUND');
    return ticket;
  }

  private async present(rows: MaintenanceTicket[]): Promise<TicketDto[]> {
    if (!rows.length) return [];
    const vehicleIds = rows.map((row) => row.vehicle_id);
    const [buses, garages, files, people, km, earlier] = await Promise.all([
      this.books.busRefs(vehicleIds),
      this.vendors.refs(rows.map((row) => row.vendor_id)),
      this.files.presentMany(rows.flatMap((row) => [row.bill_file_id, row.photo_file_id])),
      this.books.people(rows.map((row) => row.reported_by)),
      this.books.currentKm(vehicleIds),
      this.tickets.find({
        where: { vehicle_id: In([...new Set(vehicleIds)]), status: 'done' },
        order: { closed_at: 'DESC' },
      }),
    ]);
    return rows.map((row) => {
      const before: WarrantyTicket[] = earlier.filter(
        (item) =>
          item.vehicle_id === row.vehicle_id && item.id !== row.id && item.closed_at && item.closed_at <= row.opened_at,
      );
      return {
        id: row.id,
        vehicle: buses.get(row.vehicle_id) ?? { id: row.vehicle_id, registration_no: '', name: '' },
        source: row.source,
        fault_code: row.fault_code,
        severity: row.severity,
        title: row.title,
        description: row.description,
        status: row.status,
        opened_at: row.opened_at,
        closed_at: row.closed_at,
        cost: row.cost,
        vendor: row.vendor,
        odometer_km: row.odometer_km,
        notes: row.notes,
        kind: row.kind,
        category: row.category,
        schedule_id: row.schedule_id,
        parts_cost: row.parts_cost,
        labour_cost: row.labour_cost,
        garage: row.vendor_id ? (garages.get(row.vendor_id) ?? null) : null,
        bill_file: row.bill_file_id ? (files.get(row.bill_file_id) ?? null) : null,
        photo_file: row.photo_file_id ? (files.get(row.photo_file_id) ?? null) : null,
        off_road: row.off_road && row.status !== 'done',
        warranty_months: row.warranty_months,
        warranty_km: row.warranty_km,
        warranty_claim: warrantyMatch(
          before,
          row.category,
          this.dayOf(row.opened_at) ?? this.books.today(),
          row.odometer_km ?? km.get(row.vehicle_id)?.km ?? null,
          this.app.timeZone,
        ),
        reported_by: row.reported_by ? (people.get(row.reported_by) ?? null) : null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });
  }
}

export function totalCost(
  cost: number | null | undefined,
  parts: number | null | undefined,
  labour: number | null | undefined,
  fallback: number | null,
): number | null {
  if (parts == null && labour == null) return cost ?? fallback;
  return Math.round(((parts ?? 0) + (labour ?? 0)) * 100) / 100;
}
