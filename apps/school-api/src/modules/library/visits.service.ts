import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { AppException, AuthUser, escapeLike, paginate, Paginated, searchTerms } from '@app/common';
import { holidaySet, weekday } from '../../shared/school-days';
import { yearClause } from '../../shared/year-context';
import {
  LibraryPeriodDto,
  PeriodAttendanceDto,
  PeriodRosterDto,
  VisitDto,
  VisitInsightsDto,
  VisitQueryDto,
  VisitScanDto,
  VisitScanResultDto,
} from './dto/desk.dto';
import { MemberType } from './entities/library-member.entity';
import { LibraryVisit, VisitKind, VisitPurpose } from './entities/library-visit.entity';
import { minutesBetween } from './library.logic';
import { LibraryReadService, param, Row, SqlFilter } from './library-read.service';
import { MembersService, PersonKey } from './members.service';

export const LIBRARY_SUBJECT_SQL = (alias: string) =>
  `(lower(${alias}.name) LIKE '%library%' OR upper(${alias}.code) IN ('LIB', 'LIBRARY'))`;

const VISIT_SORTS: Record<string, string> = {
  in_at: 'v.in_at',
  visit_date: 'v.visit_date',
  created_at: 'v.created_at',
};

@Injectable()
export class VisitsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly read: LibraryReadService,
    private readonly members: MembersService,
  ) {}

  private visitSql(filter: SqlFilter, tail: string): string {
    return `
      SELECT v.id, v.kind, v.member_type, v.student_id, v.user_id, v.visit_date::text AS visit_date, v.in_at, v.out_at,
             v.purpose, v.present, v.period_no, v.section_id,
             CASE WHEN v.member_type = 'student' THEN s.first_name || COALESCE(' ' || s.last_name, '') ELSE u.name END AS name,
             CASE WHEN v.member_type = 'student' THEN NULLIF(CONCAT_WS(' - ', c.name, sec.name), '') ELSE st.designation END AS detail,
             COALESCE(s.photo_file_id, u.photo_file_id) AS photo,
             NULLIF(CONCAT_WS(' - ', c.name, sec.name), '') AS section_name
      FROM library_visits v
      LEFT JOIN students s ON s.id = v.student_id
      LEFT JOIN users u ON u.id = v.user_id
      LEFT JOIN staff st ON st.user_id = v.user_id AND st.school_id = v.school_id AND st.deleted_at IS NULL
      LEFT JOIN sections sec ON sec.id = v.section_id
      LEFT JOIN classes c ON c.id = COALESCE(v.class_id, sec.class_id)
      WHERE v.deleted_at IS NULL ${filter.where.length ? `AND ${filter.where.join(' AND ')}` : ''}
      ${tail}`;
  }

  private present(row: Row): VisitDto {
    const inAt = (row.in_at as Date | null) ?? null;
    const outAt = (row.out_at as Date | null) ?? null;
    return {
      id: Number(row.id),
      kind: row.kind as VisitKind,
      visitor: {
        member_type: row.member_type as MemberType,
        student_id: row.student_id === null ? null : Number(row.student_id),
        user_id: row.user_id === null ? null : Number(row.user_id),
        name: String(row.name ?? ''),
        detail: (row.detail as string | null) ?? null,
        photo_url: this.read.link(row.photo),
      },
      visit_date: String(row.visit_date),
      in_at: inAt,
      out_at: outAt,
      minutes: inAt && outAt ? minutesBetween(inAt, outAt) : null,
      purpose: row.purpose as VisitPurpose,
      present: Boolean(row.present),
      period_no: row.period_no === null ? null : Number(row.period_no),
      section: row.section_id ? { id: Number(row.section_id), name: String(row.section_name ?? '') } : null,
    };
  }

  private async visit(schoolId: number, id: number, manager?: EntityManager): Promise<VisitDto> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`v.school_id = ${param(filter, schoolId)}`, `v.id = ${param(filter, id)}`);
    const [row]: Row[] = await (manager ?? this.dataSource.manager).query(this.visitSql(filter, ''), filter.params);
    if (!row) throw AppException.notFound('Visit not found', 'VISIT_NOT_FOUND');
    return this.present(row);
  }

  async scan(schoolId: number, dto: VisitScanDto, actor: AuthUser): Promise<VisitScanResultDto> {
    const today = this.read.today();
    return this.dataSource.transaction(async (manager) => {
      const key: PersonKey = await this.members.resolveCode(manager, schoolId, dto.code);
      const type: MemberType = 'student_id' in key ? 'student' : 'staff';
      const personWhere = 'student_id' in key ? { student_id: key.student_id } : { user_id: key.user_id };
      const open = await manager.findOne(LibraryVisit, {
        where: {
          school_id: schoolId,
          kind: 'walk_in',
          visit_date: today,
          out_at: IsNull(),
          deleted_at: IsNull(),
          ...personWhere,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (open) {
        await manager.update(LibraryVisit, open.id, { out_at: new Date() });
        return { action: 'checked_out' as const, visit: await this.visit(schoolId, open.id, manager) };
      }
      let classId: number | null = null;
      let sectionId: number | null = null;
      if ('student_id' in key) {
        const [student]: { status: string; class_id: number | null; section_id: number | null }[] = await manager.query(
          `SELECT s.status, e.class_id, e.section_id FROM students s
           LEFT JOIN LATERAL (
             SELECT e.class_id, e.section_id FROM student_enrollments e
             JOIN academic_years y ON y.id = e.academic_year_id AND ${yearClause('y')}
             WHERE e.student_id = s.id ORDER BY e.id DESC LIMIT 1
           ) e ON true
           WHERE s.id = $1`,
          [key.student_id],
        );
        if (student?.status !== 'active')
          throw AppException.conflict('This student has left the school', 'MEMBER_LEFT');
        classId = student.class_id === null ? null : Number(student.class_id);
        sectionId = student.section_id === null ? null : Number(student.section_id);
      }
      const saved = await manager.save(
        manager.create(LibraryVisit, {
          school_id: schoolId,
          kind: 'walk_in',
          member_type: type,
          student_id: 'student_id' in key ? key.student_id : null,
          user_id: 'user_id' in key ? key.user_id : null,
          class_id: classId,
          section_id: sectionId,
          visit_date: today,
          in_at: new Date(),
          purpose: dto.purpose ?? 'read',
          present: true,
          marked_by: actor.id,
          created_by: actor.id,
        }),
      );
      return { action: 'checked_in' as const, visit: await this.visit(schoolId, saved.id, manager) };
    });
  }

  async checkOut(schoolId: number, id: number): Promise<VisitDto> {
    const visit = await this.dataSource.getRepository(LibraryVisit).findOneBy({ id, school_id: schoolId });
    if (!visit) throw AppException.notFound('Visit not found', 'VISIT_NOT_FOUND');
    if (visit.kind !== 'walk_in' || visit.out_at) throw AppException.conflict('Already checked out', 'ALREADY_OUT');
    await this.dataSource.getRepository(LibraryVisit).update(id, { out_at: new Date() });
    return this.visit(schoolId, id);
  }

  async list(schoolId: number, query: VisitQueryDto): Promise<Paginated<VisitDto>> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`v.school_id = ${param(filter, schoolId)}`);
    if (query.date) filter.where.push(`v.visit_date = ${param(filter, query.date)}::date`);
    if (query.from) filter.where.push(`v.visit_date >= ${param(filter, query.from)}::date`);
    if (query.to) filter.where.push(`v.visit_date <= ${param(filter, query.to)}::date`);
    if (query.kind) filter.where.push(`v.kind = ${param(filter, query.kind)}`);
    if (query.member_type) filter.where.push(`v.member_type = ${param(filter, query.member_type)}`);
    if (query.class_id) filter.where.push(`v.class_id = ${param(filter, query.class_id)}`);
    if (query.section_id) filter.where.push(`v.section_id = ${param(filter, query.section_id)}`);
    if (query.student_id) filter.where.push(`v.student_id = ${param(filter, query.student_id)}`);
    if (query.inside) filter.where.push(`v.kind = 'walk_in' AND v.out_at IS NULL`);
    if (query.present !== undefined) filter.where.push(`v.present = ${param(filter, query.present)}`);
    for (const term of searchTerms(query.search)) {
      const key = param(filter, `%${escapeLike(term)}%`);
      filter.where.push(
        `(s.first_name || COALESCE(' ' || s.last_name, '') ILIKE ${key} OR s.admission_no ILIKE ${key} OR u.name ILIKE ${key})`,
      );
    }
    const column = VISIT_SORTS[query.sort ?? 'in_at'];
    if (!column) {
      throw AppException.badRequest(`sort must be one of: ${Object.keys(VISIT_SORTS).join(', ')}`, 'INVALID_SORT');
    }
    const order = `${column} ${query.order === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, v.id DESC`;
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM (${this.visitSql(filter, '')}) counted`,
      filter.params,
    );
    const rows: Row[] = await this.dataSource.query(
      this.visitSql(filter, `ORDER BY ${order} LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`),
      filter.params,
    );
    return paginate([rows.map((row) => this.present(row)), Number(total)], query.page, query.limit);
  }

  async insights(schoolId: number, date?: string): Promise<VisitInsightsDto> {
    const day = date ?? this.read.today();
    const [row]: Row[] = await this.dataSource.query(
      `SELECT
         COUNT(*) FILTER (WHERE kind = 'walk_in' AND out_at IS NULL)::int AS inside_now,
         COUNT(DISTINCT COALESCE('s' || student_id, 'u' || user_id)) FILTER (WHERE present)::int AS visitors,
         COUNT(DISTINCT student_id) FILTER (WHERE present AND member_type = 'student')::int AS students,
         COUNT(DISTINCT user_id) FILTER (WHERE present AND member_type = 'staff')::int AS staff,
         ROUND(AVG(EXTRACT(EPOCH FROM (out_at - in_at)) / 60) FILTER (WHERE kind = 'walk_in' AND out_at IS NOT NULL)) AS average_minutes,
         COUNT(DISTINCT slot_id) FILTER (WHERE kind = 'period')::int AS periods_marked,
         MODE() WITHIN GROUP (ORDER BY EXTRACT(HOUR FROM in_at AT TIME ZONE $3)) FILTER (WHERE kind = 'walk_in') AS busiest_hour
       FROM library_visits WHERE school_id = $1 AND visit_date = $2::date AND deleted_at IS NULL`,
      [schoolId, day, this.read.zone()],
    );
    const periods = await this.periods(schoolId, day);
    return {
      date: day,
      inside_now: day === this.read.today() ? Number(row?.inside_now ?? 0) : 0,
      visitors_today: Number(row?.visitors ?? 0),
      students_today: Number(row?.students ?? 0),
      staff_today: Number(row?.staff ?? 0),
      average_minutes:
        row?.average_minutes === null || row?.average_minutes === undefined ? null : Number(row.average_minutes),
      periods_today: periods.length,
      periods_marked: periods.filter((period) => period.marked).length,
      busiest_hour: row?.busiest_hour === null || row?.busiest_hour === undefined ? null : Number(row.busiest_hour),
    };
  }

  private slotSql(where: string): string {
    return `
      SELECT t.id AS slot_id, t.period_no, t.section_id, sec.name AS section_name, c.name AS class_name, c.id AS class_id,
             tu.name AS teacher, bp.name AS period_name, bp.start_time, bp.end_time
      FROM timetable_slots t
      JOIN subjects sub ON sub.id = t.subject_id AND ${LIBRARY_SUBJECT_SQL('sub')}
      JOIN academic_years y ON y.id = t.academic_year_id AND ${yearClause('y')}
      JOIN sections sec ON sec.id = t.section_id AND sec.deleted_at IS NULL
      JOIN classes c ON c.id = sec.class_id
      LEFT JOIN users tu ON tu.id = t.teacher_user_id
      LEFT JOIN LATERAL (
        SELECT b.name, b.start_time, b.end_time FROM bell_periods b
        WHERE b.school_id = t.school_id AND b.period_no = t.period_no AND b.is_break = false
          AND (b.class_id IS NULL OR b.class_id = c.id)
          AND (b.section_ids IS NULL OR t.section_id = ANY(b.section_ids))
        ORDER BY b.class_id NULLS LAST, b.section_ids NULLS LAST LIMIT 1
      ) bp ON true
      WHERE ${where}`;
  }

  async periods(schoolId: number, date?: string): Promise<LibraryPeriodDto[]> {
    const day = date ?? this.read.today();
    const dow = weekday(day);
    if (dow === 0) return [];
    const holidays = await holidaySet(this.dataSource.manager, schoolId, day, day);
    if (holidays.has(day)) return [];
    const rows: Row[] = await this.dataSource.query(
      `${this.slotSql('t.school_id = $1 AND t.day_of_week = $2')} ORDER BY t.period_no, c.grade_level, sec.name`,
      [schoolId, dow],
    );
    return this.withCounts(schoolId, day, rows);
  }

  private async withCounts(schoolId: number, day: string, rows: Row[]): Promise<LibraryPeriodDto[]> {
    if (!rows.length) return [];
    const marks: { slot_id: number; present: number; absent: number }[] = await this.dataSource.query(
      `SELECT slot_id, COUNT(*) FILTER (WHERE present)::int AS present, COUNT(*) FILTER (WHERE NOT present)::int AS absent
       FROM library_visits WHERE school_id = $1 AND kind = 'period' AND visit_date = $2::date AND deleted_at IS NULL
       GROUP BY slot_id`,
      [schoolId, day],
    );
    const sizes: { section_id: number; total: number }[] = await this.dataSource.query(
      `SELECT e.section_id, COUNT(*)::int AS total FROM student_enrollments e
       JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       WHERE e.section_id = ANY($1) AND e.status = 'studying' GROUP BY e.section_id`,
      [rows.map((row) => Number(row.section_id))],
    );
    return rows.map((row) => {
      const mark = marks.find((item) => Number(item.slot_id) === Number(row.slot_id));
      return {
        slot_id: Number(row.slot_id),
        date: day,
        period_no: Number(row.period_no),
        period_name: (row.period_name as string | null) ?? null,
        start_time: (row.start_time as string | null) ?? null,
        end_time: (row.end_time as string | null) ?? null,
        section: { id: Number(row.section_id), name: `${row.class_name} - ${row.section_name}` },
        teacher: (row.teacher as string | null) ?? null,
        marked: Boolean(mark),
        present: Number(mark?.present ?? 0),
        absent: Number(mark?.absent ?? 0),
        total: Number(sizes.find((item) => Number(item.section_id) === Number(row.section_id))?.total ?? 0),
      };
    });
  }

  private async slot(schoolId: number, slotId: number, day: string): Promise<{ period: LibraryPeriodDto; row: Row }> {
    const [row]: Row[] = await this.dataSource.query(this.slotSql('t.school_id = $1 AND t.id = $2'), [
      schoolId,
      slotId,
    ]);
    if (!row) throw AppException.notFound('No library period with this id', 'PERIOD_NOT_FOUND');
    const [period] = await this.withCounts(schoolId, day, [row]);
    return { period: period!, row };
  }

  async roster(schoolId: number, slotId: number, date?: string): Promise<PeriodRosterDto> {
    const day = date ?? this.read.today();
    const { period } = await this.slot(schoolId, slotId, day);
    const students: Row[] = await this.dataSource.query(
      `SELECT s.id, s.first_name || COALESCE(' ' || s.last_name, '') AS name, e.roll_no, s.admission_no, s.photo_file_id,
              v.present
       FROM student_enrollments e
       JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       LEFT JOIN library_visits v ON v.student_id = s.id AND v.kind = 'period' AND v.slot_id = $2
         AND v.visit_date = $3::date AND v.deleted_at IS NULL
       WHERE e.section_id = $1 AND e.status = 'studying'
       ORDER BY e.roll_no NULLS LAST, s.first_name`,
      [period.section.id, slotId, day],
    );
    return {
      period,
      students: students.map((row) => ({
        student_id: Number(row.id),
        name: String(row.name),
        roll_no: row.roll_no === null ? null : Number(row.roll_no),
        admission_no: String(row.admission_no),
        photo_url: this.read.link(row.photo_file_id),
        present: row.present === null ? null : Boolean(row.present),
      })),
    };
  }

  async markPeriod(
    schoolId: number,
    slotId: number,
    dto: PeriodAttendanceDto,
    actor: AuthUser,
  ): Promise<PeriodRosterDto> {
    const day = dto.date ?? this.read.today();
    if (day > this.read.today())
      throw AppException.validation([{ field: 'date', message: 'You cannot mark a future day' }]);
    const { period, row } = await this.slot(schoolId, slotId, day);
    if (
      weekday(day) !==
      Number(
        (await this.dataSource.query(`SELECT day_of_week FROM timetable_slots WHERE id = $1`, [slotId]))[0]
          ?.day_of_week,
      )
    ) {
      throw AppException.validation([{ field: 'date', message: 'This library period is not on that day' }]);
    }
    const roster = await this.roster(schoolId, slotId, day);
    const known = new Set(roster.students.map((student) => student.student_id));
    const stranger = dto.absent_student_ids.find((id) => !known.has(id));
    if (stranger) {
      throw AppException.validation([
        { field: 'absent_student_ids', message: `Student ${stranger} is not in this class` },
      ]);
    }
    const absent = new Set(dto.absent_student_ids);
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(LibraryVisit, { school_id: schoolId, kind: 'period', slot_id: slotId, visit_date: day });
      if (!roster.students.length) return;
      await manager.insert(
        LibraryVisit,
        roster.students.map((student) => ({
          school_id: schoolId,
          kind: 'period' as const,
          member_type: 'student' as const,
          student_id: student.student_id,
          user_id: null,
          class_id: Number(row.class_id),
          section_id: period.section.id,
          visit_date: day,
          in_at: null,
          out_at: null,
          purpose: 'period' as const,
          present: !absent.has(student.student_id),
          slot_id: slotId,
          period_no: period.period_no,
          marked_by: actor.id,
          created_by: actor.id,
        })),
      );
    });
    return this.roster(schoolId, slotId, day);
  }

  async closeOpenVisits(schoolId: number, closingTime: string, today: string, timeZone: string): Promise<number> {
    const result: [unknown[], number] = await this.dataSource.query(
      `UPDATE library_visits SET out_at = ((visit_date::text || ' ' || $2)::timestamp AT TIME ZONE $4), updated_at = now()
       WHERE school_id = $1 AND kind = 'walk_in' AND out_at IS NULL AND deleted_at IS NULL
         AND (visit_date < $3::date OR ((visit_date::text || ' ' || $2)::timestamp AT TIME ZONE $4) <= now())`,
      [schoolId, closingTime, today, timeZone],
    );
    return Array.isArray(result) ? Number(result[1] ?? 0) : 0;
  }
}
