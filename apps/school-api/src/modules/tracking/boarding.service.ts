import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { ROLES } from '../access/access.catalog';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { StudentLifecycleService } from '../student-lifecycle/student-lifecycle.service';
import { StudentTransport } from '../transport/entities/student-transport.entity';
import { stopForTrip } from '../transport/transport.logic';
import { boardingStep, boardingStopId, clockIn, routeRefusal } from './boarding.logic';
import { BoardingDto, BoardingResultDto, RecordBoardingDto } from './dto/boarding.dto';
import { TransportTrip } from './entities/transport-trip.entity';
import { BoardingMethod, TripBoarding } from './entities/trip-boarding.entity';
import { LiveGateway } from './live.gateway';
import { TripsService } from './trips.service';

@Injectable()
export class BoardingService {
  private readonly logger = new Logger('Boarding');

  constructor(
    @InjectRepository(TripBoarding) private readonly boardings: Repository<TripBoarding>,
    private readonly trips: TripsService,
    private readonly lifecycle: StudentLifecycleService,
    private readonly gateway: LiveGateway,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async record(user: AuthUser, tripId: number, dto: RecordBoardingDto, vehicleId: number): Promise<BoardingResultDto> {
    if (dto.qr_token !== undefined && dto.student_id !== undefined) {
      throw AppException.validation([{ field: 'student_id', message: 'Send qr_token or student_id, not both' }]);
    }
    const schoolId = user.school_id!;
    const trip = await this.trips.find(schoolId, tripId);
    if (trip.vehicle_id !== vehicleId) throw AppException.forbidden('This trip is not on your bus', 'NOT_YOUR_TRIP');
    if (trip.status !== 'active') throw AppException.conflict('This trip has ended', 'TRIP_ENDED');

    const method: BoardingMethod = dto.qr_token !== undefined ? 'qr' : 'manual';
    const studentId = await this.studentFor(schoolId, dto);
    const assignment = await this.dataSource
      .getRepository(StudentTransport)
      .findOneBy({ school_id: schoolId, student_id: studentId });
    const refusal = routeRefusal(assignment, trip);
    if (refusal) throw AppException.conflict(refusal.message, refusal.code);

    const recorded = await this.boardings.find({ where: { trip_id: trip.id, student_id: studentId } });
    const step = boardingStep(
      recorded.map((row) => row.action),
      dto.action,
    );
    if (step === 'not_boarded') {
      throw AppException.conflict('This student has not boarded this trip yet', 'NOT_BOARDED');
    }
    if (step === 'already_boarded') {
      throw AppException.conflict('This student is already on the bus', 'ALREADY_BOARDED');
    }
    const onHold = dto.action === 'boarded' && assignment!.pass_status === 'on_hold';
    if (step === 'duplicate')
      return this.duplicate(
        trip,
        recorded.find((row) => row.action === dto.action)!,
      );

    const saved = await this.boardings
      .createQueryBuilder()
      .insert()
      .values({
        school_id: schoolId,
        trip_id: trip.id,
        student_id: studentId,
        stop_id: boardingStopId(dto.action, trip.kind, stopForTrip(assignment!, trip.kind)),
        action: dto.action,
        method,
        recorded_by: user.id,
        handed_to: dto.action === 'alighted' ? (dto.handed_to ?? null) : null,
        pass_on_hold: onHold,
        occurred_at: tapTime(dto.occurred_at),
      })
      .orIgnore()
      .returning('id')
      .execute();
    const insertedId = (saved.raw as { id: number }[] | undefined)?.[0]?.id;
    const row = await this.boardings.findOneByOrFail(
      insertedId ? { id: Number(insertedId) } : { trip_id: trip.id, student_id: studentId, action: dto.action },
    );
    if (!insertedId) return this.duplicate(trip, row);

    const [boarding] = await this.trips.presentBoardings(trip, [row]);
    const notified = await this.notifyParents(trip, boarding!).catch((error: Error) => {
      this.logger.warn(`Boarding ${row.id} parent notification failed: ${error.message}`);
      return 0;
    });
    if (dto.action === 'missed') {
      await this.tellClassTeacher(trip, boarding!).catch((error: Error) => {
        this.logger.warn(`Boarding ${row.id} class teacher notice failed: ${error.message}`);
      });
    }
    if (onHold) {
      await this.heldPassBoarded(trip, boarding!, assignment!).catch((error: Error) => {
        this.logger.warn(`Boarding ${row.id} held-pass notice failed: ${error.message}`);
      });
    }
    this.gateway.passenger(trip, boarding!);
    return { ...boarding!, already_recorded: false, notified };
  }

  private async heldPassBoarded(
    trip: TransportTrip,
    boarding: BoardingDto,
    assignment: StudentTransport,
  ): Promise<void> {
    const [earlier] = await this.dataSource.query(
      `SELECT 1 FROM transport_boardings b JOIN transport_trips t ON t.id = b.trip_id
       WHERE b.student_id = $1 AND b.pass_on_hold = true AND t.trip_date = $2 AND b.id <> $3 LIMIT 1`,
      [boarding.student_id, trip.trip_date, boarding.id],
    );
    if (earlier) return;
    const [info] = await this.dataSource.query(
      `SELECT v.registration_no, v.name AS bus FROM vehicles v WHERE v.id = $1`,
      [trip.vehicle_id],
    );
    const bus = info ? `${info.bus} (${info.registration_no})` : 'the school bus';
    const reason =
      assignment.pass_note?.trim() || (assignment.hold_kind === 'fee' ? 'Bus fee pending' : 'Held by the office');
    const data = {
      student: boarding.full_name,
      class_section: boarding.class_section ?? '',
      bus,
      stop: boarding.stop?.name || 'school',
      time: clockIn(new Date(boarding.occurred_at), this.app.timeZone),
      reason,
      trip_id: String(trip.id),
      student_id: String(boarding.student_id),
    };
    const parents: { user_id: number }[] = await this.dataSource.query(
      `SELECT DISTINCT g.user_id FROM student_guardians sg
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL AND g.user_id IS NOT NULL
       WHERE sg.student_id = $1 AND sg.receives_alerts = true`,
      [boarding.student_id],
    );
    if (parents.length) {
      await this.notifications.dispatch({
        template: TEMPLATES.BUS_PASS_HOLD_BOARDED,
        audience: { user_ids: parents.map((row) => Number(row.user_id)) },
        data,
      });
    }
    await this.notifications.dispatch({
      template: TEMPLATES.BUS_PASS_HOLD_BOARDED_OFFICE,
      audience: {
        roles:
          assignment.hold_kind === 'fee'
            ? [ROLES.ADMIN, ROLES.TRANSPORT_INCHARGE, ROLES.ACCOUNTANT]
            : [ROLES.ADMIN, ROLES.TRANSPORT_INCHARGE],
        school_id: trip.school_id,
      },
      data,
    });
  }

  private async studentFor(schoolId: number, dto: RecordBoardingDto): Promise<number> {
    if (dto.qr_token !== undefined) {
      const student = await this.lifecycle.verifyQr(schoolId, dto.qr_token);
      if (student.status !== 'active') {
        throw AppException.conflict('This student is no longer active in the school', 'STUDENT_NOT_ACTIVE');
      }
      return student.student_id;
    }
    const [student] = await this.dataSource.query(
      `SELECT id, status FROM students WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [dto.student_id, schoolId],
    );
    if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    if (student.status !== 'active') {
      throw AppException.conflict('This student is no longer active in the school', 'STUDENT_NOT_ACTIVE');
    }
    return Number(student.id);
  }

  private async duplicate(trip: TransportTrip, row: TripBoarding): Promise<BoardingResultDto> {
    const [boarding] = await this.trips.presentBoardings(trip, [row]);
    return { ...boarding!, already_recorded: true, notified: 0 };
  }

  private async tellClassTeacher(trip: TransportTrip, boarding: BoardingDto): Promise<void> {
    const [row]: { teacher: number | null }[] = await this.dataSource.query(
      `SELECT sec.class_teacher_user_id AS teacher FROM student_enrollments e
       JOIN sections sec ON sec.id = e.section_id
       JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current
       WHERE e.student_id = $1 LIMIT 1`,
      [boarding.student_id],
    );
    if (!row?.teacher) return;
    const [info] = await this.dataSource.query(
      `SELECT v.registration_no, v.name AS bus FROM vehicles v WHERE v.id = $1`,
      [trip.vehicle_id],
    );
    await this.notifications.dispatch({
      template: TEMPLATES.STUDENT_BUS_ABSENT_TEACHER,
      audience: { user_ids: [Number(row.teacher)] },
      data: {
        student: boarding.full_name,
        class_section: boarding.class_section ?? '',
        bus: info ? `${info.bus} (${info.registration_no})` : 'the school bus',
        stop: boarding.stop?.name || 'the stop',
        time: clockIn(new Date(boarding.occurred_at), this.app.timeZone),
        trip: trip.kind === 'pickup' ? 'morning pickup' : 'evening drop',
        trip_ta: trip.kind === 'pickup' ? 'காலை' : 'மாலை',
        student_id: String(boarding.student_id),
      },
    });
  }

  private async notifyParents(trip: TransportTrip, boarding: BoardingDto): Promise<number> {
    const parents: { user_id: number }[] = await this.dataSource.query(
      `SELECT DISTINCT g.user_id FROM student_guardians sg
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL AND g.user_id IS NOT NULL
       WHERE sg.student_id = $1 AND sg.receives_alerts = true`,
      [boarding.student_id],
    );
    if (!parents.length) return 0;
    const [info] = await this.dataSource.query(
      `SELECT v.registration_no, v.name AS bus, sc.name AS school
       FROM vehicles v JOIN schools sc ON sc.id = v.school_id WHERE v.id = $1`,
      [trip.vehicle_id],
    );
    const result = await this.notifications.dispatch({
      template:
        boarding.action === 'boarded'
          ? TEMPLATES.STUDENT_BOARDED
          : boarding.action === 'missed'
            ? TEMPLATES.STUDENT_NOT_AT_STOP
            : TEMPLATES.STUDENT_ALIGHTED,
      audience: { user_ids: parents.map((row) => Number(row.user_id)) },
      data: {
        student: boarding.full_name,
        bus: info ? `${info.bus} (${info.registration_no})` : 'the school bus',
        stop: boarding.stop?.name || info?.school || 'school',
        time: clockIn(new Date(boarding.occurred_at), this.app.timeZone),
        handed: boarding.handed_to ? ` Handed to ${boarding.handed_to}.` : '',
        handed_ta: boarding.handed_to ? ` ${boarding.handed_to} அவர்களிடம் ஒப்படைக்கப்பட்டார்.` : '',
        trip_id: String(trip.id),
        student_id: String(boarding.student_id),
      },
    });
    return result.recipients;
  }
}

const OFFLINE_WINDOW_MS = 12 * 60 * 60 * 1000;

function tapTime(sent: string | undefined): Date {
  const now = new Date();
  if (!sent) return now;
  const at = new Date(sent);
  if (Number.isNaN(at.getTime())) return now;
  if (at.getTime() > now.getTime() || now.getTime() - at.getTime() > OFFLINE_WINDOW_MS) {
    throw AppException.validation([{ field: 'occurred_at', message: 'occurred_at must be within the last 12 hours' }]);
  }
  return at;
}
