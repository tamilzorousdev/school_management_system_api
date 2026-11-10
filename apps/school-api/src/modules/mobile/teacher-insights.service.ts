import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { holidaySet, workingDays } from '../../shared/school-days';
import { ROLES } from '../access/access.catalog';
import { FeesService } from '../fees/fees.service';
import { AssignmentsService } from '../staff/assignments.service';
import { Staff } from '../staff/entities/staff.entity';
import { StaffLeaveService } from '../staff-leave/staff-leave.service';
import { TimetableService } from '../timetable/timetable.service';
import {
  ClassTeacherSummaryDto,
  LeavePreviewDto,
  LeavePreviewQueryDto,
  MyClassDto,
  StaffLeaveApprovalDto,
  TeacherProfileDto,
} from './dto/teacher-insights.dto';
import { affectedPeriods, balanceAfter, impactSummary, SlotRow, sectionsOf } from './teacher-insights.logic';

@Injectable()
export class TeacherInsightsService {
  constructor(
    private readonly assignments: AssignmentsService,
    private readonly staffLeaves: StaffLeaveService,
    private readonly timetable: TimetableService,
    private readonly fees: FeesService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async myClasses(schoolId: number, userId: number): Promise<MyClassDto[]> {
    const classes = await this.assignments.teacherClasses(schoolId, userId);
    if (!classes.length) return [];
    const ids = classes.map((item) => item.section_id);
    const query = <T>(sql: string, params: unknown[]) => this.dataSource.query(sql, params) as Promise<T[]>;
    const [[year], periods, attendance, leaves] = await Promise.all([
      query<{ name: string }>(`SELECT name FROM academic_years WHERE school_id = $1 AND is_current LIMIT 1`, [
        schoolId,
      ]),
      query<{ section_id: number; count: string }>(
        `SELECT t.section_id, COUNT(*) AS count FROM timetable_slots t
         JOIN academic_years y ON y.id = t.academic_year_id AND y.is_current
         WHERE t.teacher_user_id = $1 AND t.section_id = ANY($2) GROUP BY t.section_id`,
        [userId, ids],
      ),
      query<{ section_id: number; present: string; absent: string }>(
        `SELECT e.section_id,
                COUNT(*) FILTER (WHERE d.status IN ('present', 'late', 'half_day')) AS present,
                COUNT(*) FILTER (WHERE d.status = 'absent') AS absent
         FROM student_attendance_days d JOIN student_enrollments e ON e.student_id = d.student_id
         WHERE e.section_id = ANY($1) AND d.date = $2 GROUP BY e.section_id`,
        [ids, todayIn(this.app.timeZone)],
      ),
      query<{ section_id: number; count: string }>(
        `SELECT e.section_id, COUNT(*) AS count FROM student_leave_requests r
         JOIN student_enrollments e ON e.student_id = r.student_id
         JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current
         WHERE r.school_id = $1 AND r.status = 'pending' AND r.deleted_at IS NULL AND e.section_id = ANY($2)
         GROUP BY e.section_id`,
        [schoolId, ids],
      ),
    ]);
    const summaries = new Map<number, ClassTeacherSummaryDto>();
    for (const item of classes.filter((row) => row.is_class_teacher)) {
      const roster = await this.dataSource.query(
        `SELECT e.student_id FROM student_enrollments e JOIN students s ON s.id = e.student_id
         JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current
         WHERE e.section_id = $1 AND s.deleted_at IS NULL AND s.status = 'active'`,
        [item.section_id],
      );
      const statuses = [
        ...(
          await this.fees.statusFor(
            schoolId,
            roster.map((row: { student_id: number }) => Number(row.student_id)),
          )
        ).values(),
      ];
      const marked = attendance.find((row) => Number(row.section_id) === item.section_id);
      summaries.set(item.section_id, {
        present_today: Number(marked?.present ?? 0),
        absent_today: Number(marked?.absent ?? 0),
        total: item.student_count,
        attendance_marked: Boolean(marked),
        fees_overdue: statuses.filter((status) => status.status === 'overdue').length,
        fees_due: statuses.filter((status) => status.status === 'due' || status.status === 'partly_paid').length,
        leave_requests_pending: Number(leaves.find((row) => Number(row.section_id) === item.section_id)?.count ?? 0),
      });
    }
    return classes.map((item) => ({
      ...item,
      periods_per_week: Number(periods.find((row) => Number(row.section_id) === item.section_id)?.count ?? 0),
      academic_year: year?.name ?? '',
      class_teacher_summary: summaries.get(item.section_id) ?? null,
    }));
  }

  async leavePreview(user: AuthUser, dto: LeavePreviewQueryDto): Promise<LeavePreviewDto> {
    const staff = await this.dataSource.getRepository(Staff).findOneBy({ user_id: user.id });
    if (!staff || staff.status === 'resigned') {
      throw AppException.forbidden('Only staff members can apply for leave', 'NOT_STAFF');
    }
    if (dto.to_date < dto.from_date) {
      throw AppException.validation([{ field: 'to_date', message: 'The last day must be on or after the first day' }]);
    }
    if (dto.half_day && dto.from_date !== dto.to_date) {
      throw AppException.validation([{ field: 'half_day', message: 'A half day must start and end on the same date' }]);
    }
    const schoolId = staff.school_id;
    const balances = await this.staffLeaves.balances(schoolId, user.id);
    const balance = balances.find((row) => row.leave_type.id === dto.leave_type_id);
    if (!balance) throw AppException.validation([{ field: 'leave_type_id', message: 'Choose a leave type' }]);
    const holidays = await holidaySet(this.dataSource.manager, schoolId, dto.from_date, dto.to_date);
    const dates = workingDays(dto.from_date, dto.to_date, holidays);
    const days = dates.length ? (dto.half_day ? 0.5 : dates.length) : 0;
    const [slots, morning, overlap, hod] = await Promise.all([
      this.slotsOf(schoolId, user.id),
      this.dataSource.query(
        `SELECT c.name || ' - ' || sec.name AS name FROM sections sec JOIN classes c ON c.id = sec.class_id
         JOIN academic_years y ON y.id = sec.academic_year_id AND y.is_current
         WHERE sec.school_id = $1 AND sec.class_teacher_user_id = $2 AND sec.deleted_at IS NULL ORDER BY c.grade_level, sec.name`,
        [schoolId, user.id],
      ) as Promise<{ name: string }[]>,
      this.dataSource.query(
        `SELECT 1 FROM staff_leave_requests WHERE user_id = $1 AND deleted_at IS NULL
         AND status IN ('approved', 'pending_hod', 'pending_principal') AND from_date <= $3 AND to_date >= $2 LIMIT 1`,
        [user.id, dto.from_date, dto.to_date],
      ),
      this.hasHod(schoolId, staff, user),
    ]);
    const periods = affectedPeriods(dates, slots);
    const morningSections = dates.length ? morning.map((row) => row.name) : [];
    const after = balanceAfter(balance.remaining, days);
    return {
      leave_type: balance.leave_type,
      from_date: dto.from_date,
      to_date: dto.to_date,
      half_day: dto.half_day ?? false,
      dates,
      days,
      remaining_before: balance.remaining,
      remaining_after: after,
      enough_balance: after === null || after >= 0,
      overlaps_existing: overlap.length > 0,
      periods,
      period_count: periods.length,
      morning_attendance: morningSections,
      goes_to: hod ? 'hod' : 'principal',
      message: dates.length
        ? impactSummary(periods, morningSections, dates)
        : 'These dates are all holidays or Sundays.',
    };
  }

  async approvals(user: AuthUser): Promise<StaffLeaveApprovalDto[]> {
    const leaves = await this.staffLeaves.approvals(user);
    return Promise.all(
      leaves.map(async (leave) => {
        const staff = await this.dataSource.getRepository(Staff).findOneBy({ user_id: leave.staff.id });
        const schoolId = staff?.school_id ?? user.school_id ?? 0;
        const [balances, slots, holidays] = await Promise.all([
          this.staffLeaves.balances(schoolId, leave.staff.id),
          this.slotsOf(schoolId, leave.staff.id),
          holidaySet(this.dataSource.manager, schoolId, leave.from_date, leave.to_date),
        ]);
        const periods = affectedPeriods(workingDays(leave.from_date, leave.to_date, holidays), slots);
        return {
          ...leave,
          balance_remaining: balances.find((row) => row.leave_type.id === leave.leave_type.id)?.remaining ?? null,
          affected_periods: periods.length,
          affected_sections: sectionsOf(periods),
        };
      }),
    );
  }

  async profile(schoolId: number, user: AuthUser): Promise<TeacherProfileDto> {
    const staff = await this.dataSource.getRepository(Staff).findOneBy({ user_id: user.id });
    if (!staff) throw AppException.notFound('Staff record not found', 'STAFF_NOT_FOUND');
    const [classes, [person], [load]] = await Promise.all([
      this.assignments.teacherClasses(schoolId, user.id),
      this.dataSource.query(`SELECT name, mobile FROM users WHERE id = $1`, [user.id]),
      this.dataSource.query(
        `SELECT COUNT(*) AS count FROM timetable_slots t JOIN academic_years y ON y.id = t.academic_year_id AND y.is_current
         WHERE t.teacher_user_id = $1`,
        [user.id],
      ),
    ]);
    const subjects = new Map<number, string>();
    classes.forEach((item) => item.subjects.forEach((subject) => subjects.set(subject.id, subject.name)));
    const classTeacherOf = classes
      .filter((item) => item.is_class_teacher)
      .map((item) => ({ id: item.section_id, name: `${item.class_name} - ${item.section_name}` }));
    const isHod = user.roles.includes(ROLES.HOD);
    const years = Math.max(
      0,
      new Date().getFullYear() - new Date(staff.joining_date).getFullYear() + Number(staff.prior_experience_years ?? 0),
    );
    const subjectNames = [...subjects.values()].sort();
    return {
      user_id: user.id,
      name: person?.name ?? '',
      mobile: person?.mobile ?? '',
      employee_no: staff.employee_no,
      designation: staff.designation,
      department: staff.department,
      joining_date: staff.joining_date,
      experience_years: years,
      is_hod: isHod,
      subjects: [...subjects.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      class_teacher_of: classTeacherOf,
      sections_taught: classes.length,
      periods_per_week: Number(load?.count ?? 0),
      max_periods_per_week: staff.max_periods_per_week,
      headline: [
        staff.department ?? subjectNames[0] ?? staff.designation,
        isHod ? 'HOD' : null,
        classTeacherOf.length ? `Class teacher ${classTeacherOf.map((item) => item.name).join(', ')}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }

  private async slotsOf(schoolId: number, userId: number): Promise<SlotRow[]> {
    const [periods, rows] = await Promise.all([
      this.timetable.periods(schoolId),
      this.dataSource.query(
        `SELECT t.day_of_week, t.period_no, c.name || ' - ' || sec.name AS section, s.name AS subject
         FROM timetable_slots t JOIN academic_years y ON y.id = t.academic_year_id AND y.is_current
         JOIN sections sec ON sec.id = t.section_id JOIN classes c ON c.id = sec.class_id
         JOIN subjects s ON s.id = t.subject_id
         WHERE t.school_id = $1 AND t.teacher_user_id = $2`,
        [schoolId, userId],
      ) as Promise<{ day_of_week: number; period_no: number; section: string; subject: string }[]>,
    ]);
    return rows.map((row) => ({
      day_of_week: Number(row.day_of_week),
      period_no: Number(row.period_no),
      start_time: periods.find((period) => period.period_no === Number(row.period_no))?.start_time ?? '',
      section: row.section,
      subject: row.subject,
    }));
  }

  private async hasHod(schoolId: number, staff: Staff, user: AuthUser): Promise<boolean> {
    if (user.roles.includes(ROLES.HOD) || !staff.department) return false;
    const [row] = await this.dataSource.query(
      `SELECT 1 FROM staff st JOIN user_roles ur ON ur.user_id = st.user_id JOIN roles r ON r.id = ur.role_id AND r.code = $4
       WHERE st.school_id = $1 AND st.department = $2 AND st.user_id <> $3 AND st.deleted_at IS NULL LIMIT 1`,
      [schoolId, staff.department, user.id, ROLES.HOD],
    );
    return Boolean(row);
  }
}
