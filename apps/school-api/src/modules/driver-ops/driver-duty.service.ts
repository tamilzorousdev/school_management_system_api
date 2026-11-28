import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { ROLES } from '../access/access.catalog';
import { ClearanceService } from '../crew/clearance.service';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { TripsService } from '../tracking/trips.service';
import { routeIdsRunBy } from '../transport/bus-swaps';
import { Vehicle } from '../transport/entities/vehicle.entity';
import {
  DriverDayDto,
  DutyCheckInDto,
  DutyCheckOutDto,
  DutyDto,
  DutyMonthDto,
  DutyTodayDto,
} from './dto/driver-ops.dto';
import { dutyPlace, hoursBetween, lateMinutes, reportingTime } from './driver-ops.logic';
import { DriverDuty } from './entities/driver-ops.entity';
import { CrewMonthDto } from '../transport-incharge/dto/transport-ops.dto';

interface DayPlan {
  first_stop_time: string | null;
  reporting_time: string | null;
}

@Injectable()
export class DriverDutyService {
  private readonly logger = new Logger('DriverDuty');

  constructor(
    @InjectRepository(DriverDuty) private readonly duties: Repository<DriverDuty>,
    private readonly trips: TripsService,
    private readonly clearance: ClearanceService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async today(user: AuthUser): Promise<DutyTodayDto> {
    const date = todayIn(this.app.timeZone);
    const vehicle = await this.trips.crewVehicle(user);
    const plan = vehicle ? await this.plan(vehicle, date) : { first_stop_time: null, reporting_time: null };
    const [duty, blocked] = await Promise.all([
      this.duties.findOneBy({ user_id: user.id, duty_date: date }),
      vehicle ? this.blockedReason(vehicle) : Promise.resolve(null),
    ]);
    const attendantId = vehicle ? this.attendantOf(vehicle, user.id) : null;
    const [people, [school]] = await Promise.all([
      this.people([attendantId]),
      this.dataSource.query(`SELECT phone, emergency_phone FROM schools WHERE id = $1`, [user.school_id]) as Promise<
        { phone: string | null; emergency_phone: string | null }[]
      >,
    ]);
    return {
      date,
      vehicle: vehicle ? { id: vehicle.id, name: `${vehicle.name} (${vehicle.registration_no})` } : null,
      attendant: attendantId ? { id: attendantId, name: people.get(attendantId) ?? '' } : null,
      reporting_time: plan.reporting_time,
      first_stop_time: plan.first_stop_time,
      duty: duty ? (await this.present([duty]))[0]! : null,
      blocked: Boolean(blocked),
      blocked_reason: blocked,
      office_phone: school?.phone || school?.emergency_phone || null,
    };
  }

  async checkIn(user: AuthUser, dto: DutyCheckInDto): Promise<DutyTodayDto> {
    const date = todayIn(this.app.timeZone);
    const vehicle = await this.trips.crewVehicle(user);
    if (!vehicle) throw AppException.forbidden('You are not the driver or attendant of any bus', 'NO_BUS');
    if (await this.duties.findOneBy({ user_id: user.id, duty_date: date })) {
      throw AppException.conflict('You have already checked in today', 'ALREADY_CHECKED_IN');
    }
    await this.assertFile(vehicle.school_id, dto.photo_file_id, 'photo_file_id');
    const point = this.point(dto);
    const plan = await this.plan(vehicle, date);
    const attendantId = this.attendantOf(vehicle, user.id);
    const now = new Date();
    const duty = await this.duties.save(
      this.duties.create({
        school_id: vehicle.school_id,
        user_id: user.id,
        vehicle_id: vehicle.id,
        duty_date: date,
        check_in_at: now,
        check_in_lat: point ? String(point.lat) : null,
        check_in_lng: point ? String(point.lng) : null,
        check_in_place: dutyPlace(point, ...(await this.places(vehicle, date))),
        check_in_photo_id: dto.photo_file_id ?? null,
        reporting_time: plan.reporting_time,
        late_minutes: lateMinutes(plan.reporting_time, this.clock(now)),
        attendant_user_id: attendantId,
        attendant_present: attendantId ? (dto.attendant_present ?? true) : null,
        created_by: user.id,
      }),
    );
    if (duty.attendant_present === false) await this.attendantAbsent(duty, vehicle, user);
    return this.today(user);
  }

  async checkOut(user: AuthUser, dto: DutyCheckOutDto): Promise<DutyTodayDto> {
    const date = todayIn(this.app.timeZone);
    const duty = await this.duties.findOneBy({ user_id: user.id, duty_date: date });
    if (!duty) throw AppException.conflict('Check in first', 'NOT_CHECKED_IN');
    if (duty.check_out_at) throw AppException.conflict('You have already checked out today', 'ALREADY_CHECKED_OUT');
    await this.assertFile(duty.school_id, dto.photo_file_id, 'photo_file_id');
    const running = await this.dataSource.query(
      `SELECT 1 FROM transport_trips WHERE vehicle_id = $1 AND status = 'active' LIMIT 1`,
      [duty.vehicle_id],
    );
    if (running.length) throw AppException.conflict('End the running trip before checking out', 'TRIP_RUNNING');
    const point = this.point(dto);
    await this.duties.update(duty.id, {
      check_out_at: new Date(),
      check_out_lat: point ? String(point.lat) : null,
      check_out_lng: point ? String(point.lng) : null,
      check_out_photo_id: dto.photo_file_id ?? null,
    });
    return this.today(user);
  }

  async month(user: AuthUser, month?: string): Promise<DutyMonthDto> {
    const wanted = month ?? todayIn(this.app.timeZone).slice(0, 7);
    const rows = await this.duties
      .createQueryBuilder('d')
      .where('d.user_id = :user', { user: user.id })
      .andWhere(`to_char(d.duty_date, 'YYYY-MM') = :month`, { month: wanted })
      .orderBy('d.duty_date', 'DESC')
      .getMany();
    const days = await this.present(rows);
    return {
      month: wanted,
      days_on_duty: days.length,
      late_days: days.filter((day) => day.late_minutes > 0).length,
      late_minutes: days.reduce((sum, day) => sum + day.late_minutes, 0),
      days,
    };
  }

  async dayList(schoolId: number, date?: string): Promise<DriverDayDto[]> {
    const day = date ?? todayIn(this.app.timeZone);
    const drivers: { id: number; name: string; mobile: string | null }[] = await this.dataSource.query(
      `SELECT DISTINCT u.id, u.name, u.mobile FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id AND r.code = $2
       WHERE u.school_id = $1 AND u.deleted_at IS NULL AND u.status = 'active'
       ORDER BY u.name`,
      [schoolId, ROLES.DRIVER],
    );
    if (!drivers.length) return [];
    const ids = drivers.map((row) => Number(row.id));
    const [vehicles, rows] = await Promise.all([
      this.dataSource.getRepository(Vehicle).find({ where: { school_id: schoolId, status: 'active' } }),
      this.duties
        .createQueryBuilder('d')
        .where('d.user_id IN (:...ids)', { ids })
        .andWhere('d.duty_date = :day', { day })
        .getMany(),
    ]);
    const presented = new Map((await this.present(rows)).map((duty) => [duty.driver.id, duty]));
    return drivers.map((driver) => {
      const vehicle = vehicles.find((item) => item.driver_user_id === Number(driver.id));
      return {
        driver: { id: Number(driver.id), name: driver.name },
        mobile: driver.mobile,
        vehicle: vehicle ? { id: vehicle.id, name: `${vehicle.name} (${vehicle.registration_no})` } : null,
        duty: presented.get(Number(driver.id)) ?? null,
      };
    });
  }

  async crewMonth(schoolId: number, month?: string): Promise<CrewMonthDto> {
    const today = todayIn(this.app.timeZone);
    const wanted = month ?? today.slice(0, 7);
    const from = `${wanted}-01`;
    const rows: {
      user_id: number;
      name: string;
      role: 'driver' | 'attendant';
      days_present: number;
      late_days: number;
      absent_days: number;
      leave_days: number;
    }[] = await this.dataSource.query(
      `WITH bus_days AS (
         SELECT DISTINCT trip_date AS day FROM transport_trips
         WHERE school_id = $1 AND trip_date >= $2::date AND trip_date < ($2::date + interval '1 month') AND trip_date <= $3::date
       ),
       crew AS (
         SELECT u.id, u.name, bool_or(r.code = $4) AS is_driver FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id AND r.code IN ($4, $5)
         WHERE u.school_id = $1 AND u.deleted_at IS NULL AND u.status = 'active'
         GROUP BY u.id, u.name
       ),
       leaves AS (
         SELECT l.user_id, l.from_date, l.to_date, l.half_day FROM staff_leave_requests l
         WHERE l.school_id = $1 AND l.deleted_at IS NULL AND l.status = 'approved'
           AND l.from_date < ($2::date + interval '1 month') AND l.to_date >= $2::date
       )
       SELECT c.id AS user_id, c.name, CASE WHEN c.is_driver THEN 'driver' ELSE 'attendant' END AS role,
              (SELECT COUNT(*) FROM driver_duties d WHERE d.user_id = c.id AND d.deleted_at IS NULL
                 AND d.duty_date >= $2::date AND d.duty_date < ($2::date + interval '1 month'))::int AS days_present,
              (SELECT COUNT(*) FROM driver_duties d WHERE d.user_id = c.id AND d.deleted_at IS NULL AND d.late_minutes > 0
                 AND d.duty_date >= $2::date AND d.duty_date < ($2::date + interval '1 month'))::int AS late_days,
              (SELECT COUNT(*) FROM bus_days b
                WHERE NOT EXISTS (SELECT 1 FROM driver_duties d WHERE d.user_id = c.id AND d.deleted_at IS NULL AND d.duty_date = b.day)
                  AND NOT EXISTS (SELECT 1 FROM leaves l WHERE l.user_id = c.id AND b.day BETWEEN l.from_date AND l.to_date))::int AS absent_days,
              (SELECT COALESCE(SUM(CASE WHEN l.half_day THEN 0.5
                        ELSE LEAST(l.to_date, ($2::date + interval '1 month')::date - 1) - GREATEST(l.from_date, $2::date) + 1 END), 0)
                 FROM leaves l WHERE l.user_id = c.id)::float AS leave_days
       FROM crew c ORDER BY c.is_driver DESC, c.name`,
      [schoolId, from, today, ROLES.DRIVER, ROLES.ATTENDANT],
    );
    return {
      month: wanted,
      items: rows.map((row) => ({ ...row, user_id: Number(row.user_id), leave_days: Number(row.leave_days) })),
    };
  }

  async present(rows: DriverDuty[]): Promise<DutyDto[]> {
    if (!rows.length) return [];
    const [people, vehicles, files] = await Promise.all([
      this.people(rows.flatMap((row) => [row.user_id, row.attendant_user_id])),
      this.dataSource
        .getRepository(Vehicle)
        .findBy({ id: In([...new Set(rows.map((row) => row.vehicle_id).filter((id): id is number => Boolean(id)))]) }),
      this.files.presentMany(rows.flatMap((row) => [row.check_in_photo_id, row.check_out_photo_id])),
    ]);
    return rows.map((row) => {
      const vehicle = vehicles.find((item) => item.id === row.vehicle_id);
      return {
        id: row.id,
        duty_date: row.duty_date,
        driver: { id: row.user_id, name: people.get(row.user_id) ?? '' },
        vehicle: vehicle ? { id: vehicle.id, name: `${vehicle.name} (${vehicle.registration_no})` } : null,
        check_in_at: row.check_in_at,
        check_in_place: row.check_in_place,
        check_in_photo_url: row.check_in_photo_id ? (files.get(row.check_in_photo_id)?.url ?? null) : null,
        reporting_time: row.reporting_time,
        late_minutes: row.late_minutes,
        attendant: row.attendant_user_id
          ? { id: row.attendant_user_id, name: people.get(row.attendant_user_id) ?? '' }
          : null,
        attendant_present: row.attendant_present,
        check_out_at: row.check_out_at,
        check_out_photo_url: row.check_out_photo_id ? (files.get(row.check_out_photo_id)?.url ?? null) : null,
        hours: hoursBetween(row.check_in_at, row.check_out_at),
      };
    });
  }

  async plan(vehicle: Vehicle, date: string): Promise<DayPlan> {
    const routeIds = await routeIdsRunBy(this.dataSource, vehicle.school_id, vehicle.id, date);
    if (!routeIds.length) return { first_stop_time: null, reporting_time: null };
    const [row]: { first: string | null }[] = await this.dataSource.query(
      `SELECT MIN(substring(pickup_time from 1 for 5)) AS first FROM route_stops
       WHERE route_id = ANY($1) AND deleted_at IS NULL AND pickup_time IS NOT NULL AND pickup_time <> ''`,
      [routeIds],
    );
    const first = row?.first ?? null;
    return { first_stop_time: first, reporting_time: reportingTime(first) };
  }

  private async places(
    vehicle: Vehicle,
    date: string,
  ): Promise<
    [{ lat: number; lng: number; radius_m: number } | null, { lat: number; lng: number; radius_m: number }[]]
  > {
    const routeIds = await routeIdsRunBy(this.dataSource, vehicle.school_id, vehicle.id, date);
    const [[school], stops] = await Promise.all([
      this.dataSource.query(`SELECT latitude, longitude, geofence_radius_m FROM schools WHERE id = $1`, [
        vehicle.school_id,
      ]) as Promise<{ latitude: string | null; longitude: string | null; geofence_radius_m: number | null }[]>,
      routeIds.length
        ? (this.dataSource.query(
            `SELECT lat, lng, geofence_radius_m FROM route_stops WHERE route_id = ANY($1) AND deleted_at IS NULL`,
            [routeIds],
          ) as Promise<{ lat: string; lng: string; geofence_radius_m: number | null }[]>)
        : Promise.resolve([]),
    ]);
    return [
      school?.latitude != null && school?.longitude != null
        ? {
            lat: Number(school.latitude),
            lng: Number(school.longitude),
            radius_m: Number(school.geofence_radius_m ?? 200),
          }
        : null,
      stops.map((stop) => ({
        lat: Number(stop.lat),
        lng: Number(stop.lng),
        radius_m: Number(stop.geofence_radius_m ?? 100),
      })),
    ];
  }

  private async blockedReason(vehicle: Vehicle): Promise<string | null> {
    try {
      await this.clearance.assertCanRun(vehicle.school_id, vehicle);
      return null;
    } catch (error) {
      return error instanceof AppException ? (error.message ?? 'Not cleared for duty') : null;
    }
  }

  private attendantOf(vehicle: Vehicle, userId: number): number | null {
    if (vehicle.driver_user_id === userId) return vehicle.attendant_user_id ?? null;
    return null;
  }

  private async attendantAbsent(duty: DriverDuty, vehicle: Vehicle, user: AuthUser): Promise<void> {
    const people = await this.people([duty.attendant_user_id]);
    await this.notifications
      .dispatch({
        template: TEMPLATES.DRIVER_ATTENDANT_ABSENT,
        audience: { roles: [ROLES.ADMIN, ROLES.TRANSPORT_INCHARGE], school_id: vehicle.school_id },
        data: {
          bus: `${vehicle.name} (${vehicle.registration_no})`,
          driver: user.name,
          attendant: people.get(duty.attendant_user_id!) ?? 'The attendant',
        },
      })
      .catch((error: Error) => this.logger.warn(`Attendant absent notice failed: ${error.message}`));
  }

  private point(dto: { lat?: number; lng?: number }): { lat: number; lng: number } | null {
    return typeof dto.lat === 'number' && typeof dto.lng === 'number' ? { lat: dto.lat, lng: dto.lng } : null;
  }

  private async assertFile(schoolId: number, fileId: number | undefined, field: string): Promise<void> {
    if (fileId === undefined) return;
    const [file] = await this.dataSource.query(`SELECT id FROM files WHERE id = $1 AND school_id = $2`, [
      fileId,
      schoolId,
    ]);
    if (!file) throw AppException.validation([{ field, message: 'Upload the photo first' }]);
  }

  private async people(ids: (number | null)[]): Promise<Map<number, string>> {
    const wanted = [...new Set(ids.filter((id): id is number => Boolean(id)))];
    if (!wanted.length) return new Map();
    const rows: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT id, name FROM users WHERE id = ANY($1)`,
      [wanted],
    );
    return new Map(rows.map((row) => [Number(row.id), row.name]));
  }

  private clock(at: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: this.app.timeZone,
    }).format(at);
  }
}
