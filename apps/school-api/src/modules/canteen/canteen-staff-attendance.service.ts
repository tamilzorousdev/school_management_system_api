import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { datesInRange, monthRange, resolveRange, wageEstimate } from './canteen-people.logic';
import { attendanceRate } from './canteen.logic';
import {
  AttendanceDayDto,
  AttendanceMarkDto,
  AttendanceSummaryDto,
  RosterDto,
  RosterRowDto,
  StaffMonthDto,
} from './dto/canteen-people.dto';
import { CanteenAttendanceStatus, CanteenStaff, CanteenStaffAttendance } from './entities/canteen-people.entity';

type Row = Record<string, unknown>;

const count = (rows: { status: CanteenAttendanceStatus | null }[], status: CanteenAttendanceStatus) =>
  rows.filter((row) => row.status === status).length;

@Injectable()
export class CanteenStaffAttendanceService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CanteenStaff) private readonly staffRepo: Repository<CanteenStaff>,
    @InjectRepository(CanteenStaffAttendance) private readonly repo: Repository<CanteenStaffAttendance>,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  today(): string {
    return todayIn(this.app.timeZone);
  }

  async roster(schoolId: number, date = this.today()): Promise<RosterDto> {
    const rows: Row[] = await this.dataSource.query(
      `SELECT s.id AS canteen_staff_id, s.name, s.role, s.daily_wage,
              a.id AS attendance_id, a.status, a.check_in_at, a.check_out_at, a.note
       FROM canteen_staff s
       LEFT JOIN canteen_staff_attendance a
         ON a.canteen_staff_id = s.id AND a.attendance_date = $2 AND a.school_id = s.school_id AND a.deleted_at IS NULL
       WHERE s.school_id = $1 AND s.status = 'active' AND s.deleted_at IS NULL
       ORDER BY s.name, s.id`,
      [schoolId, date],
    );
    const items: RosterRowDto[] = rows.map((row) => ({
      canteen_staff_id: Number(row.canteen_staff_id),
      name: String(row.name),
      role: row.role as RosterRowDto['role'],
      daily_wage: row.daily_wage === null ? null : Number(row.daily_wage),
      attendance_id: row.attendance_id === null ? null : Number(row.attendance_id),
      status: (row.status as CanteenAttendanceStatus | null) ?? null,
      check_in_at: (row.check_in_at as Date | null) ?? null,
      check_out_at: (row.check_out_at as Date | null) ?? null,
      note: (row.note as string | null) ?? null,
    }));
    return {
      date,
      summary: {
        total: items.length,
        present: count(items, 'present'),
        half_day: count(items, 'half_day'),
        absent: count(items, 'absent'),
        leave: count(items, 'leave'),
        unmarked: items.filter((item) => item.status === null).length,
      },
      rows: items,
    };
  }

  async markDay(schoolId: number, dto: AttendanceDayDto): Promise<RosterDto> {
    if (dto.date > this.today()) {
      throw AppException.badRequest('Attendance cannot be marked for a future date', 'ATTENDANCE_DATE_FUTURE');
    }
    const ids = dto.marks.map((mark) => mark.canteen_staff_id);
    if (new Set(ids).size !== ids.length) {
      throw AppException.badRequest('A staff member appears more than once', 'ATTENDANCE_DUPLICATE_STAFF');
    }
    await this.activeStaff(schoolId, ids);
    const existing = await this.repo.findBy({
      school_id: schoolId,
      attendance_date: dto.date,
      canteen_staff_id: In(ids),
    });
    const byStaff = new Map(existing.map((row) => [row.canteen_staff_id, row]));
    const rows = dto.marks.map((mark) => this.applyMark(schoolId, dto.date, mark, byStaff.get(mark.canteen_staff_id)));
    await this.repo.save(rows);
    return this.roster(schoolId, dto.date);
  }

  async checkIn(schoolId: number, canteenStaffId: number): Promise<RosterRowDto> {
    const [staff] = await this.activeStaff(schoolId, [canteenStaffId]);
    const date = this.today();
    const row =
      (await this.repo.findOneBy({ school_id: schoolId, canteen_staff_id: canteenStaffId, attendance_date: date })) ??
      this.repo.create({ school_id: schoolId, canteen_staff_id: canteenStaffId, attendance_date: date });
    row.status = 'present';
    row.check_in_at = row.check_in_at ?? new Date();
    row.check_out_at = null;
    return this.single(staff!, await this.repo.save(row));
  }

  async checkOut(schoolId: number, canteenStaffId: number): Promise<RosterRowDto> {
    const [staff] = await this.activeStaff(schoolId, [canteenStaffId]);
    const date = this.today();
    const row =
      (await this.repo.findOneBy({ school_id: schoolId, canteen_staff_id: canteenStaffId, attendance_date: date })) ??
      this.repo.create({ school_id: schoolId, canteen_staff_id: canteenStaffId, attendance_date: date });
    row.status = 'present';
    row.check_out_at = new Date();
    return this.single(staff!, await this.repo.save(row));
  }

  async summary(schoolId: number, from?: string, to?: string): Promise<AttendanceSummaryDto> {
    const range = resolveRange(from, to, this.today());
    const rows: Row[] = await this.dataSource.query(
      `SELECT s.id AS canteen_staff_id, s.name, s.role,
              COUNT(*) FILTER (WHERE a.status = 'present')::int AS present,
              COUNT(*) FILTER (WHERE a.status = 'half_day')::int AS half_day,
              COUNT(*) FILTER (WHERE a.status = 'absent')::int AS absent,
              COUNT(*) FILTER (WHERE a.status = 'leave')::int AS leave
       FROM canteen_staff s
       LEFT JOIN canteen_staff_attendance a
         ON a.canteen_staff_id = s.id AND a.school_id = s.school_id AND a.deleted_at IS NULL
        AND a.attendance_date BETWEEN $2 AND $3
       WHERE s.school_id = $1 AND s.status = 'active' AND s.deleted_at IS NULL
       GROUP BY s.id, s.name, s.role
       ORDER BY s.name, s.id`,
      [schoolId, range.from, range.to],
    );
    return {
      ...range,
      rows: rows.map((row) => {
        const present = Number(row.present);
        const half = Number(row.half_day);
        const absent = Number(row.absent);
        const leave = Number(row.leave);
        const marked = present + half + absent + leave;
        return {
          canteen_staff_id: Number(row.canteen_staff_id),
          name: String(row.name),
          role: row.role as RosterRowDto['role'],
          present,
          half_day: half,
          absent,
          leave,
          marked_days: marked,
          attendance_rate: attendanceRate(present, half, marked),
        };
      }),
    };
  }

  async staffMonth(schoolId: number, id: number, month = this.today().slice(0, 7)): Promise<StaffMonthDto> {
    const staff = await this.staffRepo.findOneBy({ id, school_id: schoolId });
    if (!staff) throw AppException.notFound('Canteen staff not found', 'CANTEEN_STAFF_NOT_FOUND');
    const range = monthRange(month);
    const marks = await this.dataSource
      .getRepository(CanteenStaffAttendance)
      .createQueryBuilder('a')
      .where('a.school_id = :schoolId AND a.canteen_staff_id = :id', { schoolId, id })
      .andWhere('a.attendance_date BETWEEN :from AND :to', range)
      .getMany();
    const byDate = new Map(marks.map((mark) => [mark.attendance_date, mark]));
    const days = datesInRange(range).map((date) => {
      const mark = byDate.get(date);
      return {
        date,
        status: mark?.status ?? null,
        check_in_at: mark?.check_in_at ?? null,
        check_out_at: mark?.check_out_at ?? null,
        note: mark?.note ?? null,
      };
    });
    const present = count(days, 'present');
    const half = count(days, 'half_day');
    const absent = count(days, 'absent');
    const leave = count(days, 'leave');
    return {
      canteen_staff_id: staff.id,
      name: staff.name,
      month,
      daily_wage: staff.daily_wage,
      present,
      half_day: half,
      absent,
      leave,
      attendance_rate: attendanceRate(present, half, present + half + absent + leave),
      wage_estimate: wageEstimate({ present, half_day: half, daily_wage: staff.daily_wage }),
      days,
    };
  }

  private applyMark(
    schoolId: number,
    date: string,
    mark: AttendanceMarkDto,
    existing: CanteenStaffAttendance | undefined,
  ): CanteenStaffAttendance {
    const row =
      existing ??
      this.repo.create({ school_id: schoolId, canteen_staff_id: mark.canteen_staff_id, attendance_date: date });
    row.status = mark.status;
    row.check_in_at = mark.check_in_at ? new Date(mark.check_in_at) : null;
    row.check_out_at = mark.check_out_at ? new Date(mark.check_out_at) : null;
    row.note = mark.note ?? null;
    return row;
  }

  private async activeStaff(schoolId: number, ids: number[]): Promise<CanteenStaff[]> {
    const staff = await this.staffRepo.findBy({ school_id: schoolId, id: In(ids) });
    const byId = new Map(staff.map((row) => [row.id, row]));
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) throw AppException.notFound(`Canteen staff ${id} not found`, 'CANTEEN_STAFF_NOT_FOUND');
      if (row.status !== 'active') {
        throw AppException.badRequest(`${row.name} is not active`, 'CANTEEN_STAFF_INACTIVE');
      }
    }
    return ids.map((id) => byId.get(id)!);
  }

  private single(staff: CanteenStaff, row: CanteenStaffAttendance): RosterRowDto {
    return {
      canteen_staff_id: staff.id,
      name: staff.name,
      role: staff.role,
      daily_wage: staff.daily_wage,
      attendance_id: row.id,
      status: row.status,
      check_in_at: row.check_in_at,
      check_out_at: row.check_out_at,
      note: row.note,
    };
  }
}
