import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { weekday } from '../../shared/school-days';
import { StaffLeaveService } from '../staff-leave/staff-leave.service';
import { TimetableService } from '../timetable/timetable.service';
import { AppBannersService } from '../app-banners/app-banners.service';
import { parentBanners, schoolBanners, teacherBanners } from './banner.logic';
import { BannerListDto } from './dto/banner.dto';

const GROUPS: Record<string, string> = { all: 'all students', boys: 'the boys', girls: 'the girls' };

const clock = (timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(new Date());

@Injectable()
export class BannerService {
  constructor(
    private readonly timetable: TimetableService,
    private readonly staffLeaves: StaffLeaveService,
    private readonly appBanners: AppBannersService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async teacher(schoolId: number, user: AuthUser): Promise<BannerListDto> {
    const date = todayIn(this.app.timeZone);
    const query = <T>(sql: string, params: unknown[]) => this.dataSource.query(sql, params) as Promise<T[]>;
    const [
      periods,
      [school],
      [holiday],
      [upcoming],
      [leave],
      [checkIn],
      proxies,
      combined,
      unmarked,
      [leaves],
      [unread],
    ] = await Promise.all([
      this.timetable.periods(schoolId),
      query<{ reporting: string }>(`SELECT staff_reporting_time AS reporting FROM schools WHERE id = $1`, [schoolId]),
      query<{ name: string }>(
        `SELECT name FROM holidays WHERE school_id = $1 AND deleted_at IS NULL AND type <> 'event'
           AND date <= $2 AND COALESCE(end_date, date) >= $2 LIMIT 1`,
        [schoolId, date],
      ),
      query<{ name: string; date: string }>(
        `SELECT name, to_char(date, 'YYYY-MM-DD') AS date FROM holidays
           WHERE school_id = $1 AND deleted_at IS NULL AND type <> 'event'
           AND date > $2 AND date <= (CAST($2 AS date) + INTERVAL '7 days')
           ORDER BY date ASC LIMIT 1`,
        [schoolId, date],
      ),
      query<{ name: string }>(
        `SELECT lt.name FROM staff_leave_requests l JOIN leave_types lt ON lt.id = l.leave_type_id
           WHERE l.school_id = $1 AND l.user_id = $2 AND l.status = 'approved' AND l.deleted_at IS NULL
           AND l.from_date <= $3 AND l.to_date >= $3 LIMIT 1`,
        [schoolId, user.id, date],
      ),
      query<{ id: number }>(
        `SELECT id FROM staff_attendance WHERE school_id = $1 AND user_id = $2 AND date = $3 AND check_in_at IS NOT NULL LIMIT 1`,
        [schoolId, user.id, date],
      ),
      query<{ period_no: number; section: string; subject: string }>(
        `SELECT sb.period_no, c.name || ' - ' || sec.name AS section, s.name AS subject
           FROM substitutions sb JOIN sections sec ON sec.id = sb.section_id JOIN classes c ON c.id = sec.class_id
           JOIN subjects s ON s.id = sb.subject_id
           WHERE sb.school_id = $1 AND sb.date = $2 AND sb.kind = 'proxy' AND sb.substitute_user_id = $3
           ORDER BY sb.period_no`,
        [schoolId, date, user.id],
      ),
      query<{ period_no: number; from_section: string; student_group: string; to_section: string }>(
        `SELECT sb.period_no, fc.name || ' - ' || fs.name AS from_section, m.student_group,
                  tc.name || ' - ' || ts.name AS to_section
           FROM substitution_merges m JOIN substitutions sb ON sb.id = m.substitution_id
           JOIN sections fs ON fs.id = sb.section_id JOIN classes fc ON fc.id = fs.class_id
           JOIN sections ts ON ts.id = m.target_section_id JOIN classes tc ON tc.id = ts.class_id
           WHERE sb.school_id = $1 AND sb.date = $2 AND m.target_teacher_user_id = $3
           ORDER BY sb.period_no`,
        [schoolId, date, user.id],
      ),
      query<{ id: number; name: string }>(
        `SELECT sec.id, c.name || ' - ' || sec.name AS name FROM sections sec
           JOIN classes c ON c.id = sec.class_id
           JOIN academic_years y ON y.id = sec.academic_year_id AND y.is_current
           WHERE sec.school_id = $1 AND sec.class_teacher_user_id = $2 AND sec.deleted_at IS NULL
           AND (NOT EXISTS (SELECT 1 FROM attendance_sessions a WHERE a.section_id = sec.id AND a.date = $3 AND a.period = 1)
                OR (COALESCE((SELECT min(b.start_time) FROM bell_periods b WHERE b.school_id = $1 AND b.period_no = 5), '23:59') <= $4
                    AND NOT EXISTS (SELECT 1 FROM attendance_sessions a WHERE a.section_id = sec.id AND a.date = $3 AND a.period = 5)))
           ORDER BY c.name, sec.name`,
        [schoolId, user.id, date, clock(this.app.timeZone)],
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM student_leave_requests r
           JOIN student_enrollments e ON e.student_id = r.student_id
           JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current
           JOIN sections sec ON sec.id = e.section_id
           WHERE r.school_id = $1 AND r.status = 'pending' AND r.deleted_at IS NULL AND sec.class_teacher_user_id = $2`,
        [schoolId, user.id],
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND channel = 'in_app' AND read_at IS NULL`,
        [user.id],
      ),
    ]);
    const startOf = (periodNo: number) => periods.find((item) => item.period_no === Number(periodNo))?.start_time ?? '';
    const posters = schoolBanners(await this.appBanners.liveFor(schoolId, 'staff'));
    return {
      date,
      banners: [
        ...teacherBanners({
          holiday: holiday?.name ?? null,
          upcomingHoliday: upcoming
            ? {
                name: upcoming.name,
                date: upcoming.date,
                daysUntil: Math.max(
                  1,
                  Math.round((Date.parse(`${upcoming.date}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000),
                ),
              }
            : null,
          sunday: weekday(date) === 0,
          leaveType: leave?.name ?? null,
          checkedIn: Boolean(checkIn),
          reportingTime: school?.reporting ?? '08:45',
          now: clock(this.app.timeZone),
          proxies: proxies.map((row) => ({
            ...row,
            period_no: Number(row.period_no),
            start_time: startOf(row.period_no),
          })),
          combined: combined.map((row) => ({
            period_no: Number(row.period_no),
            from: row.from_section,
            group: GROUPS[row.student_group] ?? 'students',
            section: row.to_section,
            start_time: startOf(row.period_no),
          })),
          unmarkedSections: unmarked.map((row) => ({ id: Number(row.id), name: row.name })),
          pendingLeaves: Number(leaves?.count ?? 0),
          staffApprovals: (await this.staffLeaves.approvals(user)).filter((leave) => leave.staff.id !== user.id).length,
          unread: Number(unread?.count ?? 0),
        }),
        ...posters,
      ],
    };
  }

  async parent(schoolId: number): Promise<BannerListDto> {
    const date = todayIn(this.app.timeZone);
    const query = <T>(sql: string, params: unknown[]) => this.dataSource.query(sql, params) as Promise<T[]>;
    const [[holiday], [upcoming], posters] = await Promise.all([
      query<{ name: string }>(
        `SELECT name FROM holidays WHERE school_id = $1 AND deleted_at IS NULL AND type <> 'event'
         AND date <= $2 AND COALESCE(end_date, date) >= $2 LIMIT 1`,
        [schoolId, date],
      ),
      query<{ name: string; date: string }>(
        `SELECT name, to_char(date, 'YYYY-MM-DD') AS date FROM holidays
         WHERE school_id = $1 AND deleted_at IS NULL AND type <> 'event'
         AND date > $2 AND date <= (CAST($2 AS date) + INTERVAL '7 days')
         ORDER BY date ASC LIMIT 1`,
        [schoolId, date],
      ),
      this.appBanners.liveFor(schoolId, 'parents'),
    ]);
    return {
      date,
      banners: parentBanners(
        {
          holiday: holiday?.name ?? null,
          upcomingHoliday: upcoming
            ? {
                name: upcoming.name,
                date: upcoming.date,
                daysUntil: Math.max(
                  1,
                  Math.round((Date.parse(`${upcoming.date}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000),
                ),
              }
            : null,
          sunday: weekday(date) === 0,
        },
        posters,
      ),
    };
  }
}
