import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, IsNull, Repository } from 'typeorm';
import { AppException, AuthUser, paginate, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { addDays } from '../../shared/school-days';
import { ROLES } from '../access/access.catalog';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { TransportMode } from '../transport/entities/student-transport.entity';
import { TransportRoute } from '../transport/entities/transport-route.entity';
import { RoutesService } from '../transport/routes.service';
import { awayLookup } from '../../shared/student-away';
import { checklistSummary, missedTheBus, RiderMarks, riderStatus, tripFlag, undoRefusal } from './boarding.logic';
import {
  BoardingHistoryQueryDto,
  BoardingMarkDto,
  SectionBusBoardingDto,
  StudentTripDto,
  TripChecklistDto,
  TripHistoryDto,
} from './dto/checklist.dto';
import { RiderDto } from './dto/tracking.dto';
import { TransportTrip } from './entities/transport-trip.entity';
import { TripBoarding } from './entities/trip-boarding.entity';
import { LiveGateway } from './live.gateway';
import { ridesOn } from './tracking.logic';
import { TripsService } from './trips.service';

const HISTORY_DAYS = 30;

const TRIP_LABELS: Record<TransportTrip['kind'], { en: string; ta: string }> = {
  pickup: { en: 'morning bus', ta: 'காலை' },
  drop: { en: 'evening bus', ta: 'மாலை' },
};

interface Marks {
  boarded: BoardingMarkDto | null;
  alighted: BoardingMarkDto | null;
}

@Injectable()
export class BoardingChecklistService {
  private readonly logger = new Logger('BoardingChecklist');

  constructor(
    @InjectRepository(TripBoarding) private readonly boardings: Repository<TripBoarding>,
    @InjectRepository(TransportTrip) private readonly trips: Repository<TransportTrip>,
    private readonly tripsService: TripsService,
    private readonly routes: RoutesService,
    private readonly notifications: NotificationsService,
    private readonly gateway: LiveGateway,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async checklist(trip: TransportTrip): Promise<TripChecklistDto> {
    const [[summary], riders, marks] = await Promise.all([
      this.tripsService.present([trip]),
      this.tripsService.riders(trip),
      this.marks([trip]),
    ]);
    const ended = trip.status === 'ended';
    const stopNames = new Map(trip.stops.map((stop) => [stop.stop_id, stop.name]));
    const contacts = await this.routes.riderContacts(riders.map((rider) => rider.student_id));
    return {
      trip: summary!,
      summary: checklistSummary(riders, ended),
      students: riders.map((rider) => {
        const recorded = marks.get(markKey(trip.id, rider.student_id));
        return {
          student_id: rider.student_id,
          full_name: rider.full_name,
          class_section: rider.class_section,
          stop: stopNames.has(rider.stop_id) ? { id: rider.stop_id, name: stopNames.get(rider.stop_id)! } : null,
          status: riderStatus(rider),
          flag: tripFlag(rider, ended),
          boarded: recorded?.boarded ?? null,
          alighted: recorded?.alighted ?? null,
          away_note: rider.away_note,
          photo_url: contacts.get(rider.student_id)?.photo_url ?? null,
          parents: contacts.get(rider.student_id)?.parents ?? [],
          pass_status: contacts.get(rider.student_id)?.pass_status ?? 'active',
        };
      }),
    };
  }

  async officeChecklist(schoolId: number, tripId: number): Promise<TripChecklistDto> {
    return this.checklist(await this.tripsService.find(schoolId, tripId));
  }

  async studentHistory(
    schoolId: number,
    studentId: number,
    query: BoardingHistoryQueryDto,
  ): Promise<Paginated<StudentTripDto>> {
    const [student] = await this.dataSource.query(
      `SELECT 1 FROM students WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [studentId, schoolId],
    );
    if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    return this.childHistory(schoolId, studentId, query);
  }

  async childToday(schoolId: number, studentId: number): Promise<StudentTripDto[]> {
    const today = todayIn(this.app.timeZone);
    const result = await this.childHistory(schoolId, studentId, { from: today, to: today, page: 1, limit: 10 });
    return [...result.items].reverse();
  }

  async crewChecklist(schoolId: number, tripId: number, vehicleId: number): Promise<TripChecklistDto> {
    return this.checklist(await this.crewTrip(schoolId, tripId, vehicleId));
  }

  async undo(user: AuthUser, tripId: number, boardingId: number, vehicleId: number): Promise<TripChecklistDto> {
    const trip = await this.crewTrip(user.school_id!, tripId, vehicleId);
    if (trip.status !== 'active') throw AppException.conflict('This trip has ended', 'TRIP_ENDED');
    const row = await this.boardings.findOneBy({ id: boardingId, trip_id: trip.id });
    if (!row) throw AppException.notFound('Boarding not found on this trip', 'BOARDING_NOT_FOUND');
    const recorded = await this.boardings.find({ where: { trip_id: trip.id, student_id: row.student_id } });
    const refusal = undoRefusal(
      recorded.map((item) => item.action),
      row.action,
    );
    if (refusal) throw AppException.conflict(refusal.message, refusal.code);
    await this.boardings.delete(row.id);
    this.gateway.passengerUndone(trip, row);
    return this.checklist(trip);
  }

  async afterTripEnded(trip: TransportTrip): Promise<number> {
    const claimed = await this.trips.update(
      { id: trip.id, status: 'ended', flags_sent_at: IsNull() },
      { flags_sent_at: new Date() },
    );
    if (!claimed.affected) return 0;
    const riders = await this.tripsService.riders(trip);
    const [info] = await this.dataSource.query(`SELECT name, registration_no FROM vehicles WHERE id = $1`, [
      trip.vehicle_id,
    ]);
    const bus = info ? `${info.name} (${info.registration_no})` : 'the school bus';
    const [office, parents] = await Promise.all([
      this.leftOnBusAlert(trip, riders, bus),
      this.notOnBusNotice(trip, riders, bus),
    ]);
    return office + parents;
  }

  private async leftOnBusAlert(trip: TransportTrip, riders: RiderDto[], bus: string): Promise<number> {
    const onBus = riders.filter((rider) => rider.boarded && !rider.alighted);
    if (!onBus.length) return 0;
    const result = await this.notifications
      .dispatch({
        template: TEMPLATES.STUDENTS_LEFT_ON_BUS,
        audience: { roles: [ROLES.ADMIN, ROLES.TRANSPORT_INCHARGE], school_id: trip.school_id },
        data: {
          bus,
          count: String(onBus.length),
          names: onBus.map((rider) => rider.full_name).join(', '),
          trip_id: String(trip.id),
        },
      })
      .catch((error: Error) => {
        this.logger.warn(`Trip ${trip.id} left-on-bus alert failed: ${error.message}`);
        return { recipients: 0 };
      });
    return result.recipients;
  }

  private async notOnBusNotice(trip: TransportTrip, riders: RiderDto[], bus: string): Promise<number> {
    const missed = missedTheBus(riders);
    if (!missed.length) return 0;
    const guardians: { student_id: number; user_id: number }[] = await this.dataSource.query(
      `SELECT DISTINCT sg.student_id, g.user_id FROM student_guardians sg
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL AND g.user_id IS NOT NULL
       WHERE sg.student_id = ANY($1) AND sg.receives_alerts = true`,
      [missed.map((rider) => rider.student_id)],
    );
    const label = TRIP_LABELS[trip.kind];
    let sent = 0;
    for (const rider of missed) {
      const userIds = guardians
        .filter((row) => Number(row.student_id) === rider.student_id)
        .map((row) => Number(row.user_id));
      if (!userIds.length) continue;
      const result = await this.notifications
        .dispatch({
          template: TEMPLATES.CHILD_NOT_ON_BUS,
          audience: { user_ids: userIds },
          data: {
            student: rider.full_name,
            bus,
            trip: label.en,
            trip_ta: label.ta,
            trip_id: String(trip.id),
            student_id: String(rider.student_id),
          },
        })
        .catch((error: Error) => {
          this.logger.warn(`Trip ${trip.id} not-on-bus notice for ${rider.student_id} failed: ${error.message}`);
          return { recipients: 0 };
        });
      sent += result.recipients;
    }
    return sent;
  }

  async vehicleHistory(
    schoolId: number,
    vehicleId: number,
    query: BoardingHistoryQueryDto,
  ): Promise<Paginated<TripHistoryDto>> {
    const { from, to } = this.range(query);
    const [rows, total] = await this.trips
      .createQueryBuilder('t')
      .where('t.school_id = :schoolId AND t.vehicle_id = :vehicleId', { schoolId, vehicleId })
      .andWhere('t.trip_date BETWEEN :from AND :to', { from, to })
      .orderBy('t.started_at', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    const [presented, riders] = await Promise.all([
      this.tripsService.present(rows),
      Promise.all(rows.map((trip) => this.tripsService.riders(trip))),
    ]);
    const items = presented.map((trip, index) => ({
      ...trip,
      summary: checklistSummary(riders[index]!, rows[index]!.status === 'ended'),
    }));
    return paginate([items, total], query.page, query.limit);
  }

  async childHistory(
    schoolId: number,
    studentId: number,
    query: BoardingHistoryQueryDto,
  ): Promise<Paginated<StudentTripDto>> {
    const { from, to } = this.range(query);
    const [assignment] = await this.assignments(schoolId, [studentId]);
    const qb = this.trips
      .createQueryBuilder('t')
      .where('t.school_id = :schoolId', { schoolId })
      .andWhere('t.trip_date BETWEEN :from AND :to', { from, to })
      .andWhere(
        new Brackets((where) => {
          where.where(
            'EXISTS (SELECT 1 FROM transport_boardings b WHERE b.trip_id = t.id AND b.student_id = :studentId)',
            { studentId },
          );
          if (assignment?.mode === 'both') {
            where.orWhere('t.route_id = :routeId', { routeId: assignment.route_id });
          } else if (assignment) {
            where.orWhere('(t.route_id = :routeId AND t.kind = :kind)', {
              routeId: assignment.route_id,
              kind: assignment.mode,
            });
          }
        }),
      );
    const [rows, total] = await qb
      .orderBy('t.trip_date', 'DESC')
      .addOrderBy('t.started_at', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    const items = (await this.studentTrips(rows, [studentId])).map((row) => row.trip);
    return paginate([items, total], query.page, query.limit);
  }

  async sectionDay(schoolId: number, sectionId: number, date: string | undefined): Promise<SectionBusBoardingDto> {
    const day = date ?? todayIn(this.app.timeZone);
    const students: { student_id: number; first_name: string; last_name: string | null }[] =
      await this.dataSource.query(
        `SELECT s.id AS student_id, s.first_name, s.last_name
         FROM student_enrollments e
         JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
         JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current
         WHERE e.section_id = $1 AND s.school_id = $2
         ORDER BY s.first_name`,
        [sectionId, schoolId],
      );
    const ids = students.map((row) => Number(row.student_id));
    const assignments = await this.assignments(schoolId, ids);
    const routeIds = [...new Set(assignments.map((row) => row.route_id))];
    const dayTrips = routeIds.length
      ? await this.trips.find({
          where: { school_id: schoolId, trip_date: day, route_id: In(routeIds) },
          order: { started_at: 'ASC' },
        })
      : [];
    const trips = await this.studentTrips(
      dayTrips,
      assignments.map((row) => row.student_id),
    );
    return {
      date: day,
      students: students.flatMap((student) => {
        const assignment = assignments.find((row) => row.student_id === Number(student.student_id));
        if (!assignment) return [];
        return [
          {
            student_id: assignment.student_id,
            full_name: [student.first_name, student.last_name].filter(Boolean).join(' '),
            trips: trips
              .filter(
                (row) =>
                  row.student_id === assignment.student_id &&
                  row.trip.route.id === assignment.route_id &&
                  ridesOn(assignment.mode, row.trip.kind),
              )
              .map((row) => row.trip),
          },
        ];
      }),
    };
  }

  private async studentTrips(
    trips: TransportTrip[],
    studentIds: number[],
  ): Promise<{ student_id: number; trip: StudentTripDto }[]> {
    if (!trips.length || !studentIds.length) return [];
    const dates = [...new Set(trips.map((trip) => trip.trip_date))];
    const [marks, away, routes] = await Promise.all([
      this.marks(trips, studentIds),
      awayLookup(this.dataSource, studentIds, dates),
      this.dataSource
        .getRepository(TransportRoute)
        .findBy({ id: In([...new Set(trips.map((trip) => trip.route_id))]) }),
    ]);
    return trips.flatMap((trip) =>
      studentIds.map((studentId) => {
        const recorded = marks.get(markKey(trip.id, studentId));
        const absence = away(studentId, trip.trip_date, trip.kind);
        const rider: RiderMarks = {
          boarded: Boolean(recorded?.boarded),
          alighted: Boolean(recorded?.alighted),
          away_today: Boolean(absence),
        };
        return {
          student_id: studentId,
          trip: {
            trip_id: trip.id,
            trip_date: trip.trip_date,
            kind: trip.kind,
            trip_status: trip.status,
            route: { id: trip.route_id, name: routes.find((route) => route.id === trip.route_id)?.name ?? '' },
            status: riderStatus(rider),
            flag: tripFlag(rider, trip.status === 'ended'),
            boarded: recorded?.boarded ?? null,
            alighted: recorded?.alighted ?? null,
            away_note: absence?.note ?? null,
          },
        };
      }),
    );
  }

  private async marks(trips: TransportTrip[], studentIds?: number[]): Promise<Map<string, Marks>> {
    const result = new Map<string, Marks>();
    if (!trips.length) return result;
    const rows = await this.boardings.find({
      where: {
        trip_id: In(trips.map((trip) => trip.id)),
        ...(studentIds ? { student_id: In(studentIds) } : {}),
      },
    });
    if (!rows.length) return result;
    const people: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT id, name FROM users WHERE id = ANY($1)`,
      [[...new Set(rows.map((row) => row.recorded_by).filter(Boolean))]],
    );
    const stopNames = new Map(
      trips.flatMap((trip) => trip.stops.map((stop) => [`${trip.id}:${stop.stop_id}`, stop.name] as const)),
    );
    for (const row of rows) {
      const key = markKey(row.trip_id, row.student_id);
      const entry = result.get(key) ?? { boarded: null, alighted: null };
      const person = people.find((item) => Number(item.id) === row.recorded_by);
      entry[row.action] = {
        id: row.id,
        at: row.occurred_at,
        method: row.method,
        stop: row.stop_id ? { id: row.stop_id, name: stopNames.get(`${row.trip_id}:${row.stop_id}`) ?? '' } : null,
        recorded_by: person ? { id: Number(person.id), name: person.name } : null,
      };
      result.set(key, entry);
    }
    return result;
  }

  private async assignments(
    schoolId: number,
    studentIds: number[],
  ): Promise<{ student_id: number; route_id: number; mode: TransportMode }[]> {
    if (!studentIds.length) return [];
    const rows: { student_id: number; route_id: number; mode: TransportMode }[] = await this.dataSource.query(
      `SELECT student_id, route_id, mode FROM student_transport
       WHERE school_id = $1 AND student_id = ANY($2) AND deleted_at IS NULL`,
      [schoolId, studentIds],
    );
    return rows.map((row) => ({ student_id: Number(row.student_id), route_id: Number(row.route_id), mode: row.mode }));
  }

  private async crewTrip(schoolId: number, tripId: number, vehicleId: number): Promise<TransportTrip> {
    const trip = await this.tripsService.find(schoolId, tripId);
    if (trip.vehicle_id !== vehicleId) throw AppException.forbidden('This trip is not on your bus', 'NOT_YOUR_TRIP');
    return trip;
  }

  private range(query: BoardingHistoryQueryDto): { from: string; to: string } {
    const to = query.to ?? todayIn(this.app.timeZone);
    const from = query.from ?? addDays(to, -HISTORY_DAYS);
    if (from > to) throw AppException.validation([{ field: 'from', message: 'from must be on or before to' }]);
    return { from, to };
  }
}

function markKey(tripId: number, studentId: number): string {
  return `${tripId}:${studentId}`;
}
