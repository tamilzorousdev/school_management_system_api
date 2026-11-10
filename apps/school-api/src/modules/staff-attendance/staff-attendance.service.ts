import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { datesBetween, distanceMetres, holidaySet, monthRange, workingDays } from '../../shared/school-days';
import { School } from '../schools/entities/school.entity';
import { Staff } from '../staff/entities/staff.entity';
import {
  BiometricPunchesDto,
  BoardStatus,
  CheckInStatusDto,
  LocationDto,
  ManualMarkDto,
  PunchResultDto,
  StaffBoardDto,
  StaffDayDto,
  StaffMonthDto,
} from './dto/staff-attendance.dto';
import {
  BulkSkipDto,
  BulkStaffMarkDto,
  BulkStaffResultDto,
  StaffBoardPageDto,
  StaffBoardQueryDto,
} from './dto/staff-attendance.dto';
import { StaffAttendance } from './entities/staff-attendance.entity';
import { filterBoard, pageOf } from './staff-board.logic';

export const LATE_GRACE_MINUTES = 10;
const MAX_ACCURACY_ALLOWANCE_M = 50;

export function localTime(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(
    value,
  );
}

export function isLate(checkIn: Date, reportingTime: string, timeZone: string): boolean {
  const [hours, minutes] = reportingTime.split(':').map(Number);
  const [inHours, inMinutes] = localTime(checkIn, timeZone).split(':').map(Number);
  return inHours * 60 + inMinutes > hours * 60 + minutes + LATE_GRACE_MINUTES;
}

export function insideGeofence(distance: number, radius: number, accuracy?: number): boolean {
  return distance <= radius + Math.min(accuracy ?? 0, MAX_ACCURACY_ALLOWANCE_M);
}

function present(row: StaffAttendance | null, status?: BoardStatus): StaffDayDto {
  return {
    date: row?.date ?? '',
    status: status ?? row?.status ?? 'not_checked_in',
    check_in_at: row?.check_in_at ?? null,
    check_out_at: row?.check_out_at ?? null,
    check_in_distance_m: row?.check_in_distance_m ?? null,
    source: row?.source ?? null,
    remarks: row?.remarks ?? null,
  };
}

@Injectable()
export class StaffAttendanceService {
  constructor(
    @InjectRepository(StaffAttendance) private readonly attendance: Repository<StaffAttendance>,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async status(user: AuthUser): Promise<CheckInStatusDto> {
    const { school } = await this.staffOf(user);
    const today = todayIn(this.app.timeZone);
    const row = await this.attendance.findOneBy({ user_id: user.id, date: today });
    return {
      ...present(row),
      date: today,
      status: (await this.onLeave(user.id, today)) ? 'on_leave' : (row?.status ?? 'not_checked_in'),
      reporting_time: school.staff_reporting_time,
      geofence_radius_m: school.geofence_radius_m,
      school_latitude: school.latitude === null ? null : Number(school.latitude),
      school_longitude: school.longitude === null ? null : Number(school.longitude),
      geofence_ready: school.latitude !== null && school.longitude !== null,
      can_check_in: !row?.check_in_at,
      can_check_out: Boolean(row?.check_in_at) && !row?.check_out_at,
    };
  }

  async checkIn(user: AuthUser, location: LocationDto): Promise<CheckInStatusDto> {
    const { school } = await this.staffOf(user);
    const distance = this.assertInside(school, location);
    const today = todayIn(this.app.timeZone);
    const existing = await this.attendance.findOneBy({ user_id: user.id, date: today });
    if (existing?.check_in_at) {
      throw AppException.conflict(
        `You already checked in at ${localTime(existing.check_in_at, this.app.timeZone)}`,
        'ALREADY_CHECKED_IN',
      );
    }
    const now = new Date();
    await this.attendance.save(
      this.attendance.merge(existing ?? this.attendance.create(), {
        school_id: school.id,
        user_id: user.id,
        date: today,
        check_in_at: now,
        check_in_lat: location.lat,
        check_in_lng: location.lng,
        check_in_distance_m: distance,
        source: 'app',
        status: isLate(now, school.staff_reporting_time, this.app.timeZone) ? 'late' : 'present',
      }),
    );
    return this.status(user);
  }

  async checkOut(user: AuthUser, location: LocationDto): Promise<CheckInStatusDto> {
    const { school } = await this.staffOf(user);
    const distance = this.assertInside(school, location);
    const today = todayIn(this.app.timeZone);
    const row = await this.attendance.findOneBy({ user_id: user.id, date: today });
    if (!row?.check_in_at) throw AppException.badRequest('Check in first', 'NOT_CHECKED_IN');
    if (row.check_out_at) {
      throw AppException.conflict(
        `You already checked out at ${localTime(row.check_out_at, this.app.timeZone)}`,
        'ALREADY_CHECKED_OUT',
      );
    }
    await this.attendance.update(row.id, { check_out_at: new Date(), check_out_distance_m: distance });
    return this.status(user);
  }

  async board(schoolId: number, date: string): Promise<StaffBoardDto> {
    const school = await this.dataSource.getRepository(School).findOneByOrFail({ id: schoolId });
    const rows: {
      staff_id: number;
      user_id: number;
      name: string;
      designation: string;
      department: string | null;
      on_leave: boolean;
      attendance_id: number | null;
    }[] = await this.dataSource.query(
      `SELECT st.id AS staff_id, st.user_id, u.name, st.designation, st.department, a.id AS attendance_id,
              EXISTS (SELECT 1 FROM staff_leave_requests l WHERE l.user_id = st.user_id AND l.status = 'approved'
                      AND l.deleted_at IS NULL AND $2 BETWEEN l.from_date AND l.to_date) AS on_leave
       FROM staff st JOIN users u ON u.id = st.user_id
       LEFT JOIN staff_attendance a ON a.user_id = st.user_id AND a.date = $2
       WHERE st.school_id = $1 AND st.deleted_at IS NULL AND st.status <> 'resigned' AND st.joining_date <= $2
       ORDER BY u.name`,
      [schoolId, date],
    );
    const ids = rows.map((row) => row.attendance_id).filter((id): id is number => Boolean(id));
    const records = ids.length ? await this.attendance.findBy({ id: In(ids.map(Number)) }) : [];
    const byUser = new Map(records.map((record) => [record.user_id, record]));
    const staff = rows.map((row) => {
      const record = byUser.get(Number(row.user_id)) ?? null;
      return {
        ...present(record, row.on_leave && !record?.check_in_at ? 'on_leave' : undefined),
        date,
        staff_id: Number(row.staff_id),
        user_id: Number(row.user_id),
        name: row.name,
        designation: row.designation,
        department: row.department,
      };
    });
    const count = (status: BoardStatus) => staff.filter((row) => row.status === status).length;
    return {
      date,
      reporting_time: school.staff_reporting_time,
      total: staff.length,
      present: count('present') + count('half_day'),
      late: count('late'),
      on_leave: count('on_leave'),
      not_checked_in: count('not_checked_in') + count('absent'),
      staff,
    };
  }

  async month(schoolId: number, userId: number, month: string): Promise<StaffMonthDto> {
    const range = monthRange(month);
    const today = todayIn(this.app.timeZone);
    const to = range.to < today ? range.to : today;
    const holidays = await holidaySet(this.dataSource.manager, schoolId, range.from, range.to);
    const [records, leaves] = await Promise.all([
      this.dataSource.query(
        `SELECT *, to_char(date, 'YYYY-MM-DD') AS day FROM staff_attendance WHERE user_id = $1 AND date BETWEEN $2 AND $3`,
        [userId, range.from, to],
      ) as Promise<(StaffAttendance & { day: string })[]>,
      this.dataSource.query(
        `SELECT to_char(from_date, 'YYYY-MM-DD') AS from_date, to_char(to_date, 'YYYY-MM-DD') AS to_date
         FROM staff_leave_requests WHERE user_id = $1 AND status = 'approved' AND deleted_at IS NULL
         AND from_date <= $3 AND to_date >= $2`,
        [userId, range.from, to],
      ) as Promise<{ from_date: string; to_date: string }[]>,
    ]);
    const leaveDays = new Set(leaves.flatMap((leave) => datesBetween(leave.from_date, leave.to_date)));
    const byDate = new Map(records.map((record) => [record.day, record]));
    const days = workingDays(range.from, to, holidays).map((date) => {
      const record = byDate.get(date) ?? null;
      const status: BoardStatus =
        record?.status ?? (leaveDays.has(date) ? 'on_leave' : date < today ? 'absent' : 'not_checked_in');
      return { ...present(record, status), date };
    });
    const count = (status: BoardStatus) => days.filter((day) => day.status === status).length;
    return {
      month,
      working_days: days.length,
      present: count('present') + count('half_day'),
      late: count('late'),
      on_leave: count('on_leave'),
      absent: count('absent'),
      days,
    };
  }

  async boardPage(schoolId: number, query: StaffBoardQueryDto): Promise<StaffBoardPageDto> {
    const board = await this.board(schoolId, query.date);
    const filtered = filterBoard(board.staff, { search: query.search, status: query.status });
    const { items, ...paging } = pageOf(filtered, query.page, query.limit);
    return { ...board, staff: items, filtered_total: filtered.length, ...paging };
  }

  async bulkMark(schoolId: number, dto: BulkStaffMarkDto, actor: AuthUser): Promise<BulkStaffResultDto> {
    if (!dto.user_ids?.length && !dto.all_not_checked_in) {
      throw AppException.validation([
        { field: 'user_ids', message: 'Choose at least one staff member, or mark everyone not checked in' },
      ]);
    }
    this.assertNotFuture(dto.date);
    const board = await this.board(schoolId, dto.date);
    const byUser = new Map(board.staff.map((row) => [row.user_id, row]));
    const targets = dto.user_ids?.length
      ? dto.user_ids
      : board.staff.filter((row) => row.status === 'not_checked_in').map((row) => row.user_id);
    if (!targets.length) {
      throw AppException.badRequest('Everyone has already checked in or is on leave', 'NOTHING_TO_MARK');
    }
    const skipped: BulkSkipDto[] = [];
    let marked = 0;
    for (const userId of targets) {
      const row = byUser.get(userId);
      if (!row) {
        skipped.push({ id: userId, name: `Staff ${userId}`, reason: 'Not on the staff list for this date' });
        continue;
      }
      if (row.status === 'on_leave' && dto.status !== 'absent') {
        skipped.push({ id: userId, name: row.name, reason: 'On approved leave' });
        continue;
      }
      await this.saveManual(schoolId, userId, { ...dto, remarks: dto.remarks ?? null }, actor);
      marked += 1;
    }
    return { date: dto.date, marked, skipped };
  }

  async manualMark(schoolId: number, userId: number, dto: ManualMarkDto, actor: AuthUser): Promise<StaffDayDto> {
    const staff = await this.dataSource.getRepository(Staff).findOneBy({ user_id: userId, school_id: schoolId });
    if (!staff) throw AppException.notFound('Staff member not found', 'STAFF_NOT_FOUND');
    this.assertNotFuture(dto.date);
    return present(await this.saveManual(schoolId, userId, dto, actor));
  }

  private assertNotFuture(date: string): void {
    if (date > todayIn(this.app.timeZone)) {
      throw AppException.badRequest('Attendance cannot be marked for a future date', 'FUTURE_DATE');
    }
  }

  private async saveManual(
    schoolId: number,
    userId: number,
    dto: Pick<ManualMarkDto, 'date' | 'status' | 'check_in_at' | 'check_out_at'> & { remarks: string | null },
    actor: AuthUser,
  ): Promise<StaffAttendance> {
    const existing = await this.attendance.findOneBy({ user_id: userId, date: dto.date });
    const saved = await this.attendance.save(
      this.attendance.merge(existing ?? this.attendance.create(), {
        school_id: schoolId,
        user_id: userId,
        date: dto.date,
        status: dto.status,
        check_in_at:
          dto.check_in_at === undefined
            ? (existing?.check_in_at ?? null)
            : dto.check_in_at
              ? new Date(dto.check_in_at)
              : null,
        check_out_at:
          dto.check_out_at === undefined
            ? (existing?.check_out_at ?? null)
            : dto.check_out_at
              ? new Date(dto.check_out_at)
              : null,
        source: 'manual',
        remarks: dto.remarks,
        marked_by: actor.id,
      }),
    );
    return saved;
  }

  async ingestPunches(dto: BiometricPunchesDto): Promise<PunchResultDto> {
    const school = await this.dataSource.getRepository(School).findOneBy({ code: dto.school_code.toUpperCase() });
    if (!school) throw AppException.notFound('School code not found', 'SCHOOL_NOT_FOUND');
    const staffRows = await this.dataSource.getRepository(Staff).findBy({ school_id: school.id });
    const byNumber = new Map(staffRows.map((row) => [row.employee_no.toUpperCase(), row]));
    const unknown = new Set<string>();
    let accepted = 0;
    const sorted = [...dto.punches].sort((a, b) => a.punched_at.localeCompare(b.punched_at));
    for (const punch of sorted) {
      const staff = byNumber.get(punch.employee_no.toUpperCase());
      if (!staff) {
        unknown.add(punch.employee_no);
        continue;
      }
      const at = new Date(punch.punched_at);
      const date = todayIn(this.app.timeZone, at);
      const row = await this.attendance.findOneBy({ user_id: staff.user_id, date });
      if (!row) {
        await this.attendance.save(
          this.attendance.create({
            school_id: school.id,
            user_id: staff.user_id,
            date,
            check_in_at: at,
            source: 'biometric',
            status: isLate(at, school.staff_reporting_time, this.app.timeZone) ? 'late' : 'present',
          }),
        );
      } else if (!row.check_in_at || at < row.check_in_at) {
        await this.attendance.update(row.id, {
          check_in_at: at,
          status: isLate(at, school.staff_reporting_time, this.app.timeZone) ? 'late' : row.status,
        });
      } else if (!row.check_out_at || at > row.check_out_at) {
        await this.attendance.update(row.id, { check_out_at: at });
      }
      accepted += 1;
    }
    return { accepted, unknown_employees: [...unknown] };
  }

  private assertInside(school: School, location: LocationDto): number {
    if (school.latitude === null || school.longitude === null) {
      throw AppException.badRequest(
        'The school location is not set yet. Ask the office to set it in School setup.',
        'GEOFENCE_NOT_SET',
      );
    }
    const distance = distanceMetres(location.lat, location.lng, school.latitude, school.longitude);
    if (!insideGeofence(distance, school.geofence_radius_m, location.accuracy_m)) {
      throw AppException.badRequest(
        `You are ${distance} m from school. Check in when you are inside the campus (${school.geofence_radius_m} m).`,
        'OUTSIDE_SCHOOL',
      );
    }
    return distance;
  }

  private async staffOf(user: AuthUser): Promise<{ staff: Staff; school: School }> {
    const staff = await this.dataSource.getRepository(Staff).findOneBy({ user_id: user.id });
    if (!staff || staff.status === 'resigned') {
      throw AppException.forbidden('Only staff members can check in', 'NOT_STAFF');
    }
    const school = await this.dataSource.getRepository(School).findOneByOrFail({ id: staff.school_id });
    return { staff, school };
  }

  private async onLeave(userId: number, date: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT 1 FROM staff_leave_requests WHERE user_id = $1 AND status = 'approved' AND deleted_at IS NULL
       AND $2 BETWEEN from_date AND to_date LIMIT 1`,
      [userId, date],
    );
    return rows.length > 0;
  }
}
