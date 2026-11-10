import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { holidaySet, monthRange, percent, WEEKLY_OFF, weekday, workingDays } from '../../shared/school-days';
import { NotificationsService } from '../notifications/notifications.service';
import { AcademicYear } from '../setup/entities/academic-year.entity';
import {
  afternoonDefault,
  AttendanceSessionName,
  resolveSession,
  SESSION_PERIOD,
  SessionWindow,
  sessionState,
  windowMessage,
} from './attendance-sessions';
import {
  AttendanceBoardDto,
  AttendanceSummaryDto,
  BulkSectionMarkDto,
  BulkSectionResultDto,
  ClassReportDto,
  MarkAttendanceDto,
  MarkSomeAttendanceDto,
  MonthlyAttendanceDto,
  RosterDto,
  SectionReportDto,
  AttendanceYearDto,
  SectionDayDto,
} from './dto/attendance.dto';
import { AttendanceRecord, AttendanceStatus } from './entities/attendance-record.entity';
import { AttendanceSession } from './entities/attendance-session.entity';
import { clampRange, monthsBetween } from './attendance-reports.logic';
import { bulkPlan, mergeMarks } from './bulk-attendance.logic';

interface SectionRow {
  id: number;
  name: string;
  class_name: string;
  class_teacher_user_id: number | null;
  academic_year_id: number;
}

interface StudentRow {
  student_id: number;
  first_name: string;
  last_name: string | null;
  admission_no: string;
  roll_no: number | null;
}

export interface MarkOptions {
  teacher?: boolean;
}

export interface TodaySessions {
  status: AttendanceStatus | null;
  morning: AttendanceStatus | null;
  afternoon: AttendanceStatus | null;
}

export const PRESENT_WEIGHT: Record<AttendanceStatus, number> = {
  present: 1,
  late: 1,
  half_day: 0.5,
  absent: 0,
  leave: 0,
};

export function summarise(statuses: AttendanceStatus[]): AttendanceSummaryDto {
  const count = (status: AttendanceStatus) => statuses.filter((item) => item === status).length;
  const attended = statuses.reduce((sum, status) => sum + PRESENT_WEIGHT[status], 0);
  return {
    total: statuses.length,
    present: count('present'),
    absent: count('absent'),
    late: count('late'),
    half_day: count('half_day'),
    leave: count('leave'),
    percent: percent(attended, statuses.length),
  };
}

interface DayRow {
  student_id: number;
  status: AttendanceStatus;
  morning: AttendanceStatus | null;
  afternoon: AttendanceStatus | null;
}

const classSectionName = (section: { class_name: string; name: string }) =>
  [section.class_name, section.name].filter(Boolean).join(' - ');

function monthTotal(month: string, workingDayCount: number, statuses: AttendanceStatus[]) {
  const summary = summarise(statuses);
  return {
    month,
    working_days: workingDayCount,
    marked_days: summary.total,
    present: summary.present,
    late: summary.late,
    half_day: summary.half_day,
    absent: summary.absent,
    leave: summary.leave,
    percent: summary.percent,
  };
}

const fullName = (row: { first_name: string; last_name: string | null }) =>
  [row.first_name, row.last_name].filter(Boolean).join(' ');

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger('Attendance');

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  sessionFor(input: { session?: AttendanceSessionName; period?: number }): AttendanceSessionName {
    return resolveSession(input);
  }

  async roster(
    schoolId: number,
    sectionId: number,
    date: string,
    session: AttendanceSessionName = 'morning',
    options: MarkOptions = {},
  ): Promise<RosterDto> {
    const manager = this.dataSource.manager;
    const period = SESSION_PERIOD[session];
    const section = await this.section(manager, schoolId, sectionId);
    const [students, saved, morning, holiday, leaves, window] = await Promise.all([
      this.students(manager, sectionId),
      manager.findOne(AttendanceSession, {
        where: { section_id: sectionId, date, period },
        relations: { records: true },
      }),
      session === 'afternoon'
        ? manager.findOne(AttendanceSession, {
            where: { section_id: sectionId, date, period: SESSION_PERIOD.morning },
            relations: { records: true },
          })
        : Promise.resolve(null),
      this.holidayName(manager, schoolId, date),
      this.leaveStudents(manager, schoolId, date, session),
      this.window(manager, schoolId, session),
    ]);
    const records = new Map((saved?.records ?? []).map((record) => [record.student_id, record]));
    const morningStatus = new Map((morning?.records ?? []).map((record) => [record.student_id, record.status]));
    const takenBy = saved?.taken_by
      ? await manager.query(`SELECT id, name FROM users WHERE id = $1`, [saved.taken_by])
      : [];
    const rows = students.map((student) => {
      const id = Number(student.student_id);
      const record = records.get(id);
      const onLeave = leaves.has(id);
      return {
        student_id: id,
        full_name: fullName(student),
        admission_no: student.admission_no,
        roll_no: student.roll_no,
        status: record?.status ?? afternoonDefault(morningStatus.get(id) ?? null, onLeave),
        remarks: record?.remarks ?? null,
        on_leave: onLeave,
      };
    });
    const today = todayIn(this.app.timeZone);
    return {
      section: { id: section.id, name: `${section.class_name} - ${section.name}` },
      date,
      session,
      period,
      open: !options.teacher || sessionState(window, date, today, this.nowTime()) === 'open',
      opens_at: window.opens_at,
      closes_at: window.closes_at,
      working_day: !holiday && !WEEKLY_OFF.includes(weekday(date)),
      holiday,
      marked: Boolean(saved),
      taken_by: takenBy[0] ? { id: Number(takenBy[0].id), name: takenBy[0].name } : null,
      taken_at: saved?.updated_at ?? null,
      summary: summarise(rows.map((row) => row.status)),
      students: rows,
    };
  }

  async mark(
    schoolId: number,
    sectionId: number,
    dto: MarkAttendanceDto,
    actor: AuthUser,
    options: MarkOptions = {},
  ): Promise<RosterDto> {
    const session = resolveSession(dto);
    const period = SESSION_PERIOD[session];
    const today = todayIn(this.app.timeZone);
    if (dto.date > today) throw AppException.badRequest('Attendance cannot be taken for a future date', 'FUTURE_DATE');
    if (options.teacher) {
      const window = await this.window(this.dataSource.manager, schoolId, session);
      const state = sessionState(window, dto.date, today, this.nowTime());
      if (state !== 'open') {
        throw AppException.badRequest(
          windowMessage(session, window, state),
          state === 'not_open' ? 'SESSION_NOT_OPEN' : 'SESSION_CLOSED',
        );
      }
    }
    const absentees = await this.dataSource.transaction(async (manager) => {
      const section = await this.section(manager, schoolId, sectionId);
      const year = await manager.findOneByOrFail(AcademicYear, { id: section.academic_year_id });
      if (dto.date < year.start_date || dto.date > year.end_date) {
        throw AppException.badRequest(`The date is outside the ${year.name} academic year`, 'OUTSIDE_YEAR');
      }
      if (WEEKLY_OFF.includes(weekday(dto.date))) {
        throw AppException.badRequest('Attendance is not taken on Sundays', 'NOT_A_SCHOOL_DAY');
      }
      const holiday = await this.holidayName(manager, schoolId, dto.date);
      if (holiday) throw AppException.badRequest(`${dto.date} is a holiday: ${holiday}`, 'HOLIDAY');

      const students = await this.students(manager, sectionId);
      const enrolled = new Set(students.map((student) => Number(student.student_id)));
      const given = dto.items.map((item) => item.student_id);
      if (new Set(given).size !== given.length) {
        throw AppException.badRequest('A student appears twice in the list', 'DUPLICATE_STUDENT');
      }
      const stranger = given.find((id) => !enrolled.has(id));
      if (stranger)
        throw AppException.badRequest(`Student ${stranger} is not in this section`, 'STUDENT_NOT_IN_SECTION');
      const missing = students.filter((student) => !given.includes(Number(student.student_id)));
      if (missing.length) {
        throw AppException.badRequest(
          `Mark every student. Missing: ${missing.slice(0, 3).map(fullName).join(', ')}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''}`,
          'ATTENDANCE_INCOMPLETE',
        );
      }

      let saved = await manager.findOneBy(AttendanceSession, { section_id: sectionId, date: dto.date, period });
      const previous = new Map<number, AttendanceRecord>();
      if (saved) {
        for (const record of await manager.findBy(AttendanceRecord, { session_id: saved.id })) {
          previous.set(record.student_id, record);
        }
        await manager.update(AttendanceSession, saved.id, {
          taken_by: actor.id,
          subject_id: dto.subject_id ?? saved.subject_id,
        });
        await manager.delete(AttendanceRecord, { session_id: saved.id });
      } else {
        saved = await manager.save(
          manager.create(AttendanceSession, {
            school_id: schoolId,
            academic_year_id: section.academic_year_id,
            section_id: sectionId,
            date: dto.date,
            period,
            subject_id: dto.subject_id ?? null,
            taken_by: actor.id,
          }),
        );
      }
      await manager.insert(
        AttendanceRecord,
        dto.items.map((item) => ({
          session_id: saved!.id,
          school_id: schoolId,
          student_id: item.student_id,
          date: dto.date,
          period,
          status: item.status,
          remarks: item.remarks ?? null,
          alert_sent: previous.get(item.student_id)?.alert_sent ?? false,
        })),
      );
      if (dto.date !== today) return [];
      const absent = dto.items
        .filter((item) => item.status === 'absent' && !previous.get(item.student_id)?.alert_sent)
        .map((item) => item.student_id);
      if (!absent.length) return [];
      const alerted: { student_id: number }[] = await manager.query(
        `SELECT DISTINCT student_id FROM attendance_records
         WHERE student_id = ANY($1) AND date = $2 AND alert_sent = true`,
        [absent, dto.date],
      );
      const already = new Set(alerted.map((row) => Number(row.student_id)));
      return absent.filter((id) => !already.has(id));
    });

    if (absentees.length) await this.sendAbsentAlerts(schoolId, sectionId, dto.date, session, absentees);
    return this.roster(schoolId, sectionId, dto.date, session, options);
  }

  async markSome(
    schoolId: number,
    sectionId: number,
    dto: MarkSomeAttendanceDto,
    actor: AuthUser,
    options: MarkOptions = {},
  ): Promise<RosterDto> {
    const session = dto.session ?? 'morning';
    const roster = await this.roster(schoolId, sectionId, dto.date, session, options);
    return this.mark(
      schoolId,
      sectionId,
      { date: dto.date, session, items: mergeMarks(roster.students, dto.items) },
      actor,
      options,
    );
  }

  async bulkMark(schoolId: number, dto: BulkSectionMarkDto, actor: AuthUser): Promise<BulkSectionResultDto> {
    const session = dto.session ?? 'morning';
    const board = await this.board(schoolId, dto.date, session);
    if (!board.working_day) {
      throw AppException.badRequest(
        board.holiday ? `${dto.date} is a holiday: ${board.holiday}` : 'Attendance is not taken on Sundays',
        board.holiday ? 'HOLIDAY' : 'NOT_A_SCHOOL_DAY',
      );
    }
    const plan = bulkPlan(board.sections, dto.section_ids, dto.overwrite);
    if (!plan.targets.length && !plan.skipped.length) {
      throw AppException.badRequest('Every section is already marked for this session', 'NOTHING_TO_MARK');
    }
    let marked = 0;
    let students = 0;
    for (const section of plan.targets) {
      const roster = await this.roster(schoolId, section.section_id, dto.date, session);
      try {
        await this.mark(
          schoolId,
          section.section_id,
          {
            date: dto.date,
            session,
            items: roster.students.map((student) => ({
              student_id: student.student_id,
              status: student.on_leave ? 'leave' : dto.status,
              remarks: dto.remarks ?? null,
            })),
          },
          actor,
        );
        marked += 1;
        students += roster.students.length;
      } catch (error) {
        plan.skipped.push({ id: section.section_id, name: section.name, reason: (error as Error).message });
      }
    }
    return { date: dto.date, marked, students, skipped: plan.skipped };
  }

  async board(schoolId: number, date: string, session: AttendanceSessionName = 'morning'): Promise<AttendanceBoardDto> {
    const manager = this.dataSource.manager;
    const year = await manager.findOneBy(AcademicYear, { school_id: schoolId, is_current: true });
    const holiday = await this.holidayName(manager, schoolId, date);
    const rows: {
      section_id: number;
      class_name: string;
      section_name: string;
      class_teacher: string | null;
      total: string;
      statuses: AttendanceStatus[] | null;
      taken_by: string | null;
      taken_at: Date | null;
      morning_marked: boolean;
      afternoon_marked: boolean;
    }[] = year
      ? await manager.query(
          `SELECT sec.id AS section_id, c.name AS class_name, sec.name AS section_name, t.name AS class_teacher,
                  (SELECT COUNT(*) FROM student_enrollments e JOIN students s ON s.id = e.student_id
                    WHERE e.section_id = sec.id AND s.deleted_at IS NULL AND s.status = 'active') AS total,
                  (SELECT array_agg(r.status) FROM attendance_records r WHERE r.session_id = a.id) AS statuses,
                  u.name AS taken_by, a.updated_at AS taken_at,
                  EXISTS (SELECT 1 FROM attendance_sessions m WHERE m.section_id = sec.id AND m.date = $3 AND m.period = $5) AS morning_marked,
                  EXISTS (SELECT 1 FROM attendance_sessions n WHERE n.section_id = sec.id AND n.date = $3 AND n.period = $6) AS afternoon_marked
           FROM sections sec
           JOIN classes c ON c.id = sec.class_id
           LEFT JOIN users t ON t.id = sec.class_teacher_user_id
           LEFT JOIN attendance_sessions a ON a.section_id = sec.id AND a.date = $3 AND a.period = $4
           LEFT JOIN users u ON u.id = a.taken_by
           WHERE sec.school_id = $1 AND sec.academic_year_id = $2 AND sec.deleted_at IS NULL
           ORDER BY c.grade_level, sec.name`,
          [schoolId, year.id, date, SESSION_PERIOD[session], SESSION_PERIOD.morning, SESSION_PERIOD.afternoon],
        )
      : [];
    const sections = rows.map((row) => {
      const statuses = row.statuses ?? [];
      return {
        section_id: Number(row.section_id),
        name: `${row.class_name} - ${row.section_name}`,
        class_teacher: row.class_teacher,
        ...summarise(statuses),
        total: statuses.length || Number(row.total),
        marked: Boolean(row.taken_at),
        morning_marked: row.morning_marked,
        afternoon_marked: row.afternoon_marked,
        taken_by: row.taken_by,
        taken_at: row.taken_at,
      };
    });
    const withStudents = sections.filter((section) => section.total > 0);
    const allStatuses = rows.flatMap((row) => row.statuses ?? []);
    const { from } = monthRange(date.slice(0, 7));
    const [below, pending] = await Promise.all([
      this.belowCount(manager, schoolId, from, date),
      manager.query(
        `SELECT COUNT(*) AS count FROM student_leave_requests WHERE school_id = $1 AND status = 'pending' AND deleted_at IS NULL`,
        [schoolId],
      ),
    ]);
    return {
      date,
      session,
      working_day: !holiday && !WEEKLY_OFF.includes(weekday(date)),
      holiday,
      summary: summarise(allStatuses),
      sections_total: withStudents.length,
      sections_not_marked: withStudents.filter((section) => !section.marked).length,
      below_75: below,
      leave_pending: Number(pending[0]?.count ?? 0),
      sections: withStudents,
    };
  }

  async monthly(schoolId: number, studentId: number, month: string): Promise<MonthlyAttendanceDto> {
    const manager = this.dataSource.manager;
    const today = todayIn(this.app.timeZone);
    const range = monthRange(month);
    const to = range.to < today ? range.to : today;
    const holidays = await holidaySet(manager, schoolId, range.from, range.to);
    const records: {
      date: string;
      status: AttendanceStatus;
      morning: AttendanceStatus | null;
      afternoon: AttendanceStatus | null;
    }[] = await manager.query(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date, status, morning, afternoon FROM student_attendance_days
       WHERE student_id = $1 AND school_id = $2 AND date BETWEEN $3 AND $4`,
      [studentId, schoolId, range.from, range.to],
    );
    const byDate = new Map(records.map((record) => [record.date, record]));
    const days = [];
    for (let date = range.from; date <= to && date <= range.to;) {
      const record = byDate.get(date);
      days.push({
        date,
        status: WEEKLY_OFF.includes(weekday(date))
          ? ('weekly_off' as const)
          : holidays.has(date)
            ? ('holiday' as const)
            : (record?.status ?? ('not_marked' as const)),
        morning: record?.morning ?? null,
        afternoon: record?.afternoon ?? null,
      });
      const next = new Date(`${date}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      date = next.toISOString().slice(0, 10);
    }
    const marked = days
      .map((day) => day.status)
      .filter((status): status is AttendanceStatus => status in PRESENT_WEIGHT);
    const summary = summarise(marked);
    return {
      month,
      working_days: workingDays(range.from, to, holidays).length,
      present: summary.present,
      half_day: summary.half_day,
      absent: summary.absent,
      late: summary.late,
      leave: summary.leave,
      percent: summary.percent,
      days,
    };
  }

  async sectionReport(schoolId: number, sectionId: number, month: string): Promise<SectionReportDto> {
    const manager = this.dataSource.manager;
    await this.section(manager, schoolId, sectionId);
    const range = monthRange(month);
    const today = todayIn(this.app.timeZone);
    const to = range.to < today ? range.to : today;
    const holidays = await holidaySet(manager, schoolId, range.from, range.to);
    const students = await this.students(manager, sectionId);
    const [records, sessions] = await Promise.all([
      manager.query(
        `SELECT student_id, status FROM student_attendance_days
         WHERE student_id = ANY($1) AND school_id = $2 AND date BETWEEN $3 AND $4`,
        [students.map((student) => Number(student.student_id)), schoolId, range.from, to],
      ) as Promise<{ student_id: number; status: AttendanceStatus }[]>,
      manager.query(
        `SELECT COUNT(DISTINCT date) AS count FROM attendance_sessions
         WHERE section_id = $1 AND period = ANY($2) AND date BETWEEN $3 AND $4`,
        [sectionId, [SESSION_PERIOD.morning, SESSION_PERIOD.afternoon], range.from, to],
      ),
    ]);
    return {
      month,
      working_days: workingDays(range.from, to, holidays).length,
      marked_days: Number(sessions[0]?.count ?? 0),
      students: students.map((student) => {
        const summary = summarise(
          records
            .filter((record) => Number(record.student_id) === Number(student.student_id))
            .map((record) => record.status),
        );
        return {
          student_id: Number(student.student_id),
          full_name: fullName(student),
          roll_no: student.roll_no,
          present: summary.present,
          half_day: summary.half_day,
          absent: summary.absent,
          late: summary.late,
          leave: summary.leave,
          percent: summary.percent,
        };
      }),
    };
  }

  async classReport(schoolId: number, classId: number, month: string): Promise<ClassReportDto> {
    const manager = this.dataSource.manager;
    const [schoolClass] = await manager.query(
      `SELECT id, name FROM classes WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [classId, schoolId],
    );
    if (!schoolClass) throw AppException.notFound('Class not found', 'CLASS_NOT_FOUND');
    const year = await manager.findOneBy(AcademicYear, { school_id: schoolId, is_current: true });
    const sections: { id: number }[] = year
      ? await manager.query(
          `SELECT id FROM sections WHERE class_id = $1 AND academic_year_id = $2 AND deleted_at IS NULL ORDER BY name`,
          [classId, year.id],
        )
      : [];
    const range = monthRange(month);
    const today = todayIn(this.app.timeZone);
    const to = range.to < today ? range.to : today;
    const holidays = await holidaySet(manager, schoolId, range.from, range.to);
    const reports = await Promise.all(
      sections.map(async (row) => {
        const section = await this.section(manager, schoolId, Number(row.id));
        return { section, report: await this.sectionReport(schoolId, section.id, month) };
      }),
    );
    const average = (values: (number | null)[]) => {
      const known = values.filter((value): value is number => value !== null);
      return known.length ? Math.round((known.reduce((sum, value) => sum + value, 0) / known.length) * 10) / 10 : null;
    };
    const below = (rows: { percent: number | null }[]) =>
      rows.filter((item) => item.percent !== null && item.percent < 75).length;
    const allStudents = reports.flatMap(({ report }) => report.students);
    return {
      month,
      class: { id: Number(schoolClass.id), name: schoolClass.name },
      working_days: workingDays(range.from, to, holidays).length,
      students: allStudents.length,
      percent: average(allStudents.map((item) => item.percent)),
      below_75: below(allStudents),
      sections: reports.map(({ section, report }) => ({
        section_id: section.id,
        name: `${section.class_name} - ${section.name}`,
        students: report.students.length,
        marked_days: report.marked_days,
        percent: average(report.students.map((item) => item.percent)),
        below_75: below(report.students),
      })),
    };
  }

  async sectionDay(schoolId: number, sectionId: number, date: string): Promise<SectionDayDto> {
    const manager = this.dataSource.manager;
    const section = await this.section(manager, schoolId, sectionId);
    const [students, holiday, sessions] = await Promise.all([
      this.students(manager, sectionId),
      this.holidayName(manager, schoolId, date),
      manager.query(
        `SELECT DISTINCT period FROM attendance_sessions WHERE section_id = $1 AND date = $2 AND period = ANY($3)`,
        [sectionId, date, [SESSION_PERIOD.morning, SESSION_PERIOD.afternoon]],
      ) as Promise<{ period: number }[]>,
    ]);
    const records: DayRow[] = students.length
      ? await manager.query(
          `SELECT student_id, status, morning, afternoon FROM student_attendance_days
           WHERE school_id = $1 AND date = $2 AND student_id = ANY($3)`,
          [schoolId, date, students.map((student) => Number(student.student_id))],
        )
      : [];
    const byStudent = new Map(records.map((record) => [Number(record.student_id), record]));
    const rows = students.map((student) => {
      const record = byStudent.get(Number(student.student_id));
      return {
        student_id: Number(student.student_id),
        full_name: fullName(student),
        roll_no: student.roll_no,
        morning: record?.morning ?? null,
        afternoon: record?.afternoon ?? null,
        status: record?.status ?? null,
      };
    });
    const periods = new Set(sessions.map((row) => Number(row.period)));
    return {
      date,
      section_id: section.id,
      section: classSectionName(section),
      working_day: !WEEKLY_OFF.includes(weekday(date)) && !holiday,
      holiday,
      morning_marked: periods.has(SESSION_PERIOD.morning),
      afternoon_marked: periods.has(SESSION_PERIOD.afternoon),
      summary: summarise(rows.map((row) => row.status).filter((status): status is AttendanceStatus => status !== null)),
      students: rows,
    };
  }

  async yearSummary(schoolId: number, studentId: number): Promise<AttendanceYearDto> {
    const manager = this.dataSource.manager;
    const [year, student] = await Promise.all([
      manager.findOneBy(AcademicYear, { school_id: schoolId, is_current: true }),
      manager.query(`SELECT id FROM students WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`, [
        studentId,
        schoolId,
      ]),
    ]);
    if (!student.length) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    const today = todayIn(this.app.timeZone);
    const range = year ? clampRange(year.start_date, year.end_date, year.start_date, today) : null;
    if (!year || !range) {
      return {
        student_id: studentId,
        academic_year: year?.name ?? null,
        from: null,
        to: null,
        year: monthTotal('year', 0, []),
        months: [],
      };
    }
    const [holidays, records] = await Promise.all([
      holidaySet(manager, schoolId, range.from, range.to),
      manager.query(
        `SELECT to_char(date, 'YYYY-MM-DD') AS date, status FROM student_attendance_days
         WHERE student_id = $1 AND school_id = $2 AND date BETWEEN $3 AND $4`,
        [studentId, schoolId, range.from, range.to],
      ) as Promise<{ date: string; status: AttendanceStatus }[]>,
    ]);
    const months = monthsBetween(range.from, range.to).map((month) => {
      const part = clampRange(monthRange(month).from, monthRange(month).to, range.from, range.to)!;
      return monthTotal(
        month,
        workingDays(part.from, part.to, holidays).length,
        records.filter((record) => record.date.startsWith(month)).map((record) => record.status),
      );
    });
    return {
      student_id: studentId,
      academic_year: year.name,
      from: range.from,
      to: range.to,
      year: monthTotal(
        year.name,
        workingDays(range.from, range.to, holidays).length,
        records.map((record) => record.status),
      ),
      months,
    };
  }

  async assertClassTeacherOfSection(schoolId: number, sectionId: number, userId: number): Promise<void> {
    const section = await this.section(this.dataSource.manager, schoolId, sectionId);
    if (Number(section.class_teacher_user_id) !== userId) {
      throw AppException.forbidden(
        'Only the class teacher of this section can see its attendance reports',
        'NOT_CLASS_TEACHER',
      );
    }
  }

  async assertClassTeacherOfStudent(schoolId: number, studentId: number, userId: number): Promise<void> {
    const [row] = await this.dataSource.query(
      `SELECT s.id, sec.class_teacher_user_id FROM students s
       LEFT JOIN academic_years y ON y.school_id = s.school_id AND y.is_current AND y.deleted_at IS NULL
       LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = y.id
       LEFT JOIN sections sec ON sec.id = e.section_id
       WHERE s.id = $1 AND s.school_id = $2 AND s.deleted_at IS NULL`,
      [studentId, schoolId],
    );
    if (!row) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    if (Number(row.class_teacher_user_id) !== userId) {
      throw AppException.forbidden(
        'Only the class teacher of this student can see their attendance report',
        'NOT_CLASS_TEACHER',
      );
    }
  }

  async sectionTitle(schoolId: number, sectionId: number): Promise<string> {
    const section = await this.section(this.dataSource.manager, schoolId, sectionId);
    return `${section.class_name} - ${section.name}`;
  }

  async todayStatus(studentId: number, schoolId: number): Promise<AttendanceStatus | null> {
    return (await this.todaySessions(studentId, schoolId)).status;
  }

  async todaySessions(studentId: number, schoolId: number): Promise<TodaySessions> {
    const [row] = await this.dataSource.query(
      `SELECT status, morning, afternoon FROM student_attendance_days WHERE student_id = $1 AND school_id = $2 AND date = $3`,
      [studentId, schoolId, todayIn(this.app.timeZone)],
    );
    return { status: row?.status ?? null, morning: row?.morning ?? null, afternoon: row?.afternoon ?? null };
  }

  private async sendAbsentAlerts(
    schoolId: number,
    sectionId: number,
    date: string,
    session: AttendanceSessionName,
    studentIds: number[],
  ): Promise<void> {
    const rows: {
      student_id: number;
      first_name: string;
      last_name: string | null;
      class_name: string;
      section_name: string;
      user_ids: number[];
    }[] = await this.dataSource.query(
      `SELECT s.id AS student_id, s.first_name, s.last_name, c.name AS class_name, sec.name AS section_name,
                array_remove(array_agg(DISTINCT g.user_id), NULL) AS user_ids
         FROM students s
         JOIN student_enrollments e ON e.student_id = s.id AND e.section_id = $1
         JOIN sections sec ON sec.id = e.section_id
         JOIN classes c ON c.id = sec.class_id
         LEFT JOIN student_guardians sg ON sg.student_id = s.id AND sg.receives_alerts = true
         LEFT JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
         WHERE s.id = ANY($2)
         GROUP BY s.id, c.name, sec.name`,
      [sectionId, studentIds],
    );
    const shown = new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`));
    const when = session === 'morning' ? shown : `${shown} (afternoon)`;
    for (const row of rows) {
      if (row.user_ids.length) {
        await this.notifications
          .dispatch({
            template: 'STUDENT_ABSENT',
            audience: { user_ids: row.user_ids.map(Number) },
            data: {
              student: fullName(row),
              class: `${row.class_name}-${row.section_name}`,
              date: when,
              student_id: String(row.student_id),
              session,
            },
          })
          .catch((error: Error) =>
            this.logger.warn(`Absent alert for student ${row.student_id} failed: ${error.message}`),
          );
      }
      await this.dataSource
        .getRepository(AttendanceRecord)
        .update({ student_id: Number(row.student_id), date, period: SESSION_PERIOD[session] }, { alert_sent: true });
    }
  }

  private async window(
    manager: EntityManager,
    schoolId: number,
    session: AttendanceSessionName,
  ): Promise<SessionWindow> {
    const [row] = await manager.query(
      `SELECT start_time, end_time FROM bell_periods WHERE school_id = $1 AND period_no = $2 ORDER BY start_time LIMIT 1`,
      [schoolId, SESSION_PERIOD[session]],
    );
    return { opens_at: row?.start_time ?? null, closes_at: row?.end_time ?? null };
  }

  private nowTime(): string {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: this.app.timeZone,
    }).format(new Date());
  }

  private async section(manager: EntityManager, schoolId: number, sectionId: number): Promise<SectionRow> {
    const [row] = await manager.query(
      `SELECT sec.id, sec.name, c.name AS class_name, sec.class_teacher_user_id, sec.academic_year_id
       FROM sections sec JOIN classes c ON c.id = sec.class_id
       WHERE sec.id = $1 AND sec.school_id = $2 AND sec.deleted_at IS NULL`,
      [sectionId, schoolId],
    );
    if (!row) throw AppException.notFound('Section not found', 'SECTION_NOT_FOUND');
    return { ...row, id: Number(row.id), academic_year_id: Number(row.academic_year_id) };
  }

  private students(manager: EntityManager, sectionId: number): Promise<StudentRow[]> {
    return manager.query(
      `SELECT s.id AS student_id, s.first_name, s.last_name, s.admission_no, e.roll_no
       FROM student_enrollments e JOIN students s ON s.id = e.student_id
       WHERE e.section_id = $1 AND s.deleted_at IS NULL AND s.status = 'active'
       ORDER BY e.roll_no NULLS LAST, s.first_name`,
      [sectionId],
    );
  }

  private async leaveStudents(
    manager: EntityManager,
    schoolId: number,
    date: string,
    session: AttendanceSessionName,
  ): Promise<Set<number>> {
    const rows: { student_id: number }[] = await manager.query(
      `SELECT student_id FROM student_leave_requests
       WHERE school_id = $1 AND status = 'approved' AND deleted_at IS NULL AND $2 BETWEEN from_date AND to_date
       AND (half_day IS NULL OR half_day = $3)`,
      [schoolId, date, session],
    );
    return new Set(rows.map((row) => Number(row.student_id)));
  }

  private async holidayName(manager: EntityManager, schoolId: number, date: string): Promise<string | null> {
    const [row] = await manager.query(
      `SELECT name FROM holidays WHERE school_id = $1 AND deleted_at IS NULL AND type <> 'event'
       AND $2 BETWEEN date AND COALESCE(end_date, date) LIMIT 1`,
      [schoolId, date],
    );
    return row?.name ?? null;
  }

  private async belowCount(manager: EntityManager, schoolId: number, from: string, to: string): Promise<number> {
    const [row] = await manager.query(
      `SELECT COUNT(*) AS count FROM (
         SELECT student_id,
                SUM(CASE status WHEN 'present' THEN 1 WHEN 'late' THEN 1 WHEN 'half_day' THEN 0.5 ELSE 0 END) / COUNT(*) AS ratio
         FROM student_attendance_days WHERE school_id = $1 AND date BETWEEN $2 AND $3
         GROUP BY student_id) x WHERE ratio < 0.75`,
      [schoolId, from, to],
    );
    return Number(row?.count ?? 0);
  }
}
