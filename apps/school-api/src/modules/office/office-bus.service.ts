import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException } from '@app/common';
import { yearClause } from '../../shared/year-context';
import { inWings } from '../../shared/wing-context';
import { FilesService } from '../files/files.service';
import {
  BusesTodayDto,
  BusStudentDto,
  CrewRefDto,
  OfficeDriverDto,
  SectionBusDto,
  SectionRouteDto,
  StudentBusTodayDto,
  TripTodayDto,
} from './dto/office-bus.dto';
import { WingScopeService } from './wing-scope.service';

const num = (value: unknown) => Number(value ?? 0);

interface RiderRow {
  student_id: number;
  name: string;
  roll_no: number | null;
  photo_file_id: number | null;
  class_section: string | null;
  route_id: number;
  route: string;
  mode: string;
  pass_status: string | null;
  pickup_stop: string | null;
  pickup_time: string | null;
  drop_stop: string | null;
  drop_time: string | null;
  today: string | null;
  boarded_at: Date | null;
  dropped_at: Date | null;
}

interface RouteRow {
  route_id: number;
  bus: string | null;
  capacity: number | null;
  driver_user_id: number | null;
  driver_name: string | null;
  driver_mobile: string | null;
  driver_photo: number | null;
  attendant_user_id: number | null;
  attendant_name: string | null;
  attendant_mobile: string | null;
  attendant_photo: number | null;
  rating_avg: string | null;
  rating_count: string;
}

interface TripRow {
  route_id: number;
  kind: 'pickup' | 'drop';
  status: string;
  started_at: Date | null;
  ended_at: Date | null;
  delay_minutes: number | null;
}

@Injectable()
export class OfficeBusService {
  constructor(
    private readonly scope: WingScopeService,
    private readonly files: FilesService,
    private readonly dataSource: DataSource,
  ) {}

  async section(schoolId: number, sectionId: number): Promise<SectionBusDto> {
    const [section]: { id: number; class_id: number; label: string; students: string }[] = await this.dataSource.query(
      `SELECT s.id, s.class_id, c.name || ' - ' || s.name AS label,
              (SELECT count(*) FROM student_enrollments e WHERE e.section_id = s.id AND e.status = 'studying') AS students
       FROM sections s JOIN classes c ON c.id = s.class_id
       WHERE s.id = $1 AND s.school_id = $2 AND s.deleted_at IS NULL`,
      [sectionId, schoolId],
    );
    if (!section || !inWings(Number(section.class_id))) {
      throw AppException.notFound('Section not found', 'SECTION_NOT_FOUND');
    }
    const riders = await this.riders(schoolId, { sectionId });
    const routeIds = [...new Set(riders.map((row) => row.route_id))];
    const [routes, trips] = await Promise.all([this.routes(schoolId, routeIds), this.trips(schoolId, routeIds)]);
    const photos = await this.files.presentMany([
      ...riders.map((row) => row.photo_file_id),
      ...routes.flatMap((row) => [row.driver_photo, row.attendant_photo]),
    ]);
    const photo = (id: number | null) =>
      id ? (photos.get(Number(id))?.thumbnail_url ?? photos.get(Number(id))?.url ?? null) : null;
    const crew = (
      id: number | null,
      name: string | null,
      mobile: string | null,
      photoId: number | null,
    ): CrewRefDto | null => (id ? { user_id: Number(id), name: name ?? '', mobile, photo_url: photo(photoId) } : null);
    return {
      class_section: section.label,
      by_bus: riders.length,
      not_by_bus: Math.max(0, num(section.students) - riders.length),
      routes: routeIds.map((routeId): SectionRouteDto => {
        const route = routes.find((row) => Number(row.route_id) === routeId);
        const routeTrips = trips.filter((row) => Number(row.route_id) === routeId);
        const pickup = routeTrips.find((row) => row.kind === 'pickup');
        const students = riders
          .filter((row) => row.route_id === routeId)
          .map((row) => this.student(row, pickup, photo(row.photo_file_id)));
        return {
          route_id: routeId,
          route: riders.find((row) => row.route_id === routeId)!.route,
          bus: route?.bus ?? null,
          capacity: route?.capacity === null || route?.capacity === undefined ? null : Number(route.capacity),
          driver: route ? crew(route.driver_user_id, route.driver_name, route.driver_mobile, route.driver_photo) : null,
          driver_rating: {
            average: route?.rating_avg ? Math.round(Number(route.rating_avg) * 10) / 10 : null,
            count: num(route?.rating_count),
          },
          attendant: route
            ? crew(route.attendant_user_id, route.attendant_name, route.attendant_mobile, route.attendant_photo)
            : null,
          trips: (['pickup', 'drop'] as const).map((kind) =>
            this.trip(
              kind,
              routeTrips.find((row) => row.kind === kind),
            ),
          ),
          boarded: students.filter((row) => row.morning === 'boarded').length,
          expected: students.filter((row) => row.morning !== 'not_by_bus' && row.morning !== 'away').length,
          students,
        };
      }),
    };
  }

  async today(schoolId: number, classIds: number[] | null): Promise<BusesTodayDto> {
    if (classIds && !classIds.length) {
      return { buses: 0, reached: 0, running: 0, not_started: 0, late: 0, students: 0, not_boarded: [] };
    }
    const riders = await this.riders(schoolId, { classIds });
    const routeIds = [...new Set(riders.map((row) => row.route_id))];
    const trips = await this.trips(schoolId, routeIds);
    const pickups = routeIds.map((id) => trips.find((row) => Number(row.route_id) === id && row.kind === 'pickup'));
    const states = pickups.map((trip) => this.trip('pickup', trip).state);
    const notBoarded = riders.filter((row) => {
      const pickup = trips.find((trip) => Number(trip.route_id) === row.route_id && trip.kind === 'pickup');
      return this.student(row, pickup, null).morning === 'not_boarded';
    });
    return {
      buses: routeIds.length,
      reached: states.filter((state) => state === 'reached').length,
      running: states.filter((state) => state === 'running').length,
      not_started: states.filter((state) => state === 'not_started').length,
      late: pickups.filter((trip) => num(trip?.delay_minutes) > 0).length,
      students: riders.length,
      not_boarded: notBoarded.map((row) => ({
        student_id: row.student_id,
        name: row.name,
        class_section: row.class_section,
        route: row.route,
      })),
    };
  }

  async studentToday(studentId: number): Promise<StudentBusTodayDto | null> {
    const [row]: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT
         (SELECT b.occurred_at FROM transport_boardings b JOIN transport_trips t ON t.id = b.trip_id
            WHERE b.student_id = $1 AND b.action = 'boarded' AND t.kind = 'pickup' AND t.trip_date = $2::date
            ORDER BY b.occurred_at LIMIT 1) AS boarded_at,
         (SELECT rs.name FROM transport_boardings b JOIN transport_trips t ON t.id = b.trip_id
            LEFT JOIN route_stops rs ON rs.id = b.stop_id
            WHERE b.student_id = $1 AND b.action = 'boarded' AND t.kind = 'pickup' AND t.trip_date = $2::date
            ORDER BY b.occurred_at LIMIT 1) AS boarded_stop,
         (SELECT t.ended_at FROM transport_boardings b JOIN transport_trips t ON t.id = b.trip_id
            WHERE b.student_id = $1 AND t.kind = 'pickup' AND t.trip_date = $2::date AND t.status = 'ended' LIMIT 1) AS reached_school_at,
         (SELECT b.occurred_at FROM transport_boardings b JOIN transport_trips t ON t.id = b.trip_id
            WHERE b.student_id = $1 AND b.action = 'alighted' AND t.kind = 'drop' AND t.trip_date = $2::date
            ORDER BY b.occurred_at DESC LIMIT 1) AS dropped_at,
         (SELECT rs.name FROM transport_boardings b JOIN transport_trips t ON t.id = b.trip_id
            LEFT JOIN route_stops rs ON rs.id = b.stop_id
            WHERE b.student_id = $1 AND b.action = 'alighted' AND t.kind = 'drop' AND t.trip_date = $2::date
            ORDER BY b.occurred_at DESC LIMIT 1) AS dropped_stop`,
      [studentId, this.scope.today()],
    );
    if (!row || (!row.boarded_at && !row.dropped_at)) return null;
    return {
      boarded_at: (row.boarded_at as Date | null) ?? null,
      boarded_stop: (row.boarded_stop as string | null) ?? null,
      reached_school_at: (row.reached_school_at as Date | null) ?? null,
      dropped_at: (row.dropped_at as Date | null) ?? null,
      dropped_stop: (row.dropped_stop as string | null) ?? null,
    };
  }

  async driver(schoolId: number, userId: number): Promise<OfficeDriverDto> {
    const [row]: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT u.id, u.name, u.mobile, u.photo_file_id, st.licence_no,
              to_char(st.licence_expiry, 'YYYY-MM-DD') AS licence_expiry,
              st.licence_expiry < CURRENT_DATE AS licence_expired,
              st.badge_expiry < CURRENT_DATE AS badge_expired,
              st.medical_fitness_expiry < CURRENT_DATE AS medical_expired,
              (SELECT v.registration_no FROM vehicles v WHERE v.driver_user_id = u.id AND v.deleted_at IS NULL LIMIT 1) AS bus
       FROM users u
       JOIN vehicles v0 ON (v0.driver_user_id = u.id OR v0.attendant_user_id = u.id) AND v0.school_id = $1 AND v0.deleted_at IS NULL
       LEFT JOIN staff st ON st.user_id = u.id AND st.deleted_at IS NULL
       WHERE u.id = $2 AND u.deleted_at IS NULL LIMIT 1`,
      [schoolId, userId],
    );
    if (!row) throw AppException.notFound('Driver not found', 'DRIVER_NOT_FOUND');
    const [routes, stars, recent] = await Promise.all([
      this.dataSource.query(
        `SELECT trim(COALESCE(r.code, '') || ' · ' || r.name) AS route FROM transport_routes r
         JOIN vehicles v ON v.id = r.vehicle_id
         WHERE r.school_id = $1 AND r.deleted_at IS NULL AND (v.driver_user_id = $2 OR v.attendant_user_id = $2)
         ORDER BY r.code`,
        [schoolId, userId],
      ) as Promise<{ route: string }[]>,
      this.dataSource.query(
        `SELECT rating, count(*) AS n FROM driver_ratings
         WHERE school_id = $1 AND driver_user_id = $2 AND deleted_at IS NULL GROUP BY rating`,
        [schoolId, userId],
      ) as Promise<{ rating: number; n: string }[]>,
      this.dataSource.query(
        `SELECT rating, tags, comment, month FROM driver_ratings
         WHERE school_id = $1 AND driver_user_id = $2 AND deleted_at IS NULL
           AND (COALESCE(trim(comment), '') <> '' OR COALESCE(array_length(tags, 1), 0) > 0)
         ORDER BY month DESC, id DESC LIMIT 5`,
        [schoolId, userId],
      ) as Promise<{ rating: number; tags: string[] | null; comment: string | null; month: string }[]>,
    ]);
    const distribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    stars.forEach((item) => (distribution[String(item.rating)] = num(item.n)));
    const count = Object.values(distribution).reduce((sum, value) => sum + value, 0);
    const total = Object.entries(distribution).reduce((sum, [star, value]) => sum + Number(star) * value, 0);
    const photoId = row.photo_file_id ? Number(row.photo_file_id) : null;
    const photo = photoId ? (await this.files.presentMany([photoId])).get(photoId) : null;
    return {
      driver: {
        user_id: Number(row.id),
        name: row.name as string,
        mobile: (row.mobile as string | null) ?? null,
        photo_url: photo?.thumbnail_url ?? photo?.url ?? null,
      },
      licence_no: (row.licence_no as string | null) ?? null,
      licence_expiry: (row.licence_expiry as string | null) ?? null,
      warnings: [
        ...(row.licence_expired ? ['licence_expired'] : []),
        ...(row.badge_expired ? ['badge_expired'] : []),
        ...(row.medical_expired ? ['medical_expired'] : []),
      ],
      routes: routes.map((item) => item.route),
      bus: (row.bus as string | null) ?? null,
      rating: { average: count ? Math.round((total / count) * 10) / 10 : null, count },
      stars: distribution,
      recent: recent.map((item) => ({
        rating: Number(item.rating),
        tags: item.tags ?? [],
        comment: item.comment,
        month: String(item.month).slice(0, 7),
      })),
    };
  }

  private student(row: RiderRow, pickup: TripRow | undefined, photoUrl: string | null): BusStudentDto {
    let morning: BusStudentDto['morning'];
    if (row.mode === 'drop') morning = 'not_by_bus';
    else if (row.boarded_at) morning = 'boarded';
    else if (row.today && ['absent', 'leave'].includes(row.today)) morning = 'away';
    else if (pickup?.status === 'ended') morning = 'not_boarded';
    else morning = 'waiting';
    return {
      student_id: row.student_id,
      name: row.name,
      roll_no: row.roll_no === null ? null : Number(row.roll_no),
      photo_url: photoUrl,
      mode: row.mode,
      pickup_stop: row.pickup_stop,
      pickup_time: row.pickup_time,
      drop_stop: row.drop_stop,
      drop_time: row.drop_time,
      pass_status: row.pass_status,
      morning,
      boarded_at: row.boarded_at,
      dropped_at: row.dropped_at,
    };
  }

  private trip(kind: 'pickup' | 'drop', row: TripRow | undefined): TripTodayDto {
    return {
      kind,
      state: !row ? 'not_started' : row.status === 'ended' ? 'reached' : 'running',
      started_at: row?.started_at ?? null,
      ended_at: row?.ended_at ?? null,
      delay_minutes: row?.delay_minutes === null || row?.delay_minutes === undefined ? null : Number(row.delay_minutes),
    };
  }

  private async riders(
    schoolId: number,
    filter: { sectionId?: number; classIds?: number[] | null },
  ): Promise<RiderRow[]> {
    const rows: RiderRow[] = await this.dataSource.query(
      `WITH yr AS (SELECT ay.id FROM academic_years ay WHERE ay.school_id = $1 AND ay.deleted_at IS NULL AND ${yearClause('ay')})
       SELECT s.id AS student_id, trim(s.first_name || ' ' || COALESCE(s.last_name, '')) AS name, e.roll_no, s.photo_file_id,
              c.name || COALESCE(' - ' || sec.name, '') AS class_section,
              r.id AS route_id, trim(COALESCE(r.code, '') || ' · ' || r.name) AS route,
              st.mode, st.pass_status,
              ps.name AS pickup_stop, ps.pickup_time,
              COALESCE(ds.name, ps.name) AS drop_stop, COALESCE(ds.drop_time, ps.drop_time) AS drop_time,
              (SELECT d.status FROM student_attendance_days d WHERE d.student_id = s.id AND d.date = $2::date) AS today,
              (SELECT b.occurred_at FROM transport_boardings b JOIN transport_trips t ON t.id = b.trip_id
                 WHERE b.student_id = s.id AND b.action = 'boarded' AND t.kind = 'pickup' AND t.trip_date = $2::date
                 ORDER BY b.occurred_at LIMIT 1) AS boarded_at,
              (SELECT b.occurred_at FROM transport_boardings b JOIN transport_trips t ON t.id = b.trip_id
                 WHERE b.student_id = s.id AND b.action = 'alighted' AND t.kind = 'drop' AND t.trip_date = $2::date
                 ORDER BY b.occurred_at DESC LIMIT 1) AS dropped_at
       FROM student_enrollments e
       JOIN yr ON yr.id = e.academic_year_id
       JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
       JOIN classes c ON c.id = e.class_id
       LEFT JOIN sections sec ON sec.id = e.section_id
       JOIN student_transport st ON st.student_id = s.id AND st.deleted_at IS NULL
       JOIN transport_routes r ON r.id = st.route_id AND r.deleted_at IS NULL
       LEFT JOIN route_stops ps ON ps.id = st.stop_id
       LEFT JOIN route_stops ds ON ds.id = st.drop_stop_id
       WHERE e.status = 'studying' AND s.school_id = $1
         AND ($3::int IS NULL OR e.section_id = $3)
         AND ($4::int[] IS NULL OR e.class_id = ANY($4))
       ORDER BY r.code, e.roll_no NULLS LAST, s.first_name`,
      [schoolId, this.scope.today(), filter.sectionId ?? null, filter.classIds ?? null],
    );
    return rows.map((row) => ({
      ...row,
      student_id: Number(row.student_id),
      route_id: Number(row.route_id),
      photo_file_id: row.photo_file_id ? Number(row.photo_file_id) : null,
    }));
  }

  private async routes(schoolId: number, routeIds: number[]): Promise<RouteRow[]> {
    if (!routeIds.length) return [];
    return this.dataSource.query(
      `SELECT r.id AS route_id, v.registration_no AS bus, v.capacity,
              d.id AS driver_user_id, d.name AS driver_name, d.mobile AS driver_mobile, d.photo_file_id AS driver_photo,
              a.id AS attendant_user_id, a.name AS attendant_name, a.mobile AS attendant_mobile, a.photo_file_id AS attendant_photo,
              (SELECT avg(dr.rating) FROM driver_ratings dr WHERE dr.driver_user_id = d.id AND dr.deleted_at IS NULL) AS rating_avg,
              (SELECT count(*) FROM driver_ratings dr WHERE dr.driver_user_id = d.id AND dr.deleted_at IS NULL) AS rating_count
       FROM transport_routes r
       LEFT JOIN vehicles v ON v.id = r.vehicle_id AND v.deleted_at IS NULL
       LEFT JOIN users d ON d.id = v.driver_user_id
       LEFT JOIN users a ON a.id = v.attendant_user_id
       WHERE r.school_id = $1 AND r.id = ANY($2)`,
      [schoolId, routeIds],
    );
  }

  private async trips(schoolId: number, routeIds: number[]): Promise<TripRow[]> {
    if (!routeIds.length) return [];
    return this.dataSource.query(
      `SELECT DISTINCT ON (route_id, kind) route_id, kind, status, started_at, ended_at, delay_minutes
       FROM transport_trips
       WHERE school_id = $1 AND route_id = ANY($2) AND trip_date = $3::date AND replaced_by IS NULL
       ORDER BY route_id, kind, started_at DESC NULLS LAST, id DESC`,
      [schoolId, routeIds, this.scope.today()],
    );
  }
}
