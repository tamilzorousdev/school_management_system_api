import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, AuthUser, Paginated, paginate } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import {
  DateRangeQueryDto,
  ParentStudyDto,
  StudyCountsDto,
  StudyHistoryItemDto,
  StudyMarkDto,
  StudyReportQueryDto,
  StudyReportRowDto,
  StudyScheduleDto,
  StudyScheduleInputDto,
  StudySchedulePatchDto,
  StudyScheduleQueryDto,
  StudySheetDto,
  StudySheetEntryDto,
  StudySheetQueryDto,
  StudyTodayDto,
} from './dto/hostel-duty.dto';
import { HostelStudySchedule, StudyMark } from './entities/hostel-duty.entity';
import { HostelAuditService } from './hostel-audit.service';
import { checkRange, ensurePlace, sortColumn, staffNames } from './hostel-duty-checks';
import { duplicateKeys, MAX_REPORT_DAYS, percentOf, runsOn, STUDY_BACK_DAYS, weekdayOf } from './hostel-duty.logic';
import { HostelSettingsService } from './hostel-settings.service';
import { escapeLike, STUDENT_COLUMNS, studentFromRow, studentJoins } from './hostel-sql';
import { addDays } from './hostel.logic';

const REPORT_SORTS: Record<string, string> = {
  name: 's.first_name',
  percent: `CASE WHEN m.sessions = 0 THEN 0 ELSE (m.present + m.late)::numeric / m.sessions END`,
  absent: 'm.absent',
  sessions: 'm.sessions',
};

interface ScheduleScope {
  id: number;
  hostel_id: number;
  block_id: number | null;
  hall_id: number | null;
}

@Injectable()
export class HostelStudyService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: HostelSettingsService,
    private readonly audit: HostelAuditService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async schedules(schoolId: number, query: StudyScheduleQueryDto): Promise<StudyScheduleDto[]> {
    const params: unknown[] = [schoolId];
    const where = ['sc.school_id = $1', 'sc.deleted_at IS NULL'];
    if (query.hostel_id) where.push(`sc.hostel_id = $${params.push(query.hostel_id)}`);
    if (query.active !== undefined) where.push(`sc.active = $${params.push(query.active)}`);
    return this.scheduleRows(where, params);
  }

  async schedule(schoolId: number, id: number): Promise<StudyScheduleDto> {
    const [row] = await this.scheduleRows(['sc.school_id = $1', 'sc.id = $2', 'sc.deleted_at IS NULL'], [schoolId, id]);
    if (!row) throw AppException.notFound('Study schedule not found', 'HOSTEL_STUDY_SCHEDULE_NOT_FOUND');
    return row;
  }

  async createSchedule(schoolId: number, dto: StudyScheduleInputDto, actor: AuthUser): Promise<StudyScheduleDto> {
    const id = await this.dataSource.transaction(async (manager) => {
      await this.checkSchedule(manager, schoolId, {
        hostel_id: dto.hostel_id,
        block_id: dto.block_id ?? null,
        hall_id: dto.hall_id ?? null,
        start_time: dto.start_time,
        end_time: dto.end_time,
        supervisor_user_id: dto.supervisor_user_id ?? null,
      });
      const saved = await manager.save(
        manager.create(HostelStudySchedule, {
          school_id: schoolId,
          hostel_id: dto.hostel_id,
          block_id: dto.block_id ?? null,
          hall_id: dto.hall_id ?? null,
          name: dto.name,
          days: [...dto.days].sort((a, b) => a - b),
          start_time: dto.start_time,
          end_time: dto.end_time,
          supervisor_user_id: dto.supervisor_user_id ?? null,
          active: dto.active ?? true,
          created_by: actor.id,
        }),
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'study_schedule',
        entity_id: saved.id,
        action: 'create',
        changes: { name: saved.name, days: saved.days, start_time: saved.start_time, end_time: saved.end_time },
      });
      return saved.id;
    });
    return this.schedule(schoolId, id);
  }

  async updateSchedule(
    schoolId: number,
    id: number,
    dto: StudySchedulePatchDto,
    actor: AuthUser,
  ): Promise<StudyScheduleDto> {
    await this.dataSource.transaction(async (manager) => {
      const row = await this.lockSchedule(manager, schoolId, id);
      const next = {
        hostel_id: row.hostel_id,
        block_id: dto.block_id === undefined ? row.block_id : dto.block_id,
        hall_id: dto.hall_id === undefined ? row.hall_id : dto.hall_id,
        start_time: dto.start_time ?? row.start_time,
        end_time: dto.end_time ?? row.end_time,
        supervisor_user_id: dto.supervisor_user_id === undefined ? row.supervisor_user_id : dto.supervisor_user_id,
      };
      await this.checkSchedule(manager, schoolId, {
        ...next,
        hall_id: dto.hall_id === undefined ? null : next.hall_id,
        supervisor_user_id: dto.supervisor_user_id === undefined ? null : next.supervisor_user_id,
      });
      const changes = Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined));
      Object.assign(row, next, {
        name: dto.name ?? row.name,
        days: dto.days ? [...dto.days].sort((a, b) => a - b) : row.days,
        active: dto.active ?? row.active,
      });
      await manager.save(row);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'study_schedule',
        entity_id: row.id,
        action: 'update',
        changes,
      });
    });
    return this.schedule(schoolId, id);
  }

  async removeSchedule(schoolId: number, id: number, actor: AuthUser): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const row = await this.lockSchedule(manager, schoolId, id);
      await manager.softDelete(HostelStudySchedule, { id: row.id });
      await this.audit.record(manager, schoolId, actor, {
        entity: 'study_schedule',
        entity_id: row.id,
        action: 'delete',
        changes: { name: row.name },
      });
    });
  }

  async todayList(schoolId: number, hostelId?: number): Promise<StudyTodayDto[]> {
    const date = this.today();
    const params: unknown[] = [schoolId, weekdayOf(date)];
    const where = ['sc.school_id = $1', 'sc.deleted_at IS NULL', 'sc.active = true', '$2 = ANY(sc.days)'];
    if (hostelId) where.push(`sc.hostel_id = $${params.push(hostelId)}`);
    const schedules = await this.scheduleRows(where, params);
    const result: StudyTodayDto[] = [];
    for (const schedule of schedules) {
      const students = await this.residents(schoolId, schedule, date);
      result.push({ ...schedule, date, counts: this.counts(students) });
    }
    return result.sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  async sheet(schoolId: number, query: StudySheetQueryDto): Promise<StudySheetDto> {
    const date = query.date ?? this.today();
    const schedule = await this.schedule(schoolId, query.schedule_id);
    const students = await this.residents(schoolId, schedule, date);
    return { schedule, date, runs_on_date: runsOn(schedule.days, date), counts: this.counts(students), students };
  }

  async mark(schoolId: number, dto: StudyMarkDto, actor: AuthUser): Promise<StudySheetDto> {
    const today = this.today();
    const date = dto.date ?? today;
    if (date > today || date < addDays(today, -STUDY_BACK_DAYS)) {
      throw AppException.validation([
        { field: 'date', message: `Study attendance can be marked for today or the last ${STUDY_BACK_DAYS} days` },
      ]);
    }
    const schedule = await this.schedule(schoolId, dto.schedule_id);
    if (!schedule.active) throw AppException.conflict('This study schedule is turned off', 'HOSTEL_STUDY_INACTIVE');
    if (!runsOn(schedule.days, date)) {
      throw AppException.conflict('This study schedule does not run on that day', 'HOSTEL_STUDY_NOT_SCHEDULED');
    }
    if (duplicateKeys(dto.entries, (entry) => String(entry.admission_id)).length) {
      throw AppException.badRequest('A student appears twice in the list', 'HOSTEL_STUDY_DUPLICATE');
    }
    const ids = dto.entries.map((entry) => entry.admission_id);
    const residents = await this.residents(schoolId, schedule, date, ids);
    const students = new Map(residents.map((entry) => [entry.admission_id, entry.student.id]));
    const missing = ids.filter((id) => !students.has(id));
    if (missing.length) {
      throw AppException.badRequest(
        `Not in this study group on ${date}: admission ${missing.join(', ')}`,
        'HOSTEL_NOT_RESIDENT',
      );
    }
    await this.dataSource.transaction(async (manager) => {
      for (const entry of dto.entries) {
        await manager.query(
          `INSERT INTO hostel_study_attendance (school_id, schedule_id, study_date, admission_id, student_id, status, note, marked_by, marked_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
           ON CONFLICT (schedule_id, study_date, admission_id) DO UPDATE SET
             status = EXCLUDED.status,
             note = COALESCE(EXCLUDED.note, hostel_study_attendance.note),
             marked_by = EXCLUDED.marked_by, marked_at = now()`,
          [
            schoolId,
            schedule.id,
            date,
            entry.admission_id,
            students.get(entry.admission_id),
            entry.status,
            entry.note ?? null,
            actor.id,
          ],
        );
      }
    });
    return this.sheet(schoolId, { schedule_id: schedule.id, date });
  }

  async report(schoolId: number, query: StudyReportQueryDto): Promise<Paginated<StudyReportRowDto>> {
    const to = query.to ?? this.today();
    const from = query.from ?? addDays(to, -29);
    checkRange(from, to, MAX_REPORT_DAYS);
    const sort = sortColumn(REPORT_SORTS, query.sort ?? 'name');
    const params: unknown[] = [schoolId];
    const where = ['a.school_id = $1', 'a.deleted_at IS NULL', `a.status <> 'checked_out'`];
    if (query.hostel_id) where.push(`a.hostel_id = $${params.push(query.hostel_id)}`);
    for (const word of (query.search ?? '').split(/\s+/).filter(Boolean)) {
      const slot = `$${params.push(`%${escapeLike(word)}%`)}`;
      where.push(`(s.first_name ILIKE ${slot} OR s.last_name ILIKE ${slot} OR s.admission_no ILIKE ${slot})`);
    }
    const [{ total }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM hostel_admissions a JOIN students s ON s.id = a.student_id
       WHERE ${where.join(' AND ')}`,
      params,
    );
    const fromSlot = `$${params.push(from)}`;
    const toSlot = `$${params.push(to)}`;
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT a.id AS admission_id, h.name AS hostel_name, ${STUDENT_COLUMNS},
         m.sessions, m.present, m.late, m.absent, m.excused
       FROM hostel_admissions a
       JOIN students s ON s.id = a.student_id
       JOIN hostels h ON h.id = a.hostel_id
       ${studentJoins('s')}
       CROSS JOIN LATERAL (
         SELECT COUNT(*)::int AS sessions,
           COUNT(*) FILTER (WHERE t.status = 'present')::int AS present,
           COUNT(*) FILTER (WHERE t.status = 'late')::int AS late,
           COUNT(*) FILTER (WHERE t.status = 'absent')::int AS absent,
           COUNT(*) FILTER (WHERE t.status = 'excused')::int AS excused
         FROM hostel_study_attendance t
         WHERE t.admission_id = a.id AND t.study_date BETWEEN ${fromSlot} AND ${toSlot}
       ) m
       WHERE ${where.join(' AND ')}
       ORDER BY ${sort} ${order}, s.last_name ${order}, a.id ${order}
       LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    return paginate(
      [
        rows.map((row) => ({
          admission_id: Number(row.admission_id),
          student: studentFromRow(row),
          hostel_name: row.hostel_name as string,
          sessions: Number(row.sessions),
          present: Number(row.present),
          late: Number(row.late),
          absent: Number(row.absent),
          excused: Number(row.excused),
          percent: percentOf(Number(row.present) + Number(row.late), Number(row.sessions)),
        })),
        total,
      ],
      query.page,
      query.limit,
    );
  }

  async history(schoolId: number, admissionId: number, query: DateRangeQueryDto): Promise<StudyHistoryItemDto[]> {
    const [admission] = await this.dataSource.query(
      `SELECT 1 FROM hostel_admissions WHERE school_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [schoolId, admissionId],
    );
    if (!admission) throw AppException.notFound('Hostel admission not found', 'HOSTEL_ADMISSION_NOT_FOUND');
    const to = query.to ?? this.today();
    const from = query.from ?? addDays(to, -29);
    checkRange(from, to, MAX_REPORT_DAYS);
    return this.marks(schoolId, admissionId, from, to);
  }

  async parentStudy(schoolId: number, admissionId: number): Promise<ParentStudyDto> {
    const [stay] = await this.dataSource.query(
      `SELECT a.hostel_id, r.block_id FROM hostel_admissions a
       LEFT JOIN hostel_allocations al ON al.admission_id = a.id AND al.to_date IS NULL
       LEFT JOIN hostel_rooms r ON r.id = al.room_id
       WHERE a.school_id = $1 AND a.id = $2`,
      [schoolId, admissionId],
    );
    if (!stay) throw AppException.notFound('Your child is not staying in the hostel', 'HOSTEL_NOT_RESIDENT');
    const halls = (await this.settings.enabledModules(schoolId)).study_hall;
    const seats: { hall_id: number; hall_name: string; seat_no: string; since: string }[] = halls
      ? await this.dataSource.query(
          `SELECT sa.hall_id, hl.name AS hall_name, st.seat_no, sa.from_date::text AS since
           FROM hostel_seat_allocations sa
           JOIN hostel_study_halls hl ON hl.id = sa.hall_id AND hl.deleted_at IS NULL
           JOIN hostel_study_seats st ON st.id = sa.seat_id
           WHERE sa.school_id = $1 AND sa.admission_id = $2 AND sa.to_date IS NULL
           ORDER BY sa.from_date DESC, sa.id DESC`,
          [schoolId, admissionId],
        )
      : [];
    const schedules: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT sc.id, sc.name, sc.days, sc.start_time, sc.end_time, hl.name AS hall_name
       FROM hostel_study_schedules sc
       LEFT JOIN hostel_study_halls hl ON hl.id = sc.hall_id
       WHERE sc.school_id = $1 AND sc.hostel_id = $2 AND sc.deleted_at IS NULL AND sc.active = true
         AND (sc.block_id IS NULL OR sc.block_id = $3)
         AND (sc.hall_id IS NULL OR sc.hall_id = ANY($4::int[]))
       ORDER BY sc.start_time, sc.id`,
      [schoolId, stay.hostel_id, stay.block_id ?? null, seats.map((seat) => Number(seat.hall_id))],
    );
    const today = this.today();
    const [seat] = seats;
    return {
      schedules: schedules.map((row) => ({
        id: Number(row.id),
        name: row.name as string,
        days: (row.days as number[]).map(Number),
        start_time: row.start_time as string,
        end_time: row.end_time as string,
        hall_name: (row.hall_name as string | null) ?? null,
      })),
      marks: await this.marks(schoolId, admissionId, addDays(today, -29), today),
      seat: seat ? { hall_name: seat.hall_name, seat_no: seat.seat_no, since: seat.since } : null,
    };
  }

  today(): string {
    return todayIn(this.app.timeZone);
  }

  private async marks(schoolId: number, admissionId: number, from: string, to: string): Promise<StudyHistoryItemDto[]> {
    return this.dataSource.query(
      `SELECT t.study_date::text AS date, t.schedule_id, sc.name AS schedule_name, sc.start_time, sc.end_time,
         t.status, t.note, t.marked_at
       FROM hostel_study_attendance t
       JOIN hostel_study_schedules sc ON sc.id = t.schedule_id
       WHERE t.school_id = $1 AND t.admission_id = $2 AND t.study_date BETWEEN $3 AND $4
       ORDER BY t.study_date DESC, sc.start_time DESC, t.id DESC`,
      [schoolId, admissionId, from, to],
    );
  }

  private async residents(
    schoolId: number,
    schedule: ScheduleScope,
    date: string,
    admissionIds?: number[],
  ): Promise<StudySheetEntryDto[]> {
    const params: unknown[] = [schoolId, schedule.hostel_id, date, this.app.timeZone, schedule.id, schedule.hall_id];
    const where = [
      'a.school_id = $1',
      'a.hostel_id = $2',
      'a.deleted_at IS NULL',
      'a.admitted_on <= $3',
      `(a.status <> 'checked_out' OR a.checked_out_on > $3)`,
    ];
    if (schedule.block_id) where.push(`r.block_id = $${params.push(schedule.block_id)}`);
    if (schedule.hall_id) where.push('sa.id IS NOT NULL');
    if (admissionIds) where.push(`a.id = ANY($${params.push(admissionIds)}::int[])`);
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT a.id AS admission_id, ${STUDENT_COLUMNS}, b.name AS block_name, r.room_no, bd.bed_no, st.seat_no,
         att.status, att.note, att.marked_at, lv.away
       FROM hostel_admissions a
       JOIN students s ON s.id = a.student_id
       ${studentJoins('s')}
       LEFT JOIN hostel_allocations al ON al.admission_id = a.id AND al.to_date IS NULL
       LEFT JOIN hostel_rooms r ON r.id = al.room_id
       LEFT JOIN hostel_beds bd ON bd.id = al.bed_id
       LEFT JOIN hostel_blocks b ON b.id = r.block_id
       LEFT JOIN hostel_seat_allocations sa ON sa.admission_id = a.id AND sa.hall_id = $6::int AND sa.to_date IS NULL
       LEFT JOIN hostel_study_seats st ON st.id = sa.seat_id
       LEFT JOIN hostel_study_attendance att ON att.schedule_id = $5 AND att.study_date = $3 AND att.admission_id = a.id
       LEFT JOIN LATERAL (
         SELECT true AS away FROM hostel_leaves l
         WHERE l.admission_id = a.id AND l.deleted_at IS NULL AND l.departed_at IS NOT NULL
           AND (l.departed_at AT TIME ZONE $4)::date <= $3
           AND (l.returned_at IS NULL OR (l.returned_at AT TIME ZONE $4)::date > $3)
         LIMIT 1
       ) lv ON true
       WHERE ${where.join(' AND ')}
       ORDER BY st.seat_no IS NULL, NULLIF(regexp_replace(st.seat_no, '\\D', '', 'g'), '')::int,
         b.sort_order NULLS LAST, r.room_no NULLS LAST, bd.bed_no, s.first_name, a.id`,
      params,
    );
    return rows.map((row) => ({
      admission_id: Number(row.admission_id),
      student: studentFromRow(row),
      block_name: (row.block_name as string | null) ?? null,
      room_no: (row.room_no as string | null) ?? null,
      bed_no: (row.bed_no as string | null) ?? null,
      seat_no: (row.seat_no as string | null) ?? null,
      status: (row.status as StudyMark | null) ?? null,
      suggested_status: row.away ? 'excused' : null,
      note: (row.note as string | null) ?? null,
      marked_at: (row.marked_at as Date | null) ?? null,
    }));
  }

  private counts(students: StudySheetEntryDto[]): StudyCountsDto {
    const counts: StudyCountsDto = {
      total: students.length,
      marked: 0,
      unmarked: 0,
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
    };
    for (const entry of students) {
      if (!entry.status) {
        counts.unmarked += 1;
        continue;
      }
      counts.marked += 1;
      counts[entry.status] += 1;
    }
    return counts;
  }

  private async scheduleRows(where: string[], params: unknown[]): Promise<StudyScheduleDto[]> {
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT sc.id, sc.hostel_id, h.name AS hostel_name, sc.block_id, b.name AS block_name, sc.hall_id,
         hl.name AS hall_name, sc.name, sc.days, sc.start_time, sc.end_time, sc.supervisor_user_id,
         su.name AS supervisor_name, sc.active
       FROM hostel_study_schedules sc
       JOIN hostels h ON h.id = sc.hostel_id
       LEFT JOIN hostel_blocks b ON b.id = sc.block_id
       LEFT JOIN hostel_study_halls hl ON hl.id = sc.hall_id
       LEFT JOIN users su ON su.id = sc.supervisor_user_id
       WHERE ${where.join(' AND ')}
       ORDER BY h.name, sc.start_time, sc.name, sc.id`,
      params,
    );
    return rows.map((row) => ({
      id: Number(row.id),
      hostel_id: Number(row.hostel_id),
      hostel_name: row.hostel_name as string,
      block_id: (row.block_id as number | null) ?? null,
      block_name: (row.block_name as string | null) ?? null,
      hall_id: (row.hall_id as number | null) ?? null,
      hall_name: (row.hall_name as string | null) ?? null,
      name: row.name as string,
      days: (row.days as number[]).map(Number),
      start_time: row.start_time as string,
      end_time: row.end_time as string,
      supervisor_user_id: (row.supervisor_user_id as number | null) ?? null,
      supervisor_name: (row.supervisor_name as string | null) ?? null,
      active: Boolean(row.active),
    }));
  }

  private async checkSchedule(
    manager: EntityManager,
    schoolId: number,
    input: {
      hostel_id: number;
      block_id: number | null;
      hall_id: number | null;
      start_time: string;
      end_time: string;
      supervisor_user_id: number | null;
    },
  ): Promise<void> {
    if (input.end_time <= input.start_time) {
      throw AppException.validation([{ field: 'end_time', message: 'Must be after start_time' }]);
    }
    await ensurePlace(manager, schoolId, input.hostel_id, input.block_id);
    if (input.hall_id) {
      await this.settings.ensureEnabled(schoolId, 'study_hall');
      const [hall] = await manager.query(
        `SELECT 1 FROM hostel_study_halls WHERE school_id = $1 AND id = $2 AND hostel_id = $3 AND deleted_at IS NULL`,
        [schoolId, input.hall_id, input.hostel_id],
      );
      if (!hall) throw AppException.notFound('Study hall not found in this hostel', 'HOSTEL_STUDY_HALL_NOT_FOUND');
    }
    if (input.supervisor_user_id) {
      await staffNames(manager, schoolId, [input.supervisor_user_id], 'supervisor_user_id');
    }
  }

  private async lockSchedule(manager: EntityManager, schoolId: number, id: number): Promise<HostelStudySchedule> {
    const row = await manager.findOne(HostelStudySchedule, {
      where: { school_id: schoolId, id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!row) throw AppException.notFound('Study schedule not found', 'HOSTEL_STUDY_SCHEDULE_NOT_FOUND');
    return row;
  }
}
