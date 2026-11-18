import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, MoreThan, Not, Repository } from 'typeorm';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { ROLES } from '../access/access.catalog';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { TransportRoute } from '../transport/entities/transport-route.entity';
import { Vehicle } from '../transport/entities/vehicle.entity';
import { User } from '../users/entities/user.entity';
import { clockIn } from './boarding.logic';
import {
  AlertDto,
  AlertInsightsDto,
  AlertQueryDto,
  CancelSosDto,
  RaiseSosDto,
  ResolveAlertDto,
  SosLocationDto,
  SosResultDto,
} from './dto/fleet-alert.dto';
import { ALERT_KINDS, AlertKind, FleetAlert } from './entities/fleet-alert.entity';
import { TransportTrip } from './entities/transport-trip.entity';
import {
  ALERT_KIND_LABELS,
  alertMoveRefusal,
  cancelNote,
  positionFrom,
  safetyTemplate,
  SOS_REPEAT_MS,
  sosDuplicateOf,
  sosLocation,
  sosUpdateRefusal,
  telematicsAlert,
  TelematicsAlertEvent,
} from './fleet-alerts.logic';
import { LiveGateway } from './live.gateway';
import { TripsService } from './trips.service';

const OFFICE_ROLES = [ROLES.ADMIN, ROLES.TRANSPORT_INCHARGE];
const SOS_ROLES = [...OFFICE_ROLES, ROLES.TEACHER, ROLES.HOD];

interface BusInfo {
  vehicle: Vehicle | null;
  route: TransportRoute | null;
}

@Injectable()
export class FleetAlertsService {
  private readonly logger = new Logger('FleetAlerts');

  constructor(
    @InjectRepository(FleetAlert) private readonly alerts: Repository<FleetAlert>,
    @InjectRepository(TransportTrip) private readonly tripRows: Repository<TransportTrip>,
    private readonly trips: TripsService,
    private readonly gateway: LiveGateway,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async raiseSos(user: AuthUser, dto: RaiseSosDto): Promise<SosResultDto> {
    if ((dto.lat === undefined) !== (dto.lng === undefined)) {
      throw AppException.validation([
        { field: dto.lat === undefined ? 'lat' : 'lng', message: 'Send lat and lng together' },
      ]);
    }
    const schoolId = user.school_id!;
    const vehicle = await this.trips.crewVehicle(user);
    const trip = await this.sosTrip(schoolId, dto.trip_id, vehicle);

    const since = MoreThan(new Date(Date.now() - SOS_REPEAT_MS));
    const candidates = await this.alerts.find({
      where: [
        { school_id: schoolId, kind: 'sos', raised_by: user.id, status: Not('resolved'), raised_at: since },
        ...(vehicle
          ? [
              {
                school_id: schoolId,
                kind: 'sos' as const,
                vehicle_id: vehicle.id,
                status: Not('resolved' as const),
                raised_at: since,
              },
            ]
          : []),
      ],
    });
    const recent = sosDuplicateOf(candidates, { userId: user.id, vehicleId: vehicle?.id ?? null });
    if (recent) return { ...(await this.presentOne(recent)), already_raised: true };

    const bus = await this.busInfo(trip?.vehicle_id ?? vehicle?.id ?? null, trip?.route_id ?? null);
    const role = user.roles.includes(ROLES.DRIVER) ? 'Driver' : 'Attendant';
    const position = positionFrom(dto, trip?.last_position);
    const alert = await this.alerts.save(
      this.alerts.create({
        school_id: schoolId,
        kind: 'sos',
        severity: 'critical',
        status: 'open',
        source: 'driver_app',
        trip_id: trip?.id ?? null,
        vehicle_id: bus.vehicle?.id ?? null,
        route_id: bus.route?.id ?? null,
        device_id: bus.vehicle?.device_id ?? null,
        raised_by: user.id,
        message: `SOS from ${user.name} (${role})${dto.note ? `: ${dto.note}` : ''}`.slice(0, 300),
        position,
        data: { role, phone: user.mobile, ...(dto.note ? { note: dto.note } : {}) },
        raised_at: new Date(),
      }),
    );
    alert.notified = await this.tell(alert, TEMPLATES.SOS_ALERT, SOS_ROLES, {
      reporter: `${user.name} (${role})`,
      bus: this.busLabel(bus),
      location: sosLocation(trip?.stops ?? [], position),
      time: clockIn(alert.raised_at, this.app.timeZone),
      phone: user.mobile,
    });
    const presented = await this.presentOne(alert);
    this.gateway.alert(schoolId, 'alert.raised', presented);
    return { ...presented, already_raised: false };
  }

  async activeSos(user: AuthUser): Promise<AlertDto | null> {
    const vehicle = await this.trips.crewVehicle(user);
    const alert = await this.alerts.findOne({
      where: [
        { school_id: user.school_id!, kind: 'sos', raised_by: user.id, status: Not('resolved') },
        ...(vehicle
          ? [
              {
                school_id: user.school_id!,
                kind: 'sos' as const,
                vehicle_id: vehicle.id,
                status: Not('resolved' as const),
              },
            ]
          : []),
      ],
      order: { raised_at: 'DESC' },
    });
    return alert ? this.presentOne(alert) : null;
  }

  async updateSosLocation(user: AuthUser, id: number, dto: SosLocationDto): Promise<AlertDto> {
    const alert = await this.crewSos(user, id);
    await this.alerts.update(alert.id, { position: { lat: dto.lat, lng: dto.lng, speed_kmh: null } });
    return this.changed(alert.school_id, alert.id);
  }

  async cancelSos(user: AuthUser, id: number, dto: CancelSosDto): Promise<AlertDto> {
    const alert = await this.crewSos(user, id);
    const now = new Date();
    const note = cancelNote(user.name, dto.note);
    await this.alerts.update(alert.id, {
      status: 'resolved',
      resolved_by: user.id,
      resolved_at: now,
      resolution_note: note,
      data: { ...(alert.data ?? {}), cancelled: true },
      ...(alert.acknowledged_at ? {} : { acknowledged_by: user.id, acknowledged_at: now }),
    });
    const bus = await this.busInfo(alert.vehicle_id, alert.route_id);
    await this.tell(
      alert,
      TEMPLATES.SOS_CANCELLED,
      SOS_ROLES,
      { reporter: user.name, bus: this.busLabel(bus), note },
      false,
    );
    const presented = await this.changed(alert.school_id, alert.id);
    this.realtime.toUsers(await this.crewOf(alert), 'sos.updated', presented);
    return presented;
  }

  async fromTelematics(event: TelematicsAlertEvent): Promise<{ accepted: boolean }> {
    const deviceId = Number(event.trip?.device_id ?? event.device_id);
    if (!Number.isInteger(deviceId) || deviceId <= 0) return { accepted: false };
    let trip = event.trip?.id ? await this.tripRows.findOneBy({ telematics_trip_id: event.trip.id }) : null;
    const vehicle = trip
      ? await this.dataSource.getRepository(Vehicle).findOneBy({ id: trip.vehicle_id })
      : await this.dataSource.getRepository(Vehicle).findOneBy({ device_id: deviceId });
    if (!vehicle) return { accepted: false };
    trip ??= await this.tripRows.findOneBy({ vehicle_id: vehicle.id, status: 'active' });

    const draft = telematicsAlert(event, deviceId);
    const saved = await this.alerts
      .createQueryBuilder()
      .insert()
      .values({
        school_id: vehicle.school_id,
        kind: draft.kind,
        severity: draft.severity,
        status: 'open',
        source: 'telematics',
        source_ref: draft.source_ref,
        trip_id: trip?.id ?? null,
        vehicle_id: vehicle.id,
        route_id: trip?.route_id ?? null,
        device_id: deviceId,
        message: draft.message,
        position: draft.position,
        data: draft.data,
        raised_at: draft.raised_at,
      })
      .orIgnore()
      .returning('id')
      .execute();
    const id = (saved.raw as { id: number }[] | undefined)?.[0]?.id;
    if (!id) return { accepted: true };
    const alert = await this.alerts.findOneByOrFail({ id: Number(id) });
    const bus = await this.busInfo(vehicle.id, trip?.route_id ?? null);
    alert.notified = await this.tell(alert, safetyTemplate(alert.severity), OFFICE_ROLES, {
      bus: this.busLabel(bus),
      kind: ALERT_KIND_LABELS[alert.kind],
      message: alert.message,
      time: clockIn(alert.raised_at, this.app.timeZone),
    });
    this.gateway.alert(alert.school_id, 'alert.raised', await this.presentOne(alert));
    return { accepted: true };
  }

  async list(schoolId: number, query: AlertQueryDto): Promise<Paginated<AlertDto>> {
    const qb = this.alerts
      .createQueryBuilder('a')
      .leftJoin(Vehicle, 'v', 'v.id = a.vehicle_id')
      .leftJoin(User, 'u', 'u.id = a.raised_by')
      .where('a.school_id = :schoolId', { schoolId });
    if (query.kind) qb.andWhere('a.kind = :kind', { kind: query.kind });
    if (query.status) qb.andWhere('a.status = :status', { status: query.status });
    if (query.active) qb.andWhere(`a.status <> 'resolved'`);
    if (query.severity) qb.andWhere('a.severity = :severity', { severity: query.severity });
    if (query.vehicle_id) qb.andWhere('a.vehicle_id = :vehicleId', { vehicleId: query.vehicle_id });
    if (query.trip_id) qb.andWhere('a.trip_id = :tripId', { tripId: query.trip_id });
    if (query.from)
      qb.andWhere('(a.raised_at AT TIME ZONE :tz)::date >= :from', { tz: this.app.timeZone, from: query.from });
    if (query.to) qb.andWhere('(a.raised_at AT TIME ZONE :tz)::date <= :to', { tz: this.app.timeZone, to: query.to });
    const page = await listQuery(qb, query, {
      searchable: ['a.message', 'v.registration_no', 'v.name', 'u.name'],
      sortable: { raised_at: 'a.raised_at', kind: 'a.kind', status: 'a.status', severity: 'a.severity' },
      defaultSort: 'raised_at',
    });
    return { ...page, items: await this.present(page.items) };
  }

  async insights(schoolId: number): Promise<AlertInsightsDto> {
    const [counts] = await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open,
              COUNT(*) FILTER (WHERE status <> 'resolved' AND kind = 'sos')::int AS sos_active,
              COUNT(*) FILTER (WHERE status <> 'resolved' AND severity = 'high')::int AS high_active,
              COUNT(*) FILTER (WHERE status = 'acknowledged')::int AS acknowledged,
              COUNT(*) FILTER (WHERE status = 'resolved' AND resolved_at >= date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2)::int AS resolved_today,
              COUNT(*) FILTER (WHERE raised_at >= date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2)::int AS raised_today
       FROM fleet_alerts WHERE school_id = $1 AND deleted_at IS NULL`,
      [schoolId, this.app.timeZone],
    );
    const kinds: { kind: AlertKind; count: number }[] = await this.dataSource.query(
      `SELECT kind, COUNT(*)::int AS count FROM fleet_alerts
       WHERE school_id = $1 AND deleted_at IS NULL AND status <> 'resolved' GROUP BY kind`,
      [schoolId],
    );
    return {
      ...counts,
      active_by_kind: Object.fromEntries(
        ALERT_KINDS.filter((kind) => kinds.some((row) => row.kind === kind)).map((kind) => [
          kind,
          kinds.find((row) => row.kind === kind)!.count,
        ]),
      ),
    };
  }

  async get(schoolId: number, id: number): Promise<AlertDto> {
    return this.presentOne(await this.find(schoolId, id));
  }

  async acknowledge(schoolId: number, id: number, actor: AuthUser): Promise<AlertDto> {
    const alert = await this.find(schoolId, id);
    const refusal = alertMoveRefusal(alert.status, 'acknowledge');
    if (refusal) throw AppException.conflict(refusal.message, refusal.code);
    if (alert.status === 'open') {
      await this.alerts.update(
        { id: alert.id, status: 'open' },
        { status: 'acknowledged', acknowledged_by: actor.id, acknowledged_at: new Date() },
      );
      if (alert.kind === 'sos') {
        await this.tellCrew(alert, TEMPLATES.SOS_ACKNOWLEDGED, {
          by: actor.name,
          time: clockIn(new Date(), this.app.timeZone),
        });
      }
    }
    const presented = await this.changed(schoolId, id);
    if (alert.kind === 'sos') this.realtime.toUsers(await this.crewOf(alert), 'sos.updated', presented);
    return presented;
  }

  async resolve(schoolId: number, id: number, dto: ResolveAlertDto, actor: AuthUser): Promise<AlertDto> {
    const alert = await this.find(schoolId, id);
    const refusal = alertMoveRefusal(alert.status, 'resolve');
    if (refusal) throw AppException.conflict(refusal.message, refusal.code);
    const now = new Date();
    await this.alerts.update(alert.id, {
      status: 'resolved',
      resolved_by: actor.id,
      resolved_at: now,
      resolution_note: dto.resolution_note,
      ...(alert.acknowledged_at ? {} : { acknowledged_by: actor.id, acknowledged_at: now }),
    });
    const presented = await this.changed(schoolId, id);
    if (alert.kind === 'sos') {
      const bus = await this.busInfo(alert.vehicle_id, alert.route_id);
      const data = { by: actor.name, bus: this.busLabel(bus), note: dto.resolution_note };
      await this.tellCrew(alert, TEMPLATES.SOS_RESOLVED, data);
      await this.tell(alert, TEMPLATES.SOS_RESOLVED, SOS_ROLES, data, false);
      this.realtime.toUsers(await this.crewOf(alert), 'sos.updated', presented);
    }
    return presented;
  }

  private async crewSos(user: AuthUser, id: number): Promise<FleetAlert> {
    const alert = await this.find(user.school_id!, id);
    const vehicle = await this.trips.crewVehicle(user);
    const mine = alert.raised_by === user.id || (vehicle !== null && alert.vehicle_id === vehicle.id);
    if (!mine) throw AppException.forbidden('This SOS is not from your bus', 'NOT_YOUR_SOS');
    const refusal = sosUpdateRefusal(alert);
    if (refusal) throw AppException.conflict(refusal.message, refusal.code);
    return alert;
  }

  private async crewOf(alert: FleetAlert): Promise<number[]> {
    const vehicle = alert.vehicle_id
      ? await this.dataSource.getRepository(Vehicle).findOneBy({ id: alert.vehicle_id })
      : null;
    return [...new Set([alert.raised_by, vehicle?.driver_user_id, vehicle?.attendant_user_id])].filter(
      (id): id is number => Boolean(id),
    );
  }

  private async tellCrew(alert: FleetAlert, template: string, data: Record<string, string>): Promise<void> {
    const crew = await this.crewOf(alert);
    if (!crew.length) return;
    await this.notifications
      .dispatch({
        template,
        audience: { user_ids: crew, school_id: alert.school_id },
        data: { ...data, alert_id: String(alert.id) },
      })
      .catch((error: Error) => this.logger.warn(`SOS ${alert.id} crew notice failed: ${error.message}`));
  }

  private async changed(schoolId: number, id: number): Promise<AlertDto> {
    const presented = await this.get(schoolId, id);
    this.gateway.alert(schoolId, 'alert.updated', presented);
    return presented;
  }

  private async find(schoolId: number, id: number): Promise<FleetAlert> {
    const alert = await this.alerts.findOneBy({ id, school_id: schoolId });
    if (!alert) throw AppException.notFound('Alert not found', 'ALERT_NOT_FOUND');
    return alert;
  }

  private async sosTrip(
    schoolId: number,
    tripId: number | undefined,
    vehicle: Vehicle | null,
  ): Promise<TransportTrip | null> {
    if (tripId) {
      const trip = await this.trips.find(schoolId, tripId);
      if (vehicle && trip.vehicle_id !== vehicle.id) {
        throw AppException.forbidden('This trip is not on your bus', 'NOT_YOUR_TRIP');
      }
      return trip;
    }
    if (!vehicle) return null;
    return this.tripRows.findOneBy({ vehicle_id: vehicle.id, status: 'active' });
  }

  private async busInfo(vehicleId: number | null, routeId: number | null): Promise<BusInfo> {
    const vehicle = vehicleId ? await this.dataSource.getRepository(Vehicle).findOneBy({ id: vehicleId }) : null;
    const routes = this.dataSource.getRepository(TransportRoute);
    const route = routeId
      ? await routes.findOneBy({ id: routeId })
      : vehicle
        ? await routes.findOne({ where: { vehicle_id: vehicle.id, is_active: true }, order: { code: 'ASC' } })
        : null;
    return { vehicle, route };
  }

  private busLabel({ vehicle, route }: BusInfo): string {
    if (!vehicle) return 'no bus assigned';
    const bus = `${vehicle.name} (${vehicle.registration_no})`;
    return route ? `${bus}, ${route.name}` : bus;
  }

  private async tell(
    alert: FleetAlert,
    template: string,
    roles: string[],
    data: Record<string, string>,
    count = true,
  ): Promise<number> {
    const notified = await this.notifications
      .dispatch({
        template,
        audience: { roles, school_id: alert.school_id },
        data: { ...data, alert_id: String(alert.id) },
      })
      .then((result) => result.recipients)
      .catch((error: Error) => {
        this.logger.warn(`Alert ${alert.id} notifications failed: ${error.message}`);
        return 0;
      });
    if (count && notified) await this.alerts.update(alert.id, { notified });
    return notified;
  }

  private async presentOne(alert: FleetAlert): Promise<AlertDto> {
    const [presented] = await this.present([alert]);
    return presented!;
  }

  private async present(rows: FleetAlert[]): Promise<AlertDto[]> {
    if (!rows.length) return [];
    const ids = (values: (number | null)[]) => [...new Set(values.filter((value): value is number => Boolean(value)))];
    const [vehicles, routes, trips, people] = await Promise.all([
      this.dataSource.getRepository(Vehicle).findBy({ id: In(ids(rows.map((row) => row.vehicle_id))) }),
      this.dataSource.getRepository(TransportRoute).findBy({ id: In(ids(rows.map((row) => row.route_id))) }),
      this.tripRows.findBy({ id: In(ids(rows.map((row) => row.trip_id))) }),
      this.dataSource.query(`SELECT id, name, mobile FROM users WHERE id = ANY($1)`, [
        ids(rows.flatMap((row) => [row.raised_by, row.acknowledged_by, row.resolved_by])),
      ]) as Promise<{ id: number; name: string; mobile: string }[]>,
    ]);
    const person = (id: number | null) => {
      const found = id ? people.find((item) => Number(item.id) === id) : undefined;
      return found ? { id: Number(found.id), name: found.name } : null;
    };
    return rows.map((row) => {
      const vehicle = vehicles.find((item) => item.id === row.vehicle_id);
      const route = routes.find((item) => item.id === row.route_id);
      const trip = trips.find((item) => item.id === row.trip_id);
      const raiser = row.raised_by ? people.find((item) => Number(item.id) === row.raised_by) : undefined;
      return {
        id: row.id,
        kind: row.kind,
        kind_label: ALERT_KIND_LABELS[row.kind] ?? row.kind,
        severity: row.severity,
        status: row.status,
        source: row.source,
        message: row.message,
        trip: trip ? { id: trip.id, kind: trip.kind } : null,
        vehicle: vehicle
          ? {
              id: vehicle.id,
              registration_no: vehicle.registration_no,
              name: vehicle.name,
              device_id: vehicle.device_id,
            }
          : null,
        route: route ? { id: route.id, name: route.name } : null,
        raised_by: raiser ? { id: Number(raiser.id), name: raiser.name, mobile: raiser.mobile } : null,
        position: row.position,
        data: row.data ?? {},
        raised_at: row.raised_at,
        notified: row.notified,
        acknowledged_by: person(row.acknowledged_by),
        acknowledged_at: row.acknowledged_at,
        resolved_by: person(row.resolved_by),
        resolved_at: row.resolved_at,
        resolution_note: row.resolution_note,
      };
    });
  }
}
