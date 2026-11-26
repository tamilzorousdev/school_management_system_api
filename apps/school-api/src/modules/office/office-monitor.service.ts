import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { yearClause } from '../../shared/year-context';
import { wingClassIds } from '../../shared/wing-context';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ActivityItemDto,
  AoCardDto,
  AoDetailDto,
  MonitorDto,
  OfficeDashboardDto,
  PendingCountsDto,
  PendingItemDto,
  RemindResultDto,
} from './dto/office.dto';
import { OfficeActivityLog } from './entities/office.entity';
import {
  classesOfWing,
  EMPTY_NOTES,
  hoursSince,
  inactiveFor,
  isOverdue,
  isWingLimitedRole,
  OVERDUE_HOURS,
} from './office.logic';
import { OfficeTeachersService } from './office-teachers.service';
import { OfficeBusService } from './office-bus.service';
import { OfficeService } from './office.service';
import { WingScopeService } from './wing-scope.service';

const OPEN_GRIEVANCES = `('submitted', 'acknowledged', 'in_progress', 'reopened', 'escalated')`;

interface AoScope {
  id: number;
  name: string;
  mobile: string;
  last_login_at: Date | null;
  wings: { id: number; name: string }[];
  classIds: number[] | null;
}

const num = (value: unknown) => Number(value ?? 0);

@Injectable()
export class OfficeMonitorService {
  constructor(
    @InjectRepository(OfficeActivityLog) private readonly logs: Repository<OfficeActivityLog>,
    private readonly office: OfficeService,
    private readonly teachersService: OfficeTeachersService,
    private readonly busService: OfficeBusService,
    private readonly scope: WingScopeService,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  async monitor(user: AuthUser, schoolId: number): Promise<MonitorDto> {
    await this.assertMonitor(user, schoolId);
    const aos = await this.aoScopes(schoolId);
    const [pendingAll, feesAll, stats, grievances, wings] = await Promise.all([
      this.pendingItems(schoolId, null),
      this.collected(schoolId, null),
      this.office.sectionStats(schoolId, null),
      this.openGrievances(schoolId),
      this.scope.wings(schoolId),
    ]);
    const covered = new Set(aos.flatMap((ao) => ao.wings.map((wing) => wing.id)));
    return {
      summary: {
        pending: this.countPending(pendingAll),
        fees_today: feesAll.today,
        fees_month: feesAll.month,
        attendance: this.office.attendanceOf(stats),
        open_grievances: grievances,
        unassigned_wings: wings
          .filter((wing) => !covered.has(wing.id))
          .map((wing) => ({ id: wing.id, name: wing.name })),
      },
      aos: await Promise.all(aos.map((ao) => this.card(schoolId, ao))),
    };
  }

  async dashboard(user: AuthUser, schoolId: number): Promise<OfficeDashboardDto> {
    const classIds = wingClassIds();
    const canSeeAos = classIds === null && user.permissions.includes('office.monitor');
    const [me, stats, pending, fees, exams, alerts, staffOnLeave, aos, odToday, teachers, buses] = await Promise.all([
      this.office.me(user, schoolId),
      this.office.sectionStats(schoolId, classIds),
      this.pendingItems(schoolId, classIds),
      this.scopeFees(schoolId, classIds),
      this.office.classExams(schoolId, classIds),
      this.alerts(schoolId, classIds),
      this.staffOnLeave(schoolId),
      canSeeAos ? this.aoScopes(schoolId) : Promise.resolve(null),
      this.office.sportsOd(schoolId, null, this.scope.today(), classIds),
      this.teachersService.today(schoolId, classIds),
      this.busService.today(schoolId, classIds),
    ]);
    return {
      me,
      attendance: this.office.attendanceOf(stats),
      students: stats.reduce((sum, row) => sum + row.students, 0),
      staff_on_leave: staffOnLeave,
      fees: { ...fees, due: stats.reduce((sum, row) => sum + row.fee_due, 0) },
      pending: this.countPending(pending),
      pending_items: pending.slice(0, 5),
      exams,
      alerts,
      aos: aos ? await Promise.all(aos.map((ao) => this.card(schoolId, ao))) : null,
      od_today: { count: odToday.length, students: odToday },
      teachers,
      buses,
    };
  }

  private async scopeFees(
    schoolId: number,
    classIds: number[] | null,
  ): Promise<Omit<OfficeDashboardDto['fees'], 'due'>> {
    if (classIds && !classIds.length)
      return { collected_today: 0, collected_month: 0, defaulters: 0, top_defaulters: [] };
    const scoped = `WITH yr AS (SELECT ay.id FROM academic_years ay WHERE ay.school_id = $1 AND ay.deleted_at IS NULL AND ${yearClause('ay')}),
       en AS (
         SELECT e.student_id, trim(s.first_name || ' ' || COALESCE(s.last_name, '')) AS name,
                c.name || COALESCE(' - ' || sec.name, '') AS class_section
         FROM student_enrollments e JOIN yr ON yr.id = e.academic_year_id
         JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
         JOIN classes c ON c.id = e.class_id LEFT JOIN sections sec ON sec.id = e.section_id
         WHERE e.status = 'studying' AND ($2::int[] IS NULL OR e.class_id = ANY($2))
       )`;
    const [collected]: { today: string; month: string }[] = await this.dataSource.query(
      `${scoped}
       SELECT COALESCE(sum(p.amount) FILTER (WHERE p.paid_on = $3::date), 0) AS today,
              COALESCE(sum(p.amount) FILTER (WHERE p.paid_on >= date_trunc('month', $3::date)), 0) AS month
       FROM fee_payments p JOIN en ON en.student_id = p.student_id
       WHERE p.school_id = $1 AND p.status = 'success' AND p.deleted_at IS NULL AND p.reversed_at IS NULL`,
      [schoolId, classIds, this.scope.today()],
    );
    const dues: { student_id: number; name: string; class_section: string; due: string }[] =
      await this.dataSource.query(
        `${scoped}
       SELECT en.student_id, en.name, en.class_section, sum(i.balance) AS due
       FROM fee_invoices i JOIN en ON en.student_id = i.student_id
       WHERE i.school_id = $1 AND i.deleted_at IS NULL AND i.status <> 'cancelled' AND i.balance > 0
         AND i.academic_year_id IN (SELECT id FROM yr)
       GROUP BY en.student_id, en.name, en.class_section ORDER BY due DESC`,
        [schoolId, classIds],
      );
    return {
      collected_today: num(collected?.today),
      collected_month: num(collected?.month),
      defaulters: dues.length,
      top_defaulters: dues.slice(0, 5).map((row) => ({
        student_id: Number(row.student_id),
        name: row.name,
        class_section: row.class_section,
        due: num(row.due),
      })),
    };
  }

  private async alerts(schoolId: number, classIds: number[] | null): Promise<OfficeDashboardDto['alerts']> {
    if (classIds && !classIds.length) return { low_attendance: 0, passes_on_hold: 0, health_alerts: 0 };
    const empty = EMPTY_NOTES.map((note) => `'${note}'`).join(', ');
    const [row]: Record<string, string>[] = await this.dataSource.query(
      `WITH yr AS (SELECT ay.id, ay.start_date FROM academic_years ay WHERE ay.school_id = $1 AND ay.deleted_at IS NULL AND ${yearClause('ay')}),
       en AS (
         SELECT e.student_id FROM student_enrollments e JOIN yr ON yr.id = e.academic_year_id
         JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
         WHERE e.status = 'studying' AND ($2::int[] IS NULL OR e.class_id = ANY($2))
       ),
       att AS (
         SELECT d.student_id, count(*) AS days,
                count(*) FILTER (WHERE d.status IN ('present', 'late', 'od', 'half_day')) AS attended
         FROM student_attendance_days d JOIN en ON en.student_id = d.student_id
         WHERE d.date >= (SELECT start_date FROM yr LIMIT 1) GROUP BY d.student_id
       )
       SELECT
         (SELECT count(*) FROM att WHERE days > 0 AND attended * 100.0 / days < 75) AS low_attendance,
         (SELECT count(*) FROM student_transport st JOIN en ON en.student_id = st.student_id
            WHERE st.deleted_at IS NULL AND st.pass_status = 'on_hold') AS passes_on_hold,
         (SELECT count(*) FROM student_health h JOIN en ON en.student_id = h.student_id
            WHERE lower(trim(COALESCE(h.allergies, ''))) NOT IN (${empty})
               OR lower(trim(COALESCE(h.conditions, ''))) NOT IN (${empty})) AS health_alerts`,
      [schoolId, classIds],
    );
    return {
      low_attendance: num(row?.low_attendance),
      passes_on_hold: num(row?.passes_on_hold),
      health_alerts: num(row?.health_alerts),
    };
  }

  private async staffOnLeave(schoolId: number): Promise<number> {
    const [row]: { count: string }[] = await this.dataSource.query(
      `SELECT count(DISTINCT user_id) FROM staff_leave_requests
       WHERE school_id = $1 AND status = 'approved' AND deleted_at IS NULL AND from_date <= $2::date AND to_date >= $2::date`,
      [schoolId, this.scope.today()],
    );
    return num(row?.count);
  }

  async detail(user: AuthUser, schoolId: number, userId: number): Promise<AoDetailDto> {
    await this.assertMonitor(user, schoolId);
    const ao = (await this.aoScopes(schoolId)).find((row) => row.id === userId);
    if (!ao) throw AppException.notFound('AO not found', 'AO_NOT_FOUND');
    const [card, pending, activity] = await Promise.all([
      this.card(schoolId, ao),
      this.pendingItems(schoolId, ao.classIds),
      this.activity(schoolId, ao.id),
    ]);
    return { card, pending, activity };
  }

  async remind(user: AuthUser, schoolId: number, userId: number): Promise<RemindResultDto> {
    await this.assertMonitor(user, schoolId);
    const ao = (await this.aoScopes(schoolId)).find((row) => row.id === userId);
    if (!ao) throw AppException.notFound('AO not found', 'AO_NOT_FOUND');
    const pending = await this.pendingItems(schoolId, ao.classIds);
    if (!pending.length) throw AppException.conflict('Nothing is waiting with this AO', 'NOTHING_PENDING');
    await this.notifications.dispatch({
      template: 'OFFICE_REMINDER',
      audience: { user_ids: [ao.id] },
      data: {
        count: String(pending.length),
        overdue: String(pending.filter((item) => item.overdue).length),
        by: user.name,
        role: 'office',
      },
    });
    await this.logs.save(
      this.logs.create({
        school_id: schoolId,
        user_id: user.id,
        action: 'reminded',
        target_user_id: ao.id,
        note: `${pending.length} waiting`,
      }),
    );
    return { pending: pending.length };
  }

  private async assertMonitor(user: AuthUser, schoolId: number): Promise<void> {
    if (!isWingLimitedRole(user.roles)) return;
    const wings = await this.scope.activeWingIds(schoolId, user.id);
    if (wings.length) throw AppException.forbidden('Only the head AO can open the AO monitor', 'HEAD_AO_ONLY');
  }

  private async aoScopes(schoolId: number): Promise<AoScope[]> {
    const [aos, wings, classes] = await Promise.all([
      this.scope.aoUsers(schoolId),
      this.scope.wings(schoolId),
      this.scope.classes(schoolId),
    ]);
    const links = await this.scope.userWings(
      schoolId,
      aos.map((ao) => ao.id),
    );
    return aos.map((ao) => {
      const mine = wings.filter((wing) => links.some((link) => link.user_id === ao.id && link.wing_id === wing.id));
      const classIds = mine.length
        ? [...new Set(mine.flatMap((wing) => classesOfWing(wing, classes).map((row) => row.id)))]
        : null;
      return { ...ao, wings: mine.map((wing) => ({ id: wing.id, name: wing.name })), classIds };
    });
  }

  private async card(schoolId: number, ao: AoScope): Promise<AoCardDto> {
    const [pending, fees, stats, lastActive] = await Promise.all([
      this.pendingItems(schoolId, ao.classIds),
      this.collected(schoolId, ao.id),
      this.office.sectionStats(schoolId, ao.classIds),
      this.lastActive(ao.id, ao.last_login_at),
    ]);
    const attendance = this.office.attendanceOf(stats);
    const counts = this.countPending(pending);
    const now = new Date();
    const flags: string[] = [];
    const inactive = inactiveFor(lastActive, now);
    if (inactive) flags.push('inactive');
    if (counts.overdue) flags.push('overdue_approvals');
    if (attendance.sections_marked < attendance.sections_total) flags.push('attendance_not_marked');
    return {
      user: { id: ao.id, name: ao.name },
      mobile: ao.mobile,
      wings: ao.wings,
      is_head: ao.classIds === null,
      last_active_at: lastActive,
      inactive,
      pending: counts,
      fees_collected_today: fees.today,
      fees_collected_month: fees.month,
      fee_due: stats.reduce((sum, row) => sum + row.fee_due, 0),
      attendance,
      flags,
    };
  }

  private countPending(items: PendingItemDto[]): PendingCountsDto {
    return {
      gate_passes: items.filter((item) => item.kind === 'gate_pass').length,
      fee_requests: items.filter((item) => item.kind === 'fee_request').length,
      leave_requests: items.filter((item) => item.kind === 'student_leave').length,
      grievances: items.filter((item) => item.kind === 'grievance').length,
      total: items.length,
      overdue: items.filter((item) => item.overdue).length,
    };
  }

  private async pendingItems(schoolId: number, classIds: number[] | null): Promise<PendingItemDto[]> {
    if (classIds && !classIds.length) return [];
    const rows: {
      kind: PendingItemDto['kind'];
      id: number;
      title: string;
      student: string | null;
      class_section: string | null;
      created_at: Date;
      escalated: boolean;
    }[] = await this.dataSource.query(
      `WITH yr AS (SELECT ay.id FROM academic_years ay WHERE ay.school_id = $1 AND ay.deleted_at IS NULL AND ${yearClause('ay')}),
       en AS (
         SELECT e.student_id, e.class_id, trim(s.first_name || ' ' || COALESCE(s.last_name, '')) AS student,
                c.name || COALESCE(' - ' || sec.name, '') AS class_section
         FROM student_enrollments e JOIN yr ON yr.id = e.academic_year_id
         JOIN students s ON s.id = e.student_id JOIN classes c ON c.id = e.class_id
         LEFT JOIN sections sec ON sec.id = e.section_id
         WHERE ($2::int[] IS NULL OR e.class_id = ANY($2))
       )
       SELECT 'gate_pass' AS kind, p.id, 'Gate pass ' || p.pass_no AS title, en.student, en.class_section, p.created_at,
              (p.office_escalated_at IS NOT NULL) AS escalated
         FROM gate_passes p JOIN en ON en.student_id = p.student_id
         WHERE p.school_id = $1 AND p.status = 'pending' AND p.deleted_at IS NULL
       UNION ALL
       SELECT 'fee_request', r.id, 'Fee request: ' || replace(r.kind, '_', ' '), en.student, en.class_section, r.created_at, false
         FROM fee_requests r JOIN en ON en.student_id = r.student_id
         WHERE r.school_id = $1 AND r.status = 'pending' AND r.deleted_at IS NULL
       UNION ALL
       SELECT 'student_leave', l.id, 'Student leave ' || to_char(l.from_date, 'DD Mon'), en.student, en.class_section,
              l.created_at, false
         FROM student_leave_requests l JOIN en ON en.student_id = l.student_id
         WHERE l.school_id = $1 AND l.status = 'pending' AND l.deleted_at IS NULL
       UNION ALL
       SELECT 'grievance', g.id, 'Grievance ' || g.ticket_no, en.student, en.class_section, g.created_at, false
         FROM grievances g LEFT JOIN en ON en.student_id = g.student_id
         WHERE g.school_id = $1 AND g.status IN ${OPEN_GRIEVANCES} AND g.deleted_at IS NULL
           AND ($2::int[] IS NULL OR en.student_id IS NOT NULL)
       ORDER BY created_at ASC`,
      [schoolId, classIds],
    );
    const now = new Date();
    return rows.map((row) => ({
      kind: row.kind,
      id: Number(row.id),
      title: row.title,
      student: row.student,
      class_section: row.class_section,
      created_at: row.created_at,
      age_hours: hoursSince(row.created_at, now),
      overdue: row.kind === 'gate_pass' ? Boolean(row.escalated) : isOverdue(row.created_at, now, OVERDUE_HOURS),
    }));
  }

  private async collected(schoolId: number, userId: number | null): Promise<{ today: number; month: number }> {
    const today = this.scope.today();
    const [row]: { today: string; month: string }[] = await this.dataSource.query(
      `SELECT COALESCE(sum(amount) FILTER (WHERE paid_on = $2::date), 0) AS today,
              COALESCE(sum(amount) FILTER (WHERE paid_on >= date_trunc('month', $2::date)), 0) AS month
       FROM fee_payments WHERE school_id = $1 AND status = 'success' AND deleted_at IS NULL AND reversed_at IS NULL
         AND ($3::int IS NULL OR received_by = $3)`,
      [schoolId, today, userId],
    );
    return { today: num(row?.today), month: num(row?.month) };
  }

  private async openGrievances(schoolId: number): Promise<number> {
    const [row]: { count: string }[] = await this.dataSource.query(
      `SELECT count(*) FROM grievances WHERE school_id = $1 AND status IN ${OPEN_GRIEVANCES} AND deleted_at IS NULL`,
      [schoolId],
    );
    return num(row?.count);
  }

  private async lastActive(userId: number, lastLogin: Date | null): Promise<Date | null> {
    const [row]: { at: Date | null }[] = await this.dataSource.query(
      `SELECT GREATEST(
         $2::timestamptz,
         (SELECT max(created_at) FROM gate_events WHERE actor_id = $1),
         (SELECT max(created_at) FROM fee_payments WHERE received_by = $1),
         (SELECT max(decided_at) FROM fee_requests WHERE decided_by = $1),
         (SELECT max(decided_at) FROM student_leave_requests WHERE decided_by = $1),
         (SELECT max(created_at) FROM substitutions WHERE assigned_by = $1),
         (SELECT max(created_at) FROM office_activity_logs WHERE user_id = $1)
       ) AS at`,
      [userId, lastLogin],
    );
    return row?.at ?? null;
  }

  private async activity(schoolId: number, userId: number): Promise<ActivityItemDto[]> {
    const rows: ActivityItemDto[] = await this.dataSource.query(
      `SELECT * FROM (
         SELECT ge.created_at AS at, 'gate_' || ge.kind AS kind, initcap(replace(ge.kind, '_', ' ')) AS title,
                concat_ws(' · ', trim(s.first_name || ' ' || COALESCE(s.last_name, '')), ge.note) AS detail
           FROM gate_events ge LEFT JOIN students s ON s.id = ge.student_id
           WHERE ge.school_id = $1 AND ge.actor_id = $2
         UNION ALL
         SELECT p.created_at, 'fee_collected', 'Collected ₹' || to_char(p.amount, 'FM99,99,99,990'),
                concat_ws(' · ', trim(s.first_name || ' ' || COALESCE(s.last_name, '')), p.receipt_no, p.mode)
           FROM fee_payments p LEFT JOIN students s ON s.id = p.student_id
           WHERE p.school_id = $1 AND p.received_by = $2 AND p.deleted_at IS NULL
         UNION ALL
         SELECT r.decided_at, 'fee_request_' || r.status, 'Fee request ' || replace(r.kind, '_', ' ') || ' ' || r.status,
                trim(s.first_name || ' ' || COALESCE(s.last_name, ''))
           FROM fee_requests r LEFT JOIN students s ON s.id = r.student_id
           WHERE r.school_id = $1 AND r.decided_by = $2 AND r.decided_at IS NOT NULL
         UNION ALL
         SELECT l.decided_at, 'student_leave_' || l.status, 'Student leave ' || l.status,
                trim(s.first_name || ' ' || COALESCE(s.last_name, ''))
           FROM student_leave_requests l LEFT JOIN students s ON s.id = l.student_id
           WHERE l.school_id = $1 AND l.decided_by = $2 AND l.decided_at IS NOT NULL
         UNION ALL
         SELECT sb.created_at, 'proxy_assigned', 'Proxy teacher assigned', 'Period ' || sb.period_no || ' · ' || to_char(sb.date, 'DD Mon')
           FROM substitutions sb WHERE sb.school_id = $1 AND sb.assigned_by = $2
         UNION ALL
         SELECT o.created_at, o.action,
                CASE o.action WHEN 'student_viewed' THEN 'Opened student history'
                              WHEN 'documents_viewed' THEN 'Opened student documents'
                              WHEN 'bank_viewed' THEN 'Viewed own bank details'
                              WHEN 'wings_changed' THEN 'Changed an AO''s wings'
                              ELSE 'Reminded an AO' END,
                COALESCE(trim(s.first_name || ' ' || COALESCE(s.last_name, '')), o.note)
           FROM office_activity_logs o LEFT JOIN students s ON s.id = o.student_id
           WHERE o.school_id = $1 AND o.user_id = $2
       ) t WHERE t.at IS NOT NULL ORDER BY t.at DESC LIMIT 60`,
      [schoolId, userId],
    );
    return rows;
  }
}
