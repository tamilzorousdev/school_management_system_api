import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
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
        occurred_at: new Date(),
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
    this.gateway.passenger(trip, boarding!);
    return { ...boarding!, already_recorded: false, notified };
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
      template: boarding.action === 'boarded' ? TEMPLATES.STUDENT_BOARDED : TEMPLATES.STUDENT_ALIGHTED,
      audience: { user_ids: parents.map((row) => Number(row.user_id)) },
      data: {
        student: boarding.full_name,
        bus: info ? `${info.bus} (${info.registration_no})` : 'the school bus',
        stop: boarding.stop?.name || info?.school || 'school',
        time: clockIn(new Date(boarding.occurred_at), this.app.timeZone),
        trip_id: String(trip.id),
        student_id: String(boarding.student_id),
      },
    });
    return result.recipients;
  }
}
