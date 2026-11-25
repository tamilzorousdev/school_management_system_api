import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { awayLookup } from '../../shared/student-away';
import { FilesService } from '../files/files.service';
import { StudentLifecycleService } from '../student-lifecycle/student-lifecycle.service';
import { TripsService } from '../tracking/trips.service';
import { routeIdsRunBy } from '../transport/bus-swaps';
import { ridesTrip } from '../transport/transport.logic';
import { BusPassService } from '../transport/bus-pass.service';
import { crewLabel } from '../transport/bus-pass.logic';
import { Vehicle } from '../transport/entities/vehicle.entity';
import { MyStudentDto, MyStudentsDto, ScanInputDto, ScanResultDto, ScanWarning } from './dto/driver-students.dto';

interface RiderRow {
  student_id: number;
  route_id: number;
  route_name: string;
  mode: 'both' | 'pickup' | 'drop';
  stop_id: number;
  drop_stop_id: number | null;
  pass_status: 'active' | 'on_hold';
  pass_note: string | null;
  hold_kind: 'fee' | 'office' | null;
  first_name: string;
  last_name: string | null;
  admission_no: string;
  photo_file_id: number | null;
  class_name: string | null;
  section_name: string | null;
  roll_no: number | null;
}

@Injectable()
export class DriverStudentsService {
  constructor(
    private readonly trips: TripsService,
    private readonly passes: BusPassService,
    private readonly lifecycle: StudentLifecycleService,
    private readonly files: FilesService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async scan(user: AuthUser, dto: ScanInputDto): Promise<ScanResultDto> {
    const vehicle = await this.myBus(user);
    const schoolId = vehicle.school_id;
    if (!dto.qr_token?.trim() && !dto.pass_no?.trim()) {
      throw AppException.validation([{ field: 'qr_token', message: 'Scan the pass or type the pass number' }]);
    }
    let studentId: number;
    if (dto.qr_token?.trim()) {
      studentId = (await this.lifecycle.verifyQr(schoolId, dto.qr_token.trim())).student_id;
    } else {
      const [row] = await this.dataSource.query(
        `SELECT student_id FROM bus_passes WHERE school_id = $1 AND upper(pass_no) = upper($2) AND deleted_at IS NULL
         ORDER BY academic_year_id DESC LIMIT 1`,
        [schoolId, dto.pass_no!.trim()],
      );
      if (!row) throw AppException.notFound('No bus pass with this number', 'PASS_NOT_FOUND');
      studentId = Number(row.student_id);
    }
    const pass = await this.passes.forStudent(schoolId, studentId);
    const [assignment] = await this.riderRows(schoolId, { studentIds: [studentId] });
    const held = assignment?.pass_status === 'on_hold';
    const state = held ? 'on_hold' : pass.state;
    const holdKind = held ? assignment!.hold_kind : null;
    const warnings: ScanWarning[] = [];
    if (state === 'on_hold') warnings.push('PASS_ON_HOLD');
    if (state === 'expired') warnings.push('PASS_EXPIRED');
    if (state === 'awaiting_payment') warnings.push('PASS_AWAITING_PAYMENT');
    const onMyBus = pass.bus?.id === vehicle.id;
    if (!onMyBus) warnings.push('WRONG_BUS');

    let trip: ScanResultDto['trip'] = null;
    if (dto.trip_id !== undefined) {
      const running = await this.trips.find(schoolId, dto.trip_id);
      if (running.vehicle_id !== vehicle.id) {
        throw AppException.forbidden('This trip is not on your bus', 'NOT_YOUR_TRIP');
      }
      const rides =
        Boolean(assignment) &&
        assignment!.route_id === running.route_id &&
        (assignment!.mode === 'both' || assignment!.mode === running.kind);
      const marks: { action: string }[] = await this.dataSource.query(
        `SELECT action FROM transport_boardings WHERE trip_id = $1 AND student_id = $2`,
        [running.id, studentId],
      );
      const done = new Set(marks.map((mark) => mark.action));
      const away = (await awayLookup(this.dataSource, [studentId], [running.trip_date]))(
        studentId,
        running.trip_date,
        running.kind,
      );
      if (!rides) warnings.push('NOT_ON_THIS_TRIP');
      if (away) warnings.push('AWAY_TODAY');
      const suggested = !rides ? null : !done.has('boarded') ? 'boarded' : !done.has('alighted') ? 'alighted' : null;
      if (rides && !suggested) warnings.push('ALREADY_DONE');
      trip = {
        trip_id: running.id,
        kind: running.kind,
        rides,
        boarded: done.has('boarded'),
        alighted: done.has('alighted'),
        missed: done.has('missed'),
        away_note: away?.note ?? null,
        suggested_action: running.status === 'active' ? suggested : null,
      };
    }
    return {
      student: {
        id: studentId,
        full_name: pass.student.full_name,
        admission_no: assignment?.admission_no ?? null,
        class_section: assignment ? classSection(assignment) : null,
        photo_url: pass.student.photo_url ?? null,
      },
      pass: {
        pass_no: pass.pass_no,
        state,
        label:
          state === 'on_hold'
            ? (crewLabel('on_hold', holdKind) ?? 'Pass on hold')
            : state === 'active'
              ? `Valid till ${pass.valid_until}`
              : state === 'expired'
                ? 'Pass expired'
                : 'Bus fee not paid yet',
        hold_kind: holdKind,
        reason: held ? (assignment!.pass_note ?? pass.hold_note ?? null) : null,
        valid_until: pass.valid_until,
        fee_pending: pass.fee.pending_amount,
      },
      route: pass.route,
      stop: pass.pickup?.name ?? null,
      bus: pass.bus ? { id: pass.bus.id, name: `${pass.bus.name} (${pass.bus.registration_no})` } : null,
      on_my_bus: onMyBus,
      trip,
      warnings,
    };
  }

  async myStudents(user: AuthUser): Promise<MyStudentsDto> {
    const vehicle = await this.myBus(user);
    const schoolId = vehicle.school_id;
    const date = todayIn(this.app.timeZone);
    const routeIds = await routeIdsRunBy(this.dataSource, schoolId, vehicle.id, date);
    const empty: MyStudentsDto = {
      date,
      vehicle: { id: vehicle.id, name: `${vehicle.name} (${vehicle.registration_no})` },
      summary: {
        total: 0,
        coming_pickup: 0,
        coming_drop: 0,
        away: 0,
        no_bus: 0,
        on_hold: 0,
        pickup_persons: 0,
        on_leave: 0,
        early_leave: 0,
      },
      stops: [],
    };
    if (!routeIds.length) return empty;
    const riders = await this.riderRows(schoolId, { routeIds });
    if (!riders.length) return empty;
    const ids = riders.map((row) => row.student_id);
    const [leaves, earlyLeaves] = await Promise.all([
      this.dataSource.query(
        `SELECT student_id, from_date::text AS from_date, to_date::text AS to_date, half_day, reason
         FROM student_leave_requests
         WHERE student_id = ANY($1) AND status = 'approved' AND deleted_at IS NULL
           AND to_date >= $2::date AND from_date <= $2::date + 14
         ORDER BY from_date`,
        [ids, date],
      ) as Promise<
        {
          student_id: number;
          from_date: string;
          to_date: string;
          half_day: 'morning' | 'afternoon' | null;
          reason: string;
        }[]
      >,
      this.dataSource.query(
        `SELECT DISTINCT ON (student_id) student_id, pickup_name, pickup_relation, released_at, reason
         FROM gate_passes
         WHERE student_id = ANY($1) AND pass_date = $2 AND status = 'released' AND pickup_kind IS NOT NULL
           AND deleted_at IS NULL
         ORDER BY student_id, released_at DESC`,
        [ids, date],
      ) as Promise<
        {
          student_id: number;
          pickup_name: string | null;
          pickup_relation: string | null;
          released_at: Date;
          reason: string;
        }[]
      >,
    ]);
    const [stops, parents, pickups, health, away, files] = await Promise.all([
      this.dataSource.query(
        `SELECT s.id, s.name, s.sequence, s.pickup_time, s.drop_time, s.route_id, r.name AS route_name
         FROM route_stops s JOIN transport_routes r ON r.id = s.route_id
         WHERE s.route_id = ANY($1) AND s.deleted_at IS NULL ORDER BY r.code, s.sequence`,
        [routeIds],
      ) as Promise<
        {
          id: number;
          name: string;
          sequence: number;
          pickup_time: string | null;
          drop_time: string | null;
          route_id: number;
          route_name: string;
        }[]
      >,
      this.dataSource.query(
        `SELECT sg.student_id, g.name, sg.relation, g.mobile, sg.can_pickup, sg.is_primary
         FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
         WHERE sg.student_id = ANY($1) ORDER BY sg.is_primary DESC, g.name`,
        [ids],
      ) as Promise<
        {
          student_id: number;
          name: string;
          relation: string;
          mobile: string | null;
          can_pickup: boolean;
          is_primary: boolean;
        }[]
      >,
      this.dataSource.query(
        `SELECT student_id, name, relation, mobile FROM bus_pickup_persons
         WHERE student_id = ANY($1) AND pickup_date = $2 AND deleted_at IS NULL`,
        [ids, date],
      ) as Promise<{ student_id: number; name: string; relation: string; mobile: string }[]>,
      this.dataSource.query(
        `SELECT student_id, allergies, conditions, medications FROM student_health WHERE student_id = ANY($1)`,
        [ids],
      ) as Promise<
        { student_id: number; allergies: string | null; conditions: string | null; medications: string | null }[]
      >,
      awayLookup(this.dataSource, ids, [date]),
      this.files.presentMany(riders.map((row) => row.photo_file_id)),
    ]);
    const stopName = new Map(stops.map((stop) => [Number(stop.id), stop.name]));
    const present = (row: RiderRow): MyStudentDto => {
      const ridesPickup = ridesTrip(row.mode, 'pickup');
      const ridesDrop = ridesTrip(row.mode, 'drop');
      const pickupAway = ridesPickup ? away(row.student_id, date, 'pickup') : null;
      const dropAway = ridesDrop ? away(row.student_id, date, 'drop') : null;
      const note = health.find((item) => Number(item.student_id) === row.student_id);
      const medical = note
        ? [note.allergies, note.conditions, note.medications].filter((part): part is string => Boolean(part?.trim()))
        : [];
      const person = pickups.find((item) => Number(item.student_id) === row.student_id);
      const early = earlyLeaves.find((item) => Number(item.student_id) === row.student_id);
      return {
        student_id: row.student_id,
        full_name: [row.first_name, row.last_name].filter(Boolean).join(' '),
        admission_no: row.admission_no,
        class_section: classSection(row),
        roll_no: row.roll_no,
        photo_url: row.photo_file_id ? (files.get(row.photo_file_id)?.url ?? null) : null,
        mode: row.mode,
        drop_stop:
          row.drop_stop_id && row.drop_stop_id !== row.stop_id ? (stopName.get(row.drop_stop_id) ?? null) : null,
        pass: {
          state: row.pass_status,
          label: crewLabel(row.pass_status, row.hold_kind),
          reason: row.pass_status === 'on_hold' ? row.pass_note : null,
        },
        today: {
          pickup: !ridesPickup ? 'not_riding' : pickupAway ? 'away' : 'coming',
          pickup_note: pickupAway?.note ?? null,
          drop: !ridesDrop ? 'not_riding' : dropAway ? 'away' : 'coming',
          drop_note: dropAway?.note ?? null,
          pickup_person: person ? { name: person.name, relation: person.relation, mobile: person.mobile } : null,
          early_leave: early
            ? {
                person: early.pickup_name ?? '',
                relation: early.pickup_relation,
                released_at: early.released_at,
                reason: early.reason,
              }
            : null,
        },
        leaves: leaves
          .filter((item) => Number(item.student_id) === row.student_id)
          .map((item) => ({
            from_date: item.from_date,
            to_date: item.to_date,
            half_day: item.half_day,
            reason: item.reason,
          })),
        medical_note: medical.length ? medical.join('; ') : null,
        parents: parents
          .filter((item) => Number(item.student_id) === row.student_id)
          .map((item) => ({
            name: item.name,
            relation: item.relation,
            mobile: item.mobile,
            can_pickup: Boolean(item.can_pickup),
            is_primary: Boolean(item.is_primary),
          })),
      };
    };
    const students = riders.map(present);
    const byStop = stops
      .map((stop) => ({
        stop: {
          id: Number(stop.id),
          name: stop.name,
          sequence: Number(stop.sequence),
          pickup_time: stop.pickup_time,
          drop_time: stop.drop_time,
        },
        route: { id: Number(stop.route_id), name: stop.route_name },
        students: students.filter(
          (student) => riders.find((row) => row.student_id === student.student_id)!.stop_id === Number(stop.id),
        ),
      }))
      .filter((group) => group.students.length);
    return {
      date,
      vehicle: empty.vehicle,
      summary: {
        total: students.length,
        coming_pickup: students.filter((student) => student.today.pickup === 'coming').length,
        coming_drop: students.filter((student) => student.today.drop === 'coming').length,
        away: students.filter((student) => student.today.pickup === 'away' || student.today.drop === 'away').length,
        no_bus: students.filter(
          (student) => student.today.pickup_note === NO_BUS_NOTE || student.today.drop_note === NO_BUS_NOTE,
        ).length,
        on_hold: students.filter((student) => student.pass.state === 'on_hold').length,
        pickup_persons: students.filter((student) => student.today.pickup_person).length,
        on_leave: students.filter((student) =>
          student.leaves.some((leave) => leave.from_date <= date && leave.to_date >= date),
        ).length,
        early_leave: students.filter((student) => student.today.early_leave).length,
      },
      stops: byStop,
    };
  }

  private async myBus(user: AuthUser): Promise<Vehicle> {
    const vehicle = await this.trips.crewVehicle(user);
    if (!vehicle) throw AppException.forbidden('You are not the driver or attendant of any bus', 'NO_BUS');
    return vehicle;
  }

  private async riderRows(
    schoolId: number,
    filter: { routeIds?: number[]; studentIds?: number[] },
  ): Promise<RiderRow[]> {
    const rows: RiderRow[] = await this.dataSource.query(
      `SELECT t.student_id, t.route_id, r.name AS route_name, t.mode, t.stop_id, t.drop_stop_id,
              t.pass_status, t.pass_note, t.hold_kind,
              s.first_name, s.last_name, s.admission_no, s.photo_file_id,
              c.name AS class_name, sec.name AS section_name, e.roll_no
       FROM student_transport t
       JOIN transport_routes r ON r.id = t.route_id
       JOIN students s ON s.id = t.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       LEFT JOIN student_enrollments e ON e.student_id = s.id
         AND e.academic_year_id = (SELECT id FROM academic_years y WHERE y.school_id = s.school_id AND y.is_current LIMIT 1)
       LEFT JOIN sections sec ON sec.id = e.section_id
       LEFT JOIN classes c ON c.id = e.class_id
       WHERE t.school_id = $1 AND t.deleted_at IS NULL
         AND ($2::int[] IS NULL OR t.route_id = ANY($2))
         AND ($3::int[] IS NULL OR t.student_id = ANY($3))
       ORDER BY e.roll_no NULLS LAST, s.first_name`,
      [schoolId, filter.routeIds ?? null, filter.studentIds ?? null],
    );
    return rows.map((row) => ({
      ...row,
      student_id: Number(row.student_id),
      route_id: Number(row.route_id),
      stop_id: Number(row.stop_id),
      drop_stop_id: row.drop_stop_id === null ? null : Number(row.drop_stop_id),
      photo_file_id: row.photo_file_id === null ? null : Number(row.photo_file_id),
      roll_no: row.roll_no === null ? null : Number(row.roll_no),
    }));
  }
}

const NO_BUS_NOTE = 'Parent: not taking the bus';

function classSection(row: { class_name: string | null; section_name: string | null }): string | null {
  return row.class_name ? [row.class_name, row.section_name].filter(Boolean).join(' - ') : null;
}
