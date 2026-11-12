import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { AttendanceService } from '../attendance/attendance.service';
import { FeesService } from '../fees/fees.service';
import { FleetLiveDto } from '../fleet/dto/fleet.dto';
import { TelematicsClient } from '../fleet/telematics.client';
import { StaffService } from '../staff/staff.service';
import { StaffAttendanceService } from '../staff-attendance/staff-attendance.service';
import { AdmissionsService } from '../students/admissions.service';
import { StudentsService } from '../students/students.service';
import { FleetAlertsService } from '../tracking/fleet-alerts.service';
import { busCounts, staffToday, studentsToday, visibleSections, whenAllowed } from './dashboard.logic';
import {
  DashboardAlertsDto,
  DashboardAttendanceDto,
  DashboardBusesDto,
  DashboardDto,
  DashboardExamsDto,
  DashboardFeesDto,
  DashboardStaffDto,
  DashboardStudentsDto,
} from './dto/dashboard.dto';
import { yearClause } from '../../shared/year-context';

@Injectable()
export class DashboardService {
  constructor(
    private readonly students: StudentsService,
    private readonly admissions: AdmissionsService,
    private readonly staff: StaffService,
    private readonly attendance: AttendanceService,
    private readonly staffAttendance: StaffAttendanceService,
    private readonly fees: FeesService,
    private readonly alerts: FleetAlertsService,
    private readonly telematics: TelematicsClient,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async overview(schoolId: number, user: AuthUser): Promise<DashboardDto> {
    const date = todayIn(this.app.timeZone);
    const show = visibleSections(user.permissions);
    const [students, staff, attendance, buses, alerts, fees, exams] = await Promise.all([
      whenAllowed(show.students, () => this.studentCounts(schoolId)),
      whenAllowed(show.staff, () => this.staffCounts(schoolId)),
      whenAllowed(show.attendance, () => this.attendanceToday(schoolId, date)),
      whenAllowed(show.buses, () => this.busCounts(schoolId)),
      whenAllowed(show.alerts, () => this.alertCounts(schoolId)),
      whenAllowed(show.fees, () => this.feeCounts(schoolId)),
      whenAllowed(show.exams, () => this.examCounts(schoolId, date)),
    ]);
    return { date, students, staff, attendance, buses, alerts, fees, exams };
  }

  private async studentCounts(schoolId: number): Promise<DashboardStudentsDto> {
    const [students, admissions] = await Promise.all([
      this.students.insights(schoolId),
      this.admissions.insights(schoolId),
    ]);
    return {
      total: students.total,
      joined_this_month: students.new_this_month,
      applications_waiting: admissions.applied,
      approved_not_enrolled: admissions.approved,
    };
  }

  private async staffCounts(schoolId: number): Promise<DashboardStaffDto> {
    const insights = await this.staff.insights(schoolId);
    return { total: insights.total_staff, teachers: insights.total_teachers, need_attention: insights.need_attention };
  }

  private async attendanceToday(schoolId: number, date: string): Promise<DashboardAttendanceDto> {
    const [students, staff] = await Promise.all([
      this.attendance.board(schoolId, date),
      this.staffAttendance.board(schoolId, date),
    ]);
    return { students: studentsToday(students), staff: staffToday(staff) };
  }

  private async busCounts(schoolId: number): Promise<DashboardBusesDto> {
    const [vehicles, live] = await Promise.all([
      this.dataSource.query(
        `SELECT device_id FROM vehicles WHERE school_id = $1 AND deleted_at IS NULL AND status = 'active'`,
        [schoolId],
      ) as Promise<{ device_id: number | null }[]>,
      this.telematics.get<FleetLiveDto>('/devices/live').catch(() => null),
    ]);
    return busCounts(
      vehicles.map((row) => (row.device_id === null ? null : Number(row.device_id))),
      live,
    );
  }

  private async alertCounts(schoolId: number): Promise<DashboardAlertsDto> {
    const insights = await this.alerts.insights(schoolId);
    return { open: insights.open, sos_open: insights.sos_active, high_open: insights.high_active };
  }

  private async feeCounts(schoolId: number): Promise<DashboardFeesDto | null> {
    const insights = await this.fees.insights(schoolId).catch((error: unknown) => {
      if (error instanceof AppException) return null;
      throw error;
    });
    if (!insights) return null;
    return {
      academic_year: insights.academic_year,
      due_amount: insights.outstanding,
      overdue_amount: insights.overdue_amount,
      overdue_students: insights.students_overdue,
      todays_collection: insights.todays_collection,
    };
  }

  private async examCounts(schoolId: number, date: string): Promise<DashboardExamsDto> {
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE x.start_date > $2)::int AS upcoming,
              COUNT(*) FILTER (WHERE x.start_date <= $2 AND x.end_date >= $2)::int AS in_progress,
              COUNT(*) FILTER (WHERE x.status = 'published')::int AS published
       FROM exams x
       JOIN academic_years y ON y.id = x.academic_year_id AND ${yearClause('y')}
       WHERE x.school_id = $1 AND x.deleted_at IS NULL`,
      [schoolId, date],
    );
    return { total: row.total, upcoming: row.upcoming, in_progress: row.in_progress, published: row.published };
  }
}
