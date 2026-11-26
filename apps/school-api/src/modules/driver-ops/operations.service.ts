import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { awayLookup } from '../../shared/student-away';
import { TransportTrip, TripKind } from '../tracking/entities/transport-trip.entity';
import { vehicleOnDay } from '../transport/bus-swaps';
import { TransportRoute } from '../transport/entities/transport-route.entity';
import { Vehicle } from '../transport/entities/vehicle.entity';
import { BoardExceptionDto, BoardTripDto, BusAttendanceRowDto, OperationsBoardDto } from './dto/driver-ops.dto';
import { clockOf, minutesOf } from './driver-ops.logic';
import { DriverDuty } from './entities/driver-ops.entity';

const LATE_START_GRACE_MINUTES = 10;

interface RiderRow {
  student_id: number;
  route_id: number;
  mode: string;
  stop_id: number | null;
  drop_stop_id: number | null;
  full_name: string;
  class_section: string | null;
  pass_status: 'active' | 'on_hold';
}

@Injectable()
export class OperationsService {
  constructor(
    @InjectRepository(TransportTrip) private readonly trips: Repository<TransportTrip>,
    @InjectRepository(DriverDuty) private readonly duties: Repository<DriverDuty>,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async board(schoolId: number, date?: string): Promise<OperationsBoardDto> {
    const day = date ?? todayIn(this.app.timeZone);
    const isToday = day === todayIn(this.app.timeZone);
    const nowMinutes = minutesOf(this.clock(new Date())) ?? 0;
    const routes = await this.dataSource
      .getRepository(TransportRoute)
      .find({ where: { school_id: schoolId, is_active: true }, order: { code: 'ASC' } });
    const routeIds = routes.map((route) => route.id);
    const [stopTimes, riders, trips] = await Promise.all([
      routeIds.length
        ? (this.dataSource.query(
            `SELECT route_id, MIN(substring(pickup_time from 1 for 5)) AS first_pickup,
                    MIN(substring(drop_time from 1 for 5)) AS first_drop
             FROM route_stops WHERE route_id = ANY($1) AND deleted_at IS NULL GROUP BY route_id`,
            [routeIds],
          ) as Promise<{ route_id: number; first_pickup: string | null; first_drop: string | null }[]>)
        : Promise.resolve([]),
      this.riders(schoolId, routeIds),
      this.trips.find({ where: { school_id: schoolId, trip_date: day }, order: { started_at: 'DESC' } }),
    ]);
    const vehicleByRoute = new Map<number, number | null>();
    for (const route of routes) vehicleByRoute.set(route.id, await vehicleOnDay(this.dataSource, route, day));
    const vehicleIds = [
      ...new Set(
        [...vehicleByRoute.values(), ...trips.map((trip) => trip.vehicle_id)].filter((id): id is number => Boolean(id)),
      ),
    ];
    const vehicles = vehicleIds.length
      ? await this.dataSource.getRepository(Vehicle).findBy({ id: In(vehicleIds) })
      : [];
    const away = await awayLookup(
      this.dataSource,
      riders.map((rider) => rider.student_id),
      [day],
    );
    const boardings: { trip_id: number; student_id: number; action: string; pass_on_hold: boolean }[] = trips.length
      ? await this.dataSource.query(
          `SELECT trip_id, student_id, action, pass_on_hold FROM transport_boardings WHERE trip_id = ANY($1)`,
          [trips.map((trip) => trip.id)],
        )
      : [];
    const people = await this.people(vehicles.map((vehicle) => vehicle.driver_user_id));

    const rows: BoardTripDto[] = [];
    for (const route of routes) {
      const times = stopTimes.find((row) => Number(row.route_id) === route.id);
      for (const kind of ['pickup', 'drop'] as TripKind[]) {
        const routeRiders = riders.filter(
          (rider) => rider.route_id === route.id && (rider.mode === 'both' || rider.mode === kind),
        );
        const trip = trips.find((item) => item.route_id === route.id && item.kind === kind) ?? null;
        if (!routeRiders.length && !trip) continue;
        const vehicleId = trip?.vehicle_id ?? vehicleByRoute.get(route.id) ?? null;
        const vehicle = vehicles.find((item) => item.id === vehicleId) ?? null;
        const planned = kind === 'pickup' ? (times?.first_pickup ?? null) : (times?.first_drop ?? null);
        const awayCount = routeRiders.filter((rider) => away(rider.student_id, day, kind)).length;
        const boarded = trip
          ? new Set(
              boardings
                .filter((row) => Number(row.trip_id) === trip.id && row.action === 'boarded')
                .map((row) => Number(row.student_id)),
            ).size
          : 0;
        const tripMarks = trip ? boardings.filter((row) => Number(row.trip_id) === trip.id) : [];
        const boardedIds = new Set(
          tripMarks.filter((row) => row.action === 'boarded').map((row) => Number(row.student_id)),
        );
        const notAtStop = new Set(
          tripMarks
            .filter((row) => row.action === 'missed' && !boardedIds.has(Number(row.student_id)))
            .map((row) => Number(row.student_id)),
        ).size;
        const boardedOnHold = tripMarks.filter((row) => row.action === 'boarded' && row.pass_on_hold).length;
        const plannedMinutes = minutesOf(planned);
        const status = !trip
          ? isToday && plannedMinutes !== null && nowMinutes > plannedMinutes + LATE_START_GRACE_MINUTES
            ? 'late_start'
            : 'not_started'
          : trip.status === 'ended'
            ? 'completed'
            : trip.delay_minutes
              ? 'delayed'
              : 'running';
        const current = trip?.stops.find((stop) => stop.status === 'arrived' || stop.status === 'approaching');
        rows.push({
          route: { id: route.id, name: route.name },
          route_code: route.code,
          kind,
          vehicle: vehicle ? { id: vehicle.id, name: `${vehicle.name} (${vehicle.registration_no})` } : null,
          driver: vehicle?.driver_user_id
            ? { id: vehicle.driver_user_id, name: people.get(vehicle.driver_user_id) ?? '' }
            : null,
          planned_start: planned,
          status,
          trip_id: trip?.id ?? null,
          tracking: trip?.tracking ?? null,
          started_at: trip?.started_at ?? null,
          ended_at: trip?.ended_at ?? null,
          stops_done: trip
            ? trip.stops.filter((stop) => stop.status === 'departed' || stop.status === 'skipped').length
            : 0,
          stops_total: trip ? trip.stops.length : 0,
          current_stop: current?.name ?? null,
          expected: routeRiders.length - awayCount,
          boarded,
          away: awayCount,
          not_at_stop: notAtStop,
          boarded_on_hold: boardedOnHold,
          delay_minutes: trip?.delay_minutes ?? null,
          position: trip?.last_position
            ? { lat: trip.last_position.lat, lng: trip.last_position.lng, recorded_at: trip.last_position.recorded_at }
            : null,
          swept_at: trip?.swept_at ?? null,
        });
      }
    }
    rows.sort(
      (a, b) =>
        (a.planned_start ?? '99:99').localeCompare(b.planned_start ?? '99:99') ||
        a.route_code.localeCompare(b.route_code),
    );

    const duties = await this.duties.find({ where: { school_id: schoolId, duty_date: day } });
    const exceptions = await this.exceptions(schoolId, isToday, nowMinutes, rows, vehicles, duties, people);
    const runningVehicles = vehicles.filter((vehicle) => vehicle.driver_user_id);
    return {
      date: day,
      summary: {
        total: rows.length,
        not_started: rows.filter((row) => row.status === 'not_started' || row.status === 'late_start').length,
        running: rows.filter((row) => row.status === 'running').length,
        delayed: rows.filter((row) => row.status === 'delayed').length,
        completed: rows.filter((row) => row.status === 'completed').length,
      },
      drivers: {
        checked_in: duties.length,
        total: new Set(runningVehicles.map((vehicle) => vehicle.driver_user_id)).size,
        late: duties.filter((duty) => duty.late_minutes > 0).length,
      },
      trips: rows,
      exceptions,
    };
  }

  async busAttendance(schoolId: number, date?: string, routeId?: number): Promise<BusAttendanceRowDto[]> {
    const day = date ?? todayIn(this.app.timeZone);
    const routes = await this.dataSource
      .getRepository(TransportRoute)
      .find({ where: { school_id: schoolId, ...(routeId ? { id: routeId } : {}) } });
    if (!routes.length) return [];
    const riders = await this.riders(
      schoolId,
      routes.map((route) => route.id),
    );
    if (!riders.length) return [];
    const ids = riders.map((rider) => rider.student_id);
    const [trips, stops, classDays, away] = await Promise.all([
      this.trips.find({
        where: { school_id: schoolId, trip_date: day, route_id: In(routes.map((route) => route.id)) },
      }),
      this.dataSource.query(`SELECT id, name FROM route_stops WHERE route_id = ANY($1)`, [
        routes.map((route) => route.id),
      ]) as Promise<{ id: number; name: string }[]>,
      this.dataSource.query(
        `SELECT student_id, morning FROM student_attendance_days WHERE student_id = ANY($1) AND date = $2`,
        [ids, day],
      ) as Promise<{ student_id: number; morning: string | null }[]>,
      awayLookup(this.dataSource, ids, [day]),
    ]);
    const boardings: {
      trip_id: number;
      student_id: number;
      action: string;
      occurred_at: Date;
      handed_to: string | null;
      pass_on_hold: boolean;
    }[] = trips.length
      ? await this.dataSource.query(
          `SELECT trip_id, student_id, action, occurred_at, handed_to, pass_on_hold FROM transport_boardings
             WHERE trip_id = ANY($1) AND student_id = ANY($2)`,
          [trips.map((trip) => trip.id), ids],
        )
      : [];
    const stopName = new Map(stops.map((row) => [Number(row.id), row.name]));
    return riders
      .map((rider) => {
        const route = routes.find((item) => item.id === rider.route_id)!;
        const tripOf = (kind: TripKind) =>
          rider.mode === 'both' || rider.mode === kind
            ? (trips.find((trip) => trip.route_id === rider.route_id && trip.kind === kind) ?? null)
            : null;
        const mark = (kind: TripKind, action: string) => {
          const trip = tripOf(kind);
          return trip
            ? boardings.find(
                (row) =>
                  Number(row.trip_id) === trip.id &&
                  Number(row.student_id) === rider.student_id &&
                  row.action === action,
              )
            : undefined;
        };
        const status = (kind: TripKind) => {
          const rides = rider.mode === 'both' || rider.mode === kind;
          if (!rides) return 'not_riding';
          const awayNote = away(rider.student_id, day, kind);
          if (awayNote) return 'away';
          const trip = tripOf(kind);
          if (!trip) return 'no_trip';
          if (kind === 'drop' && mark('drop', 'alighted')) return 'dropped';
          if (mark(kind, 'boarded')) return kind === 'drop' ? 'on_bus' : 'boarded';
          if (mark(kind, 'missed')) return 'not_at_stop';
          return trip.status === 'ended' ? 'not_boarded' : 'waiting';
        };
        const pickup = status('pickup');
        const drop = status('drop');
        const classMark = classDays.find((row) => Number(row.student_id) === rider.student_id)?.morning ?? null;
        const mismatch =
          (pickup === 'boarded' && (classMark === 'absent' || classMark === 'leave')) ||
          ((pickup === 'not_boarded' || pickup === 'not_at_stop') && classMark === 'present');
        const awayNote = away(rider.student_id, day, 'pickup') ?? away(rider.student_id, day, 'drop');
        return {
          student_id: rider.student_id,
          full_name: rider.full_name,
          class_section: rider.class_section,
          route: { id: route.id, name: route.name },
          stop: rider.stop_id ? (stopName.get(rider.stop_id) ?? null) : null,
          pickup,
          pickup_at: mark('pickup', 'boarded')?.occurred_at ?? null,
          drop,
          drop_at: mark('drop', 'alighted')?.occurred_at ?? null,
          handed_to: mark('drop', 'alighted')?.handed_to ?? null,
          away_note: awayNote?.note ?? null,
          class_attendance: classMark,
          mismatch,
          pass_on_hold: rider.pass_status === 'on_hold',
          boarded_on_hold: Boolean(mark('pickup', 'boarded')?.pass_on_hold || mark('drop', 'boarded')?.pass_on_hold),
        };
      })
      .sort((a, b) => a.route.name.localeCompare(b.route.name) || a.full_name.localeCompare(b.full_name));
  }

  private async exceptions(
    schoolId: number,
    isToday: boolean,
    nowMinutes: number,
    rows: BoardTripDto[],
    vehicles: Vehicle[],
    duties: DriverDuty[],
    people: Map<number, string>,
  ): Promise<BoardExceptionDto[]> {
    const list: BoardExceptionDto[] = [];
    const label = (row: BoardTripDto) =>
      `${row.route_code} ${row.route.name} ${row.kind === 'pickup' ? 'pickup' : 'drop'}`;
    for (const row of rows) {
      if (row.status === 'late_start') {
        list.push({
          kind: 'late_start',
          message: `${label(row)} has not started (planned ${row.planned_start})`,
          trip_id: null,
          vehicle_id: row.vehicle?.id ?? null,
          incident_id: null,
        });
      }
      if (row.status === 'delayed') {
        list.push({
          kind: 'delayed',
          message: `${label(row)} is running ${row.delay_minutes} min late`,
          trip_id: row.trip_id,
          vehicle_id: row.vehicle?.id ?? null,
          incident_id: null,
        });
      }
      if (row.boarded_on_hold > 0) {
        list.push({
          kind: 'boarded_on_hold',
          message: `${label(row)}: ${row.boarded_on_hold} student(s) boarded with the bus pass on hold`,
          trip_id: row.trip_id,
          vehicle_id: row.vehicle?.id ?? null,
          incident_id: null,
        });
      }
      if (row.status === 'completed' && !row.swept_at) {
        list.push({
          kind: 'no_sweep',
          message: `${label(row)} ended without the empty-bus check`,
          trip_id: row.trip_id,
          vehicle_id: row.vehicle?.id ?? null,
          incident_id: null,
        });
      }
      if (row.status === 'completed' && row.kind === 'pickup' && row.boarded < row.expected) {
        list.push({
          kind: 'not_boarded',
          message: `${label(row)}: ${row.expected - row.boarded} student(s) did not board`,
          trip_id: row.trip_id,
          vehicle_id: row.vehicle?.id ?? null,
          incident_id: null,
        });
      }
    }
    for (const duty of duties.filter((item) => item.attendant_present === false)) {
      const vehicle = vehicles.find((item) => item.id === duty.vehicle_id);
      list.push({
        kind: 'attendant_absent',
        message: `${vehicle ? `${vehicle.name} (${vehicle.registration_no})` : 'A bus'} runs without its attendant today`,
        trip_id: null,
        vehicle_id: duty.vehicle_id,
        incident_id: null,
      });
    }
    if (isToday) {
      const checkedIn = new Set(duties.map((duty) => duty.user_id));
      for (const vehicle of vehicles) {
        if (!vehicle.driver_user_id || checkedIn.has(vehicle.driver_user_id)) continue;
        const first = rows
          .filter((row) => row.vehicle?.id === vehicle.id && row.planned_start)
          .map((row) => minutesOf(row.planned_start)!)
          .sort((a, b) => a - b)[0];
        if (first === undefined || nowMinutes < first - 15) continue;
        list.push({
          kind: 'driver_not_checked_in',
          message: `${people.get(vehicle.driver_user_id) ?? 'The driver'} of ${vehicle.name} has not checked in (first stop ${clockOf(first)})`,
          trip_id: null,
          vehicle_id: vehicle.id,
          incident_id: null,
        });
      }
    }
    const [incidents, sos] = await Promise.all([
      this.dataSource.query(
        `SELECT i.id, i.type, i.vehicle_id, v.name AS bus FROM transport_incidents i
         LEFT JOIN vehicles v ON v.id = i.vehicle_id
         WHERE i.school_id = $1 AND i.status = 'open' AND i.deleted_at IS NULL ORDER BY i.occurred_at DESC LIMIT 20`,
        [schoolId],
      ) as Promise<{ id: number; type: string; vehicle_id: number | null; bus: string | null }[]>,
      this.dataSource.query(
        `SELECT a.id, a.trip_id, a.vehicle_id, v.name AS bus FROM fleet_alerts a
         LEFT JOIN vehicles v ON v.id = a.vehicle_id
         WHERE a.school_id = $1 AND a.kind = 'sos' AND a.status IN ('open', 'acknowledged') AND a.deleted_at IS NULL`,
        [schoolId],
      ) as Promise<{ id: number; trip_id: number | null; vehicle_id: number | null; bus: string | null }[]>,
    ]);
    for (const alert of sos) {
      list.unshift({
        kind: 'sos',
        message: `SOS from ${alert.bus ?? 'a bus'}`,
        trip_id: alert.trip_id,
        vehicle_id: alert.vehicle_id,
        incident_id: null,
      });
    }
    for (const incident of incidents) {
      list.push({
        kind: 'open_incident',
        message: `Open ${incident.type} on ${incident.bus ?? 'a bus'}`,
        trip_id: null,
        vehicle_id: incident.vehicle_id,
        incident_id: Number(incident.id),
      });
    }
    return list;
  }

  private async riders(schoolId: number, routeIds: number[]): Promise<RiderRow[]> {
    if (!routeIds.length) return [];
    const rows: RiderRow[] = await this.dataSource.query(
      `SELECT t.student_id, t.route_id, t.mode, t.stop_id, t.drop_stop_id, t.pass_status,
              concat_ws(' ', s.first_name, s.last_name) AS full_name,
              (SELECT concat_ws(' - ', c.name, sec.name) FROM student_enrollments e
                 JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current
                 JOIN classes c ON c.id = e.class_id JOIN sections sec ON sec.id = e.section_id
                WHERE e.student_id = s.id LIMIT 1) AS class_section
       FROM student_transport t
       JOIN students s ON s.id = t.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       WHERE t.school_id = $1 AND t.route_id = ANY($2) AND t.deleted_at IS NULL`,
      [schoolId, routeIds],
    );
    return rows.map((row) => ({
      ...row,
      student_id: Number(row.student_id),
      route_id: Number(row.route_id),
      stop_id: row.stop_id === null ? null : Number(row.stop_id),
      drop_stop_id: row.drop_stop_id === null ? null : Number(row.drop_stop_id),
    }));
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
