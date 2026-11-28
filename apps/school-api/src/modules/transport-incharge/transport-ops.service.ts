import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { BusRequestsService } from '../driver-ops/bus-requests.service';
import { DriverDutyService } from '../driver-ops/driver-duty.service';
import { minutesOf } from '../driver-ops/driver-ops.logic';
import { IncidentQueryDto, OperationsBoardDto } from '../driver-ops/dto/driver-ops.dto';
import { IncidentsService } from '../driver-ops/incidents.service';
import { OperationsService } from '../driver-ops/operations.service';
import { ClearanceService } from '../crew/clearance.service';
import { PreTripQueryDto, ReportRangeDto } from '../fleet-ops/dto/fleet-maintenance.dto';
import { FleetReportsService } from '../fleet-ops/fleet-reports.service';
import { MaintenanceSchedulesService } from '../fleet-ops/maintenance-schedules.service';
import { PreTripChecksService } from '../fleet-ops/pre-trip-checks.service';
import { FleetLiveDto } from '../fleet/dto/fleet.dto';
import { TelematicsClient } from '../fleet/telematics.client';
import { AlertQueryDto, ResolveAlertDto } from '../tracking/dto/fleet-alert.dto';
import { TransportTrip } from '../tracking/entities/transport-trip.entity';
import { FleetAlertsService } from '../tracking/fleet-alerts.service';
import { BusPassQueryDto } from '../transport/dto/bus-pass.dto';
import { DriverRatingQueryDto } from '../transport/dto/driver-rating.dto';
import { BusPassService } from '../transport/bus-pass.service';
import { DriverRatingsService } from '../transport/driver-ratings.service';
import { Vehicle } from '../transport/entities/vehicle.entity';
import {
  LateTripDto,
  LateTripsDto,
  LiveBusDto,
  MaintenanceDueDto,
  MaintenanceDueItemDto,
  OpsCountsDto,
  PassesOnHoldQueryDto,
  PreTripFailuresDto,
  TransportAlertQueryDto,
  TransportLiveDto,
  TransportMonthDto,
  TransportRatingsDto,
} from './dto/transport-ops.dto';
import {
  classifyLate,
  END_OF_DAY_MINUTES,
  LATE_MINUTES,
  lateCounts,
  liveCounts,
  maintenanceDue,
  monthBounds,
  onTimePercent,
  weightedKmPerLitre,
} from './transport-incharge.logic';

const RECENT_RATINGS = 20;
const LIST_ALL = 100;

interface BusMonthRow {
  bus_id: number;
  bus_name: string;
  trips_run: number;
  on_time: number;
  litres: number;
  cost: number;
  incidents: number;
}

@Injectable()
export class TransportOpsService {
  constructor(
    private readonly operations: OperationsService,
    private readonly incidentsService: IncidentsService,
    private readonly clearance: ClearanceService,
    private readonly telematics: TelematicsClient,
    private readonly checks: PreTripChecksService,
    private readonly duty: DriverDutyService,
    private readonly alerts: FleetAlertsService,
    private readonly requests: BusRequestsService,
    private readonly passes: BusPassService,
    private readonly ratingsService: DriverRatingsService,
    private readonly schedules: MaintenanceSchedulesService,
    private readonly reports: FleetReportsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  incidents(schoolId: number, query: IncidentQueryDto) {
    return this.incidentsService.list(schoolId, query);
  }

  incidentInsights(schoolId: number) {
    return this.incidentsService.insights(schoolId);
  }

  incident(schoolId: number, id: number) {
    return this.incidentsService.detail(schoolId, id);
  }

  resolveIncident(schoolId: number, id: number, note: string, actor: AuthUser) {
    return this.incidentsService.resolve(schoolId, id, note, actor);
  }

  allowBusToday(schoolId: number, id: number, reason: string, actor: AuthUser) {
    return this.clearance.allowVehicle(schoolId, id, reason, actor);
  }

  async live(schoolId: number): Promise<TransportLiveDto> {
    const [vehicles, trips, live] = await Promise.all([
      this.dataSource
        .getRepository(Vehicle)
        .find({ where: { school_id: schoolId, status: 'active' }, order: { name: 'ASC' } }),
      this.dataSource.getRepository(TransportTrip).find({ where: { school_id: schoolId, status: 'active' } }),
      this.telematics.get<FleetLiveDto>('/devices/live').catch(() => null),
    ]);
    const routeIds = [...new Set(trips.map((trip) => trip.route_id))];
    const routes: { id: number; name: string }[] = routeIds.length
      ? await this.dataSource.query(`SELECT id, name FROM transport_routes WHERE id = ANY($1)`, [routeIds])
      : [];
    const buses: LiveBusDto[] = vehicles.map((vehicle) => {
      const device = vehicle.device_id ? live?.vehicles.find((item) => item.id === Number(vehicle.device_id)) : null;
      const trip = trips.find((item) => item.vehicle_id === vehicle.id) ?? null;
      const tracked = device?.position ?? null;
      const saved = trip?.last_position ?? null;
      const current = trip?.stops.find((stop) => stop.status === 'arrived' || stop.status === 'approaching');
      return {
        bus_id: vehicle.id,
        bus_name: vehicle.name,
        registration_no: vehicle.registration_no,
        state: device?.state ?? 'no_data',
        online: device?.online ?? false,
        lat: tracked?.lat ?? saved?.lat ?? null,
        lng: tracked?.lng ?? saved?.lng ?? null,
        speed: tracked?.speed ?? saved?.speed ?? null,
        heading: tracked?.heading ?? saved?.heading ?? null,
        last_seen_at: device?.last_seen_at ?? saved?.recorded_at ?? null,
        stopped_since: device?.stopped_since ?? null,
        position_source: tracked ? 'telematics' : saved ? 'trip' : null,
        trip: trip
          ? {
              trip_id: trip.id,
              route_id: trip.route_id,
              route_name: routes.find((route) => Number(route.id) === trip.route_id)?.name ?? '',
              direction: trip.kind,
              started_at: trip.started_at,
              current_stop: current?.name ?? null,
              delay_minutes: trip.delay_minutes,
            }
          : null,
      };
    });
    return { telematics_available: live !== null, counts: liveCounts(buses), buses };
  }

  async lateTrips(schoolId: number, date?: string): Promise<LateTripsDto> {
    return this.lateFromBoard(await this.operations.board(schoolId, date));
  }

  async lateFromBoard(board: OperationsBoardDto): Promise<LateTripsDto> {
    const today = todayIn(this.app.timeZone);
    const nowMinutes =
      board.date === today ? minutesOf(this.clock(new Date())) : board.date < today ? END_OF_DAY_MINUTES : null;
    const tripIds = board.trips.map((row) => row.trip_id).filter((id): id is number => id !== null);
    const driverIds = [...new Set(board.trips.map((row) => row.driver?.id).filter((id): id is number => !!id))];
    const [skipped, mobiles] = await Promise.all([
      tripIds.length
        ? (this.dataSource.query(
            `SELECT id, (SELECT COUNT(*) FROM jsonb_array_elements(stops) s WHERE s->>'status' = 'skipped')::int AS skipped
             FROM transport_trips WHERE id = ANY($1)`,
            [tripIds],
          ) as Promise<{ id: number; skipped: number }[]>)
        : Promise.resolve([]),
      driverIds.length
        ? (this.dataSource.query(`SELECT id, mobile FROM users WHERE id = ANY($1)`, [driverIds]) as Promise<
            { id: number; mobile: string | null }[]
          >)
        : Promise.resolve([]),
    ]);
    const items: LateTripDto[] = board.trips.flatMap((row) => {
      const skippedStops = skipped.find((item) => Number(item.id) === row.trip_id)?.skipped ?? 0;
      const result = classifyLate({
        status: row.status,
        planned_minutes: minutesOf(row.planned_start),
        started_minutes: row.started_at ? minutesOf(this.clock(new Date(row.started_at))) : null,
        now_minutes: nowMinutes,
        delay_minutes: row.delay_minutes,
        skipped_stops: skippedStops,
      });
      if (!result) return [];
      return [
        {
          trip_id: row.trip_id,
          route_id: row.route.id,
          route_name: row.route.name,
          direction: row.kind,
          bus_id: row.vehicle?.id ?? null,
          bus_name: row.vehicle?.name ?? null,
          driver_name: row.driver?.name ?? null,
          driver_mobile: mobiles.find((item) => Number(item.id) === row.driver?.id)?.mobile ?? null,
          scheduled_start: row.planned_start,
          started_at: row.started_at,
          delay_minutes: result.delay_minutes,
          status: result.status,
          missed_stops: skippedStops,
        },
      ];
    });
    items.sort((a, b) => b.delay_minutes - a.delay_minutes);
    return { date: board.date, counts: lateCounts(items), items };
  }

  async preTripFailures(schoolId: number, date?: string): Promise<PreTripFailuresDto> {
    const day = date ?? todayIn(this.app.timeZone);
    const page = await this.checks.list(schoolId, {
      date: day,
      state: 'failed',
      page: 1,
      limit: LIST_ALL,
      order: 'desc',
    } as PreTripQueryDto);
    return {
      date: day,
      counts: {
        failed: page.total,
        blocked: page.items.filter((check) => check.blocked).length,
        cleared: page.items.filter((check) => check.critical_failed && check.cleared_at).length,
      },
      items: page.items,
    };
  }

  clearPreTrip(schoolId: number, id: number, note: string, actor: AuthUser) {
    return this.checks.clear(schoolId, id, note, actor);
  }

  driverAttendance(schoolId: number, date?: string) {
    return this.duty.dayList(schoolId, date);
  }

  crewMonth(schoolId: number, month?: string) {
    return this.duty.crewMonth(schoolId, month);
  }

  alertList(schoolId: number, query: TransportAlertQueryDto) {
    const { type, ...rest } = query;
    return this.alerts.list(schoolId, { ...rest, kind: type } as AlertQueryDto);
  }

  alertInsights(schoolId: number) {
    return this.alerts.insights(schoolId);
  }

  acknowledgeAlert(schoolId: number, id: number, actor: AuthUser) {
    return this.alerts.acknowledge(schoolId, id, actor);
  }

  resolveAlert(schoolId: number, id: number, dto: ResolveAlertDto, actor: AuthUser) {
    return this.alerts.resolve(schoolId, id, dto, actor);
  }

  busRequests(schoolId: number, date?: string) {
    return this.requests.forDate(schoolId, date);
  }

  passesOnHold(schoolId: number, query: PassesOnHoldQueryDto) {
    return this.passes.list(schoolId, {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      state: 'on_hold',
    } as BusPassQueryDto);
  }

  async ratings(schoolId: number): Promise<TransportRatingsDto> {
    const [summary, recent] = await Promise.all([
      this.ratingsService.summary(schoolId),
      this.ratingsService.list(schoolId, {
        page: 1,
        limit: RECENT_RATINGS,
        sort: 'updated_at',
        order: 'desc',
      } as DriverRatingQueryDto),
    ]);
    return { summary, recent: [...recent.items].sort((a, b) => a.rating - b.rating) };
  }

  async maintenanceDue(schoolId: number): Promise<MaintenanceDueDto> {
    const buses = await this.dataSource
      .getRepository(Vehicle)
      .find({ where: { school_id: schoolId, status: 'active' }, select: { id: true } });
    const schedules = await this.schedules.forBuses(
      schoolId,
      buses.map((bus) => bus.id),
    );
    const items: MaintenanceDueItemDto[] = schedules.flatMap((schedule) => {
      const status = maintenanceDue(schedule);
      if (!status) return [];
      return [
        {
          bus_id: schedule.vehicle.id,
          bus_name: schedule.vehicle.name,
          registration_no: schedule.vehicle.registration_no,
          task: schedule.title,
          due_on: schedule.next_due_on,
          due_km: schedule.next_due_km,
          status,
          days_left: schedule.days_left,
        },
      ];
    });
    items.sort(
      (a, b) =>
        Number(b.status === 'overdue') - Number(a.status === 'overdue') ||
        (a.days_left ?? Infinity) - (b.days_left ?? Infinity),
    );
    return {
      counts: {
        overdue: items.filter((item) => item.status === 'overdue').length,
        due_soon: items.filter((item) => item.status === 'due_soon').length,
      },
      items,
    };
  }

  async summary(schoolId: number, month?: string): Promise<TransportMonthDto> {
    const wanted = month ?? todayIn(this.app.timeZone).slice(0, 7);
    const { from, to } = monthBounds(wanted);
    const lastDay = new Date(Date.parse(`${to}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const [rows, [totals], mileage] = await Promise.all([
      this.dataSource.query(
        `WITH first AS (
           SELECT route_id, MIN(pickup_time) AS first_pickup, MIN(drop_time) AS first_drop
           FROM route_stops WHERE deleted_at IS NULL GROUP BY route_id
         ),
         trips AS (
           SELECT t.vehicle_id, COALESCE(t.delay_minutes, 0) AS delay,
                  CASE WHEN t.kind = 'pickup' THEN f.first_pickup ELSE f.first_drop END AS planned,
                  EXTRACT(HOUR FROM t.started_at AT TIME ZONE $4) * 60 + EXTRACT(MINUTE FROM t.started_at AT TIME ZONE $4) AS started
           FROM transport_trips t LEFT JOIN first f ON f.route_id = t.route_id
           WHERE t.school_id = $1 AND t.trip_date >= $2::date AND t.trip_date < $3::date AND t.handover_of IS NULL
         ),
         trip_totals AS (
           SELECT vehicle_id, COUNT(*)::int AS trips_run,
                  COUNT(*) FILTER (WHERE delay < $5 AND (planned IS NULL OR planned !~ '^[0-9]{1,2}:[0-9]{2}'
                    OR started - (split_part(planned, ':', 1)::int * 60 + split_part(planned, ':', 2)::int) < $5))::int AS on_time
           FROM trips GROUP BY vehicle_id
         ),
         fuel AS (
           SELECT vehicle_id, SUM(litres)::float AS litres, SUM(amount)::float AS cost FROM fuel_logs
           WHERE school_id = $1 AND deleted_at IS NULL AND status = 'approved' AND filled_on >= $2::date AND filled_on < $3::date
           GROUP BY vehicle_id
         ),
         incidents AS (
           SELECT vehicle_id, COUNT(*)::int AS incidents FROM transport_incidents
           WHERE school_id = $1 AND deleted_at IS NULL
             AND (occurred_at AT TIME ZONE $4)::date >= $2::date AND (occurred_at AT TIME ZONE $4)::date < $3::date
           GROUP BY vehicle_id
         )
         SELECT v.id AS bus_id, v.name AS bus_name, COALESCE(tt.trips_run, 0) AS trips_run, COALESCE(tt.on_time, 0) AS on_time,
                COALESCE(f.litres, 0) AS litres, COALESCE(f.cost, 0) AS cost, COALESCE(i.incidents, 0) AS incidents
         FROM vehicles v
         LEFT JOIN trip_totals tt ON tt.vehicle_id = v.id
         LEFT JOIN fuel f ON f.vehicle_id = v.id
         LEFT JOIN incidents i ON i.vehicle_id = v.id
         WHERE v.school_id = $1 AND v.deleted_at IS NULL
           AND (v.status = 'active' OR tt.trips_run > 0 OR f.litres > 0 OR i.incidents > 0)
         ORDER BY v.name`,
        [schoolId, from, to, this.app.timeZone, LATE_MINUTES],
      ) as Promise<BusMonthRow[]>,
      this.dataSource.query(
        `SELECT
           (SELECT COUNT(*) FROM transport_incidents WHERE school_id = $1 AND deleted_at IS NULL
              AND (occurred_at AT TIME ZONE $4)::date >= $2::date AND (occurred_at AT TIME ZONE $4)::date < $3::date)::int AS incidents,
           (SELECT COALESCE(SUM(CASE WHEN l.half_day THEN 0.5
                     ELSE LEAST(l.to_date, $3::date - 1) - GREATEST(l.from_date, $2::date) + 1 END), 0)
              FROM staff_leave_requests l
             WHERE l.school_id = $1 AND l.deleted_at IS NULL AND l.status = 'approved'
               AND l.from_date < $3::date AND l.to_date >= $2::date
               AND EXISTS (SELECT 1 FROM user_roles cr JOIN roles crr ON crr.id = cr.role_id
                            WHERE cr.user_id = l.user_id AND crr.code IN ('DRIVER', 'ATTENDANT')))::float AS leave_days`,
        [schoolId, from, to, this.app.timeZone],
      ) as Promise<{ incidents: number; leave_days: number }[]>,
      this.reports.mileage(schoolId, { from, to: lastDay } as ReportRangeDto),
    ]);
    const buses = rows.map((row) => {
      const tripsRun = Number(row.trips_run);
      const litres = Math.round(Number(row.litres) * 100) / 100;
      return {
        bus_id: Number(row.bus_id),
        bus_name: row.bus_name,
        trips_run: tripsRun,
        on_time: Number(row.on_time),
        on_time_percent: onTimePercent(Number(row.on_time), tripsRun),
        litres,
        cost: Math.round(Number(row.cost) * 100) / 100,
        km_per_litre:
          mileage.find((item) => item.vehicle.id === Number(row.bus_id) && item.month === wanted)?.km_per_litre ?? null,
        incidents: Number(row.incidents),
      };
    });
    const tripsRun = buses.reduce((sum, bus) => sum + bus.trips_run, 0);
    const onTime = buses.reduce((sum, bus) => sum + bus.on_time, 0);
    return {
      month: wanted,
      trips_run: tripsRun,
      trips_on_time: onTime,
      on_time_percent: onTimePercent(onTime, tripsRun),
      incidents: Number(totals?.incidents ?? 0),
      leave_days: Number(totals?.leave_days ?? 0),
      fuel: {
        litres: Math.round(buses.reduce((sum, bus) => sum + bus.litres, 0) * 100) / 100,
        cost: Math.round(buses.reduce((sum, bus) => sum + bus.cost, 0) * 100) / 100,
        km_per_litre: weightedKmPerLitre(buses),
      },
      buses: buses.map((bus) => ({
        bus_id: bus.bus_id,
        bus_name: bus.bus_name,
        trips_run: bus.trips_run,
        on_time_percent: bus.on_time_percent,
        litres: bus.litres,
        cost: bus.cost,
        km_per_litre: bus.km_per_litre,
        incidents: bus.incidents,
      })),
    };
  }

  async opsCounts(schoolId: number, board: OperationsBoardDto): Promise<OpsCountsDto> {
    const [incidents, failures, late, alerts, passes, maintenance] = await Promise.all([
      this.incidentsService.insights(schoolId),
      this.checks.list(schoolId, { date: board.date, state: 'failed', page: 1, limit: 1 } as PreTripQueryDto),
      this.lateFromBoard(board),
      this.alerts.insights(schoolId),
      this.passesOnHold(schoolId, { page: 1, limit: 1 }),
      this.maintenanceDue(schoolId),
    ]);
    return {
      open_incidents: incidents.open,
      pre_trip_failures: failures.total,
      late_trips: late.items.length,
      open_alerts: alerts.open + alerts.acknowledged,
      passes_on_hold: passes.total,
      maintenance_overdue: maintenance.counts.overdue,
    };
  }

  private clock(at: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: this.app.timeZone,
    }).format(at);
  }
}
