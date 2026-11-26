import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, Not } from 'typeorm';
import { AppException, AuthUser, Paginated, paginate } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { FeeFinesService } from '../fees/fee-fines.service';
import { HOSTEL_TEMPLATES } from '../notifications/hostel-templates.catalog';
import { SequencesService } from '../schools/sequences.service';
import {
  ComplaintActionDto,
  ComplaintDetailDto,
  ComplaintDto,
  ComplaintInputDto,
  ComplaintPatchDto,
  ComplaintQueryDto,
  ConductInsightsDto,
  ParentComplaintInputDto,
  RatingDto,
  TicketChangeDto,
  TicketChargeDto,
  TicketDetailDto,
  TicketDto,
  TicketInputDto,
  TicketQueryDto,
  TicketUpdateDto,
} from './dto/hostel-conduct.dto';
import { HostelAdmission } from './entities/hostel-admission.entity';
import {
  HostelComplaint,
  HostelMaintenanceTicket,
  HostelTicketUpdate,
  UpdateTarget,
} from './entities/hostel-conduct.entity';
import { HostelBed, HostelRoom } from './entities/hostel.entity';
import { STUDENT_COLUMNS, studentFromRow, studentJoins, escapeLike } from './hostel-sql';
import { HostelAuditService } from './hostel-audit.service';
import { HostelNotifyService } from './hostel-notify.service';
import {
  ComplaintAction,
  complaintMove,
  ComplaintState,
  serialNumber,
  slaDueAt,
  ticketCanMove,
  TicketPriority,
} from './hostel.logic';

const COMPLAINT_SORTS: Record<string, string> = {
  created_at: 'c.created_at',
  due_at: 'c.due_at',
  priority: 'c.priority',
};
const TICKET_SORTS: Record<string, string> = {
  created_at: 't.created_at',
  due_at: 't.due_at',
  scheduled_on: 't.scheduled_on',
};
const OPEN_COMPLAINT = ['open', 'in_progress'];
const OPEN_TICKET = ['open', 'assigned', 'in_progress', 'on_hold'];
@Injectable()
export class HostelTicketsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sequences: SequencesService,
    private readonly fines: FeeFinesService,
    private readonly notify: HostelNotifyService,
    private readonly audit: HostelAuditService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async complaints(schoolId: number, query: ComplaintQueryDto): Promise<Paginated<ComplaintDto>> {
    const params: unknown[] = [schoolId];
    const where = ['c.school_id = $1', 'c.deleted_at IS NULL'];
    if (query.hostel_id) where.push(`c.hostel_id = $${params.push(query.hostel_id)}`);
    if (query.admission_id) where.push(`c.admission_id = $${params.push(query.admission_id)}`);
    if (query.status) where.push(`c.status = $${params.push(query.status)}`);
    if (query.category) where.push(`c.category = $${params.push(query.category)}`);
    if (query.priority) where.push(`c.priority = $${params.push(query.priority)}`);
    if (query.overdue) where.push(`c.status IN ('open', 'in_progress') AND c.due_at < now()`);
    this.addSearch(where, params, query.search, [
      'c.complaint_no',
      'c.title',
      'r.room_no',
      's.first_name',
      's.last_name',
    ]);
    const sort = this.sortOf(COMPLAINT_SORTS, query.sort ?? 'created_at');
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const from = `${this.complaintFrom()} WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    const rows = await this.dataSource.query(
      `SELECT ${this.complaintColumns()} ${from} ORDER BY ${sort} ${order}, c.id ${order}
       LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    return paginate(
      [rows.map((row: Record<string, unknown>) => this.toComplaint(row)), total],
      query.page,
      query.limit,
    );
  }

  async complaint(schoolId: number, id: number): Promise<ComplaintDetailDto> {
    const rows = await this.dataSource.query(
      `SELECT ${this.complaintColumns()} ${this.complaintFrom()} WHERE c.school_id = $1 AND c.id = $2 AND c.deleted_at IS NULL`,
      [schoolId, id],
    );
    if (!rows.length) throw AppException.notFound('Complaint not found', 'HOSTEL_COMPLAINT_NOT_FOUND');
    return { ...this.toComplaint(rows[0]), updates: await this.updates('complaint', id) };
  }

  async createComplaint(schoolId: number, dto: ComplaintInputDto, actor: AuthUser): Promise<ComplaintDetailDto> {
    const place = await this.place(schoolId, dto.hostel_id, dto.room_id, dto.admission_id);
    const id = await this.insertComplaint(schoolId, place, dto, dto.priority ?? 'normal', 'staff', actor);
    return this.complaint(schoolId, id);
  }

  async createParentComplaint(
    schoolId: number,
    admissionId: number,
    dto: ParentComplaintInputDto,
    actor: AuthUser,
  ): Promise<ComplaintDetailDto> {
    const place = await this.place(schoolId, undefined, undefined, admissionId);
    const id = await this.insertComplaint(schoolId, place, dto, 'normal', 'parent', actor);
    const item = await this.complaint(schoolId, id);
    await this.notify.tellWardens(schoolId, admissionId, HOSTEL_TEMPLATES.HOSTEL_COMPLAINT_NEW, {
      complaint_no: item.complaint_no,
      title: item.title,
      complaint_id: String(id),
    });
    return item;
  }

  async patchComplaint(
    schoolId: number,
    id: number,
    dto: ComplaintPatchDto,
    actor: AuthUser,
  ): Promise<ComplaintDetailDto> {
    if (dto.assigned_to) await this.ensureStaff(schoolId, dto.assigned_to);
    const before = await this.dataSource.transaction(async (manager) => {
      const row = await this.lockComplaint(manager, schoolId, id);
      if (!OPEN_COMPLAINT.includes(row.status)) {
        throw AppException.conflict(`This complaint is ${row.status}`, 'HOSTEL_COMPLAINT_STATE');
      }
      const previous = row.assigned_to;
      if (dto.priority) Object.assign(row, { priority: dto.priority, due_at: slaDueAt(row.created_at, dto.priority) });
      if (dto.assigned_to !== undefined) row.assigned_to = dto.assigned_to;
      await manager.save(row);
      const parts = [
        dto.priority ? `Priority ${dto.priority}` : null,
        dto.assigned_to !== undefined ? (dto.assigned_to ? 'Assigned' : 'Unassigned') : null,
        dto.note ?? null,
      ].filter(Boolean);
      await this.addUpdate(manager, schoolId, 'complaint', id, null, parts.join(' · ') || null, actor);
      return previous;
    });
    const item = await this.complaint(schoolId, id);
    if (dto.assigned_to && dto.assigned_to !== before) {
      await this.notify.tellUsers([dto.assigned_to], HOSTEL_TEMPLATES.HOSTEL_TICKET_ASSIGNED, {
        number: item.complaint_no,
        title: item.title,
        place: [item.hostel_name, item.room_no].filter(Boolean).join(' · '),
        complaint_id: String(id),
      });
    }
    return item;
  }

  async actComplaint(
    schoolId: number,
    id: number,
    action: ComplaintAction,
    dto: ComplaintActionDto,
    actor: AuthUser,
  ): Promise<ComplaintDetailDto> {
    if (['resolve', 'reject'].includes(action) && !dto.note) {
      throw AppException.validation([{ field: 'note', message: 'Say what was done' }]);
    }
    const status = await this.dataSource.transaction(async (manager) => {
      const row = await this.lockComplaint(manager, schoolId, id);
      const next = complaintMove(row.status, action);
      if (!next)
        throw AppException.conflict(`A ${row.status} complaint cannot be changed this way`, 'HOSTEL_COMPLAINT_STATE');
      row.status = next;
      if (action === 'resolve' || action === 'reject')
        Object.assign(row, { resolution: dto.note, resolved_at: new Date() });
      if (action === 'reopen') Object.assign(row, { resolved_at: null, rating: null, rating_comment: null });
      await manager.save(row);
      await this.addUpdate(manager, schoolId, 'complaint', id, next, dto.note ?? null, actor);
      return next;
    });
    const item = await this.complaint(schoolId, id);
    await this.tellComplaint(item, status);
    return item;
  }

  async rate(
    schoolId: number,
    id: number,
    admissionId: number,
    dto: RatingDto,
    actor: AuthUser,
  ): Promise<ComplaintDetailDto> {
    const status = await this.dataSource.transaction(async (manager) => {
      const row = await this.lockComplaint(manager, schoolId, id);
      if (row.admission_id !== admissionId)
        throw AppException.notFound('Complaint not found', 'HOSTEL_COMPLAINT_NOT_FOUND');
      if (row.status !== 'resolved') {
        throw AppException.conflict('You can answer once the complaint is resolved', 'HOSTEL_COMPLAINT_STATE');
      }
      const next: ComplaintState = dto.reopen ? 'in_progress' : 'closed';
      Object.assign(row, {
        status: next,
        rating: dto.rating,
        rating_comment: dto.comment ?? null,
        ...(dto.reopen ? { resolved_at: null } : {}),
      });
      await manager.save(row);
      await this.addUpdate(
        manager,
        schoolId,
        'complaint',
        id,
        next,
        [`Parent rated ${dto.rating}/5`, dto.reopen ? 'not fixed' : null, dto.comment].filter(Boolean).join(' · '),
        actor,
      );
      return next;
    });
    const item = await this.complaint(schoolId, id);
    if (status === 'in_progress') {
      await this.notify.tellWardens(schoolId, admissionId, HOSTEL_TEMPLATES.HOSTEL_COMPLAINT_NEW, {
        complaint_no: item.complaint_no,
        title: `Reopened: ${item.title}`,
        complaint_id: String(id),
      });
    }
    return item;
  }

  async toMaintenance(schoolId: number, id: number, dto: TicketInputDto, actor: AuthUser): Promise<TicketDetailDto> {
    const complaint = await this.complaint(schoolId, id);
    if (!OPEN_COMPLAINT.includes(complaint.status)) {
      throw AppException.conflict(`This complaint is ${complaint.status}`, 'HOSTEL_COMPLAINT_STATE');
    }
    if (complaint.maintenance_ticket_id) {
      throw AppException.conflict('A maintenance ticket already exists for this complaint', 'HOSTEL_TICKET_EXISTS');
    }
    const ticket = await this.createTicket(
      schoolId,
      {
        ...dto,
        hostel_id: dto.hostel_id ?? complaint.hostel_id,
        room_id: dto.room_id ?? complaint.room_id ?? undefined,
      },
      actor,
      id,
    );
    await this.dataSource.transaction(async (manager) => {
      await manager.update(HostelComplaint, { id }, { maintenance_ticket_id: ticket.id, status: 'in_progress' });
      await this.addUpdate(
        manager,
        schoolId,
        'complaint',
        id,
        'in_progress',
        `Maintenance ticket ${ticket.ticket_no}`,
        actor,
      );
    });
    if (complaint.status === 'open') await this.tellComplaint(await this.complaint(schoolId, id), 'in_progress');
    return ticket;
  }

  async tickets(schoolId: number, query: TicketQueryDto): Promise<Paginated<TicketDto>> {
    const params: unknown[] = [schoolId];
    const where = ['t.school_id = $1', 't.deleted_at IS NULL'];
    if (query.hostel_id) where.push(`t.hostel_id = $${params.push(query.hostel_id)}`);
    if (query.room_id) where.push(`t.room_id = $${params.push(query.room_id)}`);
    if (query.status) where.push(`t.status = $${params.push(query.status)}`);
    if (query.category) where.push(`t.category = $${params.push(query.category)}`);
    if (query.priority) where.push(`t.priority = $${params.push(query.priority)}`);
    if (query.open) where.push(`t.status = ANY($${params.push(OPEN_TICKET)})`);
    if (query.overdue) where.push(`t.status = ANY($${params.push(OPEN_TICKET)}) AND t.due_at < now()`);
    this.addSearch(where, params, query.search, ['t.ticket_no', 't.title', 'r.room_no', 't.vendor_name']);
    const sort = this.sortOf(TICKET_SORTS, query.sort ?? 'created_at');
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const from = `${this.ticketFrom()} WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    const rows = await this.dataSource.query(
      `SELECT ${this.ticketColumns()} ${from} ORDER BY ${sort} ${order} NULLS LAST, t.id ${order}
       LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    return paginate([rows.map((row: Record<string, unknown>) => this.toTicket(row)), total], query.page, query.limit);
  }

  async ticket(schoolId: number, id: number): Promise<TicketDetailDto> {
    const rows = await this.dataSource.query(
      `SELECT ${this.ticketColumns()} ${this.ticketFrom()} WHERE t.school_id = $1 AND t.id = $2 AND t.deleted_at IS NULL`,
      [schoolId, id],
    );
    if (!rows.length) throw AppException.notFound('Maintenance ticket not found', 'HOSTEL_TICKET_NOT_FOUND');
    return { ...this.toTicket(rows[0]), updates: await this.updates('maintenance', id) };
  }

  async createTicket(schoolId: number, dto: TicketInputDto, actor: AuthUser, complaintId: number | null = null) {
    let roomId = dto.room_id ?? null;
    if (dto.bed_id) {
      const bed = await this.dataSource.manager.findOneBy(HostelBed, { school_id: schoolId, id: dto.bed_id });
      if (!bed) throw AppException.notFound('Bed not found', 'HOSTEL_BED_NOT_FOUND');
      if (roomId && roomId !== bed.room_id) {
        throw AppException.validation([{ field: 'bed_id', message: 'This bed is not in that room' }]);
      }
      roomId = bed.room_id;
    }
    const place = await this.place(schoolId, dto.hostel_id, roomId ?? undefined, undefined);
    if (dto.blocks_room && !place.room_id) {
      throw AppException.validation([{ field: 'blocks_room', message: 'Choose a room to close it' }]);
    }
    const priority: TicketPriority = dto.priority ?? 'normal';
    const year = todayIn(this.app.timeZone).slice(0, 4);
    const id = await this.dataSource.transaction(async (manager) => {
      const value = await this.sequences.next(manager, schoolId, `hostel_ticket:${year}`);
      const now = new Date();
      const saved = await manager.save(
        manager.create(HostelMaintenanceTicket, {
          school_id: schoolId,
          ticket_no: serialNumber('HMT', year, value),
          hostel_id: place.hostel_id,
          room_id: place.room_id,
          bed_id: dto.bed_id ?? null,
          category: dto.category,
          priority,
          title: dto.title,
          description: dto.description ?? null,
          photo_file_id: dto.photo_file_id ?? null,
          status: 'open',
          blocks_room: Boolean(dto.blocks_room),
          due_at: slaDueAt(now, priority),
          complaint_id: complaintId,
          created_by: actor.id,
        }),
      );
      if (dto.blocks_room && place.room_id) {
        await manager.update(HostelRoom, { id: place.room_id, status: 'active' }, { status: 'maintenance' });
      }
      await this.addUpdate(manager, schoolId, 'maintenance', saved.id, 'open', dto.description ?? null, actor);
      return saved.id;
    });
    return this.ticket(schoolId, id);
  }

  async changeTicket(schoolId: number, id: number, dto: TicketChangeDto, actor: AuthUser): Promise<TicketDetailDto> {
    if (dto.assigned_to) await this.ensureStaff(schoolId, dto.assigned_to);
    const result = await this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(HostelMaintenanceTicket, {
        where: { school_id: schoolId, id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw AppException.notFound('Maintenance ticket not found', 'HOSTEL_TICKET_NOT_FOUND');
      if (['done', 'cancelled'].includes(row.status)) {
        throw AppException.conflict(`This ticket is ${row.status}`, 'HOSTEL_TICKET_STATE');
      }
      const previousAssignee = row.assigned_to;
      let status = dto.status;
      if (!status && dto.assigned_to && row.status === 'open') status = 'assigned';
      if (status && status !== row.status && !ticketCanMove(row.status, status)) {
        throw AppException.conflict(`A ${row.status} ticket cannot become ${status}`, 'HOSTEL_TICKET_STATE');
      }
      if (status) row.status = status;
      if (dto.priority) Object.assign(row, { priority: dto.priority, due_at: slaDueAt(row.created_at, dto.priority) });
      if (dto.assigned_to !== undefined) row.assigned_to = dto.assigned_to;
      if (dto.vendor_name !== undefined) row.vendor_name = dto.vendor_name;
      if (dto.scheduled_on !== undefined) row.scheduled_on = dto.scheduled_on;
      if (dto.cost !== undefined) row.cost = dto.cost;
      const closing = status === 'done' || status === 'cancelled';
      if (status === 'done') row.completed_at = new Date();
      await manager.save(row);
      if (closing && row.blocks_room && row.room_id) await this.reopenRoom(manager, row);
      await this.addUpdate(manager, schoolId, 'maintenance', id, status ?? null, dto.note ?? null, actor);
      let complaintResolved = false;
      if (status === 'done' && row.complaint_id) {
        const updated = await manager.update(
          HostelComplaint,
          { id: row.complaint_id, status: In(OPEN_COMPLAINT) },
          {
            status: 'resolved',
            resolution: `Fixed (${row.ticket_no})${dto.note ? `: ${dto.note}` : ''}`.slice(0, 500),
            resolved_at: new Date(),
          },
        );
        if (updated.affected) {
          await this.addUpdate(
            manager,
            schoolId,
            'complaint',
            row.complaint_id,
            'resolved',
            `Fixed (${row.ticket_no})`,
            actor,
          );
          complaintResolved = true;
        }
      }
      return { row, previousAssignee, complaintResolved };
    });
    const item = await this.ticket(schoolId, id);
    if (dto.assigned_to && dto.assigned_to !== result.previousAssignee) {
      await this.notify.tellUsers([dto.assigned_to], HOSTEL_TEMPLATES.HOSTEL_TICKET_ASSIGNED, {
        number: item.ticket_no,
        title: item.title,
        place: [item.hostel_name, item.room_no].filter(Boolean).join(' · '),
        ticket_id: String(id),
      });
    }
    if (result.complaintResolved && result.row.complaint_id) {
      await this.tellComplaint(await this.complaint(schoolId, result.row.complaint_id), 'resolved');
    }
    return item;
  }

  async chargeTicket(schoolId: number, id: number, dto: TicketChargeDto, actor: AuthUser): Promise<TicketDetailDto> {
    const ticket = await this.ticket(schoolId, id);
    if (ticket.charged_fine_id)
      throw AppException.conflict('Damage is already charged for this ticket', 'HOSTEL_ALREADY_CHARGED');
    const admission = await this.dataSource.manager.findOneBy(HostelAdmission, {
      school_id: schoolId,
      id: dto.admission_id,
    });
    if (!admission) throw AppException.notFound('Hostel admission not found', 'HOSTEL_ADMISSION_NOT_FOUND');
    const fine = await this.fines.raise(
      schoolId,
      {
        student_id: admission.student_id,
        title: `Hostel damage: ${dto.reason}`.slice(0, 120),
        amount: dto.amount,
        details: `${ticket.ticket_no} · ${ticket.title}`.slice(0, 500),
      },
      actor,
    );
    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        HostelMaintenanceTicket,
        { id },
        { charged_admission_id: admission.id, charged_fine_id: fine.id },
      );
      await this.addUpdate(
        manager,
        schoolId,
        'maintenance',
        id,
        null,
        `Damage charge ${dto.amount} raised for approval`,
        actor,
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'maintenance',
        entity_id: id,
        action: 'charge',
        student_id: admission.student_id,
        changes: { amount: dto.amount, fee_fine_id: fine.id },
        note: dto.reason,
      });
    });
    return this.ticket(schoolId, id);
  }

  async insights(schoolId: number, hostelId?: number): Promise<ConductInsightsDto> {
    const params: unknown[] = [schoolId];
    const filter = hostelId ? ` AND hostel_id = $${params.push(hostelId)}` : '';
    const [row] = await this.dataSource.query(
      `SELECT
         (SELECT COUNT(*) FROM hostel_discipline_cases WHERE school_id = $1 AND deleted_at IS NULL AND status = 'open'${filter})::int AS open_cases,
         (SELECT COUNT(*) FROM hostel_complaints WHERE school_id = $1 AND deleted_at IS NULL AND status IN ('open', 'in_progress')${filter})::int AS open_complaints,
         (SELECT COUNT(*) FROM hostel_complaints WHERE school_id = $1 AND deleted_at IS NULL AND status IN ('open', 'in_progress') AND due_at < now()${filter})::int AS overdue_complaints,
         (SELECT COUNT(*) FROM hostel_maintenance_tickets WHERE school_id = $1 AND deleted_at IS NULL AND status IN ('open', 'assigned', 'in_progress', 'on_hold')${filter})::int AS open_tickets,
         (SELECT COUNT(*) FROM hostel_maintenance_tickets WHERE school_id = $1 AND deleted_at IS NULL AND status IN ('open', 'assigned', 'in_progress', 'on_hold') AND due_at < now()${filter})::int AS overdue_tickets,
         (SELECT ROUND(AVG(rating)::numeric, 1)::float FROM hostel_complaints WHERE school_id = $1 AND rating IS NOT NULL AND created_at > now() - interval '90 days'${filter}) AS average_rating`,
      params,
    );
    return row;
  }

  private async insertComplaint(
    schoolId: number,
    place: { hostel_id: number; room_id: number | null; admission_id: number | null; student_id: number | null },
    dto: ParentComplaintInputDto,
    priority: TicketPriority,
    role: 'parent' | 'staff',
    actor: AuthUser,
  ): Promise<number> {
    const year = todayIn(this.app.timeZone).slice(0, 4);
    return this.dataSource.transaction(async (manager) => {
      const value = await this.sequences.next(manager, schoolId, `hostel_complaint:${year}`);
      const saved = await manager.save(
        manager.create(HostelComplaint, {
          school_id: schoolId,
          complaint_no: serialNumber('HCP', year, value),
          hostel_id: place.hostel_id,
          admission_id: place.admission_id,
          student_id: place.student_id,
          room_id: place.room_id,
          category: dto.category,
          priority,
          title: dto.title,
          description: dto.description,
          photo_file_id: dto.photo_file_id ?? null,
          raised_by_role: role,
          status: 'open',
          due_at: slaDueAt(new Date(), priority),
          created_by: actor.id,
        }),
      );
      await this.addUpdate(manager, schoolId, 'complaint', saved.id, 'open', null, actor);
      return saved.id;
    });
  }

  private async place(
    schoolId: number,
    hostelId: number | undefined,
    roomId: number | undefined,
    admissionId: number | undefined,
  ): Promise<{ hostel_id: number; room_id: number | null; admission_id: number | null; student_id: number | null }> {
    let hostel = hostelId ?? null;
    let room = roomId ?? null;
    let student: number | null = null;
    if (admissionId) {
      const admission = await this.dataSource.manager.findOneBy(HostelAdmission, {
        school_id: schoolId,
        id: admissionId,
      });
      if (!admission) throw AppException.notFound('Hostel admission not found', 'HOSTEL_ADMISSION_NOT_FOUND');
      hostel = hostel ?? admission.hostel_id;
      student = admission.student_id;
      if (!room) {
        const [allocation] = await this.dataSource.query(
          `SELECT room_id FROM hostel_allocations WHERE admission_id = $1 AND to_date IS NULL`,
          [admissionId],
        );
        room = allocation ? Number(allocation.room_id) : null;
      }
    }
    if (room) {
      const row = await this.dataSource.manager.findOneBy(HostelRoom, { school_id: schoolId, id: room });
      if (!row) throw AppException.notFound('Room not found', 'HOSTEL_ROOM_NOT_FOUND');
      if (hostel && hostel !== row.hostel_id) {
        throw AppException.validation([{ field: 'room_id', message: 'This room is in another hostel' }]);
      }
      hostel = row.hostel_id;
    }
    if (!hostel) throw AppException.validation([{ field: 'hostel_id', message: 'Choose a hostel, room or resident' }]);
    const [exists] = await this.dataSource.query(
      `SELECT 1 FROM hostels WHERE school_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [schoolId, hostel],
    );
    if (!exists) throw AppException.notFound('Hostel not found', 'HOSTEL_NOT_FOUND');
    return { hostel_id: hostel, room_id: room, admission_id: admissionId ?? null, student_id: student };
  }

  private async reopenRoom(manager: EntityManager, ticket: HostelMaintenanceTicket): Promise<void> {
    const others = await manager.countBy(HostelMaintenanceTicket, {
      room_id: ticket.room_id!,
      blocks_room: true,
      status: In(OPEN_TICKET),
      id: Not(ticket.id),
    });
    if (!others) await manager.update(HostelRoom, { id: ticket.room_id!, status: 'maintenance' }, { status: 'active' });
  }

  private async ensureStaff(schoolId: number, userId: number): Promise<void> {
    const [row] = await this.dataSource.query(
      `SELECT 1 FROM users u WHERE u.id = $1 AND u.school_id = $2 AND u.deleted_at IS NULL AND u.status = 'active'
         AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.code <> 'PARENT')`,
      [userId, schoolId],
    );
    if (!row)
      throw AppException.validation([
        { field: 'assigned_to', message: 'Choose an active staff member of this school' },
      ]);
  }

  private async lockComplaint(manager: EntityManager, schoolId: number, id: number): Promise<HostelComplaint> {
    const row = await manager.findOne(HostelComplaint, {
      where: { school_id: schoolId, id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!row) throw AppException.notFound('Complaint not found', 'HOSTEL_COMPLAINT_NOT_FOUND');
    return row;
  }

  private async tellComplaint(item: ComplaintDto, status: string): Promise<void> {
    if (!item.admission_id) return;
    await this.notify.tellParents(item.admission_id, HOSTEL_TEMPLATES.HOSTEL_COMPLAINT_UPDATE, {
      complaint_no: item.complaint_no,
      title: item.title,
      status: status.replace(/_/g, ' '),
      note: item.resolution ?? '',
      complaint_id: String(item.id),
    });
  }

  private async addUpdate(
    manager: EntityManager,
    schoolId: number,
    target: UpdateTarget,
    targetId: number,
    status: string | null,
    note: string | null,
    actor: AuthUser,
  ): Promise<void> {
    await manager.insert(HostelTicketUpdate, {
      school_id: schoolId,
      target,
      target_id: targetId,
      status,
      note,
      actor_user_id: actor.id,
      actor_name: actor.name,
    });
  }

  private async updates(target: UpdateTarget, id: number): Promise<TicketUpdateDto[]> {
    return this.dataSource.query(
      `SELECT status, note, actor_name, created_at FROM hostel_ticket_updates
       WHERE target = $1 AND target_id = $2 ORDER BY created_at, id`,
      [target, id],
    );
  }

  private sortOf(sorts: Record<string, string>, key: string): string {
    const column = sorts[key];
    if (!column) throw AppException.badRequest(`sort must be one of ${Object.keys(sorts).join(', ')}`, 'INVALID_SORT');
    return column;
  }

  private addSearch(where: string[], params: unknown[], search: string | undefined, columns: string[]): void {
    for (const word of (search ?? '').split(/\s+/).filter(Boolean)) {
      const slot = `$${params.push(`%${escapeLike(word)}%`)}`;
      where.push(`(${columns.map((column) => `${column} ILIKE ${slot}`).join(' OR ')})`);
    }
  }

  private complaintColumns(): string {
    return `c.id, c.complaint_no, c.hostel_id, h.name AS hostel_name, c.room_id, r.room_no, c.admission_id, c.category,
         c.priority, c.title, c.description, c.photo_file_id, c.raised_by_role, cu.name AS raised_by_name, c.status,
         c.assigned_to, au.name AS assigned_to_name, c.due_at,
         (c.status IN ('open', 'in_progress') AND c.due_at < now()) AS overdue, c.resolution, c.resolved_at,
         c.rating, c.rating_comment, c.maintenance_ticket_id, c.created_at, ${STUDENT_COLUMNS}`;
  }

  private complaintFrom(): string {
    return `FROM hostel_complaints c
       JOIN hostels h ON h.id = c.hostel_id
       LEFT JOIN hostel_rooms r ON r.id = c.room_id
       LEFT JOIN users cu ON cu.id = c.created_by
       LEFT JOIN users au ON au.id = c.assigned_to
       LEFT JOIN students s ON s.id = c.student_id
       ${studentJoins('s')}`;
  }

  private ticketColumns(): string {
    return `t.id, t.ticket_no, t.hostel_id, h.name AS hostel_name, t.room_id, r.room_no, t.bed_id, bd.bed_no, t.category,
         t.priority, t.title, t.description, t.photo_file_id, t.status, t.assigned_to, au.name AS assigned_to_name,
         t.vendor_name, t.scheduled_on::text AS scheduled_on, t.blocks_room, t.cost::float AS cost, t.due_at,
         (t.status IN ('open', 'assigned', 'in_progress', 'on_hold') AND t.due_at < now()) AS overdue,
         t.completed_at, t.complaint_id, t.charged_admission_id, t.charged_fine_id, cu.name AS created_by_name, t.created_at`;
  }

  private ticketFrom(): string {
    return `FROM hostel_maintenance_tickets t
       JOIN hostels h ON h.id = t.hostel_id
       LEFT JOIN hostel_rooms r ON r.id = t.room_id
       LEFT JOIN hostel_beds bd ON bd.id = t.bed_id
       LEFT JOIN users au ON au.id = t.assigned_to
       LEFT JOIN users cu ON cu.id = t.created_by`;
  }

  private toComplaint(row: Record<string, unknown>): ComplaintDto {
    return {
      id: row.id as number,
      complaint_no: row.complaint_no as string,
      hostel_id: row.hostel_id as number,
      hostel_name: row.hostel_name as string,
      room_id: (row.room_id as number | null) ?? null,
      room_no: (row.room_no as string | null) ?? null,
      admission_id: (row.admission_id as number | null) ?? null,
      student: row.student_id ? studentFromRow(row) : null,
      category: row.category as ComplaintDto['category'],
      priority: row.priority as ComplaintDto['priority'],
      title: row.title as string,
      description: row.description as string,
      photo_file_id: (row.photo_file_id as number | null) ?? null,
      raised_by_role: row.raised_by_role as ComplaintDto['raised_by_role'],
      raised_by_name: (row.raised_by_name as string | null) ?? null,
      status: row.status as ComplaintDto['status'],
      assigned_to: (row.assigned_to as number | null) ?? null,
      assigned_to_name: (row.assigned_to_name as string | null) ?? null,
      due_at: row.due_at as Date,
      overdue: Boolean(row.overdue),
      resolution: (row.resolution as string | null) ?? null,
      resolved_at: (row.resolved_at as Date | null) ?? null,
      rating: (row.rating as number | null) ?? null,
      rating_comment: (row.rating_comment as string | null) ?? null,
      maintenance_ticket_id: (row.maintenance_ticket_id as number | null) ?? null,
      created_at: row.created_at as Date,
    };
  }

  private toTicket(row: Record<string, unknown>): TicketDto {
    return {
      id: row.id as number,
      ticket_no: row.ticket_no as string,
      hostel_id: row.hostel_id as number,
      hostel_name: row.hostel_name as string,
      room_id: (row.room_id as number | null) ?? null,
      room_no: (row.room_no as string | null) ?? null,
      bed_id: (row.bed_id as number | null) ?? null,
      bed_no: (row.bed_no as string | null) ?? null,
      category: row.category as TicketDto['category'],
      priority: row.priority as TicketDto['priority'],
      title: row.title as string,
      description: (row.description as string | null) ?? null,
      photo_file_id: (row.photo_file_id as number | null) ?? null,
      status: row.status as TicketDto['status'],
      assigned_to: (row.assigned_to as number | null) ?? null,
      assigned_to_name: (row.assigned_to_name as string | null) ?? null,
      vendor_name: (row.vendor_name as string | null) ?? null,
      scheduled_on: (row.scheduled_on as string | null) ?? null,
      blocks_room: Boolean(row.blocks_room),
      cost: (row.cost as number | null) ?? null,
      due_at: row.due_at as Date,
      overdue: Boolean(row.overdue),
      completed_at: (row.completed_at as Date | null) ?? null,
      complaint_id: (row.complaint_id as number | null) ?? null,
      charged_admission_id: (row.charged_admission_id as number | null) ?? null,
      charged_fine_id: (row.charged_fine_id as number | null) ?? null,
      created_by_name: (row.created_by_name as string | null) ?? null,
      created_at: row.created_at as Date,
    };
  }
}
