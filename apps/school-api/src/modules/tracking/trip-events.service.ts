import { Inject, Injectable, Logger } from '@nestjs/common';
import { STOP_FOR_TRIP_SQL } from '../transport/transport.logic';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException } from '@app/common';
import { appConfig, AppConfig, telematicsConfig, TelematicsConfig } from '../../config/configuration';
import { VehicleFaultEvent } from '../fleet-ops/fleet-ops.logic';
import { MaintenanceService } from '../fleet-ops/maintenance.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BoardingChecklistService } from './boarding-checklist.service';
import { TransportTrip, TripPosition } from './entities/transport-trip.entity';
import { TripEvent, TripEventType } from './entities/trip-event.entity';
import { TelematicsAlertEvent } from './fleet-alerts.logic';
import { FleetAlertsService } from './fleet-alerts.service';
import { LiveGateway } from './live.gateway';
import { applyStopEvent, minutesFrom, signatureValid } from './tracking.logic';
import { TripsService } from './trips.service';

export interface TelematicsEvent {
  id?: number;
  type: TripEventType | 'trip.position';
  at: string;
  trip: { id: number; ref: string; device_id: number; kind: string };
  stop?: { ref: string; name: string; sequence: number } | null;
  eta_seconds?: number | null;
  position?: TripPosition | null;
  end_reason?: string | null;
}

@Injectable()
export class TripEventsService {
  private readonly logger = new Logger('TripEvents');

  constructor(
    @InjectRepository(TransportTrip) private readonly trips: Repository<TransportTrip>,
    @InjectRepository(TripEvent) private readonly events: Repository<TripEvent>,
    private readonly tripsService: TripsService,
    private readonly checklist: BoardingChecklistService,
    private readonly gateway: LiveGateway,
    private readonly notifications: NotificationsService,
    private readonly alerts: FleetAlertsService,
    private readonly maintenance: MaintenanceService,
    private readonly dataSource: DataSource,
    @Inject(telematicsConfig.KEY) private readonly config: TelematicsConfig,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async receive(rawBody: Buffer | undefined, signature: string | undefined): Promise<{ accepted: boolean }> {
    if (!this.config.webhookSecret) {
      throw AppException.unavailable('Telematics events are switched off', 'TELEMATICS_WEBHOOK_OFF');
    }
    if (!rawBody || !signatureValid(rawBody, signature, this.config.webhookSecret)) {
      throw AppException.unauthorized('Signature is missing or wrong', 'SIGNATURE_INVALID');
    }
    let event: TelematicsEvent;
    try {
      event = JSON.parse(rawBody.toString('utf8')) as TelematicsEvent;
    } catch {
      throw AppException.badRequest('Body is not JSON', 'VALIDATION_FAILED');
    }
    if ((event.type as string) === 'alert.raised') {
      return this.alerts.fromTelematics(event as unknown as TelematicsAlertEvent);
    }
    if ((event.type as string) === 'vehicle.fault') {
      return this.maintenance.fromTelematics(event as unknown as VehicleFaultEvent);
    }
    const trip = await this.tripFor(event);
    if (!trip) return { accepted: false };
    await this.handle(trip, event);
    return { accepted: true };
  }

  private async tripFor(event: TelematicsEvent): Promise<TransportTrip | null> {
    if (!event.trip?.id) return null;
    const known = await this.trips.findOneBy({ telematics_trip_id: event.trip.id });
    if (known) return known;
    const localId = Number(/-(\d+)$/.exec(event.trip.ref ?? '')?.[1]);
    if (!localId) return null;
    const trip = await this.trips.findOneBy({ id: localId, device_id: event.trip.device_id });
    if (!trip || (trip.telematics_trip_id && trip.telematics_trip_id !== event.trip.id)) return null;
    if (!trip.telematics_trip_id) {
      await this.trips.update(trip.id, { telematics_trip_id: event.trip.id });
      trip.telematics_trip_id = event.trip.id;
    }
    return trip;
  }

  async handle(trip: TransportTrip, event: TelematicsEvent): Promise<void> {
    const at = new Date(event.at ?? Date.now());
    if (event.position) {
      await this.trips.update(trip.id, { last_position: event.position });
      trip.last_position = event.position;
    }
    if (event.type === 'trip.position') {
      if (event.position) this.gateway.position(trip, { position: event.position, at: event.at });
      return;
    }

    const stopId = event.stop?.ref ? Number(event.stop.ref) : null;
    const saved = await this.events
      .createQueryBuilder()
      .insert()
      .values({
        trip_id: trip.id,
        type: event.type,
        stop_id: stopId,
        eta_seconds: event.eta_seconds ?? null,
        occurred_at: at,
        source_event_id: event.id && event.id > 0 ? event.id : null,
      })
      .orIgnore()
      .returning('id')
      .execute();
    if (!(saved.raw as unknown[] | undefined)?.length) return;
    const eventId = Number((saved.raw as { id: number }[])[0]!.id);

    if (stopId) {
      trip.stops = applyStopEvent(trip.stops, event.type, stopId, event.at, event.eta_seconds ?? null);
      await this.trips.update(trip.id, { stops: trip.stops });
    }
    if (event.type === 'trip.ended') {
      await this.tripsService.markEnded(trip, event.end_reason ?? 'route_complete', at);
      trip.status = 'ended';
      await this.checklist.afterTripEnded(trip).catch((error: Error) => {
        this.logger.warn(`Trip ${trip.id} end-of-trip flags failed: ${error.message}`);
      });
    }

    const notified = await this.notify(trip, event, stopId, at).catch((error: Error) => {
      this.logger.warn(`Trip ${trip.id} ${event.type} notifications failed: ${error.message}`);
      return 0;
    });
    if (notified) await this.events.update(eventId, { notified });
    this.gateway.event(trip, {
      type: event.type,
      at: event.at,
      stop: event.stop ? { id: stopId, name: event.stop.name, sequence: event.stop.sequence } : null,
      eta_seconds: event.eta_seconds ?? null,
      position: event.position ?? trip.last_position,
      end_reason: event.end_reason ?? null,
      notified,
    });
  }

  private async notify(trip: TransportTrip, event: TelematicsEvent, stopId: number | null, at: Date): Promise<number> {
    const [info] = await this.dataSource.query(
      `SELECT v.registration_no, v.name AS bus, r.name AS route FROM vehicles v, transport_routes r WHERE v.id = $1 AND r.id = $2`,
      [trip.vehicle_id, trip.route_id],
    );
    const bus = info ? `${info.bus} (${info.registration_no})` : 'The school bus';
    switch (event.type) {
      case 'trip.started': {
        const users = await this.parents(trip, null);
        return this.send('BUS_STARTED', users, { bus, trip: info?.route ?? '' });
      }
      case 'stop.approaching': {
        const users = await this.parents(trip, stopId);
        return this.send('BUS_APPROACHING', users, {
          bus,
          stop: event.stop?.name ?? '',
          minutes: String(minutesFrom(event.eta_seconds ?? null)),
        });
      }
      case 'stop.arrived': {
        const users = await this.parents(trip, stopId);
        return this.send('BUS_ARRIVED', users, { bus, place: event.stop?.name ?? '', time: this.clock(at) });
      }
      case 'trip.ended':
        return this.notBoarded(trip, bus);
      default:
        return 0;
    }
  }

  private async notBoarded(trip: TransportTrip, bus: string): Promise<number> {
    if (trip.kind !== 'pickup' || trip.not_boarded_sent_at) return 0;
    const [{ count }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM transport_boardings WHERE trip_id = $1 AND action = 'boarded'`,
      [trip.id],
    );
    if (!count) {
      this.logger.log(`Trip ${trip.id} ended with no boarding scans: not-boarded list not sent`);
      return 0;
    }
    const missing = (await this.tripsService.riders(trip)).filter((rider) => !rider.boarded && !rider.away_today);
    if (!missing.length) return 0;
    const teachers: { student_id: number; class_teacher_user_id: number | null }[] = await this.dataSource.query(
      `SELECT e.student_id, sec.class_teacher_user_id FROM student_enrollments e
       JOIN sections sec ON sec.id = e.section_id
       JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current
       WHERE e.student_id = ANY($1)`,
      [missing.map((rider) => rider.student_id)],
    );
    const bySection = new Map<number, { section: string; names: string[] }>();
    for (const rider of missing) {
      const teacher = teachers.find((row) => Number(row.student_id) === rider.student_id)?.class_teacher_user_id;
      if (!teacher) continue;
      const group = bySection.get(Number(teacher)) ?? { section: rider.class_section ?? '', names: [] };
      group.names.push(rider.full_name);
      bySection.set(Number(teacher), group);
    }
    let sent = 0;
    for (const [teacherId, group] of bySection) {
      sent += await this.send('TRIP_NOT_BOARDED', [teacherId], {
        bus,
        section: group.section,
        count: String(group.names.length),
        names: group.names.join(', '),
      });
    }
    await this.trips.update(trip.id, { not_boarded_sent_at: new Date() });
    return sent;
  }

  private async parents(trip: TransportTrip, stopId: number | null): Promise<number[]> {
    const rows: { user_id: number }[] = await this.dataSource.query(
      `SELECT DISTINCT g.user_id FROM student_transport t
       JOIN students s ON s.id = t.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       JOIN student_guardians sg ON sg.student_id = t.student_id AND sg.receives_alerts = true
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL AND g.user_id IS NOT NULL
       WHERE t.route_id = $1 AND t.deleted_at IS NULL AND (t.mode = 'both' OR t.mode = $2)
         ${stopId ? `AND ${STOP_FOR_TRIP_SQL('t', '$2')} = $3` : ''}`,
      stopId ? [trip.route_id, trip.kind, stopId] : [trip.route_id, trip.kind],
    );
    return rows.map((row) => Number(row.user_id));
  }

  private async send(template: string, userIds: number[], data: Record<string, string>): Promise<number> {
    if (!userIds.length) return 0;
    await this.notifications.dispatch({ template, audience: { user_ids: userIds }, data });
    return userIds.length;
  }

  private clock(at: Date): string {
    return new Intl.DateTimeFormat('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: this.app.timeZone,
    }).format(at);
  }
}
