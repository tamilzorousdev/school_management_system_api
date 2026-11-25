import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, AuthUser, Paginated, paginate } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { PERMISSIONS } from '../access/access.catalog';
import { HOSTEL_TEMPLATES } from '../notifications/hostel-templates.catalog';
import { SequencesService } from '../schools/sequences.service';
import { QrTokens } from '../security/qr-tokens';
import {
  LeaveDecisionDto,
  LeaveDto,
  LeaveInputDto,
  LeaveQueryDto,
  PassCheckDto,
  PassCheckResultDto,
  PassVerdict,
  StaffLeaveInputDto,
} from './dto/hostel-movement.dto';
import { HostelAdmission } from './entities/hostel-admission.entity';
import { HostelLeave, LeaveSource } from './entities/hostel-movement.entity';
import { STUDENT_COLUMNS, studentFromRow, studentJoins, escapeLike } from './hostel-sql';
import { HostelAuditService } from './hostel-audit.service';
import { HostelNotifyService } from './hostel-notify.service';
import { HostelSettingsService } from './hostel-settings.service';
import {
  addDays,
  daysBetween,
  LeaveAction,
  leaveMove,
  LeaveState,
  lateMinutes,
  OPEN_LEAVE_STATES,
  outingWithinWindow,
  serialNumber,
} from './hostel.logic';

const MAX_LEAVE_DAYS = 60;
const OVERDUE_GRACE_MINUTES = 15;
const LEAVE_SORTS: Record<string, string> = {
  created_at: 'l.created_at',
  from_date: 'l.from_date',
  expected_return_at: 'l.expected_return_at',
};

const VERDICT_TEXT: Record<PassVerdict, string> = {
  can_go_out: 'Valid. Check the escort, then mark the student out.',
  can_come_in: 'The student is out on this pass. Mark them back in.',
  not_approved: 'This pass is not approved. Do not let the student go.',
  not_started: 'This pass starts on a later day.',
  expired: 'This pass has ended. Ask the warden.',
  closed: 'This pass was already used, cancelled or rejected.',
};

@Injectable()
export class HostelLeavesService {
  private readonly logger = new Logger('HostelLeaves');

  constructor(
    private readonly dataSource: DataSource,
    private readonly sequences: SequencesService,
    private readonly settings: HostelSettingsService,
    private readonly notify: HostelNotifyService,
    private readonly audit: HostelAuditService,
    private readonly qr: QrTokens,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async list(schoolId: number, query: LeaveQueryDto, withQr = true): Promise<Paginated<LeaveDto>> {
    const params: unknown[] = [schoolId];
    const where = ['l.school_id = $1', 'l.deleted_at IS NULL'];
    if (query.hostel_id) where.push(`l.hostel_id = $${params.push(query.hostel_id)}`);
    if (query.admission_id) where.push(`l.admission_id = $${params.push(query.admission_id)}`);
    if (query.status) where.push(`l.status = $${params.push(query.status)}`);
    if (query.kind) where.push(`l.kind = $${params.push(query.kind)}`);
    if (query.overdue) where.push(`l.status = 'out' AND l.expected_return_at < now()`);
    if (query.on_date) {
      const slot = `$${params.push(query.on_date)}`;
      where.push(`l.from_date <= ${slot} AND l.to_date >= ${slot}`);
    }
    for (const word of (query.search ?? '').split(/\s+/).filter(Boolean)) {
      const slot = `$${params.push(`%${escapeLike(word)}%`)}`;
      where.push(
        `(l.leave_no ILIKE ${slot} OR s.first_name ILIKE ${slot} OR s.last_name ILIKE ${slot} OR s.admission_no ILIKE ${slot})`,
      );
    }
    const sort = LEAVE_SORTS[query.sort ?? 'created_at'];
    if (!sort)
      throw AppException.badRequest(`sort must be one of ${Object.keys(LEAVE_SORTS).join(', ')}`, 'INVALID_SORT');
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const from = `${this.leaveFrom()} WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    const rows = await this.dataSource.query(
      `SELECT ${this.leaveColumns()} ${from} ORDER BY ${sort} ${order}, l.id ${order}
       LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    return paginate(
      [rows.map((row: Record<string, unknown>) => this.toLeave(row, withQr)), total],
      query.page,
      query.limit,
    );
  }

  async get(schoolId: number, id: number, withQr = true): Promise<LeaveDto> {
    const rows = await this.dataSource.query(
      `SELECT ${this.leaveColumns()} ${this.leaveFrom()} WHERE l.school_id = $1 AND l.id = $2 AND l.deleted_at IS NULL`,
      [schoolId, id],
    );
    if (!rows.length) throw AppException.notFound('Hostel leave not found', 'HOSTEL_LEAVE_NOT_FOUND');
    return this.toLeave(rows[0], withQr);
  }

  async createByStaff(schoolId: number, dto: StaffLeaveInputDto, actor: AuthUser): Promise<LeaveDto> {
    const source: LeaveSource = actor.roles.some((role) => role === 'WARDEN' || role === 'ASSISTANT_WARDEN')
      ? 'warden'
      : 'office';
    const approveNow = Boolean(dto.approve_now) && actor.permissions.includes(PERMISSIONS.HOSTEL_LEAVE_APPROVE);
    if (dto.approve_now && !approveNow) {
      throw AppException.forbidden('You cannot approve hostel leave', 'FORBIDDEN');
    }
    return this.create(schoolId, dto.admission_id, dto, actor, source, approveNow);
  }

  async createByParent(schoolId: number, admissionId: number, dto: LeaveInputDto, actor: AuthUser): Promise<LeaveDto> {
    return this.create(schoolId, admissionId, dto, actor, 'parent', false);
  }

  async decide(
    schoolId: number,
    id: number,
    action: 'approve' | 'reject' | 'cancel',
    dto: LeaveDecisionDto,
    actor: AuthUser,
  ): Promise<LeaveDto> {
    const leave = await this.dataSource.transaction(async (manager) => {
      const row = await this.lock(manager, schoolId, id);
      const next = this.move(row, action);
      Object.assign(row, {
        status: next,
        decided_by: actor.id,
        decided_at: new Date(),
        decision_note: dto.note ?? null,
      });
      if (action === 'approve' && row.kind !== 'outing')
        row.school_leave_id = await this.schoolLeave(manager, row, actor);
      if (action === 'cancel' && row.school_leave_id) {
        await manager.query(
          `UPDATE student_leave_requests SET status = 'cancelled', updated_at = now() WHERE id = $1`,
          [row.school_leave_id],
        );
      }
      await manager.save(row);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'leave',
        entity_id: id,
        action,
        student_id: row.student_id,
        changes: { status: next },
        note: dto.note ?? null,
      });
      return row;
    });
    if (action !== 'cancel' || actor.roles.every((role) => role !== 'PARENT')) {
      await this.tellDecision(
        leave,
        action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'cancelled',
      );
    }
    return this.get(schoolId, id);
  }

  async consent(schoolId: number, id: number, agree: boolean, note: string | null, actor: AuthUser): Promise<LeaveDto> {
    const leave = await this.dataSource.transaction(async (manager) => {
      const row = await this.lock(manager, schoolId, id);
      const next = this.move(row, agree ? 'consent_given' : 'consent_refused');
      Object.assign(row, {
        status: next,
        consent_status: agree ? 'given' : 'refused',
        consent_by: actor.id,
        consent_at: new Date(),
        ...(agree ? {} : { decision_note: note ?? 'Parent did not agree' }),
      });
      await manager.save(row);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'leave',
        entity_id: id,
        action: agree ? 'consent_given' : 'consent_refused',
        student_id: row.student_id,
        changes: { status: next },
        note,
      });
      return row;
    });
    if (agree)
      await this.notify.tellWardens(
        schoolId,
        leave.admission_id,
        HOSTEL_TEMPLATES.HOSTEL_LEAVE_REQUESTED,
        this.leaveData(leave),
      );
    return this.get(schoolId, id);
  }

  async check(schoolId: number, dto: PassCheckDto): Promise<PassCheckResultDto> {
    const id = await this.resolvePass(schoolId, dto);
    const leave = await this.get(schoolId, id);
    const verdict = this.verdict(leave);
    return {
      ok: verdict === 'can_go_out' || verdict === 'can_come_in',
      verdict,
      message: VERDICT_TEXT[verdict],
      leave,
    };
  }

  async goOut(schoolId: number, id: number, actor: AuthUser): Promise<LeaveDto> {
    const leave = await this.dataSource.transaction(async (manager) => {
      const row = await this.lock(manager, schoolId, id);
      const verdict = this.verdict({ status: row.status, from_date: row.from_date, to_date: row.to_date });
      if (verdict !== 'can_go_out') throw AppException.conflict(VERDICT_TEXT[verdict], 'HOSTEL_PASS_NOT_VALID');
      this.move(row, 'out');
      Object.assign(row, { status: 'out', departed_at: new Date(), departed_by: actor.id });
      await manager.save(row);
      if (row.kind !== 'outing') {
        await manager.update(HostelAdmission, { id: row.admission_id, status: 'active' }, { status: 'on_leave' });
      }
      await this.audit.record(manager, schoolId, actor, {
        entity: 'leave',
        entity_id: id,
        action: 'out',
        student_id: row.student_id,
      });
      return row;
    });
    await this.notify.tellParents(leave.admission_id, HOSTEL_TEMPLATES.HOSTEL_STUDENT_LEFT, {
      ...this.leaveData(leave),
      time: this.time(leave.departed_at!),
      escort: leave.escort_name
        ? `${leave.escort_name}${leave.escort_relation ? ` (${leave.escort_relation})` : ''}`
        : '-',
    });
    return this.get(schoolId, id);
  }

  async comeIn(schoolId: number, id: number, actor: AuthUser): Promise<LeaveDto> {
    const leave = await this.dataSource.transaction(async (manager) => {
      const row = await this.lock(manager, schoolId, id);
      this.move(row, 'in');
      const now = new Date();
      Object.assign(row, {
        status: 'returned',
        returned_at: now,
        returned_by: actor.id,
        late_minutes: lateMinutes(row.expected_return_at, now) || null,
      });
      await manager.save(row);
      await manager.update(HostelAdmission, { id: row.admission_id, status: 'on_leave' }, { status: 'active' });
      await this.trimSchoolLeave(manager, row);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'leave',
        entity_id: id,
        action: 'in',
        student_id: row.student_id,
        changes: { late_minutes: row.late_minutes },
      });
      return row;
    });
    await this.notify.tellParents(leave.admission_id, HOSTEL_TEMPLATES.HOSTEL_STUDENT_RETURNED, {
      ...this.leaveData(leave),
      time: this.time(leave.returned_at!),
    });
    return this.get(schoolId, id);
  }

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'hostel-overdue-returns' })
  async alertOverdue(): Promise<number> {
    try {
      const rows: { id: number }[] = await this.dataSource.query(
        `UPDATE hostel_leaves SET overdue_alerted_at = now()
         WHERE status = 'out' AND deleted_at IS NULL AND overdue_alerted_at IS NULL
           AND expected_return_at < now() - make_interval(mins => $1)
         RETURNING id`,
        [OVERDUE_GRACE_MINUTES],
      );
      for (const { id } of rows) {
        const leave = await this.dataSource.manager.findOneBy(HostelLeave, { id });
        if (!leave) continue;
        const data = this.leaveData(leave);
        await this.notify.tellParents(leave.admission_id, HOSTEL_TEMPLATES.HOSTEL_LATE_RETURN, data);
        await this.notify.tellWardens(
          leave.school_id,
          leave.admission_id,
          HOSTEL_TEMPLATES.HOSTEL_OVERDUE_RETURN,
          data,
        );
      }
      return rows.length;
    } catch (error) {
      this.logger.warn(`Overdue return check failed: ${(error as Error).message}`);
      return 0;
    }
  }

  today(): string {
    return todayIn(this.app.timeZone);
  }

  private async create(
    schoolId: number,
    admissionId: number,
    dto: LeaveInputDto,
    actor: AuthUser,
    source: LeaveSource,
    approveNow: boolean,
  ): Promise<LeaveDto> {
    const settings = await this.settings.get(schoolId);
    const today = this.today();
    const toDate = dto.kind === 'outing' ? dto.from_date : (dto.to_date ?? dto.from_date);
    if (dto.from_date < today)
      throw AppException.validation([{ field: 'from_date', message: 'Cannot be in the past' }]);
    if (toDate < dto.from_date)
      throw AppException.validation([{ field: 'to_date', message: 'Must be on or after from_date' }]);
    if (daysBetween(dto.from_date, toDate) > MAX_LEAVE_DAYS) {
      throw AppException.validation([
        { field: 'to_date', message: `Hostel leave can be at most ${MAX_LEAVE_DAYS} days` },
      ]);
    }
    if (dto.kind === 'outing') {
      if (!dto.depart_time || !dto.return_time) {
        throw AppException.validation([
          { field: 'depart_time', message: 'An outing needs depart_time and return_time' },
        ]);
      }
      if (!outingWithinWindow(dto.depart_time, dto.return_time, settings)) {
        throw AppException.badRequest(
          `Outings are allowed between ${settings.outing_from_time} and ${settings.outing_until_time}`,
          'HOSTEL_OUTING_OUTSIDE_WINDOW',
        );
      }
    }
    const consentNeeded = source !== 'parent' && settings.parent_consent_for_leave && dto.kind !== 'medical';
    const status: LeaveState = consentNeeded ? 'awaiting_parent' : approveNow ? 'approved' : 'pending';
    const id = await this.dataSource.transaction(async (manager) => {
      const admission = await manager.findOne(HostelAdmission, {
        where: { school_id: schoolId, id: admissionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!admission) throw AppException.notFound('Hostel admission not found', 'HOSTEL_ADMISSION_NOT_FOUND');
      if (!['active', 'on_leave'].includes(admission.status)) {
        throw AppException.conflict('This student is not staying in the hostel', 'HOSTEL_ADMISSION_CLOSED');
      }
      const [overlap] = await manager.query(
        `SELECT leave_no FROM hostel_leaves WHERE school_id = $1 AND admission_id = $2 AND deleted_at IS NULL
           AND status = ANY($3) AND from_date <= $5 AND to_date >= $4 LIMIT 1`,
        [schoolId, admissionId, OPEN_LEAVE_STATES, dto.from_date, toDate],
      );
      if (overlap) {
        throw AppException.conflict(
          `Another hostel leave (${overlap.leave_no}) covers these dates`,
          'HOSTEL_LEAVE_OVERLAP',
        );
      }
      const [{ at }] = await manager.query(`SELECT (($1::date + $2::time) AT TIME ZONE $3) AS at`, [
        toDate,
        dto.return_time ?? settings.in_time,
        this.app.timeZone,
      ]);
      const value = await this.sequences.next(manager, schoolId, `hostel_leave:${dto.from_date.slice(0, 4)}`);
      const leave = manager.create(HostelLeave, {
        school_id: schoolId,
        leave_no: serialNumber('HLV', dto.from_date.slice(0, 4), value),
        admission_id: admission.id,
        student_id: admission.student_id,
        hostel_id: admission.hostel_id,
        kind: dto.kind,
        from_date: dto.from_date,
        to_date: toDate,
        depart_time: dto.depart_time ?? null,
        return_time: dto.return_time ?? null,
        expected_return_at: at,
        reason: dto.reason,
        source,
        status,
        consent_status: source === 'parent' ? 'given' : consentNeeded ? 'waiting' : 'not_needed',
        consent_by: source === 'parent' ? actor.id : null,
        consent_at: source === 'parent' ? new Date() : null,
        escort_name: dto.escort_name ?? null,
        escort_relation: dto.escort_relation ?? null,
        escort_mobile: dto.escort_mobile ?? null,
        ...(status === 'approved' ? { decided_by: actor.id, decided_at: new Date() } : {}),
        created_by: actor.id,
      });
      if (status === 'approved' && leave.kind !== 'outing')
        leave.school_leave_id = await this.schoolLeave(manager, leave, actor);
      const saved = await manager.save(leave);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'leave',
        entity_id: saved.id,
        action: 'create',
        student_id: saved.student_id,
        changes: { kind: saved.kind, from_date: saved.from_date, to_date: saved.to_date, status, source },
      });
      return saved.id;
    });
    const leave = (await this.dataSource.manager.findOneBy(HostelLeave, { id }))!;
    const data = this.leaveData(leave);
    if (status === 'awaiting_parent') {
      await this.notify.tellParents(leave.admission_id, HOSTEL_TEMPLATES.HOSTEL_LEAVE_CONSENT_NEEDED, data);
    } else if (status === 'approved') {
      await this.tellDecision(leave, 'approved');
    } else if (source === 'parent') {
      await this.notify.tellWardens(schoolId, leave.admission_id, HOSTEL_TEMPLATES.HOSTEL_LEAVE_REQUESTED, data);
    }
    return this.get(schoolId, id, true);
  }

  private async schoolLeave(manager: EntityManager, leave: HostelLeave, actor: AuthUser): Promise<number | null> {
    const [existing] = await manager.query(
      `SELECT 1 FROM student_leave_requests WHERE student_id = $1 AND status = 'approved' AND deleted_at IS NULL
         AND from_date <= $3 AND to_date >= $2 LIMIT 1`,
      [leave.student_id, leave.from_date, leave.to_date],
    );
    if (existing) return null;
    const [row] = await manager.query(
      `INSERT INTO student_leave_requests (school_id, student_id, from_date, to_date, reason, status, decided_by, decided_at, decision_note, created_by)
       VALUES ($1, $2, $3, $4, $5, 'approved', $6, now(), $7, $6) RETURNING id`,
      [
        leave.school_id,
        leave.student_id,
        leave.from_date,
        leave.to_date,
        `Hostel ${leave.kind} leave: ${leave.reason}`.slice(0, 500),
        actor.id,
        leave.leave_no,
      ],
    );
    return Number(row.id);
  }

  private async trimSchoolLeave(manager: EntityManager, leave: HostelLeave): Promise<void> {
    if (!leave.school_leave_id) return;
    const back = todayIn(this.app.timeZone, leave.returned_at ?? new Date());
    if (back > leave.to_date) return;
    if (back <= leave.from_date) {
      await manager.query(`UPDATE student_leave_requests SET status = 'cancelled', updated_at = now() WHERE id = $1`, [
        leave.school_leave_id,
      ]);
      return;
    }
    await manager.query(`UPDATE student_leave_requests SET to_date = $2, updated_at = now() WHERE id = $1`, [
      leave.school_leave_id,
      addDays(back, -1),
    ]);
  }

  private async resolvePass(schoolId: number, dto: PassCheckDto): Promise<number> {
    if (dto.qr) {
      const token = this.qr.readHostelPass(dto.qr);
      if (!token) throw AppException.badRequest('This is not a valid hostel pass QR', 'HOSTEL_QR_INVALID');
      const [row] = await this.dataSource.query(
        `SELECT id, qr_version FROM hostel_leaves WHERE school_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [schoolId, token.leave_id],
      );
      if (!row) throw AppException.notFound('Hostel pass not found', 'HOSTEL_LEAVE_NOT_FOUND');
      if (Number(row.qr_version) !== token.version) {
        throw AppException.conflict('This QR was replaced. Ask for the latest pass.', 'HOSTEL_QR_OLD_CARD');
      }
      return Number(row.id);
    }
    if (dto.leave_no) {
      const [row] = await this.dataSource.query(
        `SELECT id FROM hostel_leaves WHERE school_id = $1 AND UPPER(leave_no) = UPPER($2) AND deleted_at IS NULL`,
        [schoolId, dto.leave_no],
      );
      if (!row) throw AppException.notFound('Hostel pass not found', 'HOSTEL_LEAVE_NOT_FOUND');
      return Number(row.id);
    }
    throw AppException.validation([{ field: 'qr', message: 'Send qr or leave_no' }]);
  }

  private verdict(leave: { status: string; from_date: string; to_date: string }): PassVerdict {
    if (leave.status === 'out') return 'can_come_in';
    if (['awaiting_parent', 'pending'].includes(leave.status)) return 'not_approved';
    if (leave.status !== 'approved') return 'closed';
    const today = this.today();
    if (today < leave.from_date) return 'not_started';
    if (today > leave.to_date) return 'expired';
    return 'can_go_out';
  }

  private async lock(manager: EntityManager, schoolId: number, id: number): Promise<HostelLeave> {
    const leave = await manager.findOne(HostelLeave, {
      where: { school_id: schoolId, id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!leave) throw AppException.notFound('Hostel leave not found', 'HOSTEL_LEAVE_NOT_FOUND');
    return leave;
  }

  private move(leave: HostelLeave, action: LeaveAction): LeaveState {
    const next = leaveMove(leave.status, action);
    if (!next) throw AppException.conflict(`A ${leave.status} leave cannot be changed this way`, 'HOSTEL_LEAVE_STATE');
    return next;
  }

  private async tellDecision(leave: HostelLeave, decision: string): Promise<void> {
    await this.notify.tellParents(leave.admission_id, HOSTEL_TEMPLATES.HOSTEL_LEAVE_DECIDED, {
      ...this.leaveData(leave),
      decision,
      note: leave.decision_note ?? '',
    });
  }

  private leaveData(leave: HostelLeave): Record<string, string> {
    return {
      leave_id: String(leave.id),
      leave_no: leave.leave_no,
      kind: leave.kind,
      from_date: leave.from_date,
      to_date: leave.to_date,
      reason: leave.reason,
      expected: this.dateTime(leave.expected_return_at),
    };
  }

  private time(value: Date): string {
    return new Intl.DateTimeFormat('en-IN', { timeZone: this.app.timeZone, hour: '2-digit', minute: '2-digit' }).format(
      value,
    );
  }

  private dateTime(value: Date): string {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: this.app.timeZone,
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(value);
  }

  private leaveColumns(): string {
    return `l.id, l.leave_no, l.admission_id, l.qr_version, h.name AS hostel_name, l.kind,
         l.from_date::text AS from_date, l.to_date::text AS to_date, l.depart_time, l.return_time,
         l.expected_return_at, l.reason, l.source, l.status, l.consent_status, l.escort_name, l.escort_relation,
         l.escort_mobile, l.decision_note, du.name AS decided_by_name, l.departed_at, l.returned_at, l.late_minutes,
         (l.status = 'out' AND l.expected_return_at < now()) AS overdue, l.created_at,
         ${STUDENT_COLUMNS},
         CASE WHEN r.id IS NULL THEN NULL ELSE CONCAT(r.room_no, ' / ', bd.bed_no) END AS bed`;
  }

  private leaveFrom(): string {
    return `FROM hostel_leaves l
       JOIN hostels h ON h.id = l.hostel_id
       JOIN students s ON s.id = l.student_id
       ${studentJoins('s')}
       LEFT JOIN users du ON du.id = l.decided_by
       LEFT JOIN hostel_allocations al ON al.admission_id = l.admission_id AND al.to_date IS NULL
       LEFT JOIN hostel_rooms r ON r.id = al.room_id
       LEFT JOIN hostel_beds bd ON bd.id = al.bed_id`;
  }

  private toLeave(row: Record<string, unknown>, withQr: boolean): LeaveDto {
    const status = row.status as LeaveState;
    return {
      id: row.id as number,
      leave_no: row.leave_no as string,
      admission_id: row.admission_id as number,
      student: studentFromRow(row),
      hostel_name: row.hostel_name as string,
      bed: (row.bed as string | null) ?? null,
      kind: row.kind as LeaveDto['kind'],
      from_date: row.from_date as string,
      to_date: row.to_date as string,
      depart_time: (row.depart_time as string | null) ?? null,
      return_time: (row.return_time as string | null) ?? null,
      expected_return_at: row.expected_return_at as Date,
      reason: row.reason as string,
      source: row.source as LeaveDto['source'],
      status,
      consent_status: row.consent_status as LeaveDto['consent_status'],
      escort_name: (row.escort_name as string | null) ?? null,
      escort_relation: (row.escort_relation as string | null) ?? null,
      escort_mobile: (row.escort_mobile as string | null) ?? null,
      decision_note: (row.decision_note as string | null) ?? null,
      decided_by_name: (row.decided_by_name as string | null) ?? null,
      departed_at: (row.departed_at as Date | null) ?? null,
      returned_at: (row.returned_at as Date | null) ?? null,
      late_minutes: (row.late_minutes as number | null) ?? null,
      overdue: Boolean(row.overdue),
      qr_token:
        withQr && (status === 'approved' || status === 'out')
          ? this.qr.hostelPass(row.id as number, Number(row.qr_version))
          : null,
      created_at: row.created_at as Date,
    };
  }
}
