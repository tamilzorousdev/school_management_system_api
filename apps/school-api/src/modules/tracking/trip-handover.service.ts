import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { ROLES } from '../access/access.catalog';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { Vehicle } from '../transport/entities/vehicle.entity';
import { RoutesService } from '../transport/routes.service';
import { HandoverInputDto, HandoverResultDto } from './dto/tracking.dto';
import { LiveGateway } from './live.gateway';
import { TripsService } from './trips.service';

const DONE_STATUSES = ['departed', 'skipped'];

const TRIP_NAMES = {
  pickup: { en: 'morning pickup', ta: 'காலை' },
  drop: { en: 'evening drop', ta: 'மாலை' },
} as const;

export function stopsLeft(stops: { stop_id: number; status: string }[]): number[] {
  const left = stops.filter((stop) => !DONE_STATUSES.includes(stop.status)).map((stop) => stop.stop_id);
  return left.length ? left : stops.slice(-1).map((stop) => stop.stop_id);
}

@Injectable()
export class TripHandoverService {
  private readonly logger = new Logger('TripHandover');

  constructor(
    private readonly trips: TripsService,
    private readonly routes: RoutesService,
    private readonly notifications: NotificationsService,
    private readonly gateway: LiveGateway,
    private readonly dataSource: DataSource,
  ) {}

  async handover(schoolId: number, tripId: number, dto: HandoverInputDto, actor: AuthUser): Promise<HandoverResultDto> {
    const old = await this.trips.find(schoolId, tripId);
    if (old.status !== 'active') throw AppException.conflict('This trip has already ended', 'TRIP_ENDED');
    if (dto.vehicle_id === old.vehicle_id) {
      throw AppException.badRequest('Pick a different bus to take over', 'SAME_BUS');
    }
    const vehicles = this.dataSource.getRepository(Vehicle);
    const [oldBus, newBus] = await Promise.all([
      vehicles.findOneBy({ id: old.vehicle_id }),
      vehicles.findOneBy({ id: dto.vehicle_id, school_id: schoolId }),
    ]);
    if (!newBus || newBus.status !== 'active') {
      throw AppException.validation([{ field: 'vehicle_id', message: 'Pick an active bus of this school' }]);
    }
    const reason = dto.reason?.trim() || null;
    const fresh = await this.trips.start(schoolId, { route_id: old.route_id, kind: old.kind }, actor, undefined, {
      vehicleId: newBus.id,
      stopIds: stopsLeft(old.stops),
      fromTripId: old.id,
    });
    await this.dataSource.query(
      `INSERT INTO transport_boardings (school_id, trip_id, student_id, stop_id, action, method, recorded_by, occurred_at)
       SELECT school_id, $2, student_id, stop_id, action, method, recorded_by, occurred_at
       FROM transport_boardings WHERE trip_id = $1`,
      [old.id, fresh.id],
    );
    await this.trips.closeForHandover(old, fresh.id);

    let warning: string | null = null;
    if (dto.keep_for_today) {
      const swap = await this.routes.swapBus(
        schoolId,
        old.route_id,
        { vehicle_id: newBus.id, ...(reason ? { reason } : {}), force: true },
        actor,
      );
      warning = swap.warning;
    }

    const newTrip = await this.trips.find(schoolId, fresh.id);
    const riders = await this.trips.riders(newTrip);
    const onBoard = riders.filter((rider) => rider.boarded && !rider.alighted);
    const waiting = riders.filter((rider) => !rider.boarded && !rider.alighted && !rider.away_today);
    const guardians: { student_id: number; user_id: number }[] = riders.length
      ? await this.dataSource.query(
          `SELECT DISTINCT sg.student_id, g.user_id FROM student_guardians sg
           JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL AND g.user_id IS NOT NULL
           WHERE sg.student_id = ANY($1) AND sg.receives_alerts = true`,
          [riders.map((rider) => rider.student_id)],
        )
      : [];
    const parentsOf = (studentId: number) =>
      guardians.filter((row) => Number(row.student_id) === studentId).map((row) => Number(row.user_id));
    const [route] = await this.dataSource.query(`SELECT name FROM transport_routes WHERE id = $1`, [old.route_id]);
    const base: Record<string, string> = {
      old_bus: oldBus ? `${oldBus.name} (${oldBus.registration_no})` : 'The bus',
      new_bus: `${newBus.name} (${newBus.registration_no})`,
      route: route?.name ?? '',
      trip: TRIP_NAMES[old.kind].en,
      trip_ta: TRIP_NAMES[old.kind].ta,
      reason: reason ? `Reason: ${reason}` : '',
      trip_id: String(fresh.id),
    };
    const send = (
      template: string,
      audience: Parameters<NotificationsService['dispatch']>[0]['audience'],
      data: Record<string, string> = base,
    ) =>
      this.notifications
        .dispatch({ template, audience, data })
        .then((result) => result.recipients)
        .catch((error: Error) => {
          this.logger.warn(`Hand-over notice for trip ${old.id} failed: ${error.message}`);
          return 0;
        });

    let told = 0;
    for (const rider of onBoard) {
      const users = parentsOf(rider.student_id);
      if (users.length) {
        told += await send(TEMPLATES.BUS_HANDOVER_ONBOARD, { user_ids: users }, { ...base, student: rider.full_name });
      }
    }
    const waitingParents = [...new Set(waiting.flatMap((rider) => parentsOf(rider.student_id)))];
    if (waitingParents.length) told += await send(TEMPLATES.BUS_HANDOVER, { user_ids: waitingParents });
    const crew = [oldBus, newBus]
      .flatMap((bus) => [bus?.driver_user_id, bus?.attendant_user_id])
      .filter((id): id is number => Boolean(id));
    if (crew.length) await send(TEMPLATES.BUS_HANDOVER, { user_ids: [...new Set(crew)] });
    await send(TEMPLATES.BUS_HANDOVER, { roles: [ROLES.ADMIN, ROLES.TRANSPORT_INCHARGE], school_id: schoolId });

    this.gateway.event(old, {
      type: 'trip.handover',
      new_trip_id: fresh.id,
      new_vehicle: { id: newBus.id, name: newBus.name, registration_no: newBus.registration_no },
      reason,
    });
    this.logger.log(
      `Trip ${old.id} handed over to trip ${fresh.id} on ${newBus.registration_no} by user ${actor.id}: ${onBoard.length} on board, ${waiting.length} waiting`,
    );
    const [oldDto, newDto] = await this.trips.present([await this.trips.find(schoolId, old.id), newTrip]);
    return {
      old_trip: oldDto!,
      new_trip: newDto!,
      on_board: onBoard.length,
      waiting: waiting.length,
      parents_told: told,
      warning,
    };
  }
}
