import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThanOrEqual, Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { maskMobile } from '../../shared/mobile';
import { addDays } from '../../shared/school-days';
import { FilesService } from '../files/files.service';
import { MobileAccessService } from '../mobile/mobile-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { TripsService } from '../tracking/trips.service';
import { vehicleOnDay } from '../transport/bus-swaps';
import { TransportRoute } from '../transport/entities/transport-route.entity';
import { Vehicle } from '../transport/entities/vehicle.entity';
import {
  ChildBusTodayDto,
  OptOutDto,
  OptOutInputDto,
  PickupPersonDto,
  PickupPersonInputDto,
  StudentHandoverDto,
} from './dto/driver-ops.dto';
import { BusOptOut, BusPickupPerson, OptOutTrip } from './entities/driver-ops.entity';

const OPT_OUT_DAYS_AHEAD = 30;
const PICKUP_DAYS_AHEAD = 7;
const TRIP_LABELS: Record<OptOutTrip, string> = { pickup: 'morning pickup', drop: 'evening drop' };

@Injectable()
export class BusRequestsService {
  private readonly logger = new Logger('BusRequests');

  constructor(
    @InjectRepository(BusOptOut) private readonly optOuts: Repository<BusOptOut>,
    @InjectRepository(BusPickupPerson) private readonly pickups: Repository<BusPickupPerson>,
    private readonly access: MobileAccessService,
    private readonly trips: TripsService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async childBus(user: AuthUser, studentId: number): Promise<ChildBusTodayDto> {
    const schoolId = await this.access.childSchool(user.id, studentId);
    const today = todayIn(this.app.timeZone);
    const [optOuts, pickups] = await Promise.all([
      this.optOuts.find({
        where: { school_id: schoolId, student_id: studentId, opt_date: MoreThanOrEqual(today) },
        order: { opt_date: 'ASC', trip: 'DESC' },
      }),
      this.pickups.find({
        where: { school_id: schoolId, student_id: studentId, pickup_date: MoreThanOrEqual(today) },
        order: { pickup_date: 'ASC' },
      }),
    ]);
    return { date: today, opt_outs: optOuts.map(presentOptOut), pickup_persons: await this.presentPickups(pickups) };
  }

  async optOut(user: AuthUser, studentId: number, dto: OptOutInputDto): Promise<ChildBusTodayDto> {
    const schoolId = await this.access.childSchool(user.id, studentId);
    const assignment = await this.assignment(schoolId, studentId);
    const today = todayIn(this.app.timeZone);
    this.assertDate(dto.date, today, OPT_OUT_DAYS_AHEAD);
    const trips = [...new Set(dto.trips)];
    if (!trips.length) throw AppException.validation([{ field: 'trips', message: 'Pick pickup, drop or both' }]);
    const added: OptOutTrip[] = [];
    for (const trip of trips) {
      const existing = await this.optOuts.findOneBy({ student_id: studentId, opt_date: dto.date, trip });
      if (existing) continue;
      const running = await this.dataSource.query(
        `SELECT 1 FROM transport_boardings b JOIN transport_trips t ON t.id = b.trip_id
         WHERE b.student_id = $1 AND t.trip_date = $2 AND t.kind = $3 LIMIT 1`,
        [studentId, dto.date, trip],
      );
      if (running.length) {
        throw AppException.conflict(`${TRIP_LABELS[trip]} is already marked on the bus for this day`, 'ALREADY_ON_BUS');
      }
      await this.optOuts.save(
        this.optOuts.create({
          school_id: schoolId,
          student_id: studentId,
          opt_date: dto.date,
          trip,
          reason: dto.reason ?? null,
          created_by: user.id,
        }),
      );
      added.push(trip);
    }
    if (added.length) {
      await this.tellDriver(assignment.route_id, studentId, dto.date, TEMPLATES.BUS_OPT_OUT, {
        trips: added.map((trip) => TRIP_LABELS[trip]).join(' and '),
        reason: dto.reason ? ` Reason: ${dto.reason}` : '',
      });
    }
    return this.childBus(user, studentId);
  }

  async cancelOptOut(user: AuthUser, studentId: number, optOutId: number): Promise<ChildBusTodayDto> {
    const schoolId = await this.access.childSchool(user.id, studentId);
    const row = await this.optOuts.findOneBy({ id: optOutId, student_id: studentId, school_id: schoolId });
    if (!row) throw AppException.notFound('This request was not found', 'OPT_OUT_NOT_FOUND');
    if (row.opt_date < todayIn(this.app.timeZone)) {
      throw AppException.conflict('This day is over', 'OPT_OUT_PAST');
    }
    await this.optOuts.softDelete(row.id);
    return this.childBus(user, studentId);
  }

  async setPickupPerson(user: AuthUser, studentId: number, dto: PickupPersonInputDto): Promise<ChildBusTodayDto> {
    const schoolId = await this.access.childSchool(user.id, studentId);
    const assignment = await this.assignment(schoolId, studentId);
    const today = todayIn(this.app.timeZone);
    this.assertDate(dto.date, today, PICKUP_DAYS_AHEAD);
    if (dto.photo_file_id !== undefined) {
      const [file] = await this.dataSource.query(`SELECT id FROM files WHERE id = $1 AND school_id = $2`, [
        dto.photo_file_id,
        schoolId,
      ]);
      if (!file) throw AppException.validation([{ field: 'photo_file_id', message: 'Upload the photo first' }]);
    }
    const existing = await this.pickups.findOneBy({ student_id: studentId, pickup_date: dto.date });
    if (existing) await this.pickups.softDelete(existing.id);
    await this.pickups.save(
      this.pickups.create({
        school_id: schoolId,
        student_id: studentId,
        pickup_date: dto.date,
        name: dto.name,
        relation: dto.relation,
        mobile: dto.mobile,
        photo_file_id: dto.photo_file_id ?? null,
        created_by: user.id,
      }),
    );
    await this.tellDriver(assignment.route_id, studentId, dto.date, TEMPLATES.BUS_PICKUP_PERSON, {
      person: `${dto.name} (${dto.relation})`,
    });
    return this.childBus(user, studentId);
  }

  async removePickupPerson(user: AuthUser, studentId: number, id: number): Promise<ChildBusTodayDto> {
    const schoolId = await this.access.childSchool(user.id, studentId);
    const row = await this.pickups.findOneBy({ id, student_id: studentId, school_id: schoolId });
    if (!row) throw AppException.notFound('This pickup person was not found', 'PICKUP_PERSON_NOT_FOUND');
    await this.pickups.softDelete(row.id);
    return this.childBus(user, studentId);
  }

  async handoverList(user: AuthUser, tripId: number): Promise<StudentHandoverDto[]> {
    const vehicle = await this.trips.crewVehicle(user);
    if (!vehicle) throw AppException.forbidden('You are not the driver or attendant of any bus', 'NO_BUS');
    const trip = await this.trips.find(vehicle.school_id, tripId);
    if (trip.vehicle_id !== vehicle.id) throw AppException.forbidden('This trip is not on your bus', 'NOT_YOUR_TRIP');
    const riders = await this.trips.riders(trip);
    const ids = riders.map((rider) => rider.student_id);
    if (!ids.length) return [];
    const [guardians, oneTime, health] = await Promise.all([
      this.dataSource.query(
        `SELECT sg.student_id, g.name, sg.relation, g.mobile, g.photo_file_id
         FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
         WHERE sg.student_id = ANY($1) AND sg.can_pickup = true
         ORDER BY sg.is_primary DESC, g.name`,
        [ids],
      ) as Promise<
        { student_id: number; name: string; relation: string; mobile: string | null; photo_file_id: number | null }[]
      >,
      this.pickups.find({ where: { school_id: trip.school_id, pickup_date: trip.trip_date } }),
      this.dataSource.query(
        `SELECT student_id, allergies, conditions, medications FROM student_health WHERE student_id = ANY($1)`,
        [ids],
      ) as Promise<
        { student_id: number; allergies: string | null; conditions: string | null; medications: string | null }[]
      >,
    ]);
    const files = await this.files.presentMany([
      ...guardians.map((row) => row.photo_file_id),
      ...oneTime.map((row) => row.photo_file_id),
    ]);
    const url = (id: number | null) => (id ? (files.get(id)?.url ?? null) : null);
    return riders.map((rider) => {
      const note = health.find((row) => Number(row.student_id) === rider.student_id);
      const medical = note ? [note.allergies, note.conditions, note.medications].filter((part) => part?.trim()) : [];
      return {
        student_id: rider.student_id,
        full_name: rider.full_name,
        persons: [
          ...oneTime
            .filter((row) => row.student_id === rider.student_id)
            .map((row) => ({
              name: row.name,
              relation: row.relation,
              mobile: maskMobile(row.mobile),
              photo_url: url(row.photo_file_id),
              one_time: true,
            })),
          ...guardians
            .filter((row) => Number(row.student_id) === rider.student_id)
            .map((row) => ({
              name: row.name,
              relation: row.relation,
              mobile: row.mobile ? maskMobile(row.mobile) : null,
              photo_url: url(row.photo_file_id),
              one_time: false,
            })),
        ],
        medical_note: medical.length ? medical.join('; ') : null,
      };
    });
  }

  private async assignment(schoolId: number, studentId: number): Promise<{ route_id: number }> {
    const [row] = await this.dataSource.query(
      `SELECT route_id FROM student_transport WHERE school_id = $1 AND student_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [schoolId, studentId],
    );
    if (!row) throw AppException.conflict('This child does not use the school bus', 'NO_BUS_ASSIGNED');
    return { route_id: Number(row.route_id) };
  }

  private assertDate(date: string, today: string, daysAhead: number): void {
    if (date < today) throw AppException.validation([{ field: 'date', message: 'Pick today or a later day' }]);
    if (date > addDays(today, daysAhead)) {
      throw AppException.validation([{ field: 'date', message: `Pick a day within ${daysAhead} days` }]);
    }
  }

  private async tellDriver(
    routeId: number,
    studentId: number,
    date: string,
    template: string,
    data: Record<string, string>,
  ): Promise<void> {
    try {
      const route = await this.dataSource.getRepository(TransportRoute).findOneBy({ id: routeId });
      if (!route) return;
      const vehicleId = await vehicleOnDay(this.dataSource, route, date);
      const vehicle = vehicleId ? await this.dataSource.getRepository(Vehicle).findOneBy({ id: vehicleId }) : null;
      const crew = [vehicle?.driver_user_id, vehicle?.attendant_user_id].filter((id): id is number => Boolean(id));
      if (!crew.length) return;
      const [student] = await this.dataSource.query(
        `SELECT concat_ws(' ', first_name, last_name) AS name FROM students WHERE id = $1`,
        [studentId],
      );
      await this.notifications.dispatch({
        template,
        audience: { user_ids: crew },
        data: {
          ...data,
          student: student?.name ?? 'A student',
          day: date === todayIn(this.app.timeZone) ? 'today' : date,
          student_id: String(studentId),
        },
      });
    } catch (error) {
      this.logger.warn(`Driver notice ${template} failed: ${(error as Error).message}`);
    }
  }

  private async presentPickups(rows: BusPickupPerson[]): Promise<PickupPersonDto[]> {
    const files = await this.files.presentMany(rows.map((row) => row.photo_file_id));
    return rows.map((row) => ({
      id: row.id,
      date: row.pickup_date,
      name: row.name,
      relation: row.relation,
      mobile: row.mobile,
      photo_url: row.photo_file_id ? (files.get(row.photo_file_id)?.url ?? null) : null,
    }));
  }
}

function presentOptOut(row: BusOptOut): OptOutDto {
  return { id: row.id, date: row.opt_date, trip: row.trip, reason: row.reason, created_at: row.created_at };
}
