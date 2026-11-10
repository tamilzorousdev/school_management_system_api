import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, AuthUser, paginate, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { addDays, holidaySet, WEEKLY_OFF, weekday } from '../../shared/school-days';
import { TelematicsClient } from '../fleet/telematics.client';
import { RouteStop } from '../transport/entities/route-stop.entity';
import { StudentTransport } from '../transport/entities/student-transport.entity';
import { TransportRoute } from '../transport/entities/transport-route.entity';
import { Vehicle } from '../transport/entities/vehicle.entity';
import { BoardingDto, ChildBoardingDto } from './dto/boarding.dto';
import {
  ChildBusDto,
  ChildBusTimelineDto,
  ChildBusV2Dto,
  DriverTodayDto,
  PhonePositionDto,
  RiderDto,
  TripDetailDto,
  TripDto,
  TripPositionDto,
  TripQueryDto,
  TripStopDto,
} from './dto/tracking.dto';
import { TransportTrip, TripKind, TripPosition, TripStop } from './entities/transport-trip.entity';
import { TripBoarding } from './entities/trip-boarding.entity';
import { TripEvent } from './entities/trip-event.entity';
import { boardingStatus, liveTimeline, nextScheduledTrip, plannedTimeline, zoneOffset } from './bus-timeline.logic';
import { childBusStatus, minutesFrom, orderStops, ridesOn } from './tracking.logic';

interface TelematicsStop {
  ref: string;
  status: TripStop['status'];
  eta_seconds: number | null;
  approached_at: string | null;
  arrived_at: string | null;
  departed_at: string | null;
}

interface TelematicsTrip {
  id: number;
  status: string;
  position: TripPosition | null;
  destination_eta_seconds: number | null;
  stops: TelematicsStop[];
}

const STALE_MS = 2 * 60 * 1000;

@Injectable()
export class TripsService {
  private readonly logger = new Logger('Trips');

  constructor(
    @InjectRepository(TransportTrip) private readonly trips: Repository<TransportTrip>,
    @InjectRepository(TripEvent) private readonly events: Repository<TripEvent>,
    @InjectRepository(TripBoarding) private readonly boardings: Repository<TripBoarding>,
    private readonly telematics: TelematicsClient,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async start(schoolId: number, dto: { route_id: number; kind: TripKind }, actor: AuthUser, vehicleId?: number) {
    const route = await this.dataSource
      .getRepository(TransportRoute)
      .findOneBy({ id: dto.route_id, school_id: schoolId });
    if (!route || !route.is_active) throw AppException.notFound('Route not found or not running', 'ROUTE_NOT_FOUND');
    if (vehicleId !== undefined && route.vehicle_id !== vehicleId) {
      throw AppException.forbidden('This route is not run by your bus', 'NOT_YOUR_ROUTE');
    }
    if (!route.vehicle_id) throw AppException.badRequest('Give this route a bus first', 'ROUTE_HAS_NO_BUS');
    const vehicle = await this.dataSource.getRepository(Vehicle).findOneByOrFail({ id: route.vehicle_id });
    if (!vehicle.device_id) {
      throw AppException.badRequest('Fit a GPS tracker to this bus in Buses and routes first', 'NO_TRACKER');
    }
    const stops = await this.dataSource.getRepository(RouteStop).find({ where: { route_id: route.id } });
    if (!stops.length) throw AppException.badRequest('Add stops to this route first', 'ROUTE_HAS_NO_STOPS');
    const [school] = await this.dataSource.query(
      `SELECT code, name, latitude, longitude, geofence_radius_m FROM schools WHERE id = $1`,
      [schoolId],
    );
    if (school?.latitude == null || school?.longitude == null) {
      throw AppException.badRequest('Set the school location in School setup first', 'SCHOOL_LOCATION_MISSING');
    }
    const running = await this.trips.findOneBy({ vehicle_id: vehicle.id, status: 'active' });
    if (running) {
      throw AppException.conflict(`${vehicle.registration_no} already has a trip running`, 'TRIP_ALREADY_ACTIVE');
    }

    const ordered = orderStops(stops, dto.kind);
    const trip = await this.trips.save(
      this.trips.create({
        school_id: schoolId,
        route_id: route.id,
        vehicle_id: vehicle.id,
        device_id: vehicle.device_id,
        kind: dto.kind,
        trip_date: todayIn(this.app.timeZone),
        status: 'active',
        started_by: actor.id,
        started_at: new Date(),
        stops: ordered.map((stop) => ({
          stop_id: stop.id,
          name: stop.name,
          sequence: stop.sequence,
          lat: stop.lat,
          lng: stop.lng,
          radius_m: stop.geofence_radius_m,
          planned_time: dto.kind === 'pickup' ? stop.pickup_time : stop.drop_time,
          status: 'pending' as const,
          eta_seconds: null,
          approached_at: null,
          arrived_at: null,
          departed_at: null,
        })),
      }),
    );
    try {
      const remote = await this.telematics.post<TelematicsTrip>('/trips', {
        ref: `${school.code}-${trip.id}`,
        device_id: vehicle.device_id,
        kind: dto.kind,
        approach_minutes: 5,
        approach_metres: 800,
        stops: ordered.map((stop, index) => ({
          ref: String(stop.id),
          name: stop.name,
          sequence: index + 1,
          lat: stop.lat,
          lng: stop.lng,
          radius_m: stop.geofence_radius_m,
          ...(trip.stops[index]!.planned_time ? { planned_time: trip.stops[index]!.planned_time } : {}),
        })),
        destination: {
          name: school.name,
          lat: Number(school.latitude),
          lng: Number(school.longitude),
          radius_m: Number(school.geofence_radius_m ?? 200),
        },
        started_by: actor.name,
      });
      await this.trips.update(trip.id, { telematics_trip_id: remote.id });
    } catch (error) {
      await this.trips.delete(trip.id);
      throw error;
    }
    return this.detail(schoolId, trip.id);
  }

  async end(schoolId: number, tripId: number, reason: 'driver' | 'admin', vehicleId?: number): Promise<TripDetailDto> {
    const trip = await this.find(schoolId, tripId);
    if (vehicleId !== undefined && trip.vehicle_id !== vehicleId) {
      throw AppException.forbidden('This trip is not on your bus', 'NOT_YOUR_TRIP');
    }
    if (trip.status === 'active' && trip.telematics_trip_id) {
      await this.telematics.post(`/trips/${trip.telematics_trip_id}/end`, { reason }).catch((error: Error) => {
        this.logger.warn(`Ending telematics trip ${trip.telematics_trip_id}: ${error.message}`);
      });
    }
    await this.markEnded(trip, reason, new Date());
    return this.detail(schoolId, tripId);
  }

  async markEnded(trip: TransportTrip, reason: string, at: Date): Promise<boolean> {
    const result = await this.trips.update(
      { id: trip.id, status: 'active' },
      { status: 'ended', ended_at: at, end_reason: reason },
    );
    return Boolean(result.affected);
  }

  async list(schoolId: number, query: TripQueryDto): Promise<Paginated<TripDto>> {
    const qb = this.trips.createQueryBuilder('t').where('t.school_id = :schoolId', { schoolId });
    if (query.date) qb.andWhere('t.trip_date = :date', { date: query.date });
    if (query.status) qb.andWhere('t.status = :status', { status: query.status });
    if (query.route_id) qb.andWhere('t.route_id = :route', { route: query.route_id });
    if (query.vehicle_id) qb.andWhere('t.vehicle_id = :vehicle', { vehicle: query.vehicle_id });
    const [rows, total] = await qb
      .orderBy('t.started_at', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return paginate([await this.present(rows), total], query.page, query.limit);
  }

  async detail(schoolId: number, tripId: number): Promise<TripDetailDto> {
    const trip = await this.refresh(await this.find(schoolId, tripId));
    const [summary] = await this.present([trip]);
    const [events, riders, school, boardings] = await Promise.all([
      this.events.find({ where: { trip_id: trip.id }, order: { occurred_at: 'ASC', id: 'ASC' } }),
      this.riders(trip),
      this.dataSource.query(`SELECT latitude, longitude FROM schools WHERE id = $1`, [schoolId]),
      this.boardingList(trip),
    ]);
    const stopNames = new Map(trip.stops.map((stop) => [stop.stop_id, stop.name]));
    return {
      ...summary!,
      stop_list: this.stopList(trip, riders),
      school:
        school[0]?.latitude != null ? { lat: Number(school[0].latitude), lng: Number(school[0].longitude) } : null,
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        stop: event.stop_id ? { id: event.stop_id, name: stopNames.get(event.stop_id) ?? '' } : null,
        eta_seconds: event.eta_seconds,
        occurred_at: event.occurred_at,
        notified: event.notified,
      })),
      riders,
      not_boarded: riders.filter((rider) => !rider.boarded && !rider.away_today),
      boardings,
    };
  }

  async driverToday(user: AuthUser): Promise<DriverTodayDto> {
    const vehicle = await this.crewVehicle(user);
    if (!vehicle) return { vehicle: null, has_tracker: false, active_trip: null, routes: [] };
    const today = todayIn(this.app.timeZone);
    const routes = await this.dataSource
      .getRepository(TransportRoute)
      .find({ where: { vehicle_id: vehicle.id, is_active: true }, order: { code: 'ASC' } });
    const trips = await this.trips.find({
      where: { vehicle_id: vehicle.id, trip_date: today },
      order: { started_at: 'ASC' },
    });
    const presented = await this.present(trips);
    const stats: { route_id: number; stops: string; students: string; first_pickup: string | null }[] = routes.length
      ? await this.dataSource.query(
          `SELECT r.id AS route_id,
                  (SELECT COUNT(*) FROM route_stops s WHERE s.route_id = r.id AND s.deleted_at IS NULL) AS stops,
                  (SELECT COUNT(*) FROM student_transport t WHERE t.route_id = r.id AND t.deleted_at IS NULL) AS students,
                  (SELECT MIN(s.pickup_time) FROM route_stops s WHERE s.route_id = r.id AND s.deleted_at IS NULL) AS first_pickup
           FROM transport_routes r WHERE r.id = ANY($1)`,
          [routes.map((route) => route.id)],
        )
      : [];
    return {
      vehicle: {
        id: vehicle.id,
        registration_no: vehicle.registration_no,
        name: vehicle.name,
        device_id: vehicle.device_id,
      },
      has_tracker: Boolean(vehicle.device_id),
      active_trip: presented.find((trip) => trip.status === 'active') ?? null,
      routes: routes.map((route) => {
        const stat = stats.find((row) => Number(row.route_id) === route.id);
        return {
          route: { id: route.id, name: route.name },
          code: route.code,
          stops: Number(stat?.stops ?? 0),
          students: Number(stat?.students ?? 0),
          first_pickup: stat?.first_pickup ?? null,
          trips: presented.filter((trip) => trip.route.id === route.id),
        };
      }),
    };
  }

  async crewVehicle(user: AuthUser): Promise<Vehicle | null> {
    if (!user.school_id) return null;
    return this.dataSource.getRepository(Vehicle).findOne({
      where: [
        { school_id: user.school_id, driver_user_id: user.id, status: 'active' },
        { school_id: user.school_id, attendant_user_id: user.id, status: 'active' },
      ],
    });
  }

  async phonePosition(schoolId: number, tripId: number, dto: PhonePositionDto, vehicleId: number): Promise<void> {
    const trip = await this.find(schoolId, tripId);
    if (trip.vehicle_id !== vehicleId) throw AppException.forbidden('This trip is not on your bus', 'NOT_YOUR_TRIP');
    if (trip.status !== 'active') throw AppException.conflict('This trip has ended', 'TRIP_ENDED');
    const at = dto.recorded_at ? new Date(dto.recorded_at) : new Date();
    if (Number.isNaN(at.getTime())) {
      throw AppException.validation([{ field: 'recorded_at', message: 'recorded_at must be a date and time' }]);
    }
    await this.telematics.post(`/devices/${trip.device_id}/positions`, {
      ts: Math.floor(at.getTime() / 1000),
      lat: dto.lat,
      lng: dto.lng,
      ...(dto.speed !== undefined ? { spd: dto.speed } : {}),
      ...(dto.heading !== undefined ? { hdg: dto.heading } : {}),
      ign: 1,
    });
  }

  async childBus(schoolId: number, studentId: number): Promise<ChildBusDto | null> {
    return (await this.childBusState(schoolId, studentId))?.bus ?? null;
  }

  async childBusWithTimeline(schoolId: number, studentId: number): Promise<ChildBusV2Dto | null> {
    const state = await this.childBusState(schoolId, studentId);
    if (!state) return null;
    const { bus, trip, assignment } = state;
    const now = new Date();
    const offset = zoneOffset(this.app.timeZone, now);
    const timeline =
      trip?.status === 'active'
        ? {
            source: 'live' as const,
            trip_id: trip.id,
            kind: trip.kind,
            trip_date: trip.trip_date,
            child_stop_id: assignment.stop_id,
            stops: liveTimeline(trip.stops, {
              childStopId: assignment.stop_id,
              tripDate: trip.trip_date,
              offset,
              positionAt: trip.last_position ? new Date(trip.last_position.recorded_at) : null,
              now,
            }),
          }
        : await this.scheduledTimeline(schoolId, assignment, offset, now);
    return {
      ...bus,
      boarding_status: boardingStatus(bus.boarding?.action),
      last_position_at: bus.position ? String(bus.position.recorded_at) : null,
      timeline,
    };
  }

  private async scheduledTimeline(
    schoolId: number,
    assignment: StudentTransport,
    offset: string,
    now: Date,
  ): Promise<ChildBusTimelineDto | null> {
    const today = todayIn(this.app.timeZone, now);
    const [stops, ran, holidays] = await Promise.all([
      this.dataSource.getRepository(RouteStop).find({ where: { route_id: assignment.route_id } }),
      this.trips.find({ where: { route_id: assignment.route_id, trip_date: today }, select: { kind: true } }),
      holidaySet(this.dataSource.manager, schoolId, today, addDays(today, 14)),
    ]);
    if (!stops.length) return null;
    const latest = (times: (string | null)[]) =>
      times
        .filter((time): time is string => Boolean(time))
        .sort()
        .pop() ?? null;
    const next = nextScheduledTrip({
      mode: assignment.mode,
      today,
      nowTime: new Intl.DateTimeFormat('en-GB', {
        timeZone: this.app.timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(now),
      ranToday: ran.map((trip) => trip.kind),
      lastPlanned: {
        pickup: latest(stops.map((stop) => stop.pickup_time)),
        drop: latest(stops.map((stop) => stop.drop_time)),
      },
      isDayOff: (date) => WEEKLY_OFF.includes(weekday(date)) || holidays.has(date),
    });
    if (!next) return null;
    return {
      source: 'scheduled',
      trip_id: null,
      kind: next.kind,
      trip_date: next.trip_date,
      child_stop_id: assignment.stop_id,
      stops: plannedTimeline(stops, {
        kind: next.kind,
        childStopId: assignment.stop_id,
        tripDate: next.trip_date,
        offset,
      }),
    };
  }

  private async childBusState(
    schoolId: number,
    studentId: number,
  ): Promise<{ bus: ChildBusDto; trip: TransportTrip | null; assignment: StudentTransport } | null> {
    const assignment = await this.dataSource
      .getRepository(StudentTransport)
      .findOneBy({ school_id: schoolId, student_id: studentId });
    if (!assignment) return null;
    const route = await this.dataSource.getRepository(TransportRoute).findOneByOrFail({ id: assignment.route_id });
    const vehicle = route.vehicle_id
      ? await this.dataSource.getRepository(Vehicle).findOneBy({ id: route.vehicle_id })
      : null;
    const today = todayIn(this.app.timeZone);
    const candidates = await this.trips.find({
      where: { route_id: route.id, trip_date: today },
      order: { started_at: 'DESC' },
    });
    const own = candidates.filter((trip) => ridesOn(assignment.mode, trip.kind));
    let trip = own.find((item) => item.status === 'active') ?? own[0] ?? null;
    if (trip?.status === 'active') trip = await this.refresh(trip);
    const [summary] = trip ? await this.present([trip]) : [null];
    const stopState = trip?.stops.find((stop) => stop.stop_id === assignment.stop_id) ?? null;
    const stopRow = await this.dataSource.getRepository(RouteStop).findOneBy({ id: assignment.stop_id });
    const stop: TripStopDto | null = stopState
      ? { ...stopState, riders: 0 }
      : stopRow
        ? {
            stop_id: stopRow.id,
            name: stopRow.name,
            sequence: stopRow.sequence,
            lat: stopRow.lat,
            lng: stopRow.lng,
            radius_m: stopRow.geofence_radius_m,
            planned_time: stopRow.pickup_time,
            status: 'pending',
            eta_seconds: null,
            approached_at: null,
            arrived_at: null,
            departed_at: null,
            riders: 0,
          }
        : null;
    let position: TripPositionDto | null = trip?.last_position ?? null;
    if (!position && vehicle?.device_id) position = await this.lastKnown(vehicle.device_id);
    const status = childBusStatus(trip, assignment.stop_id);
    const boarding = trip ? await this.childBoarding(trip, studentId) : null;
    const eta = status === 'on_the_way' || status === 'approaching' ? (stopState?.eta_seconds ?? null) : null;
    const bus: ChildBusDto = {
      status,
      headline: this.headline(status, eta, stop?.name ?? ''),
      route: { id: route.id, name: route.name },
      stop,
      vehicle: vehicle
        ? { id: vehicle.id, registration_no: vehicle.registration_no, name: vehicle.name, device_id: vehicle.device_id }
        : null,
      trip: summary ?? null,
      eta_seconds: eta,
      position,
      position_stale: position ? Date.now() - new Date(position.recorded_at).getTime() > STALE_MS : true,
      boarding,
    };
    return { bus, trip, assignment };
  }

  async riders(trip: TransportTrip): Promise<RiderDto[]> {
    const rows: {
      student_id: number;
      first_name: string;
      last_name: string | null;
      class_name: string | null;
      section_name: string | null;
      stop_id: number;
      mode: RiderDto['mode'];
      passenger_ref: string;
    }[] = await this.dataSource.query(
      `SELECT t.student_id, s.first_name, s.last_name, c.name AS class_name, sec.name AS section_name,
              t.stop_id, t.mode, t.passenger_ref
       FROM student_transport t
       JOIN students s ON s.id = t.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       LEFT JOIN student_enrollments e ON e.student_id = s.id
         AND e.academic_year_id = (SELECT id FROM academic_years y WHERE y.school_id = s.school_id AND y.is_current LIMIT 1)
       LEFT JOIN sections sec ON sec.id = e.section_id
       LEFT JOIN classes c ON c.id = e.class_id
       WHERE t.route_id = $1 AND t.deleted_at IS NULL AND (t.mode = 'both' OR t.mode = $2)
       ORDER BY s.first_name`,
      [trip.route_id, trip.kind],
    );
    if (!rows.length) return [];
    const ids = rows.map((row) => Number(row.student_id));
    const [recorded, away] = await Promise.all([
      this.boardings.find({ where: { trip_id: trip.id, student_id: In(ids) } }),
      this.dataSource.query(
        `SELECT student_id FROM student_leave_requests
           WHERE student_id = ANY($1) AND status = 'approved' AND deleted_at IS NULL AND from_date <= $2 AND to_date >= $2
         UNION
         SELECT student_id FROM student_attendance_days
           WHERE student_id = ANY($1) AND date = $2 AND status IN ('absent', 'leave')`,
        [ids, trip.trip_date],
      ) as Promise<{ student_id: number }[]>,
    ]);
    const boardedIds = new Set(recorded.filter((row) => row.action === 'boarded').map((row) => row.student_id));
    const alightedIds = new Set(recorded.filter((row) => row.action === 'alighted').map((row) => row.student_id));
    const awayIds = new Set(away.map((row) => Number(row.student_id)));
    const order = new Map(trip.stops.map((stop, index) => [stop.stop_id, index]));
    return rows
      .map((row) => ({
        student_id: Number(row.student_id),
        full_name: [row.first_name, row.last_name].filter(Boolean).join(' '),
        class_section: row.class_name ? [row.class_name, row.section_name].filter(Boolean).join(' - ') : null,
        stop_id: Number(row.stop_id),
        mode: row.mode,
        passenger_ref: row.passenger_ref,
        boarded: boardedIds.has(Number(row.student_id)),
        alighted: alightedIds.has(Number(row.student_id)),
        away_today: awayIds.has(Number(row.student_id)),
      }))
      .sort(
        (a, b) => (order.get(a.stop_id) ?? 99) - (order.get(b.stop_id) ?? 99) || a.full_name.localeCompare(b.full_name),
      );
  }

  async boardingList(trip: TransportTrip): Promise<BoardingDto[]> {
    const rows = await this.boardings.find({ where: { trip_id: trip.id }, order: { occurred_at: 'DESC', id: 'DESC' } });
    return this.presentBoardings(trip, rows);
  }

  async presentBoardings(trip: TransportTrip, rows: TripBoarding[]): Promise<BoardingDto[]> {
    if (!rows.length) return [];
    const [students, people] = await Promise.all([
      this.dataSource.query(
        `SELECT s.id, s.first_name, s.last_name, c.name AS class_name, sec.name AS section_name
         FROM students s
         LEFT JOIN student_enrollments e ON e.student_id = s.id
           AND e.academic_year_id = (SELECT id FROM academic_years y WHERE y.school_id = s.school_id AND y.is_current LIMIT 1)
         LEFT JOIN sections sec ON sec.id = e.section_id
         LEFT JOIN classes c ON c.id = e.class_id
         WHERE s.id = ANY($1)`,
        [[...new Set(rows.map((row) => row.student_id))]],
      ) as Promise<
        {
          id: number;
          first_name: string;
          last_name: string | null;
          class_name: string | null;
          section_name: string | null;
        }[]
      >,
      this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [
        [...new Set(rows.map((row) => row.recorded_by).filter(Boolean))],
      ]) as Promise<{ id: number; name: string }[]>,
    ]);
    const stopNames = new Map(trip.stops.map((stop) => [stop.stop_id, stop.name]));
    return rows.map((row) => {
      const student = students.find((item) => Number(item.id) === row.student_id);
      const person = people.find((item) => Number(item.id) === row.recorded_by);
      return {
        id: row.id,
        trip_id: row.trip_id,
        student_id: row.student_id,
        full_name: student ? [student.first_name, student.last_name].filter(Boolean).join(' ') : '',
        class_section: student?.class_name
          ? [student.class_name, student.section_name].filter(Boolean).join(' - ')
          : null,
        action: row.action,
        method: row.method,
        stop: row.stop_id ? { id: row.stop_id, name: stopNames.get(row.stop_id) ?? '' } : null,
        recorded_by: person ? { id: Number(person.id), name: person.name } : null,
        occurred_at: row.occurred_at,
      };
    });
  }

  private async childBoarding(trip: TransportTrip, studentId: number): Promise<ChildBoardingDto | null> {
    const row = await this.boardings.findOne({
      where: { trip_id: trip.id, student_id: studentId },
      order: { occurred_at: 'DESC', id: 'DESC' },
    });
    if (!row) return null;
    const stop = row.stop_id ? trip.stops.find((item) => item.stop_id === row.stop_id) : null;
    return {
      action: row.action,
      method: row.method,
      stop: stop ? { id: stop.stop_id, name: stop.name } : null,
      occurred_at: row.occurred_at,
    };
  }

  async find(schoolId: number, tripId: number): Promise<TransportTrip> {
    const trip = await this.trips.findOneBy({ id: tripId, school_id: schoolId });
    if (!trip) throw AppException.notFound('Trip not found', 'TRIP_NOT_FOUND');
    return trip;
  }

  async present(rows: TransportTrip[]): Promise<TripDto[]> {
    if (!rows.length) return [];
    const [routes, vehicles, people] = await Promise.all([
      this.dataSource.getRepository(TransportRoute).findBy({ id: In([...new Set(rows.map((row) => row.route_id))]) }),
      this.dataSource.getRepository(Vehicle).findBy({ id: In([...new Set(rows.map((row) => row.vehicle_id))]) }),
      this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [
        [...new Set(rows.map((row) => row.started_by).filter(Boolean))],
      ]) as Promise<{ id: number; name: string }[]>,
    ]);
    return rows.map((row) => {
      const route = routes.find((item) => item.id === row.route_id);
      const vehicle = vehicles.find((item) => item.id === row.vehicle_id);
      const person = people.find((item) => Number(item.id) === row.started_by);
      return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        trip_date: row.trip_date,
        route: { id: row.route_id, name: route?.name ?? '' },
        vehicle: {
          id: row.vehicle_id,
          registration_no: vehicle?.registration_no ?? '',
          name: vehicle?.name ?? '',
          device_id: row.device_id,
        },
        started_by: person ? { id: Number(person.id), name: person.name } : null,
        started_at: row.started_at,
        ended_at: row.ended_at,
        end_reason: row.end_reason,
        position: row.last_position,
        destination_eta_seconds: row.status === 'active' ? row.destination_eta_seconds : null,
        stops_done: row.stops.filter((stop) => stop.status === 'departed' || stop.status === 'skipped').length,
        stops_total: row.stops.length,
      };
    });
  }

  private stopList(trip: TransportTrip, riders: RiderDto[]): TripStopDto[] {
    return trip.stops.map((stop) => ({
      ...stop,
      riders: riders.filter((rider) => rider.stop_id === stop.stop_id).length,
    }));
  }

  private async refresh(trip: TransportTrip): Promise<TransportTrip> {
    if (trip.status !== 'active' || !trip.telematics_trip_id) return trip;
    const remote = await this.telematics.get<TelematicsTrip>(`/trips/${trip.telematics_trip_id}`).catch(() => null);
    if (!remote) return trip;
    const byRef = new Map(remote.stops.map((stop) => [Number(stop.ref), stop]));
    const stops = trip.stops.map((stop) => {
      const live = byRef.get(stop.stop_id);
      return live
        ? {
            ...stop,
            status: live.status,
            eta_seconds: live.eta_seconds,
            approached_at: live.approached_at ?? stop.approached_at,
            arrived_at: live.arrived_at ?? stop.arrived_at,
            departed_at: live.departed_at ?? stop.departed_at,
          }
        : stop;
    });
    const changes = {
      stops,
      last_position: remote.position ?? trip.last_position,
      destination_eta_seconds: remote.destination_eta_seconds,
    };
    await this.trips.update(trip.id, changes);
    return Object.assign(trip, changes);
  }

  private async lastKnown(deviceId: number): Promise<TripPositionDto | null> {
    const status = await this.telematics
      .get<{
        position: {
          lat: number;
          lng: number;
          speed: number | null;
          heading: number | null;
          recorded_at: string;
        } | null;
      }>(`/devices/${deviceId}/status`)
      .catch(() => null);
    const position = status?.position;
    return position ? { ...position, source: 'device' } : null;
  }

  private headline(status: ReturnType<typeof childBusStatus>, eta: number | null, stop: string): string {
    switch (status) {
      case 'approaching':
        return `Bus is ${minutesFrom(eta)} min away from ${stop}`;
      case 'at_stop':
        return `Bus is at ${stop}`;
      case 'passed':
        return `Bus has left ${stop}`;
      case 'trip_ended':
        return 'Today’s trip has ended';
      case 'on_the_way':
        return eta ? `Bus is on the way, about ${minutesFrom(eta)} min to ${stop}` : 'Bus is on the way';
      default:
        return 'The bus has not started yet';
    }
  }
}
