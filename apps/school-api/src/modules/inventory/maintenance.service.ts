import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, AuthUser, paginate, Paginated } from '@app/common';
import { INVENTORY_TEMPLATES } from '../notifications/inventory-templates.catalog';
import { SequencesService } from '../schools/sequences.service';
import {
  ScheduleDto,
  ScheduleInputDto,
  ScheduleQueryDto,
  ScheduleUpdateDto,
  TicketCancelDto,
  TicketDto,
  TicketInputDto,
  TicketQueryDto,
  TicketResolveDto,
  TicketUpdateDto,
} from './dto/operations.dto';
import { Asset } from './entities/asset.entity';
import { InventoryVendor } from './entities/master.entity';
import { AssetMaintenanceSchedule, AssetMaintenanceTicket, TicketKind } from './entities/operations.entity';
import { daysBetween, documentNumber, maintenanceRefusal, nextDueDate } from './inventory.logic';
import { InventoryNotifyService } from './inventory-notify.service';
import {
  addSearch,
  InventoryReadService,
  num,
  numOrNull,
  orderBy,
  param,
  ref,
  Row,
  SqlFilter,
  str,
} from './inventory-read.service';

const TICKET_SORTS: Record<string, string> = {
  opened_at: 't.opened_at',
  priority: `CASE t.priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END`,
  resolved_at: 't.resolved_at',
};

@Injectable()
export class MaintenanceService {
  private readonly sequences = new SequencesService();

  constructor(
    private readonly dataSource: DataSource,
    private readonly read: InventoryReadService,
    private readonly notify: InventoryNotifyService,
  ) {}

  private ticketSql(filter: SqlFilter, tail: string) {
    return `
      SELECT t.*, a.asset_tag, a.name AS asset_name, a.location_id, l.name AS location_name,
             ru.name AS reported_by_name, au.name AS assigned_name, ast.designation AS assigned_detail, v.name AS vendor_name
      FROM asset_maintenance_tickets t
      JOIN assets a ON a.id = t.asset_id
      LEFT JOIN inventory_locations l ON l.id = a.location_id
      LEFT JOIN users ru ON ru.id = t.reported_by
      LEFT JOIN users au ON au.id = t.assigned_to_user_id
      LEFT JOIN staff ast ON ast.user_id = t.assigned_to_user_id AND ast.school_id = t.school_id AND ast.deleted_at IS NULL
      LEFT JOIN inventory_vendors v ON v.id = t.vendor_id
      WHERE t.deleted_at IS NULL ${filter.where.length ? `AND ${filter.where.join(' AND ')}` : ''} ${tail}`;
  }

  private presentTicket(row: Row): TicketDto {
    const opened = row.opened_at as Date;
    const resolved = (row.resolved_at as Date | null) ?? null;
    const end = resolved ?? new Date();
    return {
      id: num(row.id),
      ticket_no: String(row.ticket_no),
      asset: { id: num(row.asset_id), name: `${row.asset_tag} · ${row.asset_name}` },
      asset_tag: String(row.asset_tag),
      location: ref(row.location_id, row.location_name),
      kind: row.kind as TicketKind,
      title: String(row.title),
      description: str(row.description),
      priority: row.priority as TicketDto['priority'],
      status: row.status as TicketDto['status'],
      reported_by: str(row.reported_by_name),
      assigned_to: row.assigned_to_user_id
        ? { id: num(row.assigned_to_user_id), name: String(row.assigned_name ?? ''), detail: str(row.assigned_detail) }
        : null,
      vendor: ref(row.vendor_id, row.vendor_name),
      under_warranty: Boolean(row.under_warranty),
      cost: numOrNull(row.cost),
      parts: str(row.parts),
      opened_at: opened,
      resolved_at: resolved,
      downtime_days:
        row.status === 'cancelled' ? null : Math.max(0, Math.round((end.getTime() - opened.getTime()) / 86400000)),
      resolution: str(row.resolution),
    };
  }

  async list(schoolId: number, query: TicketQueryDto): Promise<Paginated<TicketDto>> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`t.school_id = ${param(filter, schoolId)}`);
    if (query.status) filter.where.push(`t.status = ${param(filter, query.status)}`);
    if (query.kind) filter.where.push(`t.kind = ${param(filter, query.kind)}`);
    if (query.priority) filter.where.push(`t.priority = ${param(filter, query.priority)}`);
    if (query.asset_id) filter.where.push(`t.asset_id = ${param(filter, query.asset_id)}`);
    if (query.vendor_id) filter.where.push(`t.vendor_id = ${param(filter, query.vendor_id)}`);
    if (query.active !== undefined) {
      filter.where.push(query.active ? `t.status IN ('open', 'in_progress')` : `t.status IN ('resolved', 'cancelled')`);
    }
    addSearch(filter, query.search, ['t.ticket_no', 't.title', 'a.asset_tag', 'a.name']);
    const order = orderBy(TICKET_SORTS, query.sort, 'opened_at', query.order, 't.id DESC');
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM (${this.ticketSql(filter, '')}) counted`,
      filter.params,
    );
    const rows: Row[] = await this.dataSource.query(
      this.ticketSql(filter, `ORDER BY ${order} LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`),
      filter.params,
    );
    return paginate([rows.map((row) => this.presentTicket(row)), Number(total)], query.page, query.limit);
  }

  async get(schoolId: number, id: number): Promise<TicketDto> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`t.school_id = ${param(filter, schoolId)}`, `t.id = ${param(filter, id)}`);
    const [row]: Row[] = await this.dataSource.query(this.ticketSql(filter, ''), filter.params);
    if (!row) throw AppException.notFound('Ticket not found', 'TICKET_NOT_FOUND');
    return this.presentTicket(row);
  }

  private async checkPeople(
    manager: EntityManager,
    schoolId: number,
    dto: { assigned_to_user_id?: number | null; vendor_id?: number | null },
  ) {
    if (dto.assigned_to_user_id) {
      const [staff] = await manager.query(
        `SELECT id FROM staff WHERE user_id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [dto.assigned_to_user_id, schoolId],
      );
      if (!staff) throw AppException.validation([{ field: 'assigned_to_user_id', message: 'Choose a staff member' }]);
    }
    if (dto.vendor_id && !(await manager.existsBy(InventoryVendor, { id: dto.vendor_id, school_id: schoolId }))) {
      throw AppException.validation([{ field: 'vendor_id', message: 'Vendor not found' }]);
    }
  }

  async openInTx(
    manager: EntityManager,
    schoolId: number,
    dto: TicketInputDto & { schedule_id?: number | null },
    actorId: number,
  ): Promise<AssetMaintenanceTicket> {
    const asset = await manager.findOne(Asset, {
      where: { id: dto.asset_id, school_id: schoolId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!asset) throw AppException.notFound('Asset not found', 'ASSET_NOT_FOUND');
    const refusal = maintenanceRefusal(asset.status);
    if (refusal) throw AppException.conflict(refusal.message, refusal.code);
    const [open] = await manager.query(
      `SELECT ticket_no FROM asset_maintenance_tickets WHERE asset_id = $1 AND status IN ('open', 'in_progress') AND deleted_at IS NULL LIMIT 1`,
      [asset.id],
    );
    if (open) throw AppException.conflict(`${asset.asset_tag} already has ticket ${open.ticket_no}`, 'TICKET_OPEN');
    await this.checkPeople(manager, schoolId, dto);
    const today = this.read.today();
    const school = await this.read.schoolInfo(manager, schoolId);
    const year = today.slice(0, 4);
    const ticket = await manager.save(
      manager.create(AssetMaintenanceTicket, {
        school_id: schoolId,
        ticket_no: documentNumber(
          school.code,
          'MNT',
          year,
          await this.sequences.next(manager, schoolId, `inventory_ticket:${year}`),
        ),
        asset_id: asset.id,
        kind: dto.kind ?? 'breakdown',
        title: dto.title,
        description: dto.description ?? null,
        priority: dto.priority ?? 'medium',
        status: 'open',
        reported_by: actorId,
        assigned_to_user_id: dto.assigned_to_user_id ?? null,
        vendor_id: dto.vendor_id ?? null,
        under_warranty: Boolean(
          (asset.warranty_until && asset.warranty_until >= today) || (asset.amc_until && asset.amc_until >= today),
        ),
        opened_at: new Date(),
        schedule_id: dto.schedule_id ?? null,
        created_by: actorId,
      }),
    );
    if (asset.status !== 'allocated' || ticket.kind === 'breakdown') {
      await manager.update(Asset, asset.id, { status: 'in_maintenance' });
    }
    await this.read.logEvents(manager, [
      {
        school_id: schoolId,
        asset_id: asset.id,
        kind: 'maintenance_opened',
        note: `${ticket.ticket_no}: ${ticket.title}`,
        ref_type: 'ticket',
        ref_id: ticket.id,
        actor_id: actorId,
      },
    ]);
    return ticket;
  }

  async open(schoolId: number, dto: TicketInputDto, actor: AuthUser): Promise<TicketDto> {
    const ticket = await this.dataSource.transaction((manager) => this.openInTx(manager, schoolId, dto, actor.id));
    return this.get(schoolId, ticket.id);
  }

  private async activeTicket(manager: EntityManager, schoolId: number, id: number): Promise<AssetMaintenanceTicket> {
    const ticket = await manager.findOne(AssetMaintenanceTicket, {
      where: { id, school_id: schoolId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!ticket) throw AppException.notFound('Ticket not found', 'TICKET_NOT_FOUND');
    if (ticket.status === 'resolved' || ticket.status === 'cancelled') {
      throw AppException.conflict(`This ticket is ${ticket.status}`, 'TICKET_CLOSED');
    }
    return ticket;
  }

  async update(schoolId: number, id: number, dto: TicketUpdateDto): Promise<TicketDto> {
    await this.dataSource.transaction(async (manager) => {
      await this.activeTicket(manager, schoolId, id);
      await this.checkPeople(manager, schoolId, dto);
      const fields = Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined));
      if (Object.keys(fields).length) await manager.update(AssetMaintenanceTicket, id, fields);
    });
    return this.get(schoolId, id);
  }

  private async releaseAsset(manager: EntityManager, assetId: number, condition?: string) {
    const [active] = await manager.query(
      `SELECT id FROM asset_allocations WHERE asset_id = $1 AND status = 'active' AND deleted_at IS NULL`,
      [assetId],
    );
    const asset = await manager.findOneByOrFail(Asset, { id: assetId });
    if (asset.status === 'in_maintenance' || condition) {
      await manager.update(Asset, assetId, {
        ...(asset.status === 'in_maintenance' ? { status: active ? 'allocated' : 'in_store' } : {}),
        ...(condition ? { condition: condition as Asset['condition'] } : {}),
      });
    }
  }

  async resolve(schoolId: number, id: number, dto: TicketResolveDto, actor: AuthUser): Promise<TicketDto> {
    const reporter = await this.dataSource.transaction(async (manager) => {
      const ticket = await this.activeTicket(manager, schoolId, id);
      const now = new Date();
      await manager.update(AssetMaintenanceTicket, id, {
        status: 'resolved',
        resolution: dto.resolution,
        cost: dto.cost ?? null,
        parts: dto.parts ?? null,
        resolved_at: now,
      });
      await this.releaseAsset(manager, ticket.asset_id, dto.condition);
      if (ticket.schedule_id) {
        const schedule = await manager.findOneBy(AssetMaintenanceSchedule, { id: ticket.schedule_id });
        if (schedule) {
          const today = this.read.today();
          await manager.update(AssetMaintenanceSchedule, schedule.id, {
            last_done_on: today,
            next_due_on: nextDueDate(today, schedule.interval_days),
          });
        }
      }
      await this.read.logEvents(manager, [
        {
          school_id: schoolId,
          asset_id: ticket.asset_id,
          kind: 'maintenance_closed',
          note: `${ticket.ticket_no}: ${dto.resolution}${dto.cost ? ` · Rs. ${dto.cost}` : ''}`,
          ref_type: 'ticket',
          ref_id: ticket.id,
          actor_id: actor.id,
        },
      ]);
      return ticket.reported_by;
    });
    const result = await this.get(schoolId, id);
    if (reporter && reporter !== actor.id) {
      const [name] = result.asset.name.split(' · ').slice(1);
      await this.notify.users([reporter], INVENTORY_TEMPLATES.INVENTORY_TICKET_RESOLVED, {
        asset: name ?? result.asset.name,
        tag: result.asset_tag,
        ticket_no: result.ticket_no,
        resolution: dto.resolution,
        ticket_id: String(result.id),
      });
    }
    return result;
  }

  async cancel(schoolId: number, id: number, dto: TicketCancelDto, actor: AuthUser): Promise<TicketDto> {
    await this.dataSource.transaction(async (manager) => {
      const ticket = await this.activeTicket(manager, schoolId, id);
      await manager.update(AssetMaintenanceTicket, id, {
        status: 'cancelled',
        resolution: dto.note,
        resolved_at: new Date(),
      });
      await this.releaseAsset(manager, ticket.asset_id);
      await this.read.logEvents(manager, [
        {
          school_id: schoolId,
          asset_id: ticket.asset_id,
          kind: 'maintenance_closed',
          note: `${ticket.ticket_no} cancelled: ${dto.note}`,
          ref_type: 'ticket',
          ref_id: ticket.id,
          actor_id: actor.id,
        },
      ]);
    });
    return this.get(schoolId, id);
  }

  private scheduleSql(filter: SqlFilter, tail: string) {
    return `
      SELECT ms.*, ms.next_due_on::text AS next_due, ms.last_done_on::text AS last_done, a.asset_tag, a.name AS asset_name,
             v.name AS vendor_name,
             (SELECT t.id FROM asset_maintenance_tickets t WHERE t.schedule_id = ms.id AND t.status IN ('open', 'in_progress')
                AND t.deleted_at IS NULL LIMIT 1) AS open_ticket_id
      FROM asset_maintenance_schedules ms
      JOIN assets a ON a.id = ms.asset_id AND a.deleted_at IS NULL
      LEFT JOIN inventory_vendors v ON v.id = ms.vendor_id
      WHERE ms.deleted_at IS NULL ${filter.where.length ? `AND ${filter.where.join(' AND ')}` : ''} ${tail}`;
  }

  private presentSchedule(row: Row, today: string, alertDays: number): ScheduleDto {
    const due = String(row.next_due);
    return {
      id: num(row.id),
      asset: { id: num(row.asset_id), name: `${row.asset_tag} · ${row.asset_name}` },
      asset_tag: String(row.asset_tag),
      title: String(row.title),
      interval_days: num(row.interval_days),
      next_due_on: due,
      last_done_on: str(row.last_done),
      vendor: ref(row.vendor_id, row.vendor_name),
      is_active: Boolean(row.is_active),
      state: due < today ? 'overdue' : daysBetween(today, due) <= alertDays ? 'due_soon' : 'scheduled',
      open_ticket_id: numOrNull(row.open_ticket_id),
    };
  }

  async schedules(schoolId: number, query: ScheduleQueryDto): Promise<Paginated<ScheduleDto>> {
    const context = await this.read.context(schoolId);
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`ms.school_id = ${param(filter, schoolId)}`);
    if (query.asset_id) filter.where.push(`ms.asset_id = ${param(filter, query.asset_id)}`);
    if (query.state) {
      filter.where.push('ms.is_active');
      const today = param(filter, context.today);
      if (query.state === 'overdue') filter.where.push(`ms.next_due_on < ${today}::date`);
      if (query.state === 'due_soon') {
        filter.where.push(
          `ms.next_due_on >= ${today}::date AND ms.next_due_on <= ${today}::date + ${Number(context.settings.maintenance_alert_days)}`,
        );
      }
      if (query.state === 'scheduled') {
        filter.where.push(`ms.next_due_on > ${today}::date + ${Number(context.settings.maintenance_alert_days)}`);
      }
    }
    addSearch(filter, query.search, ['ms.title', 'a.asset_tag', 'a.name']);
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM (${this.scheduleSql(filter, '')}) counted`,
      filter.params,
    );
    const rows: Row[] = await this.dataSource.query(
      this.scheduleSql(
        filter,
        `ORDER BY ms.is_active DESC, ms.next_due_on ASC, ms.id LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      ),
      filter.params,
    );
    return paginate(
      [
        rows.map((row) => this.presentSchedule(row, context.today, context.settings.maintenance_alert_days)),
        Number(total),
      ],
      query.page,
      query.limit,
    );
  }

  async schedule(schoolId: number, id: number): Promise<ScheduleDto> {
    const context = await this.read.context(schoolId);
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`ms.school_id = ${param(filter, schoolId)}`, `ms.id = ${param(filter, id)}`);
    const [row]: Row[] = await this.dataSource.query(this.scheduleSql(filter, ''), filter.params);
    if (!row) throw AppException.notFound('Schedule not found', 'SCHEDULE_NOT_FOUND');
    return this.presentSchedule(row, context.today, context.settings.maintenance_alert_days);
  }

  async createSchedule(schoolId: number, dto: ScheduleInputDto): Promise<ScheduleDto> {
    const asset = await this.dataSource.getRepository(Asset).findOneBy({ id: dto.asset_id, school_id: schoolId });
    if (!asset) throw AppException.notFound('Asset not found', 'ASSET_NOT_FOUND');
    if (asset.status === 'disposed') throw AppException.conflict('This asset has been disposed', 'ASSET_DISPOSED');
    await this.checkPeople(this.dataSource.manager, schoolId, { vendor_id: dto.vendor_id });
    const saved = await this.dataSource
      .getRepository(AssetMaintenanceSchedule)
      .save(this.dataSource.getRepository(AssetMaintenanceSchedule).create({ ...dto, school_id: schoolId }));
    return this.schedule(schoolId, saved.id);
  }

  async updateSchedule(schoolId: number, id: number, dto: ScheduleUpdateDto): Promise<ScheduleDto> {
    await this.schedule(schoolId, id);
    if (dto.asset_id)
      throw AppException.validation([{ field: 'asset_id', message: 'A schedule cannot move to another asset' }]);
    await this.checkPeople(this.dataSource.manager, schoolId, { vendor_id: dto.vendor_id });
    const fields = Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined));
    if (Object.keys(fields).length) await this.dataSource.getRepository(AssetMaintenanceSchedule).update(id, fields);
    return this.schedule(schoolId, id);
  }

  async startSchedule(schoolId: number, id: number, actor: AuthUser): Promise<TicketDto> {
    const schedule = await this.schedule(schoolId, id);
    if (!schedule.is_active) throw AppException.conflict('This schedule is paused', 'SCHEDULE_PAUSED');
    if (schedule.open_ticket_id)
      throw AppException.conflict('A ticket is already open for this schedule', 'TICKET_OPEN');
    const ticket = await this.dataSource.transaction((manager) =>
      this.openInTx(
        manager,
        schoolId,
        {
          asset_id: schedule.asset.id,
          kind: 'preventive',
          title: schedule.title,
          priority: schedule.state === 'overdue' ? 'high' : 'medium',
          vendor_id: schedule.vendor?.id ?? null,
          schedule_id: schedule.id,
        },
        actor.id,
      ),
    );
    return this.get(schoolId, ticket.id);
  }
}
