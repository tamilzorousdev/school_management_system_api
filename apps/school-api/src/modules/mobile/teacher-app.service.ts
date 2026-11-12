import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { weekday } from '../../shared/school-days';
import { AchievementsService } from '../achievements/achievements.service';
import { AttendanceStatus } from '../attendance/entities/attendance-record.entity';
import { ExamsService } from '../exams/exams.service';
import { FeesService } from '../fees/fees.service';
import { AttendanceService, summarise } from '../attendance/attendance.service';
import { StudentLeaveService } from '../attendance/student-leave.service';
import { StudentLifecycleService } from '../student-lifecycle/student-lifecycle.service';
import { StudentRecordsService } from '../student-records/student-records.service';
import { StudentsService } from '../students/students.service';
import { SubstitutesService } from '../substitutes/substitutes.service';
import { DAY_NAMES } from '../timetable/dto/timetable.dto';
import { TimetableService } from '../timetable/timetable.service';
import {
  BenchPlanDto,
  BenchQueryDto,
  RosterQueryDto,
  RosterStudentDto,
  StudentHistoryDto,
  TodayPeriodDto,
  TodayTimetableDto,
} from './dto/teacher-app.dto';
import { groupLabel, sortRoster, splitIntoGroups } from './roster.logic';

const nowClock = (timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(new Date());

@Injectable()
export class TeacherAppService {
  constructor(
    private readonly timetable: TimetableService,
    private readonly substitutes: SubstitutesService,
    private readonly attendance: AttendanceService,
    private readonly leaves: StudentLeaveService,
    private readonly records: StudentRecordsService,
    private readonly lifecycle: StudentLifecycleService,
    private readonly students: StudentsService,
    private readonly achievements: AchievementsService,
    private readonly exams: ExamsService,
    private readonly fees: FeesService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async today(schoolId: number, user: AuthUser): Promise<TodayTimetableDto> {
    const date = todayIn(this.app.timeZone);
    const day = weekday(date);
    const [holidayRow] = await this.dataSource.query(
      `SELECT name FROM holidays WHERE school_id = $1 AND deleted_at IS NULL AND type <> 'event'
       AND date <= $2 AND COALESCE(end_date, date) >= $2 AND class_ids IS NULL LIMIT 1`,
      [schoolId, date],
    );
    const holiday: string | null = holidayRow?.name ?? null;
    const working = day !== 0 && !holiday;
    const [bell, mine, covers] = await Promise.all([
      this.timetable.periods(schoolId),
      working ? this.timetable.today(schoolId, user.id, day) : Promise.resolve([]),
      working ? this.substitutes.mine(user) : Promise.resolve([]),
    ]);
    const offSections = new Set<number>(
      (
        (await this.dataSource.query(
          `SELECT sec.id FROM sections sec JOIN holidays h ON h.school_id = sec.school_id
           WHERE sec.school_id = $1 AND h.deleted_at IS NULL AND h.type <> 'event' AND h.class_ids IS NOT NULL
             AND sec.class_id = ANY(h.class_ids) AND h.date <= $2 AND COALESCE(h.end_date, h.date) >= $2`,
          [schoolId, date],
        )) as { id: number }[]
      ).map((row) => Number(row.id)),
    );
    mine.splice(0, mine.length, ...mine.filter((slot) => !offSections.has(slot.section.id)));
    const todayCovers = covers.filter((cover) => cover.date === date);
    const sectionIds = [
      ...new Set([...mine.map((slot) => slot.section.id), ...todayCovers.map((cover) => cover.section.id)]),
    ];
    const counts: { section_id: number; students: string; present: string | null; marked: boolean }[] =
      sectionIds.length
        ? await this.dataSource.query(
            `SELECT sec.id AS section_id,
                    (SELECT COUNT(*) FROM student_enrollments e JOIN students s ON s.id = e.student_id
                      WHERE e.section_id = sec.id AND s.deleted_at IS NULL AND s.status = 'active') AS students,
                    (SELECT COUNT(*) FILTER (WHERE r.status IN ('present', 'late', 'half_day'))
                       FROM attendance_sessions a JOIN attendance_records r ON r.session_id = a.id
                      WHERE a.section_id = sec.id AND a.date = $2
                        AND a.period = (SELECT max(l.period) FROM attendance_sessions l
                                        WHERE l.section_id = sec.id AND l.date = $2 AND l.period IN (1, 5))) AS present,
                    EXISTS (SELECT 1 FROM attendance_sessions a WHERE a.section_id = sec.id AND a.date = $2 AND a.period IN (1, 5)) AS marked
             FROM sections sec WHERE sec.id = ANY($1)`,
            [sectionIds, date],
          )
        : [];
    const clock = nowClock(this.app.timeZone);
    const periods: TodayPeriodDto[] = bell
      .filter((period) => !period.is_special)
      .map((period) => {
        const base = {
          period_no: period.period_no,
          name: period.name,
          start_time: period.start_time,
          end_time: period.end_time,
          is_break: period.is_break,
          is_now: working && clock >= period.start_time && clock < period.end_time,
        };
        const empty = {
          section: null,
          subject: null,
          room: null,
          covering_for: null,
          students: 0,
          present: null,
          attendance_marked: false,
        };
        if (period.is_break || !working) return { ...base, ...empty, kind: period.is_break ? 'break' : 'free' };
        const slot = mine.find((item) => item.period_no === period.period_no);
        const cover = todayCovers.find((item) => item.period_no === period.period_no);
        const lesson = slot
          ? {
              kind: 'class' as const,
              section: slot.section,
              subject: slot.subject,
              room: slot.room,
              covering_for: null,
            }
          : cover
            ? {
                kind: 'substitute' as const,
                section: cover.section,
                subject: cover.subject,
                room: cover.room,
                covering_for: cover.absent_teacher,
              }
            : null;
        if (!lesson) return { ...base, ...empty, kind: 'free' };
        const count = counts.find((row) => Number(row.section_id) === lesson.section.id);
        return {
          ...base,
          ...lesson,
          students: Number(count?.students ?? 0),
          present: count?.marked ? Number(count.present ?? 0) : null,
          attendance_marked: Boolean(count?.marked),
        };
      });
    return {
      date,
      day_of_week: day,
      day_name: day === 0 ? 'Sunday' : DAY_NAMES[day]!,
      working_day: working,
      holiday,
      my_periods: periods.filter((period) => period.kind === 'class' || period.kind === 'substitute').length,
      periods,
    };
  }

  async history(schoolId: number, studentId: number, classTeacher = false): Promise<StudentHistoryDto> {
    const month = todayIn(this.app.timeZone).slice(0, 7);
    const [
      student,
      attendanceMonth,
      statuses,
      leaves,
      behaviour,
      achievements,
      health,
      documents,
      idCard,
      results,
      fees,
    ] = await Promise.all([
      this.students.get(schoolId, studentId),
      this.attendance.monthly(schoolId, studentId, month),
      this.dataSource.query(
        `SELECT d.status FROM student_attendance_days d
           JOIN academic_years y ON y.school_id = d.school_id AND y.is_current AND y.deleted_at IS NULL
                                AND d.date BETWEEN y.start_date AND y.end_date
           WHERE d.student_id = $1 AND d.school_id = $2`,
        [studentId, schoolId],
      ) as Promise<{ status: AttendanceStatus }[]>,
      this.leaves.forStudent(schoolId, studentId),
      this.records.listBehaviour(schoolId, studentId),
      this.achievements.list(schoolId, studentId),
      this.records.getHealth(schoolId, studentId),
      this.records.listDocuments(schoolId, studentId),
      this.lifecycle.digitalId(schoolId, studentId).catch(() => null),
      this.exams.studentResults(schoolId, studentId),
      classTeacher ? this.fees.summary(schoolId, studentId) : Promise.resolve(null),
    ]);
    const year = summarise(statuses.map((row) => row.status));
    return {
      student,
      attendance_year: {
        percent: year.percent,
        days_marked: year.total,
        present: year.present + year.half_day,
        absent: year.absent,
        late: year.late,
        leave: year.leave,
      },
      attendance_month: attendanceMonth,
      leaves,
      behaviour,
      achievements,
      results,
      fees,
      health,
      documents,
      id_card: idCard,
    };
  }

  async roster(
    schoolId: number,
    sectionId: number,
    classTeacher: boolean,
    query: RosterQueryDto = {},
  ): Promise<RosterStudentDto[]> {
    return (await this.rankedRoster(schoolId, sectionId, classTeacher, query)).students;
  }

  async benches(
    schoolId: number,
    sectionId: number,
    classTeacher: boolean,
    query: BenchQueryDto,
  ): Promise<BenchPlanDto> {
    const { students, exam } = await this.rankedRoster(schoolId, sectionId, classTeacher, query);
    const parts = splitIntoGroups(students, query.groups ?? 3);
    return {
      sort: query.sort ?? 'roll_no',
      order: query.order ?? 'asc',
      exam,
      total: students.length,
      groups: parts.map((part, index) => ({
        position: index + 1,
        label: groupLabel(index, parts.length),
        count: part.length,
        students: part,
      })),
    };
  }

  private async rankedRoster(schoolId: number, sectionId: number, classTeacher: boolean, query: RosterQueryDto) {
    const [page, ranking, todayRows] = await Promise.all([
      this.students.list(schoolId, {
        section_id: sectionId,
        status: 'active',
        sort: 'roll_no',
        order: 'asc',
        page: 1,
        limit: 100,
      }),
      this.exams.sectionRanking(schoolId, sectionId, query.exam_id),
      this.dataSource.query(
        `SELECT d.student_id, d.status FROM student_attendance_days d
         JOIN student_enrollments e ON e.student_id = d.student_id AND e.section_id = $1
         WHERE d.date = $2`,
        [sectionId, todayIn(this.app.timeZone)],
      ) as Promise<{ student_id: number; status: string }[]>,
    ]);
    const fees = classTeacher
      ? await this.fees.statusFor(
          schoolId,
          page.items.map((item) => item.id),
        )
      : null;
    const ranks = new Map(ranking.rows.map((row) => [row.student_id, row.rank]));
    const today = new Map(todayRows.map((row) => [Number(row.student_id), row.status]));
    const rows = page.items.map((item) => ({
      ...item,
      fee: fees?.get(item.id) ?? null,
      rank: ranks.get(item.id) ?? null,
      today_status: today.get(item.id) ?? 'not_marked',
    }));
    return { exam: ranking.exam, students: sortRoster(rows, query.sort ?? 'roll_no', query.order ?? 'asc') };
  }

  async isClassTeacherOf(schoolId: number, userId: number, studentId: number): Promise<boolean> {
    const [row] = await this.dataSource.query(
      `SELECT 1 FROM student_enrollments e
       JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current
       JOIN sections sec ON sec.id = e.section_id
       WHERE e.student_id = $1 AND sec.school_id = $2 AND sec.class_teacher_user_id = $3 LIMIT 1`,
      [studentId, schoolId, userId],
    );
    return Boolean(row);
  }
}
