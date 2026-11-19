import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { ROLES } from '../access/access.catalog';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { BusDelayInputDto, TripDto } from './dto/tracking.dto';
import { TransportTrip } from './entities/transport-trip.entity';
import { LiveGateway } from './live.gateway';
import { TripsService } from './trips.service';

export const DELAY_REPEAT_MINUTES = 3;

const TRIP_NAMES = {
  pickup: { en: 'morning pickup', ta: 'காலை' },
  drop: { en: 'evening drop', ta: 'மாலை' },
} as const;

@Injectable()
export class TripDelayService {
  private readonly logger = new Logger('TripDelay');

  constructor(
    @InjectRepository(TransportTrip) private readonly trips: Repository<TransportTrip>,
    private readonly tripsService: TripsService,
    private readonly notifications: NotificationsService,
    private readonly gateway: LiveGateway,
    private readonly dataSource: DataSource,
  ) {}

  async report(user: AuthUser, tripId: number, vehicleId: number, dto: BusDelayInputDto): Promise<TripDto> {
    const trip = await this.tripsService.find(user.school_id!, tripId);
    if (trip.vehicle_id !== vehicleId) throw AppException.forbidden('This trip is not on your bus', 'NOT_YOUR_TRIP');
    if (trip.status !== 'active') throw AppException.conflict('This trip has ended', 'TRIP_ENDED');
    if (trip.delayed_at && Date.now() - trip.delayed_at.getTime() < DELAY_REPEAT_MINUTES * 60_000) {
      throw AppException.tooManyRequests(
        `Parents were told a moment ago. Wait ${DELAY_REPEAT_MINUTES} minutes before sending again.`,
        'DELAY_TOO_SOON',
      );
    }
    const reason = dto.reason?.trim() || null;
    const now = new Date();
    await this.trips.update(trip.id, { delay_minutes: dto.minutes, delay_reason: reason, delayed_at: now });
    const updated = { ...trip, delay_minutes: dto.minutes, delay_reason: reason, delayed_at: now };
    const [info] = await this.dataSource.query(
      `SELECT v.name, v.registration_no, r.name AS route FROM vehicles v, transport_routes r WHERE v.id = $1 AND r.id = $2`,
      [trip.vehicle_id, trip.route_id],
    );
    const parents: { user_id: number }[] = await this.dataSource.query(
      `SELECT DISTINCT g.user_id FROM student_transport t
       JOIN students s ON s.id = t.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       JOIN student_guardians sg ON sg.student_id = t.student_id AND sg.receives_alerts = true
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL AND g.user_id IS NOT NULL
       WHERE t.route_id = $1 AND t.deleted_at IS NULL AND (t.mode = 'both' OR t.mode = $2)`,
      [trip.route_id, trip.kind],
    );
    const data = {
      bus: info ? `${info.name} (${info.registration_no})` : 'The school bus',
      route: info?.route ?? '',
      minutes: String(dto.minutes),
      trip: TRIP_NAMES[trip.kind].en,
      trip_ta: TRIP_NAMES[trip.kind].ta,
      reason: reason ? `Reason: ${reason}` : '',
      trip_id: String(trip.id),
    };
    const send = (audience: Parameters<NotificationsService['dispatch']>[0]['audience']) =>
      this.notifications
        .dispatch({ template: TEMPLATES.BUS_DELAYED, audience, data })
        .catch((error: Error) => this.logger.warn(`Trip ${trip.id} delay notice failed: ${error.message}`));
    if (parents.length) await send({ user_ids: parents.map((row) => Number(row.user_id)) });
    await send({ roles: [ROLES.ADMIN, ROLES.TRANSPORT_INCHARGE], school_id: trip.school_id });
    this.gateway.event(updated, {
      type: 'trip.delayed',
      delay_minutes: dto.minutes,
      reason,
      at: now,
    });
    this.logger.log(`Trip ${trip.id} delayed ${dto.minutes} min by user ${user.id}: ${parents.length} parents told`);
    return (await this.tripsService.present([updated]))[0]!;
  }
}
