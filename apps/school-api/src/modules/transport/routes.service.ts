import { randomBytes } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AppException, applySearch, applySort, paginate, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { NotificationsService } from '../notifications/notifications.service';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import {
  AssignResultDto,
  AssignStopStudentsDto,
  AssignTransportDto,
  DriverDutyDto,
  ParentTransportDto,
  RosterStudentDto,
  RouteDetailDto,
  RouteDto,
  RouteInputDto,
  RouteRosterDto,
  StopDto,
  StopsInputDto,
  StudentTransportDto,
  StudentTransportQueryDto,
  TransportChangeDto,
  UpdateRouteDto,
} from './dto/transport.dto';
import { RouteStop } from './entities/route-stop.entity';
import { StudentTransportChange, TransportChangeAction } from './entities/student-transport-change.entity';
import { StudentTransport, TransportMode } from './entities/student-transport.entity';
import { TransportRoute } from './entities/transport-route.entity';
import { Vehicle } from './entities/vehicle.entity';
import { TransportFeeSyncService } from '../fees/transport-fee-sync.service';
import { TransportFeesReportService } from '../fees/transport-fees-report.service';
import { autoSequence, pathKm, RIDER_FEE_SQL, seatCheck, stopFee, stopsOf, tripRiders } from './transport.logic';

export const passengerRef = () => `P${randomBytes(9).toString('hex')}`;

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

@Injectable()
export class RoutesService {
  private readonly logger = new Logger('Transport');

  constructor(
    @InjectRepository(TransportRoute) private readonly routes: Repository<TransportRoute>,
    @InjectRepository(RouteStop) private readonly stops: Repository<RouteStop>,
    @InjectRepository(StudentTransport) private readonly assignments: Repository<StudentTransport>,
    @InjectRepository(StudentTransportChange) private readonly changes: Repository<StudentTransportChange>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    private readonly notifications: NotificationsService,
    private readonly feeSync: TransportFeeSyncService,
    private readonly feeReport: TransportFeesReportService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async list(schoolId: number): Promise<RouteDto[]> {
    const rows = await this.routes.find({ where: { school_id: schoolId }, order: { code: 'ASC' } });
    return this.present(schoolId, rows);
  }

  async detail(schoolId: number, id: number): Promise<RouteDetailDto> {
    const route = await this.find(schoolId, id);
    const [summary] = await this.present(schoolId, [route]);
    const stops = await this.stopList(route.id);
    const [school] = await this.dataSource.query(`SELECT latitude, longitude FROM schools WHERE id = $1`, [schoolId]);
    const schoolLocation =
      school?.latitude != null && school?.longitude != null
        ? { lat: Number(school.latitude), lng: Number(school.longitude) }
        : null;
    return {
      ...summary!,
      stop_list: stops,
      school_location: schoolLocation,
      distance_km: pathKm([...stops, ...(schoolLocation ? [schoolLocation] : [])]),
    };
  }

  async create(schoolId: number, dto: RouteInputDto): Promise<RouteDetailDto> {
    await this.validate(schoolId, dto);
    const saved = await this.routes.save(
      this.routes.create({
        school_id: schoolId,
        code: dto.code,
        name: dto.name,
        vehicle_id: dto.vehicle_id ?? null,
        monthly_fee: dto.monthly_fee ?? 0,
        is_active: dto.is_active ?? true,
      }),
    );
    return this.detail(schoolId, saved.id);
  }

  async update(schoolId: number, id: number, dto: UpdateRouteDto): Promise<RouteDetailDto> {
    const route = await this.find(schoolId, id);
    await this.validate(schoolId, dto, id);
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
      await manager.save(this.routes.merge(route, dto));
    });
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

  async setStops(schoolId: number, id: number, dto: StopsInputDto): Promise<RouteDetailDto> {
    await this.find(schoolId, id);
    const current = await this.stops.findBy({ route_id: id });
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
            monthly_fee: item.monthly_fee === undefined ? (existing?.monthly_fee ?? null) : item.monthly_fee,
          }),
        );
      }
    });
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
    await this.assertActiveStudents(schoolId, dto.student_ids);
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
    await this.assertActiveStudents(schoolId, [studentId], true);
    const current = await this.assignments.findOneBy({ school_id: schoolId, student_id: studentId });
    const mode = dto.mode ?? current?.mode ?? 'both';
    let dropStopId = dto.drop_stop_id ?? null;
    if (dropStopId === stop.id) dropStopId = null;
    if (dropStopId !== null) {
      if (mode !== 'both') {
        throw AppException.validation([
          { field: 'drop_stop_id', message: 'A separate drop stop is only for students who use the bus both ways' },
        ]);
      }
      const dropStop = await this.stops.findOneBy({ id: dropStopId, route_id: dto.route_id });
      if (!dropStop) {
        throw AppException.validation([{ field: 'drop_stop_id', message: 'Choose a drop stop on the same route' }]);
      }
    }
    await this.place(schoolId, dto.route_id, [
      { student_id: studentId, stop_id: stop.id, drop_stop_id: dropStopId, mode, start_date: dto.start_date },
    ]);
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
    void this.feeSync.sync(schoolId, [studentId]);
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
    }[] = await this.dataSource.query(
      `SELECT t.student_id, t.stop_id, t.drop_stop_id, t.mode, s.first_name, s.last_name, s.admission_no,
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
    const students = rows.map((row) => {
      const student: RosterStudentDto = {
        id: Number(row.student_id),
        full_name: fullName(row.first_name, row.last_name),
        admission_no: row.admission_no,
        class_section: classSection(row.class_name, row.section_name),
        mode: row.mode,
        guardian_name: row.guardian_name,
        guardian_mobile: row.guardian_mobile,
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
    const monthlyFee = Math.max(stop.monthly_fee, dropStop?.monthly_fee ?? 0);
    const vehicle = route.vehicle_id ? await this.vehicles.findOneBy({ id: route.vehicle_id }) : null;
    const people: { id: number; name: string; mobile: string }[] = vehicle
      ? await this.dataSource.query(`SELECT id, name, mobile FROM users WHERE id = ANY($1)`, [
          [vehicle.driver_user_id, vehicle.attendant_user_id].filter(Boolean),
        ])
      : [];
    const person = (id: number | null | undefined) => {
      const found = people.find((item) => Number(item.id) === id);
      return found ? { id: Number(found.id), name: found.name, mobile: found.mobile } : null;
    };
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
      monthly_fee: monthlyFee,
      fee: await this.feeReport.forStudent(schoolId, studentId, monthlyFee),
    };
  }

  async forDriver(schoolId: number, userId: number): Promise<DriverDutyDto> {
    const vehicle = await this.vehicles.findOne({
      where: [
        { school_id: schoolId, driver_user_id: userId, status: 'active' },
        { school_id: schoolId, attendant_user_id: userId, status: 'active' },
      ],
    });
    if (!vehicle) return { vehicle: null, routes: [] };
    const routes = await this.routes.find({
      where: { school_id: schoolId, vehicle_id: vehicle.id, is_active: true },
      order: { code: 'ASC' },
    });
    const riders = routes.length
      ? await this.studentRows(schoolId, { route_ids: routes.map((route) => route.id) })
      : [];
    const placed = riders.map((row) => ({
      row,
      stops: stopsOf({ stop_id: row.stop.id, drop_stop_id: row.drop_stop?.id ?? null, mode: row.mode }),
    }));
    return {
      vehicle: {
        id: vehicle.id,
        registration_no: vehicle.registration_no,
        name: vehicle.name,
        capacity: vehicle.capacity,
      },
      routes: await Promise.all(
        routes.map(async (route) => ({
          id: route.id,
          code: route.code,
          name: route.name,
          stops: (await this.stopList(route.id)).map((stop) => ({
            ...stop,
            student_list: placed
              .filter((item) => item.stops.pickup === stop.id || item.stops.drop === stop.id)
              .map((item) => ({
                ...item.row.student,
                passenger_ref: item.row.passenger_ref,
                mode: item.row.mode,
                for:
                  item.stops.pickup === stop.id && item.stops.drop === stop.id
                    ? ('both' as const)
                    : item.stops.pickup === stop.id
                      ? ('pickup' as const)
                      : ('drop' as const),
              })),
          })),
        })),
      ),
    };
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
    void this.feeSync.sync(
      schoolId,
      changes.map((change) => change.student_id),
    );
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
    }[] = await this.dataSource.query(
      `SELECT t.id, t.student_id, s.first_name, s.last_name, s.admission_no, c.name AS class_name, sec.name AS section_name,
              r.id AS route_id, r.name AS route_name, st.id AS stop_id, st.name AS stop_name, st.pickup_time, st.drop_time,
              dst.id AS drop_stop_id, dst.name AS drop_stop_name, dst.pickup_time AS drop_pickup_time,
              dst.drop_time AS drop_drop_time,
              ${RIDER_FEE_SQL('st', 'dst', 'r')} AS monthly_fee,
              t.mode, to_char(t.start_date, 'YYYY-MM-DD') AS start_date, t.passenger_ref
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
      };
    });
  }

  private async stopList(routeId: number): Promise<StopDto[]> {
    const rows = await this.stops.find({ where: { route_id: routeId }, order: { sequence: 'ASC' } });
    const route = await this.routes.findOne({ where: { id: routeId }, withDeleted: true });
    const routeFee = Number(route?.monthly_fee ?? 0);
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
      monthly_fee: stopFee(row.monthly_fee, routeFee),
      fee_override: row.monthly_fee,
      students: Number(counts.find((item) => Number(item.stop_id) === row.id)?.count ?? 0),
    }));
  }

  private async stop(schoolId: number, routeId: number, stopId: number): Promise<RouteStop> {
    await this.find(schoolId, routeId);
    const stop = await this.stops.findOneBy({ id: stopId, route_id: routeId });
    if (!stop) throw AppException.validation([{ field: 'stop_id', message: 'Choose a stop on this route' }]);
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
    const [vehicles, stats]: [
      Vehicle[],
      { route_id: number; stops: string; students: string; first_pickup: string | null }[],
    ] = await Promise.all([
      this.vehicles.findBy({
        school_id: schoolId,
        id: In(rows.map((row) => row.vehicle_id).filter((value): value is number => Boolean(value))),
      }),
      this.dataSource.query(
        `SELECT r.id AS route_id,
                  (SELECT COUNT(*) FROM route_stops s WHERE s.route_id = r.id AND s.deleted_at IS NULL) AS stops,
                  (SELECT COUNT(*) FROM student_transport t WHERE t.route_id = r.id AND t.deleted_at IS NULL) AS students,
                  (SELECT MIN(s.pickup_time) FROM route_stops s WHERE s.route_id = r.id AND s.deleted_at IS NULL) AS first_pickup
           FROM transport_routes r WHERE r.id = ANY($1)`,
        [ids],
      ),
    ]);
    return rows.map((row) => {
      const vehicle = vehicles.find((item) => item.id === row.vehicle_id);
      const stat = stats.find((item) => Number(item.route_id) === row.id);
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        vehicle: vehicle
          ? { id: vehicle.id, registration_no: vehicle.registration_no, name: vehicle.name, capacity: vehicle.capacity }
          : null,
        is_active: row.is_active,
        stops: Number(stat?.stops ?? 0),
        students: Number(stat?.students ?? 0),
        first_pickup: stat?.first_pickup ?? null,
        monthly_fee: Number(row.monthly_fee),
      };
    });
  }
}
