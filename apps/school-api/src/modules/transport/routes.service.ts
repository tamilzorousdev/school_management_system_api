import { randomBytes } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, MoreThanOrEqual, Repository } from 'typeorm';
import { AppException, applySearch, applySort, AuthUser, paginate, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { addDays, distanceMetres } from '../../shared/school-days';
import { AwayLookup, awayLookup } from '../../shared/student-away';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import {
  AssignResultDto,
  AssignStopStudentsDto,
  AssignTransportDto,
  DriverDutyDto,
  DriverStopStudentDto,
  DriverStudentDto,
  DriverStudentQueryDto,
  GuardianContactDto,
  ParentTransportDto,
  PassInputDto,
  RosterStudentDto,
  RouteChangeDto,
  RouteDetailDto,
  BusSwapDto,
  BusSwapInputDto,
  RouteDto,
  RouteInputDto,
  RouteInsightsDto,
  RouteQueryDto,
  RouteRosterDto,
  RouteTimingsDto,
  StopDto,
  StopsInputDto,
  StudentTransportDto,
  StudentTransportQueryDto,
  TransportChangeDto,
  UpdateRouteDto,
} from './dto/transport.dto';
import { routeIdsRunBy, vehicleOnDay } from './bus-swaps';
import { RouteBusSwap } from './entities/route-bus-swap.entity';
import { RouteChange, RouteChangeKind } from './entities/route-change.entity';
import { RouteStop } from './entities/route-stop.entity';
import { StudentTransportChange, TransportChangeAction } from './entities/student-transport-change.entity';
import { PassStatus, StudentTransport, TransportMode } from './entities/student-transport.entity';
import { TransportRoute } from './entities/transport-route.entity';
import { VEHICLE_EXPIRY_FIELDS } from './entities/vehicle-document.entity';
import { Vehicle } from './entities/vehicle.entity';
import {
  checkSchedule,
  NOTIFY_MOVE_METRES,
  NOTIFY_TIME_SHIFT_MINUTES,
  routeTimings,
  ScheduleProblem,
  ScheduleStop,
  SchoolDay,
  timeShift,
  timeWindows,
  windowsOverlap,
} from './route-schedule.logic';
import {
  autoSequence,
  expiryState,
  occupancy,
  pathKm,
  ridesTrip,
  ROAD_KINDS,
  roadBlockers,
  seatCheck,
  stopsOf,
  transportChangeSummary,
  tripRiders,
} from './transport.logic';

export const passengerRef = () => `P${randomBytes(9).toString('hex')}`;

const RECENT_CHANGE_DAYS = 30;
const SWAP_DAYS_AHEAD = 30;

export interface RiderContact {
  photo_url: string | null;
  parents: GuardianContactDto[];
  pass_status: PassStatus;
}

interface StudentRow {
  id: number;
  full_name: string;
  admission_no: string;
  class_section: string | null;
}

interface Placement {
  route_id: number;
  stop_id: number;
  drop_stop_id: number | null;
  mode: TransportMode;
}

interface PlacementChange {
  student_id: number;
  action: TransportChangeAction;
  before: Placement | null;
  after: Placement | null;
}

interface PlacementEntry {
  student_id: number;
  stop_id: number;
  drop_stop_id: number | null;
  mode?: TransportMode;
  start_date?: string;
}

interface SchoolContext extends SchoolDay {
  point: { lat: number; lng: number } | null;
}

interface TimedStop {
  name: string;
  pickup_time: string | null;
  drop_time: string | null;
}

const placementOf = (row: StudentTransport): Placement => ({
  route_id: row.route_id,
  stop_id: row.stop_id,
  drop_stop_id: row.drop_stop_id,
  mode: row.mode,
});

const samePlace = (a: Placement, b: Placement) =>
  a.route_id === b.route_id && a.stop_id === b.stop_id && a.drop_stop_id === b.drop_stop_id && a.mode === b.mode;

const fullName = (first: string, last: string | null) => [first, last].filter(Boolean).join(' ');

const classSection = (className: string | null, sectionName: string | null) =>
  className ? [className, sectionName].filter(Boolean).join(' - ') : null;

const asSchedule = (stop: {
  name: string;
  lat: number;
  lng: number;
  pickup_time: string | null;
  drop_time: string | null;
}): ScheduleStop => ({
  name: stop.name,
  lat: Number(stop.lat),
  lng: Number(stop.lng),
  pickup_time: stop.pickup_time,
  drop_time: stop.drop_time,
});

function modeProblem(mode: TransportMode, pickupStop: TimedStop, dropStop: TimedStop | null = null): string | null {
  if (ridesTrip(mode, 'pickup') && !pickupStop.pickup_time) {
    return `${pickupStop.name} has no pickup time, so students cannot ride there in the morning`;
  }
  const evening = dropStop ?? pickupStop;
  if (ridesTrip(mode, 'drop') && !evening.drop_time) {
    return `${evening.name} has no drop time, so students cannot ride there in the evening`;
  }
  return null;
}

export function journeyText(mode: TransportMode, stop: TimedStop, dropStop: TimedStop | null = null): string {
  const evening = dropStop ?? stop;
  const parts = [];
  if (ridesTrip(mode, 'pickup')) parts.push(`Boards at ${stop.name}${stop.pickup_time ? ` ${stop.pickup_time}` : ''}`);
  if (ridesTrip(mode, 'drop'))
    parts.push(`Drops at ${evening.name}${evening.drop_time ? ` ${evening.drop_time}` : ''}`);
  return parts.join(' · ');
}

function awayNotes(away: AwayLookup, studentId: number, mode: TransportMode, date: string) {
  return {
    away_morning: ridesTrip(mode, 'pickup') ? (away(studentId, date, 'pickup')?.note ?? null) : null,
    away_evening: ridesTrip(mode, 'drop') ? (away(studentId, date, 'drop')?.note ?? null) : null,
  };
}

const stopStudent = (row: DriverStudentDto): DriverStopStudentDto => ({
  id: row.id,
  full_name: row.full_name,
  admission_no: row.admission_no,
  class_section: row.class_section,
  passenger_ref: row.passenger_ref,
  mode: row.mode,
  for: row.for,
  photo_url: row.photo_url,
  parents: row.parents,
  pass_status: row.pass_status,
  away_morning: row.away_morning,
  away_evening: row.away_evening,
  journey: row.journey,
});

@Injectable()
export class RoutesService {
  private readonly logger = new Logger('Transport');

  constructor(
    @InjectRepository(TransportRoute) private readonly routes: Repository<TransportRoute>,
    @InjectRepository(RouteStop) private readonly stops: Repository<RouteStop>,
    @InjectRepository(StudentTransport) private readonly assignments: Repository<StudentTransport>,
    @InjectRepository(StudentTransportChange) private readonly changes: Repository<StudentTransportChange>,
    @InjectRepository(RouteChange) private readonly routeChanges: Repository<RouteChange>,
    @InjectRepository(RouteBusSwap) private readonly swaps: Repository<RouteBusSwap>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async list(schoolId: number, query: RouteQueryDto = {}): Promise<RouteDto[]> {
    const rows = await this.routes.find({ where: { school_id: schoolId }, order: { code: 'ASC' } });
    const presented = await this.present(schoolId, rows);
    if (query.flag === 'no_bus') return presented.filter((route) => !route.vehicle);
    if (query.flag === 'inactive') return presented.filter((route) => !route.is_active);
    if (query.flag === 'has_problems') return presented.filter((route) => route.problems > 0);
    return presented;
  }

  async insights(schoolId: number): Promise<RouteInsightsDto> {
    const routes = await this.list(schoolId);
    return {
      routes: routes.length,
      active: routes.filter((route) => route.is_active).length,
      stops: routes.reduce((sum, route) => sum + route.stops, 0),
      students: routes.reduce((sum, route) => sum + route.students, 0),
      no_bus: routes.filter((route) => route.is_active && !route.vehicle).length,
      with_problems: routes.filter((route) => route.problems > 0).length,
    };
  }

  async detail(schoolId: number, id: number): Promise<RouteDetailDto> {
    const route = await this.find(schoolId, id);
    const [summary] = await this.present(schoolId, [route]);
    const stops = await this.stopList(route.id);
    const school = await this.schoolContext(schoolId);
    const problems: ScheduleProblem[] = checkSchedule(stops.map(asSchedule), school);
    const clash = await this.clashFor(schoolId, route.id, route.vehicle_id, route.is_active, summary!.timings);
    if (clash)
      problems.push({ code: clash.code, severity: 'warning', stop: null, field: null, message: clash.message });
    return {
      ...summary!,
      stop_list: stops,
      school_location: school.point,
      distance_km: pathKm([...stops, ...(school.point ? [school.point] : [])]),
      schedule_problems: problems,
      warnings: await this.busWarnings(route),
    };
  }

  async routeHistory(schoolId: number, id: number): Promise<RouteChangeDto[]> {
    await this.find(schoolId, id);
    const rows = await this.routeChanges.find({ where: { route_id: id }, order: { id: 'DESC' }, take: 100 });
    const pick = (values: (number | null)[]) => values.filter((value): value is number => Boolean(value));
    const [people, students, stops]: [
      { id: number; name: string }[],
      { id: number; name: string }[],
      { id: number; name: string }[],
    ] = await Promise.all([
      pick(rows.map((row) => row.changed_by)).length
        ? this.dataSource.query(`SELECT u.id, u.name FROM users u WHERE u.id = ANY($1)`, [
            pick(rows.map((row) => row.changed_by)),
          ])
        : Promise.resolve([]),
      pick(rows.map((row) => row.student_id)).length
        ? this.dataSource.query(
            `SELECT s.id, concat_ws(' ', s.first_name, s.last_name) AS name FROM students s WHERE s.id = ANY($1)`,
            [pick(rows.map((row) => row.student_id))],
          )
        : Promise.resolve([]),
      pick(rows.map((row) => row.stop_id)).length
        ? this.dataSource.query(`SELECT st.id, st.name FROM route_stops st WHERE st.id = ANY($1)`, [
            pick(rows.map((row) => row.stop_id)),
          ])
        : Promise.resolve([]),
    ]);
    const ref = (list: { id: number; name: string }[], id: number | null) => {
      const found = id ? list.find((item) => Number(item.id) === id) : null;
      return found ? { id: Number(found.id), name: found.name } : null;
    };
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      summary: row.summary,
      reason: row.reason,
      stop: ref(stops, row.stop_id),
      student: ref(students, row.student_id),
      parents_told: row.parents_told,
      changed_by: ref(people, row.changed_by),
      at: row.created_at,
    }));
  }

  async create(schoolId: number, dto: RouteInputDto): Promise<RouteDetailDto> {
    await this.validate(schoolId, dto);
    const saved = await this.routes.save(
      this.routes.create({
        school_id: schoolId,
        code: dto.code,
        name: dto.name,
        vehicle_id: dto.vehicle_id ?? null,
        is_active: dto.is_active ?? true,
      }),
    );
    return this.detail(schoolId, saved.id);
  }

  async update(
    schoolId: number,
    id: number,
    dto: UpdateRouteDto,
    actor: AuthUser | null = null,
  ): Promise<RouteDetailDto> {
    const route = await this.find(schoolId, id);
    await this.validate(schoolId, dto, id);
    const vehicleId = dto.vehicle_id === undefined ? route.vehicle_id : dto.vehicle_id;
    const active = dto.is_active ?? route.is_active;
    const busChanged = dto.vehicle_id !== undefined && dto.vehicle_id !== route.vehicle_id;
    if (busChanged || (active && !route.is_active)) {
      const school = await this.schoolContext(schoolId);
      const timings = routeTimings((await this.stopList(route.id)).map(asSchedule), school, school.point);
      const clash = await this.clashFor(schoolId, route.id, vehicleId, active, timings);
      if (clash) throw AppException.conflict(clash.message, clash.code);
    }
    const { reason, ...changes } = dto;
    await this.dataSource.transaction(async (manager) => {
      if (dto.vehicle_id && dto.vehicle_id !== route.vehicle_id) {
        const riders = await manager.findBy(StudentTransport, { school_id: schoolId, route_id: id });
        await this.assertSeats(
          manager,
          dto.vehicle_id,
          riders.map((row) => row.student_id),
          riders.map((row) => row.mode),
        );
      }
      await manager.save(this.routes.merge(route, changes));
    });
    if (busChanged) {
      const vehicle = vehicleId ? await this.vehicles.findOneBy({ id: vehicleId }) : null;
      await this.record(schoolId, route.id, {
        kind: 'bus_changed',
        summary: vehicle
          ? `Route ${route.name} now runs on bus ${vehicle.registration_no} (${vehicle.name})`
          : `Route ${route.name} has no bus for now. The school will tell you the new bus.`,
        studentIds: await this.routeStudents(route.id),
        actor,
        reason,
      });
    }
    return this.detail(schoolId, id);
  }

  async remove(schoolId: number, id: number): Promise<void> {
    await this.find(schoolId, id);
    const riders = await this.assignments.countBy({ route_id: id });
    if (riders) {
      throw AppException.conflict(
        `${riders} student${riders === 1 ? '' : 's'} use this route. Move them to another route first.`,
        'ROUTE_IN_USE',
      );
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(RouteStop, { route_id: id });
      await manager.softDelete(TransportRoute, id);
    });
  }

  async setStops(
    schoolId: number,
    id: number,
    dto: StopsInputDto,
    actor: AuthUser | null = null,
  ): Promise<RouteDetailDto> {
    const route = await this.find(schoolId, id);
    const current = await this.stops.findBy({ route_id: id });
    const snapshot = current.map((stop) => ({ ...stop }));
    const keep = new Set(dto.items.map((item) => item.id).filter((value): value is number => Boolean(value)));
    const unknown = [...keep].filter((stopId) => !current.some((stop) => stop.id === stopId));
    if (unknown.length) {
      throw AppException.validation([{ field: 'items', message: `Stop ${unknown[0]} is not on this route` }]);
    }
    const removed = current.filter((stop) => !keep.has(stop.id));
    if (removed.length) {
      const ids = removed.map((stop) => stop.id);
      const riders = await this.assignments.count({ where: [{ stop_id: In(ids) }, { drop_stop_id: In(ids) }] });
      if (riders) {
        throw AppException.conflict(
          `${riders} student${riders === 1 ? '' : 's'} get on or off at a stop you removed. Move them first.`,
          'STOP_IN_USE',
        );
      }
    }
    const school = await this.schoolContext(schoolId);
    const planned = dto.items.map((item) => ({
      name: item.name,
      lat: item.lat,
      lng: item.lng,
      pickup_time: item.pickup_time ?? null,
      drop_time: item.drop_time ?? null,
    }));
    const errors = checkSchedule(planned, school).filter((item) => item.severity === 'error');
    if (errors.length) {
      throw AppException.validation(errors.map((item) => ({ field: item.field ?? 'items', message: item.message })));
    }
    const riders = await this.assignments.findBy({ route_id: id });
    const plannedStop = (stopId: number | null) => {
      const item = stopId ? dto.items.find((entry) => entry.id === stopId) : undefined;
      return item
        ? { name: item.name, pickup_time: item.pickup_time ?? null, drop_time: item.drop_time ?? null }
        : null;
    };
    for (const rider of riders) {
      const pickupStop = plannedStop(rider.stop_id);
      if (!pickupStop) continue;
      const problem = modeProblem(rider.mode, pickupStop, plannedStop(rider.drop_stop_id));
      if (problem) {
        throw AppException.validation([{ field: 'items', message: `${problem}. Students ride there.` }]);
      }
    }
    const timings = routeTimings(planned, school, school.point);
    const clash = await this.clashFor(schoolId, route.id, route.vehicle_id, route.is_active, timings);
    if (clash) throw AppException.conflict(clash.message, clash.code);

    await this.dataSource.transaction(async (manager) => {
      if (removed.length) await manager.softDelete(RouteStop, { id: In(removed.map((stop) => stop.id)) });
      for (const [index, item] of dto.items.entries()) {
        const existing = item.id ? current.find((stop) => stop.id === item.id) : undefined;
        await manager.save(
          manager.merge(RouteStop, existing ?? manager.create(RouteStop), {
            school_id: schoolId,
            route_id: id,
            name: item.name,
            landmark: item.landmark ?? null,
            lat: item.lat,
            lng: item.lng,
            sequence: index + 1,
            pickup_time: item.pickup_time ?? null,
            drop_time: item.drop_time ?? null,
            geofence_radius_m: item.geofence_radius_m ?? existing?.geofence_radius_m ?? 100,
            monthly_fee: item.monthly_fee ?? existing?.monthly_fee ?? 0,
          }),
        );
      }
    });
    await this.recordStopChanges(schoolId, route, snapshot, dto, removed, riders, actor);
    return this.detail(schoolId, id);
  }

  async autoSequence(schoolId: number, id: number): Promise<RouteDetailDto> {
    const route = await this.detail(schoolId, id);
    if (route.stop_list.length < 2) return route;
    const ordered = autoSequence(route.stop_list, route.school_location);
    await this.dataSource.transaction(async (manager) => {
      for (const [index, stop] of ordered.entries()) {
        await manager.update(RouteStop, stop.id, { sequence: index + 1 });
      }
    });
    return this.detail(schoolId, id);
  }

  async assignStop(
    schoolId: number,
    routeId: number,
    stopId: number,
    dto: AssignStopStudentsDto,
  ): Promise<AssignResultDto> {
    const stop = await this.stop(schoolId, routeId, stopId);
    const route = await this.find(schoolId, routeId);
    await this.assertActiveStudents(schoolId, dto.student_ids);
    const existing = await this.assignments.findBy({ school_id: schoolId, student_id: In(dto.student_ids) });
    for (const studentId of dto.student_ids) {
      const mode = dto.mode ?? existing.find((row) => row.student_id === studentId)?.mode ?? 'both';
      this.assertCanRide(route, mode, stop);
    }
    const changes = await this.place(
      schoolId,
      routeId,
      dto.student_ids.map((studentId) => ({
        student_id: studentId,
        stop_id: stop.id,
        drop_stop_id: null,
        mode: dto.mode,
      })),
    );
    return {
      assigned: dto.student_ids.length,
      moved: changes.filter((change) => change.action === 'moved').length,
      route: await this.detail(schoolId, routeId),
    };
  }

  async assignStudent(schoolId: number, studentId: number, dto: AssignTransportDto): Promise<StudentTransportDto> {
    const stop = await this.stop(schoolId, dto.route_id, dto.stop_id);
    const route = await this.find(schoolId, dto.route_id);
    await this.assertActiveStudents(schoolId, [studentId], true);
    const current = await this.assignments.findOneBy({ school_id: schoolId, student_id: studentId });
    const mode = dto.mode ?? current?.mode ?? 'both';
    let dropStopId = dto.drop_stop_id ?? null;
    if (dropStopId === stop.id) dropStopId = null;
    let dropStop: RouteStop | null = null;
    if (dropStopId !== null) {
      if (mode !== 'both') {
        throw AppException.validation([
          { field: 'drop_stop_id', message: 'A separate drop stop is only for students who use the bus both ways' },
        ]);
      }
      dropStop = await this.stops.findOneBy({ id: dropStopId, route_id: dto.route_id });
      if (!dropStop) {
        throw AppException.validation([{ field: 'drop_stop_id', message: 'Choose a drop stop on the same route' }]);
      }
    }
    this.assertCanRide(route, mode, stop, dropStop);
    await this.place(schoolId, dto.route_id, [
      { student_id: studentId, stop_id: stop.id, drop_stop_id: dropStopId, mode, start_date: dto.start_date },
    ]);
    return (await this.studentRows(schoolId, { student_id: studentId }))[0]!;
  }

  async setPass(schoolId: number, studentId: number, dto: PassInputDto, actor: AuthUser): Promise<StudentTransportDto> {
    const current = await this.assignments.findOneBy({ school_id: schoolId, student_id: studentId });
    if (!current) throw AppException.notFound('This student has no bus', 'TRANSPORT_NOT_FOUND');
    const note = dto.status === 'on_hold' ? (dto.note ?? null) : null;
    if (current.pass_status !== dto.status || current.pass_note !== note) {
      await this.assignments.update(current.id, {
        pass_status: dto.status,
        pass_note: note,
        pass_changed_at: new Date(),
        pass_changed_by: actor.id,
      });
      const [student] = await this.dataSource.query(
        `SELECT concat_ws(' ', first_name, last_name) AS name FROM students WHERE id = $1`,
        [studentId],
      );
      await this.record(schoolId, current.route_id, {
        kind: 'pass_changed',
        summary:
          dto.status === 'on_hold'
            ? `${student?.name ?? 'Your child'}'s bus pass is on hold.${note ? ` ${note}.` : ''} Please contact the school office.`
            : `${student?.name ?? 'Your child'}'s bus pass is active again.`,
        studentIds: [studentId],
        studentId,
        actor,
      });
    }
    return (await this.studentRows(schoolId, { student_id: studentId }))[0]!;
  }

  async unassignStudent(schoolId: number, studentId: number): Promise<void> {
    const current = await this.assignments.findOneBy({ school_id: schoolId, student_id: studentId });
    if (!current) throw AppException.notFound('This student has no bus', 'TRANSPORT_NOT_FOUND');
    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(StudentTransport, current.id);
      await manager.save(
        manager.create(StudentTransportChange, {
          school_id: schoolId,
          student_id: studentId,
          action: 'removed',
          from_route_id: current.route_id,
          from_stop_id: current.stop_id,
          from_drop_stop_id: current.drop_stop_id,
          to_route_id: null,
          to_stop_id: null,
          to_drop_stop_id: null,
          mode: current.mode,
        }),
      );
    });
    void this.notify(schoolId, [
      { student_id: studentId, action: 'removed', before: placementOf(current), after: null },
    ]);
  }

  async studentTransport(schoolId: number, studentId: number): Promise<StudentTransportDto | null> {
    return (await this.studentRows(schoolId, { student_id: studentId }))[0] ?? null;
  }

  async history(schoolId: number, studentId: number): Promise<TransportChangeDto[]> {
    const rows = await this.changes.find({
      where: { school_id: schoolId, student_id: studentId },
      order: { created_at: 'DESC', id: 'DESC' },
      take: 50,
    });
    if (!rows.length) return [];
    const routeIds = rows.flatMap((row) => [row.from_route_id, row.to_route_id]);
    const stopIds = rows.flatMap((row) => [
      row.from_stop_id,
      row.from_drop_stop_id,
      row.to_stop_id,
      row.to_drop_stop_id,
    ]);
    const userIds = rows.map((row) => row.created_by);
    const ids = (values: (number | null)[]) => [...new Set(values.filter((value): value is number => Boolean(value)))];
    const [routes, stops, users] = await Promise.all([
      this.routes.find({ where: { id: In(ids(routeIds)) }, withDeleted: true }),
      this.stops.find({ where: { id: In(ids(stopIds)) }, withDeleted: true }),
      ids(userIds).length
        ? this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [ids(userIds)])
        : Promise.resolve([] as { id: number; name: string }[]),
    ]);
    const ref = (list: { id: number; name: string }[], id: number | null) => {
      const found = id ? list.find((item) => Number(item.id) === id) : undefined;
      return found ? { id: Number(found.id), name: found.name } : null;
    };
    const place = (routeId: number | null, stopId: number | null, dropId: number | null) => {
      const route = ref(routes, routeId);
      const stop = ref(stops, stopId);
      return route && stop ? { route, stop, drop_stop: ref(stops, dropId) } : null;
    };
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      from: place(row.from_route_id, row.from_stop_id, row.from_drop_stop_id),
      to: place(row.to_route_id, row.to_stop_id, row.to_drop_stop_id),
      mode: row.mode,
      by: ref(users, row.created_by),
      at: row.created_at,
    }));
  }

  async roster(schoolId: number, routeId: number): Promise<RouteRosterDto> {
    const route = await this.find(schoolId, routeId);
    const vehicle = route.vehicle_id ? await this.vehicles.findOneBy({ id: route.vehicle_id }) : null;
    const stops = await this.stops.find({ where: { route_id: routeId }, order: { sequence: 'ASC' } });
    const rows: {
      student_id: number;
      stop_id: number;
      drop_stop_id: number | null;
      mode: TransportMode;
      first_name: string;
      last_name: string | null;
      admission_no: string;
      class_name: string | null;
      section_name: string | null;
      guardian_name: string | null;
      guardian_mobile: string | null;
      pass_status: PassStatus;
    }[] = await this.dataSource.query(
      `SELECT t.student_id, t.stop_id, t.drop_stop_id, t.mode, t.pass_status, s.first_name, s.last_name, s.admission_no,
              c.name AS class_name, sec.name AS section_name, g.name AS guardian_name, g.mobile AS guardian_mobile
       FROM student_transport t
       JOIN students s ON s.id = t.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       LEFT JOIN student_enrollments e ON e.student_id = s.id
         AND e.academic_year_id = (SELECT id FROM academic_years y WHERE y.school_id = s.school_id AND y.is_current LIMIT 1)
       LEFT JOIN sections sec ON sec.id = e.section_id
       LEFT JOIN classes c ON c.id = COALESCE(e.class_id, sec.class_id)
       LEFT JOIN LATERAL (
         SELECT gd.name, gd.mobile FROM student_guardians sg
         JOIN guardians gd ON gd.id = sg.guardian_id AND gd.deleted_at IS NULL
         WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC, sg.id LIMIT 1
       ) g ON true
       WHERE t.school_id = $1 AND t.route_id = $2 AND t.deleted_at IS NULL
       ORDER BY s.first_name, s.last_name`,
      [schoolId, routeId],
    );
    const today = todayIn(this.app.timeZone);
    const away = await awayLookup(
      this.dataSource,
      rows.map((row) => Number(row.student_id)),
      [today],
    );
    const students = rows.map((row) => {
      const student: RosterStudentDto = {
        id: Number(row.student_id),
        full_name: fullName(row.first_name, row.last_name),
        admission_no: row.admission_no,
        class_section: classSection(row.class_name, row.section_name),
        mode: row.mode,
        guardian_name: row.guardian_name,
        guardian_mobile: row.guardian_mobile,
        pass_status: row.pass_status,
        ...awayNotes(away, Number(row.student_id), row.mode, today),
      };
      return {
        student,
        stops: stopsOf({ stop_id: Number(row.stop_id), drop_stop_id: row.drop_stop_id, mode: row.mode }),
      };
    });
    const busRiders = vehicle ? await this.busRiders(this.dataSource.manager, vehicle.id, []) : [];
    const routeRiders = tripRiders(rows.map((row) => row.mode));
    const bus = tripRiders(busRiders);
    return {
      id: route.id,
      code: route.code,
      name: route.name,
      vehicle: vehicle
        ? { id: vehicle.id, registration_no: vehicle.registration_no, name: vehicle.name, capacity: vehicle.capacity }
        : null,
      morning_riders: routeRiders.pickup,
      evening_riders: routeRiders.drop,
      bus_morning_riders: bus.pickup,
      bus_evening_riders: bus.drop,
      stops: stops.map((stop) => ({
        id: stop.id,
        sequence: stop.sequence,
        name: stop.name,
        landmark: stop.landmark,
        pickup_time: stop.pickup_time,
        drop_time: stop.drop_time,
        pickup_students: students.filter((item) => item.stops.pickup === stop.id).map((item) => item.student),
        drop_students: students.filter((item) => item.stops.drop === stop.id).map((item) => item.student),
      })),
    };
  }

  async listStudents(schoolId: number, query: StudentTransportQueryDto): Promise<Paginated<StudentTransportDto>> {
    const qb = this.assignments
      .createQueryBuilder('t')
      .innerJoin('students', 's', 's.id = t.student_id AND s.deleted_at IS NULL')
      .innerJoin('route_stops', 'st', 'st.id = t.stop_id')
      .leftJoin(
        'student_enrollments',
        'e',
        'e.student_id = s.id AND e.academic_year_id = (SELECT id FROM academic_years y WHERE y.school_id = s.school_id AND y.is_current LIMIT 1)',
      )
      .leftJoin('sections', 'sec', 'sec.id = e.section_id')
      .leftJoin('classes', 'c', 'c.id = COALESCE(e.class_id, sec.class_id)')
      .where('t.school_id = :schoolId', { schoolId });
    if (query.route_id) qb.andWhere('t.route_id = :route', { route: query.route_id });
    if (query.stop_id) qb.andWhere('(t.stop_id = :stop OR t.drop_stop_id = :stop)', { stop: query.stop_id });
    if (query.class_id) qb.andWhere('c.id = :classId', { classId: query.class_id });
    if (query.section_id) qb.andWhere('sec.id = :sectionId', { sectionId: query.section_id });
    if (query.mode) qb.andWhere('t.mode = :mode', { mode: query.mode });
    if (query.pass_status) qb.andWhere('t.pass_status = :pass', { pass: query.pass_status });
    const ordered = query.sort ? query : { ...query, sort: 'name', order: 'asc' as const };
    applySearch(qb, query.search, ['s.first_name', 's.last_name', 's.admission_no']);
    applySort(qb, ordered, {
      sortable: {
        name: 's.first_name',
        admission_no: 's.admission_no',
        class: 'c.grade_level',
        stop: 'st.sequence',
        created_at: 't.created_at',
      },
      defaultSort: 'name',
    });
    const [items, total] = await Promise.all([
      qb
        .clone()
        .offset((query.page - 1) * query.limit)
        .limit(query.limit)
        .getMany(),
      qb.clone().getCount(),
    ]);
    const rows = items.length ? await this.studentRows(schoolId, { ids: items.map((item) => item.id) }) : [];
    return paginate(
      [
        items
          .map((item) => rows.find((row) => row.id === item.id))
          .filter((row): row is StudentTransportDto => Boolean(row)),
        total,
      ],
      query.page,
      query.limit,
    );
  }

  async forParent(schoolId: number, studentId: number): Promise<ParentTransportDto | null> {
    const assignment = await this.assignments.findOneBy({ school_id: schoolId, student_id: studentId });
    if (!assignment) return null;
    const route = await this.routes.findOneBy({ id: assignment.route_id });
    const stops = await this.stopList(assignment.route_id);
    const stop = stops.find((item) => item.id === assignment.stop_id);
    const dropStop = assignment.drop_stop_id
      ? (stops.find((item) => item.id === assignment.drop_stop_id) ?? null)
      : null;
    if (!route || !stop) return null;
    const busToday = await vehicleOnDay(this.dataSource, route, todayIn(this.app.timeZone));
    const vehicle = busToday ? await this.vehicles.findOneBy({ id: busToday }) : null;
    const people: { id: number; name: string; mobile: string }[] = vehicle
      ? await this.dataSource.query(`SELECT id, name, mobile FROM users WHERE id = ANY($1)`, [
          [vehicle.driver_user_id, vehicle.attendant_user_id].filter(Boolean),
        ])
      : [];
    const person = (id: number | null | undefined) => {
      const found = people.find((item) => Number(item.id) === id);
      return found ? { id: Number(found.id), name: found.name, mobile: found.mobile } : null;
    };
    const school = await this.schoolContext(schoolId);
    const myStops = [stop.id, ...(dropStop ? [dropStop.id] : [])];
    const since = new Date(Date.now() - RECENT_CHANGE_DAYS * 86400000);
    const recent = await this.routeChanges
      .createQueryBuilder('c')
      .where('c.route_id = :route AND c.created_at >= :since', { route: route.id, since })
      .andWhere(
        `(c.student_id = :student OR (c.student_id IS NULL AND (c.stop_id IS NULL OR c.stop_id IN (:...stops))))`,
        {
          student: studentId,
          stops: myStops,
        },
      )
      .orderBy('c.id', 'DESC')
      .take(10)
      .getMany();
    const moves = (await this.history(schoolId, studentId)).filter((change) => change.at >= since);
    const recentChanges = [
      ...recent.map((row) => ({ summary: row.summary, at: row.created_at })),
      ...moves.map((change) => ({ summary: transportChangeSummary(change), at: change.at })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 10);
    return {
      route: { id: route.id, name: route.name },
      stop,
      drop_stop: dropStop,
      mode: assignment.mode,
      vehicle: vehicle
        ? { id: vehicle.id, registration_no: vehicle.registration_no, name: vehicle.name, capacity: vehicle.capacity }
        : null,
      driver: person(vehicle?.driver_user_id),
      attendant: person(vehicle?.attendant_user_id),
      monthly_fee: Math.max(stop.monthly_fee, dropStop?.monthly_fee ?? 0),
      route_stops: stops.map((item) => ({
        sequence: item.sequence,
        name: item.name,
        landmark: item.landmark,
        pickup_time: item.pickup_time,
        drop_time: item.drop_time,
        is_my_stop: myStops.includes(item.id),
      })),
      timings: routeTimings(stops.map(asSchedule), school, school.point),
      pass_status: assignment.pass_status,
      pass_note: assignment.pass_note,
      recent_changes: recentChanges,
    };
  }

  async forDriver(schoolId: number, userId: number): Promise<DriverDutyDto> {
    const vehicle = await this.driverVehicle(schoolId, userId);
    if (!vehicle) {
      return {
        vehicle: null,
        students: 0,
        morning: 0,
        evening: 0,
        passes_on_hold: 0,
        away_morning: 0,
        away_evening: 0,
        routes: [],
      };
    }
    const routes = await this.todayRoutes(schoolId, vehicle.id);
    const riders = routes.length
      ? await this.driverRiders(
          schoolId,
          routes.map((route) => route.id),
        )
      : [];
    const school = await this.schoolContext(schoolId);
    return {
      vehicle: {
        id: vehicle.id,
        registration_no: vehicle.registration_no,
        name: vehicle.name,
        capacity: vehicle.capacity,
      },
      students: riders.length,
      morning: riders.filter((row) => ridesTrip(row.mode, 'pickup')).length,
      evening: riders.filter((row) => ridesTrip(row.mode, 'drop')).length,
      passes_on_hold: riders.filter((row) => row.pass_status === 'on_hold').length,
      away_morning: riders.filter((row) => row.away_morning).length,
      away_evening: riders.filter((row) => row.away_evening).length,
      routes: await Promise.all(
        routes.map(async (route) => {
          const stops = await this.stopList(route.id);
          const own = riders.filter((row) => row.route.id === route.id);
          return {
            id: route.id,
            code: route.code,
            name: route.name,
            path: [...stops.map((item) => item.name), 'School'].join(' → '),
            from: stops[0]?.name ?? null,
            to: 'School',
            timings: routeTimings(stops.map(asSchedule), school, school.point),
            students: own.length,
            stops: stops.map((stop) => ({
              ...stop,
              student_list: own
                .map((row) => {
                  const legs = stopsOf({
                    stop_id: row.stop.id,
                    drop_stop_id: row.drop_stop?.id ?? null,
                    mode: row.mode,
                  });
                  const forStop: DriverStopStudentDto['for'] | null =
                    legs.pickup === stop.id && legs.drop === stop.id
                      ? 'both'
                      : legs.pickup === stop.id
                        ? 'pickup'
                        : legs.drop === stop.id
                          ? 'drop'
                          : null;
                  return forStop ? { ...stopStudent(row), for: forStop } : null;
                })
                .filter((row): row is DriverStopStudentDto => Boolean(row)),
            })),
          };
        }),
      ),
    };
  }

  async driverStudents(schoolId: number, userId: number, query: DriverStudentQueryDto): Promise<DriverStudentDto[]> {
    const vehicle = await this.driverVehicle(schoolId, userId);
    if (!vehicle) return [];
    const routes = await this.todayRoutes(schoolId, vehicle.id);
    if (!routes.length) return [];
    const riders = await this.driverRiders(
      schoolId,
      routes.map((route) => route.id),
    );
    const words = (query.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    return riders.filter((row) => {
      if (query.ride === 'morning' && !ridesTrip(row.mode, 'pickup')) return false;
      if (query.ride === 'evening' && !ridesTrip(row.mode, 'drop')) return false;
      const text = [row.full_name, row.admission_no, ...row.parents.map((parent) => parent.mobile)]
        .join(' ')
        .toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }

  async driverRoster(schoolId: number, userId: number): Promise<RouteRosterDto[]> {
    const vehicle = await this.driverVehicle(schoolId, userId);
    if (!vehicle) return [];
    const routes = await this.todayRoutes(schoolId, vehicle.id);
    return Promise.all(routes.map((route) => this.roster(schoolId, route.id)));
  }

  async swapBus(schoolId: number, routeId: number, dto: BusSwapInputDto, actor: AuthUser): Promise<BusSwapDto> {
    const route = await this.find(schoolId, routeId);
    if (!route.is_active) throw AppException.badRequest(`Route ${route.code} is switched off`, 'ROUTE_INACTIVE');
    const today = todayIn(this.app.timeZone);
    const date = dto.date ?? today;
    if (date < today || date > addDays(today, SWAP_DAYS_AHEAD)) {
      throw AppException.validation([
        { field: 'date', message: `Pick today or a day in the next ${SWAP_DAYS_AHEAD} days` },
      ]);
    }
    const vehicle = await this.vehicles.findOneBy({ id: dto.vehicle_id, school_id: schoolId });
    if (!vehicle || vehicle.status !== 'active') {
      throw AppException.validation([{ field: 'vehicle_id', message: 'Pick an active bus of this school' }]);
    }
    if (vehicle.id === route.vehicle_id) {
      throw AppException.badRequest('This is already the usual bus of the route', 'SAME_BUS');
    }
    const school = await this.schoolContext(schoolId);
    const timings = routeTimings((await this.stopList(route.id)).map(asSchedule), school, school.point);
    const clash = await this.clashFor(schoolId, route.id, vehicle.id, true, timings);
    if (clash && !dto.force) throw AppException.conflict(`${clash.message}. Change anyway if you must.`, clash.code);
    const reason = dto.reason?.trim() || null;
    const existing = await this.swaps.findOneBy({ route_id: route.id, swap_date: date });
    const saved = await this.swaps.save(
      existing
        ? this.swaps.merge(existing, { vehicle_id: vehicle.id, reason, created_by: actor.id })
        : this.swaps.create({
            school_id: schoolId,
            route_id: route.id,
            swap_date: date,
            vehicle_id: vehicle.id,
            original_vehicle_id: route.vehicle_id,
            reason,
            created_by: actor.id,
          }),
    );
    const usual = route.vehicle_id ? await this.vehicles.findOneBy({ id: route.vehicle_id }) : null;
    const parents = await this.parentsOf(await this.routeStudents(route.id));
    const crew = [usual, vehicle]
      .flatMap((bus) => [bus?.driver_user_id, bus?.attendant_user_id])
      .filter((id): id is number => Boolean(id));
    const when = date === today ? 'today' : `on ${date}`;
    const data = {
      route: route.name,
      bus: `${vehicle.name} (${vehicle.registration_no})`,
      old_bus: usual ? `${usual.name} (${usual.registration_no})` : 'the usual bus',
      when,
      when_ta: date === today ? 'இன்று' : date,
      reason: reason ? `Reason: ${reason}` : '',
      route_id: String(route.id),
    };
    await this.send(TEMPLATES.BUS_SWAPPED, schoolId, [...new Set([...parents, ...crew])], data);
    await this.routeChanges.insert({
      school_id: schoolId,
      route_id: route.id,
      kind: 'bus_swapped',
      summary: `${data.bus} runs route ${route.name} ${when} instead of ${data.old_bus}`.slice(0, 255),
      reason,
      parents_told: parents.length,
      changed_by: actor.id,
    });
    if (clash) {
      const busy = await this.routes.findOneBy({ id: clash.route_id });
      if (busy) {
        await this.record(schoolId, busy.id, {
          kind: 'bus_swapped',
          summary: `${vehicle.name} also covers route ${route.name} ${when}, so it may be late on route ${busy.name}`,
          studentIds: await this.routeStudents(busy.id),
          actor,
          reason,
        });
      }
    }
    return {
      ...(await this.presentSwaps([saved]))[0]!,
      parents_told: parents.length,
      warning: clash ? clash.message : null,
    };
  }

  async clearSwap(schoolId: number, routeId: number, date: string | undefined, actor: AuthUser): Promise<void> {
    const route = await this.find(schoolId, routeId);
    const day = date ?? todayIn(this.app.timeZone);
    const swap = await this.swaps.findOneBy({ route_id: route.id, swap_date: day });
    if (!swap) throw AppException.notFound('No bus change for this route on that day', 'SWAP_NOT_FOUND');
    await this.swaps.softRemove(swap);
    const usual = route.vehicle_id ? await this.vehicles.findOneBy({ id: route.vehicle_id }) : null;
    await this.record(schoolId, route.id, {
      kind: 'bus_swapped',
      summary: `Route ${route.name} runs on its usual bus${usual ? ` ${usual.name} (${usual.registration_no})` : ''} ${day === todayIn(this.app.timeZone) ? 'today' : `on ${day}`} after all`,
      studentIds: await this.routeStudents(route.id),
      actor,
    });
  }

  async listSwaps(schoolId: number, date: string | undefined): Promise<BusSwapDto[]> {
    const rows = await this.swaps.find({
      where: date
        ? { school_id: schoolId, swap_date: date }
        : { school_id: schoolId, swap_date: MoreThanOrEqual(todayIn(this.app.timeZone)) },
      order: { swap_date: 'ASC', id: 'ASC' },
    });
    return this.presentSwaps(rows);
  }

  private async todayRoutes(schoolId: number, vehicleId: number): Promise<TransportRoute[]> {
    const ids = await routeIdsRunBy(this.dataSource, schoolId, vehicleId, todayIn(this.app.timeZone));
    if (!ids.length) return [];
    const rows = await this.routes.findBy({ id: In(ids) });
    return rows.sort((a, b) => a.code.localeCompare(b.code));
  }

  private async presentSwaps(rows: RouteBusSwap[]): Promise<BusSwapDto[]> {
    if (!rows.length) return [];
    const [routes, buses, users]: [TransportRoute[], Vehicle[], { id: number; name: string }[]] = await Promise.all([
      this.routes.find({ where: { id: In(rows.map((row) => row.route_id)) }, withDeleted: true }),
      this.vehicles.find({
        where: {
          id: In(
            rows.flatMap((row) => [row.vehicle_id, row.original_vehicle_id]).filter((id): id is number => Boolean(id)),
          ),
        },
        withDeleted: true,
      }),
      this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [
        rows.map((row) => row.created_by).filter((id): id is number => Boolean(id)),
      ]),
    ]);
    const bus = (id: number | null) => {
      const found = id ? buses.find((item) => item.id === id) : undefined;
      return found
        ? { id: found.id, registration_no: found.registration_no, name: found.name, capacity: found.capacity }
        : null;
    };
    return rows.map((row) => {
      const route = routes.find((item) => item.id === row.route_id);
      const by = users.find((user) => Number(user.id) === row.created_by);
      return {
        id: row.id,
        route: { id: row.route_id, name: route?.name ?? '' },
        date: row.swap_date,
        vehicle: bus(row.vehicle_id)!,
        usual_vehicle: bus(row.original_vehicle_id),
        reason: row.reason,
        by: by ? { id: Number(by.id), name: by.name } : null,
        parents_told: 0,
        warning: null,
      };
    });
  }

  private async driverVehicle(schoolId: number, userId: number): Promise<Vehicle | null> {
    return this.vehicles.findOne({
      where: [
        { school_id: schoolId, driver_user_id: userId, status: 'active' },
        { school_id: schoolId, attendant_user_id: userId, status: 'active' },
      ],
    });
  }

  async riderContacts(studentIds: number[]): Promise<Map<number, RiderContact>> {
    if (!studentIds.length) return new Map();
    const [students, guardians]: [
      { id: number; photo_file_id: number | null; pass_status: PassStatus | null }[],
      { student_id: number; name: string; relation: string; mobile: string; is_primary: boolean }[],
    ] = await Promise.all([
      this.dataSource.query(
        `SELECT s.id, s.photo_file_id, t.pass_status FROM students s
         LEFT JOIN student_transport t ON t.student_id = s.id AND t.deleted_at IS NULL
         WHERE s.id = ANY($1)`,
        [studentIds],
      ),
      this.dataSource.query(
        `SELECT sg.student_id, g.name, sg.relation, g.mobile, sg.is_primary
         FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
         WHERE sg.student_id = ANY($1) ORDER BY sg.is_primary DESC, sg.id`,
        [studentIds],
      ),
    ]);
    return new Map(
      students.map((student) => {
        const id = Number(student.id);
        const parents: GuardianContactDto[] = guardians
          .filter((item) => Number(item.student_id) === id)
          .map((item) => ({
            name: item.name,
            relation: item.relation,
            mobile: item.mobile,
            is_primary: item.is_primary,
          }));
        const photo = student.photo_file_id === null ? null : Number(student.photo_file_id);
        return [id, { photo_url: this.files.linkFor(photo), parents, pass_status: student.pass_status ?? 'active' }];
      }),
    );
  }

  private async driverRiders(schoolId: number, routeIds: number[]): Promise<DriverStudentDto[]> {
    const rows = await this.studentRows(schoolId, { route_ids: routeIds });
    if (!rows.length) return [];
    const studentIds = rows.map((row) => row.student.id);
    const today = todayIn(this.app.timeZone);
    const [contacts, away] = await Promise.all([
      this.riderContacts(studentIds),
      awayLookup(this.dataSource, studentIds, [today]),
    ]);
    return rows.map((row) => {
      const contact = contacts.get(row.student.id);
      return {
        ...row.student,
        passenger_ref: row.passenger_ref,
        mode: row.mode,
        for: row.mode,
        photo_url: contact?.photo_url ?? null,
        parents: contact?.parents ?? [],
        pass_status: row.pass_status,
        ...awayNotes(away, row.student.id, row.mode, today),
        journey: journeyText(row.mode, row.stop, row.drop_stop),
        route: row.route,
        stop: row.stop,
        drop_stop: row.drop_stop,
      };
    });
  }

  private assertCanRide(
    route: TransportRoute,
    mode: TransportMode,
    pickupStop: TimedStop,
    dropStop: TimedStop | null = null,
  ): void {
    if (!route.is_active) {
      throw AppException.badRequest(`Route ${route.code} is switched off. Switch it on first.`, 'ROUTE_INACTIVE');
    }
    if (!route.vehicle_id) {
      throw AppException.badRequest(`Route ${route.code} has no bus yet. Give it a bus first.`, 'ROUTE_HAS_NO_BUS');
    }
    const problem = modeProblem(mode, pickupStop, dropStop);
    if (problem) throw AppException.badRequest(problem, 'STOP_TIME_MISSING');
  }

  private async place(schoolId: number, routeId: number, entries: PlacementEntry[]): Promise<PlacementChange[]> {
    const route = await this.find(schoolId, routeId);
    const today = todayIn(this.app.timeZone);
    const studentIds = entries.map((entry) => entry.student_id);
    const changes = await this.dataSource.transaction(async (manager) => {
      const existing = await manager.findBy(StudentTransport, { school_id: schoolId, student_id: In(studentIds) });
      const resolved = entries.map((entry) => {
        const current = existing.find((row) => row.student_id === entry.student_id) ?? null;
        const mode = entry.mode ?? current?.mode ?? 'both';
        return { entry, current, mode };
      });
      if (route.vehicle_id) {
        await this.assertSeats(
          manager,
          route.vehicle_id,
          studentIds,
          resolved.map((item) => item.mode),
        );
      }
      const result: PlacementChange[] = [];
      for (const { entry, current, mode } of resolved) {
        const after: Placement = {
          route_id: routeId,
          stop_id: entry.stop_id,
          drop_stop_id: mode === 'both' ? entry.drop_stop_id : null,
          mode,
        };
        const before = current ? placementOf(current) : null;
        await manager.save(
          manager.merge(StudentTransport, current ?? manager.create(StudentTransport), {
            ...after,
            school_id: schoolId,
            student_id: entry.student_id,
            start_date: entry.start_date ?? current?.start_date ?? today,
            passenger_ref: current?.passenger_ref ?? passengerRef(),
          }),
        );
        const action: TransportChangeAction | null = !before ? 'assigned' : samePlace(before, after) ? null : 'moved';
        if (!action) continue;
        await manager.save(
          manager.create(StudentTransportChange, {
            school_id: schoolId,
            student_id: entry.student_id,
            action,
            from_route_id: before?.route_id ?? null,
            from_stop_id: before?.stop_id ?? null,
            from_drop_stop_id: before?.drop_stop_id ?? null,
            to_route_id: after.route_id,
            to_stop_id: after.stop_id,
            to_drop_stop_id: after.drop_stop_id,
            mode,
          }),
        );
        result.push({ student_id: entry.student_id, action, before, after });
      }
      return result;
    });
    void this.notify(schoolId, changes);
    return changes;
  }

  private async busRiders(manager: EntityManager, vehicleId: number, excluded: number[]): Promise<TransportMode[]> {
    const rows: { mode: TransportMode }[] = await manager.query(
      `SELECT t.mode FROM student_transport t
       JOIN transport_routes r ON r.id = t.route_id AND r.deleted_at IS NULL AND r.is_active = true
       JOIN students s ON s.id = t.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       WHERE r.vehicle_id = $1 AND t.deleted_at IS NULL AND NOT (t.student_id = ANY($2))`,
      [vehicleId, excluded],
    );
    return rows.map((row) => row.mode);
  }

  private async assertSeats(
    manager: EntityManager,
    vehicleId: number,
    studentIds: number[],
    modes: TransportMode[],
  ): Promise<void> {
    const [vehicle]: { id: number; registration_no: string; capacity: number }[] = await manager.query(
      `SELECT id, registration_no, capacity FROM vehicles WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [vehicleId],
    );
    if (!vehicle) return;
    const others = await this.busRiders(manager, vehicleId, studentIds);
    const problem = seatCheck(Number(vehicle.capacity), tripRiders([...others, ...modes]));
    if (problem) throw AppException.conflict(`${vehicle.registration_no} has ${problem}.`, 'BUS_FULL');
  }

  private async assertActiveStudents(schoolId: number, studentIds: number[], single = false): Promise<void> {
    const students: { id: number }[] = await this.dataSource.query(
      `SELECT id FROM students WHERE school_id = $1 AND id = ANY($2) AND deleted_at IS NULL AND status = 'active'`,
      [schoolId, studentIds],
    );
    const missing = studentIds.filter((studentId) => !students.some((row) => Number(row.id) === studentId));
    if (!missing.length) return;
    if (single) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    throw AppException.validation([
      { field: 'student_ids', message: `Student ${missing[0]} is not an active student of this school` },
    ]);
  }

  private async notify(schoolId: number, changes: PlacementChange[]): Promise<void> {
    if (!changes.length) return;
    try {
      const studentIds = changes.map((change) => change.student_id);
      const places = changes
        .flatMap((change) => [change.before, change.after])
        .filter((item): item is Placement => Boolean(item));
      const routeIds = [...new Set(places.map((item) => item.route_id))];
      const stopIds = [
        ...new Set(
          places.flatMap((item) => [item.stop_id, item.drop_stop_id]).filter((id): id is number => Boolean(id)),
        ),
      ];
      const [students, routes, stops, parents]: [
        {
          id: number;
          first_name: string;
          last_name: string | null;
          class_name: string | null;
          section_name: string | null;
        }[],
        TransportRoute[],
        RouteStop[],
        { student_id: number; user_id: number }[],
      ] = await Promise.all([
        this.dataSource.query(
          `SELECT s.id, s.first_name, s.last_name, c.name AS class_name, sec.name AS section_name
           FROM students s
           LEFT JOIN student_enrollments e ON e.student_id = s.id
             AND e.academic_year_id = (SELECT id FROM academic_years y WHERE y.school_id = s.school_id AND y.is_current LIMIT 1)
           LEFT JOIN sections sec ON sec.id = e.section_id
           LEFT JOIN classes c ON c.id = COALESCE(e.class_id, sec.class_id)
           WHERE s.id = ANY($1)`,
          [studentIds],
        ),
        this.routes.find({ where: { id: In(routeIds) }, withDeleted: true }),
        this.stops.find({ where: { id: In(stopIds) }, withDeleted: true }),
        this.dataSource.query(
          `SELECT DISTINCT sg.student_id, g.user_id FROM student_guardians sg
           JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL AND g.user_id IS NOT NULL
           WHERE sg.student_id = ANY($1) AND sg.receives_alerts = true`,
          [studentIds],
        ),
      ]);
      const vehicleIds = [
        ...new Set(routes.map((route) => route.vehicle_id).filter((id): id is number => Boolean(id))),
      ];
      const vehicles = vehicleIds.length
        ? await this.vehicles.find({ where: { id: In(vehicleIds) }, withDeleted: true })
        : [];
      const routeOf = (id: number) => routes.find((route) => route.id === id);
      const busOf = (place: Placement | null) => {
        const vehicleId = place ? routeOf(place.route_id)?.vehicle_id : null;
        return vehicleId ? (vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null) : null;
      };
      const stopText = (id: number | null, time: 'pickup_time' | 'drop_time') => {
        const stop = id ? stops.find((item) => item.id === id) : undefined;
        if (!stop) return '—';
        return stop[time] ? `${stop.name}, ${stop[time]!.slice(0, 5)}` : stop.name;
      };
      const where = (place: Placement) => {
        const legs = stopsOf(place);
        return {
          pickup: legs.pickup ? stopText(legs.pickup, 'pickup_time') : '—',
          drop: legs.drop ? stopText(legs.drop, 'drop_time') : '—',
        };
      };
      const crewOf = (vehicle: Vehicle | null) =>
        vehicle ? [vehicle.driver_user_id, vehicle.attendant_user_id].filter((id): id is number => Boolean(id)) : [];
      for (const change of changes) {
        const student = students.find((row) => Number(row.id) === change.student_id);
        if (!student) continue;
        const name = fullName(student.first_name, student.last_name);
        const klass = classSection(student.class_name, student.section_name) ?? 'no class';
        const guardians = parents
          .filter((row) => Number(row.student_id) === change.student_id)
          .map((row) => Number(row.user_id));
        if (change.after) {
          const legs = where(change.after);
          await this.send(TEMPLATES.TRANSPORT_ASSIGNED, schoolId, guardians, {
            student: name,
            route: routeOf(change.after.route_id)?.name ?? 'the school bus',
            pickup: legs.pickup,
            drop: legs.drop,
          });
        } else if (change.before) {
          await this.send(TEMPLATES.TRANSPORT_REMOVED, schoolId, guardians, {
            student: name,
            route: routeOf(change.before.route_id)?.name ?? 'the school bus',
          });
        }
        const oldBus = busOf(change.before);
        const newBus = busOf(change.after);
        const placeText = (place: Placement) => {
          const legs = where(place);
          if (place.mode === 'pickup') return `morning pickup at ${legs.pickup}`;
          if (place.mode === 'drop') return `evening drop at ${legs.drop}`;
          return legs.pickup === legs.drop
            ? `gets on and off at ${legs.pickup}`
            : `pickup at ${legs.pickup}, drop at ${legs.drop}`;
        };
        if (oldBus && newBus && oldBus.id === newBus.id) {
          await this.send(TEMPLATES.BUS_RIDER_CHANGED, schoolId, crewOf(newBus), {
            student: name,
            class: klass,
            detail: `stop changed: ${placeText(change.after!)}`,
          });
          continue;
        }
        if (oldBus) {
          await this.send(TEMPLATES.BUS_RIDER_CHANGED, schoolId, crewOf(oldBus), {
            student: name,
            class: klass,
            detail: `no longer rides ${oldBus.registration_no}`,
          });
        }
        if (newBus && change.after) {
          await this.send(TEMPLATES.BUS_RIDER_CHANGED, schoolId, crewOf(newBus), {
            student: name,
            class: klass,
            detail: `added to ${newBus.registration_no}: ${placeText(change.after)}`,
          });
        }
      }
    } catch (error) {
      this.logger.warn(`Transport change notices not sent: ${(error as Error).message}`);
    }
  }

  private async send(
    template: string,
    schoolId: number,
    userIds: number[],
    data: Record<string, string>,
  ): Promise<void> {
    if (!userIds.length) return;
    await this.notifications
      .dispatch({ template, audience: { user_ids: [...new Set(userIds)], school_id: schoolId }, data })
      .catch((error: Error) => this.logger.warn(`${template} not sent: ${error.message}`));
  }

  private async clashFor(
    schoolId: number,
    routeId: number,
    vehicleId: number | null,
    active: boolean,
    timings: RouteTimingsDto,
  ): Promise<{ code: string; message: string; route_id: number } | null> {
    if (!vehicleId || !active) return null;
    const mine = timeWindows(timings);
    if (!mine.length) return null;
    const vehicle = await this.vehicles.findOneBy({ id: vehicleId });
    if (!vehicle) return null;
    const crew = [vehicle.driver_user_id, vehicle.attendant_user_id].filter((id): id is number => Boolean(id));
    const buses = await this.vehicles.find({
      where: [
        { id: vehicleId },
        ...(crew.length
          ? [
              { school_id: schoolId, driver_user_id: In(crew) },
              { school_id: schoolId, attendant_user_id: In(crew) },
            ]
          : []),
      ],
    });
    const others = await this.routes.findBy({
      school_id: schoolId,
      vehicle_id: In(buses.map((bus) => bus.id)),
      is_active: true,
    });
    const school = await this.schoolContext(schoolId);
    for (const other of others.filter((item) => item.id !== routeId)) {
      const theirs = routeTimings((await this.stopList(other.id)).map(asSchedule), school, school.point);
      if (!windowsOverlap(mine, timeWindows(theirs))) continue;
      const window = `${theirs.leaves_at ?? theirs.leaves_school_at} to ${theirs.reaches_school_at ?? theirs.last_drop_at}`;
      if (other.vehicle_id === vehicleId) {
        return {
          code: 'BUS_TIME_CLASH',
          message: `${vehicle.registration_no} already runs route ${other.code} (${window}) at the same time`,
          route_id: other.id,
        };
      }
      return {
        code: 'CREW_TIME_CLASH',
        message: `The crew of ${vehicle.registration_no} also work route ${other.code} on another bus (${window}) at the same time`,
        route_id: other.id,
      };
    }
    return null;
  }

  private async busWarnings(route: TransportRoute): Promise<string[]> {
    if (!route.vehicle_id) {
      return route.is_active ? ['This route has no bus. Students cannot be added until it has one.'] : [];
    }
    const vehicle = await this.vehicles.findOneBy({ id: route.vehicle_id });
    if (!vehicle) return [];
    const warnings: string[] = [];
    if (vehicle.status !== 'active') warnings.push(`${vehicle.registration_no} is marked off the road`);
    const today = todayIn(this.app.timeZone);
    const blockers = roadBlockers(
      ROAD_KINDS.map((kind) =>
        expiryState(kind, vehicle[VEHICLE_EXPIRY_FIELDS[kind] as keyof Vehicle] as string | null, today),
      ),
    );
    if (blockers.length) warnings.push(`${vehicle.registration_no} is not road-worthy: ${blockers.join(', ')} expired`);
    const riders = tripRiders(await this.busRiders(this.dataSource.manager, vehicle.id, []));
    const seats = occupancy(Math.max(riders.pickup, riders.drop), vehicle.capacity);
    if (seats.over_capacity) warnings.push(`${vehicle.registration_no} has more students than seats on a trip`);
    else if (seats.nearly_full) warnings.push(`${vehicle.registration_no} is ${seats.occupancy_percent}% full`);
    return warnings;
  }

  private async recordStopChanges(
    schoolId: number,
    route: TransportRoute,
    before: RouteStop[],
    dto: StopsInputDto,
    removed: RouteStop[],
    riders: StudentTransport[],
    actor: AuthUser | null,
  ): Promise<void> {
    const boarding = (stopId: number) =>
      riders
        .filter((rider) => ridesTrip(rider.mode, 'pickup') && rider.stop_id === stopId)
        .map((rider) => rider.student_id);
    const leaving = (stopId: number) =>
      riders
        .filter((rider) => ridesTrip(rider.mode, 'drop') && (rider.drop_stop_id ?? rider.stop_id) === stopId)
        .map((rider) => rider.student_id);
    const anyUse = (stopId: number) => [...new Set([...boarding(stopId), ...leaving(stopId)])];
    for (const item of dto.items) {
      const old = item.id ? before.find((stop) => stop.id === item.id) : undefined;
      if (!old) {
        await this.record(schoolId, route.id, {
          kind: 'stop_added',
          summary: `New stop ${item.name} added to route ${route.name}`,
          studentIds: [],
          actor,
          reason: dto.reason,
        });
        continue;
      }
      const pickupMoved = timeShift(old.pickup_time, item.pickup_time ?? null) >= NOTIFY_TIME_SHIFT_MINUTES;
      const dropMoved = timeShift(old.drop_time, item.drop_time ?? null) >= NOTIFY_TIME_SHIFT_MINUTES;
      if (pickupMoved || dropMoved) {
        const lines = [
          pickupMoved &&
            `Pickup at ${item.name} changed from ${old.pickup_time ?? 'none'} to ${item.pickup_time ?? 'none'}`,
          dropMoved && `Drop at ${item.name} changed from ${old.drop_time ?? 'none'} to ${item.drop_time ?? 'none'}`,
        ].filter(Boolean);
        await this.record(schoolId, route.id, {
          kind: 'stop_time',
          stopId: old.id,
          summary: lines.join('. '),
          studentIds: [...new Set([...(pickupMoved ? boarding(old.id) : []), ...(dropMoved ? leaving(old.id) : [])])],
          actor,
          reason: dto.reason,
        });
      }
      if (distanceMetres(Number(old.lat), Number(old.lng), item.lat, item.lng) >= NOTIFY_MOVE_METRES) {
        await this.record(schoolId, route.id, {
          kind: 'stop_moved',
          stopId: old.id,
          summary: `Stop ${item.name} has moved${item.landmark ? ` to near ${item.landmark}` : ''}. Check the new place in the app.`,
          studentIds: anyUse(old.id),
          actor,
          reason: dto.reason,
        });
      }
    }
    for (const stop of removed) {
      await this.record(schoolId, route.id, {
        kind: 'stop_removed',
        stopId: stop.id,
        summary: `Stop ${stop.name} removed from route ${route.name}`,
        studentIds: [],
        actor,
        reason: dto.reason,
      });
    }
  }

  private async record(
    schoolId: number,
    routeId: number,
    change: {
      kind: RouteChangeKind;
      summary: string;
      studentIds: number[];
      stopId?: number;
      studentId?: number;
      actor: AuthUser | null;
      reason?: string | null;
    },
  ): Promise<void> {
    const parents = await this.parentsOf(change.studentIds);
    const reason = change.reason?.trim() || null;
    const summary = reason ? `${change.summary}. Reason: ${reason}` : change.summary;
    await this.routeChanges.insert({
      school_id: schoolId,
      route_id: routeId,
      stop_id: change.stopId ?? null,
      student_id: change.studentId ?? null,
      kind: change.kind,
      summary: summary.slice(0, 255),
      reason,
      parents_told: parents.length,
      changed_by: change.actor?.id ?? null,
    });
    await this.send(TEMPLATES.TRANSPORT_CHANGED, schoolId, parents, {
      summary,
      route_id: String(routeId),
    });
  }

  private async parentsOf(studentIds: number[]): Promise<number[]> {
    if (!studentIds.length) return [];
    const rows: { user_id: number }[] = await this.dataSource.query(
      `SELECT DISTINCT g.user_id FROM student_guardians sg
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
       WHERE sg.student_id = ANY($1) AND g.user_id IS NOT NULL AND sg.receives_alerts = true`,
      [studentIds],
    );
    return rows.map((row) => Number(row.user_id));
  }

  private async routeStudents(routeId: number): Promise<number[]> {
    return (await this.assignments.findBy({ route_id: routeId })).map((row) => row.student_id);
  }

  private async schoolContext(schoolId: number): Promise<SchoolContext> {
    const [[school], [day]] = await Promise.all([
      this.dataSource.query(`SELECT latitude, longitude FROM schools WHERE id = $1`, [schoolId]),
      this.dataSource.query(
        `SELECT MIN(start_time) AS start, MAX(end_time) AS "end" FROM bell_periods
         WHERE school_id = $1 AND is_special = false
           AND (class_id IS NULL OR NOT EXISTS (SELECT 1 FROM bell_periods b WHERE b.school_id = $1 AND b.class_id IS NULL))`,
        [schoolId],
      ),
    ]);
    return {
      start: day?.start ?? null,
      end: day?.end ?? null,
      point:
        school?.latitude != null && school?.longitude != null
          ? { lat: Number(school.latitude), lng: Number(school.longitude) }
          : null,
    };
  }

  private async studentRows(
    schoolId: number,
    filter: { student_id?: number; ids?: number[]; route_ids?: number[] },
  ): Promise<StudentTransportDto[]> {
    const where = filter.student_id ? 't.student_id = $2' : filter.ids ? 't.id = ANY($2)' : 't.route_id = ANY($2)';
    const rows: {
      id: number;
      student_id: number;
      first_name: string;
      last_name: string | null;
      admission_no: string;
      class_name: string | null;
      section_name: string | null;
      route_id: number;
      route_name: string;
      stop_id: number;
      stop_name: string;
      pickup_time: string | null;
      drop_time: string | null;
      drop_stop_id: number | null;
      drop_stop_name: string | null;
      drop_pickup_time: string | null;
      drop_drop_time: string | null;
      monthly_fee: string;
      mode: StudentTransport['mode'];
      start_date: string;
      passenger_ref: string;
      pass_status: StudentTransport['pass_status'];
      pass_note: string | null;
      pass_changed_at: Date | null;
    }[] = await this.dataSource.query(
      `SELECT t.id, t.student_id, s.first_name, s.last_name, s.admission_no, c.name AS class_name, sec.name AS section_name,
              r.id AS route_id, r.name AS route_name, st.id AS stop_id, st.name AS stop_name, st.pickup_time, st.drop_time,
              dst.id AS drop_stop_id, dst.name AS drop_stop_name, dst.pickup_time AS drop_pickup_time,
              dst.drop_time AS drop_drop_time,
              GREATEST(st.monthly_fee, COALESCE(dst.monthly_fee, 0)) AS monthly_fee,
              t.mode, to_char(t.start_date, 'YYYY-MM-DD') AS start_date, t.passenger_ref,
              t.pass_status, t.pass_note, t.pass_changed_at
       FROM student_transport t
       JOIN students s ON s.id = t.student_id
       JOIN transport_routes r ON r.id = t.route_id
       JOIN route_stops st ON st.id = t.stop_id
       LEFT JOIN route_stops dst ON dst.id = t.drop_stop_id
       LEFT JOIN student_enrollments e ON e.student_id = s.id
         AND e.academic_year_id = (SELECT id FROM academic_years y WHERE y.school_id = s.school_id AND y.is_current LIMIT 1)
       LEFT JOIN sections sec ON sec.id = e.section_id
       LEFT JOIN classes c ON c.id = COALESCE(e.class_id, sec.class_id)
       WHERE t.school_id = $1 AND t.deleted_at IS NULL AND ${where}
       ORDER BY st.sequence, s.first_name`,
      [schoolId, filter.student_id ?? filter.ids ?? filter.route_ids],
    );
    return rows.map((row) => {
      const student: StudentRow = {
        id: Number(row.student_id),
        full_name: fullName(row.first_name, row.last_name),
        admission_no: row.admission_no,
        class_section: classSection(row.class_name, row.section_name),
      };
      return {
        id: Number(row.id),
        student,
        route: { id: Number(row.route_id), name: row.route_name },
        stop: { id: Number(row.stop_id), name: row.stop_name, pickup_time: row.pickup_time, drop_time: row.drop_time },
        drop_stop: row.drop_stop_id
          ? {
              id: Number(row.drop_stop_id),
              name: row.drop_stop_name!,
              pickup_time: row.drop_pickup_time,
              drop_time: row.drop_drop_time,
            }
          : null,
        mode: row.mode,
        start_date: row.start_date,
        passenger_ref: row.passenger_ref,
        monthly_fee: Number(row.monthly_fee),
        pass_status: row.pass_status,
        pass_note: row.pass_note,
        pass_changed_at: row.pass_changed_at,
      };
    });
  }

  private async stopList(routeId: number): Promise<StopDto[]> {
    const rows = await this.stops.find({ where: { route_id: routeId }, order: { sequence: 'ASC' } });
    const counts: { stop_id: number; count: string }[] = rows.length
      ? await this.dataSource.query(
          `SELECT stop_id, COUNT(DISTINCT student_id) AS count FROM (
             SELECT student_id, stop_id FROM student_transport WHERE deleted_at IS NULL AND stop_id = ANY($1)
             UNION ALL
             SELECT student_id, drop_stop_id FROM student_transport WHERE deleted_at IS NULL AND drop_stop_id = ANY($1)
           ) riders GROUP BY stop_id`,
          [rows.map((row) => row.id)],
        )
      : [];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      landmark: row.landmark,
      lat: row.lat,
      lng: row.lng,
      sequence: row.sequence,
      pickup_time: row.pickup_time,
      drop_time: row.drop_time,
      geofence_radius_m: row.geofence_radius_m,
      monthly_fee: row.monthly_fee,
      students: Number(counts.find((item) => Number(item.stop_id) === row.id)?.count ?? 0),
    }));
  }

  private async stop(schoolId: number, routeId: number, stopId: number): Promise<RouteStop> {
    const route = await this.find(schoolId, routeId);
    const stop = await this.stops.findOneBy({ id: stopId, route_id: routeId });
    if (!stop) {
      throw AppException.validation([
        { field: 'stop_id', message: `Choose a stop on route ${route.code}: this stop is not on it` },
      ]);
    }
    return stop;
  }

  private async validate(schoolId: number, dto: Partial<RouteInputDto>, id?: number): Promise<void> {
    if (dto.code) {
      const clash = await this.routes.findOneBy({ school_id: schoolId, code: dto.code });
      if (clash && clash.id !== id) throw AppException.conflict(`Route ${dto.code} already exists`, 'ROUTE_EXISTS');
    }
    if (dto.vehicle_id) {
      const vehicle = await this.vehicles.findOneBy({ id: dto.vehicle_id, school_id: schoolId });
      if (!vehicle) throw AppException.validation([{ field: 'vehicle_id', message: 'Choose a bus of this school' }]);
    }
  }

  private async find(schoolId: number, id: number): Promise<TransportRoute> {
    const route = await this.routes.findOneBy({ id, school_id: schoolId });
    if (!route) throw AppException.notFound('Route not found', 'ROUTE_NOT_FOUND');
    return route;
  }

  private async present(schoolId: number, rows: TransportRoute[]): Promise<RouteDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const [vehicles, stats, allStops, school]: [
      Vehicle[],
      {
        route_id: number;
        stops: string;
        students: string;
        morning_riders: string;
        evening_riders: string;
        first_pickup: string | null;
      }[],
      RouteStop[],
      SchoolContext,
    ] = await Promise.all([
      this.vehicles.findBy({
        school_id: schoolId,
        id: In(rows.map((row) => row.vehicle_id).filter((value): value is number => Boolean(value))),
      }),
      this.dataSource.query(
        `SELECT r.id AS route_id,
                  (SELECT COUNT(*) FROM route_stops s WHERE s.route_id = r.id AND s.deleted_at IS NULL) AS stops,
                  (SELECT COUNT(*) FROM student_transport t WHERE t.route_id = r.id AND t.deleted_at IS NULL) AS students,
                  (SELECT COUNT(*) FILTER (WHERE t.mode IN ('both', 'pickup')) FROM student_transport t
                     JOIN students st ON st.id = t.student_id AND st.deleted_at IS NULL AND st.status = 'active'
                     WHERE t.route_id = r.id AND t.deleted_at IS NULL) AS morning_riders,
                  (SELECT COUNT(*) FILTER (WHERE t.mode IN ('both', 'drop')) FROM student_transport t
                     JOIN students st ON st.id = t.student_id AND st.deleted_at IS NULL AND st.status = 'active'
                     WHERE t.route_id = r.id AND t.deleted_at IS NULL) AS evening_riders,
                  (SELECT MIN(s.pickup_time) FROM route_stops s WHERE s.route_id = r.id AND s.deleted_at IS NULL) AS first_pickup
           FROM transport_routes r WHERE r.id = ANY($1)`,
        [ids],
      ),
      this.stops.find({ where: { route_id: In(ids) }, order: { sequence: 'ASC' } }),
      this.schoolContext(schoolId),
    ]);
    const swaps = await this.swaps.findBy({ route_id: In(ids), swap_date: todayIn(this.app.timeZone) });
    const swapBuses = swaps.length ? await this.vehicles.findBy({ id: In(swaps.map((swap) => swap.vehicle_id)) }) : [];
    return rows.map((row) => {
      const vehicle = vehicles.find((item) => item.id === row.vehicle_id);
      const swap = swaps.find((item) => item.route_id === row.id);
      const swapBus = swap ? swapBuses.find((item) => item.id === swap.vehicle_id) : undefined;
      const stat = stats.find((item) => Number(item.route_id) === row.id);
      const schedule = allStops.filter((stop) => stop.route_id === row.id).map(asSchedule);
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        vehicle: vehicle
          ? { id: vehicle.id, registration_no: vehicle.registration_no, name: vehicle.name, capacity: vehicle.capacity }
          : null,
        swap_today: swapBus
          ? {
              vehicle: {
                id: swapBus.id,
                registration_no: swapBus.registration_no,
                name: swapBus.name,
                capacity: swapBus.capacity,
              },
              reason: swap!.reason,
            }
          : null,
        is_active: row.is_active,
        stops: Number(stat?.stops ?? 0),
        students: Number(stat?.students ?? 0),
        morning_riders: Number(stat?.morning_riders ?? 0),
        evening_riders: Number(stat?.evening_riders ?? 0),
        first_pickup: stat?.first_pickup ?? null,
        timings: routeTimings(schedule, school, school.point),
        problems: checkSchedule(schedule, school).filter((item) => item.severity === 'error').length,
      };
    });
  }
}
