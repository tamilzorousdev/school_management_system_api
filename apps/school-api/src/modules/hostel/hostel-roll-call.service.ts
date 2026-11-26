import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, AuthUser, Paginated, paginate } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { QrTokens } from '../security/qr-tokens';
import { HOSTEL_TEMPLATES } from '../notifications/hostel-templates.catalog';
import {
  RollEntryDto,
  RollFinishDto,
  RollHistoryItemDto,
  RollHistoryQueryDto,
  RollMarkDto,
  RollScanDto,
  RollScanResultDto,
  RollSessionDto,
  RollSessionQueryDto,
  RollSheetDto,
  RollSheetQueryDto,
} from './dto/hostel-movement.dto';
import { STUDENT_COLUMNS, studentFromRow, studentJoins } from './hostel-sql';
import { HostelHealthService } from './hostel-health.service';
import { HostelNotifyService } from './hostel-notify.service';
import { HostelSettingsService } from './hostel-settings.service';
import { addDays, ROLL_STATUSES, rollStatusFromLeave, RollSlot, RollStatus } from './hostel.logic';

interface ResidentFilter {
  block_id?: number;
  floor_id?: number;
  room_id?: number;
  admission_id?: number;
  unmarked?: boolean;
}

interface MarkInput {
  admission_id: number;
  status: RollStatus;
  note?: string | null;
}

const ROLL_BACK_DAYS = 2;

@Injectable()
export class HostelRollCallService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: HostelSettingsService,
    private readonly notify: HostelNotifyService,
    private readonly qr: QrTokens,
    private readonly health: HostelHealthService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async sheet(schoolId: number, query: RollSheetQueryDto): Promise<RollSheetDto> {
    const date = query.date ?? this.today();
    const settings = await this.settings.get(schoolId);
    const [rollCall] = await this.dataSource.query(
      `SELECT id, finished_at FROM hostel_roll_calls WHERE school_id = $1 AND hostel_id = $2 AND roll_date = $3 AND slot = $4`,
      [schoolId, query.hostel_id, date, query.slot],
    );
    const students = await this.residents(schoolId, query.hostel_id, date, query.slot, query);
    const counts = { total: students.length, unmarked: 0 } as RollSheetDto['counts'];
    for (const status of ROLL_STATUSES) counts[status] = 0;
    for (const entry of students) {
      if (entry.status) counts[entry.status] += 1;
      else counts.unmarked += 1;
    }
    return {
      roll_call_id: rollCall?.id ?? null,
      date,
      slot: query.slot,
      finished_at: rollCall?.finished_at ?? null,
      holiday_mode: settings.holiday_mode,
      counts,
      students,
    };
  }

  async mark(schoolId: number, dto: RollMarkDto, actor: AuthUser): Promise<RollSheetDto> {
    const date = await this.checkDate(schoolId, dto.date);
    const absentees = await this.dataSource.transaction((manager) =>
      this.save(manager, schoolId, dto.hostel_id, date, dto.slot, dto.entries, 'manual', actor),
    );
    await this.tellAbsentees(absentees, date, dto.slot);
    return this.sheet(schoolId, { hostel_id: dto.hostel_id, slot: dto.slot, date });
  }

  async scan(schoolId: number, dto: RollScanDto, actor: AuthUser): Promise<RollScanResultDto> {
    const date = await this.checkDate(schoolId, dto.date);
    const token = this.qr.readStudent(dto.qr);
    if (!token) throw AppException.badRequest('This is not a valid student ID card QR', 'HOSTEL_QR_INVALID');
    const [student] = await this.dataSource.query(
      `SELECT card_version FROM students WHERE school_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [schoolId, token.student_id],
    );
    if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    if (Number(student.card_version) !== token.version) {
      throw AppException.conflict('This ID card was replaced. Use the new card.', 'HOSTEL_QR_OLD_CARD');
    }
    const [admission] = await this.dataSource.query(
      `SELECT id FROM hostel_admissions WHERE school_id = $1 AND hostel_id = $2 AND student_id = $3
         AND status <> 'checked_out' AND deleted_at IS NULL`,
      [schoolId, dto.hostel_id, token.student_id],
    );
    if (!admission) {
      throw AppException.notFound('This student does not stay in this hostel', 'HOSTEL_NOT_RESIDENT');
    }
    const [before] = await this.residents(schoolId, dto.hostel_id, date, dto.slot, { admission_id: admission.id });
    await this.dataSource.transaction((manager) =>
      this.save(
        manager,
        schoolId,
        dto.hostel_id,
        date,
        dto.slot,
        [{ admission_id: admission.id, status: dto.status ?? 'present' }],
        'qr',
        actor,
      ),
    );
    const [entry] = await this.residents(schoolId, dto.hostel_id, date, dto.slot, { admission_id: admission.id });
    return { entry: entry!, already_marked: Boolean(before?.status) };
  }

  async finish(schoolId: number, dto: RollFinishDto, actor: AuthUser): Promise<RollSheetDto> {
    const date = await this.checkDate(schoolId, dto.date);
    const unmarked = await this.residents(schoolId, dto.hostel_id, date, dto.slot, {
      block_id: dto.block_id,
      unmarked: true,
    });
    const entries: MarkInput[] = unmarked.map((entry) => ({
      admission_id: entry.admission_id,
      status: entry.suggested_status ?? dto.unmarked_as,
    }));
    const absentees = await this.dataSource.transaction(async (manager) => {
      const found = entries.length
        ? await this.save(manager, schoolId, dto.hostel_id, date, dto.slot, entries, 'auto', actor)
        : [];
      const rollCallId = await this.rollCallId(manager, schoolId, dto.hostel_id, date, dto.slot, actor);
      await manager.query(`UPDATE hostel_roll_calls SET finished_at = now(), finished_by = $2 WHERE id = $1`, [
        rollCallId,
        actor.id,
      ]);
      return found;
    });
    await this.tellAbsentees(absentees, date, dto.slot);
    return this.sheet(schoolId, { hostel_id: dto.hostel_id, slot: dto.slot, date, block_id: dto.block_id });
  }

  async sessions(schoolId: number, query: RollSessionQueryDto): Promise<Paginated<RollSessionDto>> {
    if (query.sort && query.sort !== 'roll_date') {
      throw AppException.badRequest('sort must be roll_date', 'INVALID_SORT');
    }
    const params: unknown[] = [schoolId];
    const where = ['c.school_id = $1'];
    if (query.hostel_id) where.push(`c.hostel_id = $${params.push(query.hostel_id)}`);
    if (query.slot) where.push(`c.slot = $${params.push(query.slot)}`);
    if (query.from) where.push(`c.roll_date >= $${params.push(query.from)}`);
    if (query.to) where.push(`c.roll_date <= $${params.push(query.to)}`);
    const [{ total }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM hostel_roll_calls c WHERE ${where.join(' AND ')}`,
      params,
    );
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const rows = await this.dataSource.query(
      `SELECT c.id, c.hostel_id, h.name AS hostel_name, c.roll_date::text AS roll_date, c.slot, c.finished_at,
         COUNT(r.id) FILTER (WHERE r.status = 'present')::int AS present,
         COUNT(r.id) FILTER (WHERE r.status = 'absent')::int AS absent,
         COUNT(r.id) FILTER (WHERE r.status = 'late')::int AS late,
         COUNT(r.id) FILTER (WHERE r.status IN ('on_leave', 'outing', 'sick'))::int AS away,
         COUNT(r.id)::int AS marked
       FROM hostel_roll_calls c
       JOIN hostels h ON h.id = c.hostel_id
       LEFT JOIN hostel_roll_call_records r ON r.roll_call_id = c.id
       WHERE ${where.join(' AND ')}
       GROUP BY c.id, h.name
       ORDER BY c.roll_date ${order}, c.slot, c.id
       LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    return paginate([rows, total], query.page, query.limit);
  }

  async history(schoolId: number, admissionId: number, query: RollHistoryQueryDto): Promise<RollHistoryItemDto[]> {
    const to = query.to ?? this.today();
    const from = query.from ?? addDays(to, -30);
    if (from > to) throw AppException.validation([{ field: 'from', message: 'Must be on or before to' }]);
    return this.dataSource.query(
      `SELECT c.roll_date::text AS date, c.slot, r.status, r.method, r.note, r.marked_at
       FROM hostel_roll_call_records r
       JOIN hostel_roll_calls c ON c.id = r.roll_call_id
       WHERE r.school_id = $1 AND r.admission_id = $2 AND c.roll_date BETWEEN $3 AND $4
       ORDER BY c.roll_date DESC, CASE c.slot WHEN 'night' THEN 1 WHEN 'evening' THEN 2 ELSE 3 END`,
      [schoolId, admissionId, from, to],
    );
  }

  today(): string {
    return todayIn(this.app.timeZone);
  }

  private async checkDate(schoolId: number, date: string | undefined): Promise<string> {
    const settings = await this.settings.get(schoolId);
    if (settings.holiday_mode) {
      throw AppException.conflict('Holiday mode is on. Roll call is paused.', 'HOSTEL_HOLIDAY_MODE');
    }
    const today = this.today();
    const value = date ?? today;
    if (value > today || value < addDays(today, -ROLL_BACK_DAYS)) {
      throw AppException.validation([
        { field: 'date', message: `Roll call can be marked for today or the last ${ROLL_BACK_DAYS} days` },
      ]);
    }
    return value;
  }

  private async rollCallId(
    manager: EntityManager,
    schoolId: number,
    hostelId: number,
    date: string,
    slot: RollSlot,
    actor: AuthUser,
  ): Promise<number> {
    const [row] = await manager.query(
      `INSERT INTO hostel_roll_calls (school_id, hostel_id, roll_date, slot, started_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (school_id, hostel_id, roll_date, slot) DO UPDATE SET slot = EXCLUDED.slot
       RETURNING id`,
      [schoolId, hostelId, date, slot, actor.id],
    );
    return Number(row.id);
  }

  private async save(
    manager: EntityManager,
    schoolId: number,
    hostelId: number,
    date: string,
    slot: RollSlot,
    entries: MarkInput[],
    method: 'manual' | 'qr' | 'auto',
    actor: AuthUser,
  ): Promise<number[]> {
    const ids = [...new Set(entries.map((entry) => entry.admission_id))];
    if (ids.length !== entries.length) {
      throw AppException.badRequest('A student appears twice in the list', 'HOSTEL_ROLL_DUPLICATE');
    }
    const live: { id: number; student_id: number }[] = await manager.query(
      `SELECT id, student_id FROM hostel_admissions
       WHERE school_id = $1 AND hostel_id = $2 AND id = ANY($3) AND deleted_at IS NULL AND admitted_on <= $4
         AND (status <> 'checked_out' OR checked_out_on > $4)`,
      [schoolId, hostelId, ids, date],
    );
    const students = new Map(live.map((row) => [Number(row.id), Number(row.student_id)]));
    const missing = ids.filter((id) => !students.has(id));
    if (missing.length) {
      throw AppException.badRequest(
        `Not residents of this hostel on ${date}: admission ${missing.join(', ')}`,
        'HOSTEL_NOT_RESIDENT',
      );
    }
    const rollCallId = await this.rollCallId(manager, schoolId, hostelId, date, slot, actor);
    const absentees: number[] = [];
    for (const entry of entries) {
      const [row] = await manager.query(
        `INSERT INTO hostel_roll_call_records (school_id, roll_call_id, admission_id, student_id, status, method, note, marked_by, marked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (roll_call_id, admission_id) DO UPDATE SET
           status = EXCLUDED.status, method = EXCLUDED.method,
           note = COALESCE(EXCLUDED.note, hostel_roll_call_records.note),
           marked_by = EXCLUDED.marked_by, marked_at = now()
         RETURNING id, status, parent_notified_at`,
        [
          schoolId,
          rollCallId,
          entry.admission_id,
          students.get(entry.admission_id),
          entry.status,
          method,
          entry.note ?? null,
          actor.id,
        ],
      );
      if (row.status === 'absent' && !row.parent_notified_at) {
        await manager.query(`UPDATE hostel_roll_call_records SET parent_notified_at = now() WHERE id = $1`, [row.id]);
        absentees.push(entry.admission_id);
      }
    }
    return absentees;
  }

  private async tellAbsentees(admissionIds: number[], date: string, slot: RollSlot): Promise<void> {
    for (const admissionId of admissionIds) {
      await this.notify.tellParents(admissionId, HOSTEL_TEMPLATES.HOSTEL_ABSENT, { date, slot });
    }
  }

  private async residents(
    schoolId: number,
    hostelId: number,
    date: string,
    slot: RollSlot,
    filter: ResidentFilter,
  ): Promise<RollEntryDto[]> {
    const params: unknown[] = [schoolId, hostelId, date, slot, this.app.timeZone];
    const where = [
      'a.school_id = $1',
      'a.hostel_id = $2',
      'a.deleted_at IS NULL',
      'a.admitted_on <= $3',
      `(a.status <> 'checked_out' OR a.checked_out_on > $3)`,
    ];
    if (filter.block_id) where.push(`r.block_id = $${params.push(filter.block_id)}`);
    if (filter.floor_id) where.push(`r.floor_id = $${params.push(filter.floor_id)}`);
    if (filter.room_id) where.push(`r.id = $${params.push(filter.room_id)}`);
    if (filter.admission_id) where.push(`a.id = $${params.push(filter.admission_id)}`);
    if (filter.unmarked) where.push('rec.id IS NULL');
    const rows = await this.dataSource.query(
      `SELECT a.id AS admission_id, ${STUDENT_COLUMNS}, r.room_no, bd.bed_no, b.name AS block_name,
         rec.id AS record_id, rec.status, rec.method, rec.note, rec.marked_at, lv.kind AS leave_kind
       FROM hostel_admissions a
       JOIN students s ON s.id = a.student_id
       ${studentJoins('s')}
       LEFT JOIN hostel_allocations al ON al.admission_id = a.id AND al.to_date IS NULL
       LEFT JOIN hostel_rooms r ON r.id = al.room_id
       LEFT JOIN hostel_beds bd ON bd.id = al.bed_id
       LEFT JOIN hostel_blocks b ON b.id = r.block_id
       LEFT JOIN hostel_roll_calls rc ON rc.school_id = a.school_id AND rc.hostel_id = a.hostel_id
         AND rc.roll_date = $3 AND rc.slot = $4
       LEFT JOIN hostel_roll_call_records rec ON rec.roll_call_id = rc.id AND rec.admission_id = a.id
       LEFT JOIN LATERAL (
         SELECT l.kind FROM hostel_leaves l
         WHERE l.admission_id = a.id AND l.deleted_at IS NULL AND l.departed_at IS NOT NULL
           AND (l.departed_at AT TIME ZONE $5)::date <= $3
           AND (l.returned_at IS NULL OR (l.returned_at AT TIME ZONE $5)::date > $3)
         ORDER BY l.id DESC LIMIT 1
       ) lv ON true
       WHERE ${where.join(' AND ')}
       ORDER BY b.sort_order NULLS LAST, r.room_no NULLS LAST, bd.bed_no, s.first_name`,
      params,
    );
    const sick = date === this.today() ? await this.health.inSickBay(schoolId, hostelId) : new Set<number>();
    return rows.map((row: Record<string, unknown>) => ({
      admission_id: row.admission_id as number,
      student: studentFromRow(row),
      room_no: (row.room_no as string | null) ?? null,
      bed_no: (row.bed_no as string | null) ?? null,
      block_name: (row.block_name as string | null) ?? null,
      status: (row.status as RollStatus | null) ?? null,
      suggested_status:
        rollStatusFromLeave((row.leave_kind as string | null) ?? null, row.leave_kind ? 'out' : null) ??
        (sick.has(row.admission_id as number) ? 'sick' : null),
      method: (row.method as RollEntryDto['method']) ?? null,
      note: (row.note as string | null) ?? null,
      marked_at: (row.marked_at as Date | null) ?? null,
    }));
  }
}
