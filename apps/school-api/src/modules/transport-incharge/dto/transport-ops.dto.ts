import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { ListQueryDto, PaginationDto } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { PreTripCheckDto } from '../../fleet-ops/dto/fleet-maintenance.dto';
import { VEHICLE_STATES, VehicleState } from '../../fleet/dto/fleet.dto';
import { ALERT_KINDS, ALERT_STATUSES, AlertKind, AlertStatus } from '../../tracking/entities/fleet-alert.entity';
import { DriverRatingDto, DriverRatingSummaryDto } from '../../transport/dto/driver-rating.dto';

export class DateQueryDto {
  @IsDateOnly('2026-11-27', true)
  date?: string;
}

export class TransportAlertQueryDto extends ListQueryDto {
  @ApiPropertyOptional({
    enum: ALERT_KINDS,
    description: 'Alert kind (sos, overspeed, harsh_braking, idle, route_deviation, vehicle_fault, other)',
  })
  @IsOptional()
  @IsIn(ALERT_KINDS)
  type?: AlertKind;

  @ApiPropertyOptional({ enum: ALERT_STATUSES })
  @IsOptional()
  @IsIn(ALERT_STATUSES)
  status?: AlertStatus;
}

export class PassesOnHoldQueryDto extends PaginationDto {}

export class OpsCountsDto {
  @ApiProperty({ example: 2 })
  open_incidents: number;

  @ApiProperty({ example: 1, description: 'Today’s pre-trip checks with at least one item not OK' })
  pre_trip_failures: number;

  @ApiProperty({ example: 3, description: 'Late, not started and missed-stop trips of the day (GET trips/late)' })
  late_trips: number;

  @ApiProperty({ example: 4, description: 'Fleet alerts not resolved yet (open or acknowledged)' })
  open_alerts: number;

  @ApiProperty({ example: 2 })
  passes_on_hold: number;

  @ApiProperty({ example: 1 })
  maintenance_overdue: number;
}

export class LateCountsDto {
  @ApiProperty({ example: 2, description: 'late_start + running_late' })
  late: number;

  @ApiProperty({ example: 1 })
  not_started: number;

  @ApiProperty({ example: 1 })
  missed_stops: number;
}

export const LATE_STATUSES = ['late_start', 'running_late', 'not_started', 'missed_stops'] as const;

export class LateTripDto {
  @ApiProperty({ nullable: true, type: Number, example: 41, description: 'null when the trip has not started' })
  trip_id: number | null;

  @ApiProperty({ example: 3 })
  route_id: number;

  @ApiProperty({ example: 'Anna Nagar' })
  route_name: string;

  @ApiProperty({ enum: ['pickup', 'drop'] })
  direction: 'pickup' | 'drop';

  @ApiProperty({ nullable: true, type: Number, example: 2 })
  bus_id: number | null;

  @ApiProperty({ nullable: true, type: String, example: 'Bus 2 (TN01AB1234)' })
  bus_name: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Murugan K' })
  driver_name: string | null;

  @ApiProperty({ nullable: true, type: String, example: '9876543210' })
  driver_mobile: string | null;

  @ApiProperty({ nullable: true, type: String, example: '07:15', description: 'First stop time, HH:mm' })
  scheduled_start: string | null;

  @ApiProperty({ nullable: true, type: Date })
  started_at: Date | null;

  @ApiProperty({ example: 14 })
  delay_minutes: number;

  @ApiProperty({ enum: LATE_STATUSES })
  status: (typeof LATE_STATUSES)[number];

  @ApiProperty({ example: 0, description: 'Stops skipped on the trip' })
  missed_stops: number;
}

export class LateTripsDto {
  @ApiProperty({ example: '2026-11-27' })
  date: string;

  @ApiProperty({ type: LateCountsDto })
  counts: LateCountsDto;

  @ApiProperty({ type: [LateTripDto] })
  items: LateTripDto[];
}

export class PreTripFailureCountsDto {
  @ApiProperty({ example: 3, description: 'Checks with at least one item not OK' })
  failed: number;

  @ApiProperty({ example: 1, description: 'Critical item not OK and not cleared: the bus cannot run' })
  blocked: number;

  @ApiProperty({ example: 1, description: 'Critical failures already cleared' })
  cleared: number;
}

export class PreTripFailuresDto {
  @ApiProperty({ example: '2026-11-27' })
  date: string;

  @ApiProperty({ type: PreTripFailureCountsDto })
  counts: PreTripFailureCountsDto;

  @ApiProperty({ type: [PreTripCheckDto] })
  items: PreTripCheckDto[];
}

export class CrewMonthRowDto {
  @ApiProperty({ example: 21 })
  user_id: number;

  @ApiProperty({ example: 'Murugan K' })
  name: string;

  @ApiProperty({ enum: ['driver', 'attendant'] })
  role: 'driver' | 'attendant';

  @ApiProperty({ example: 18 })
  days_present: number;

  @ApiProperty({ example: 2 })
  late_days: number;

  @ApiProperty({ example: 1, description: 'Bus days with no check-in and no approved leave' })
  absent_days: number;

  @ApiProperty({ example: 1.5, description: 'Approved leave days in the month; a half day counts 0.5' })
  leave_days: number;
}

export class CrewMonthDto {
  @ApiProperty({ example: '2026-11' })
  month: string;

  @ApiProperty({ type: [CrewMonthRowDto] })
  items: CrewMonthRowDto[];
}

export class BusStudentDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  name: string;

  @ApiProperty({ nullable: true, type: String, example: '6 - A' })
  class_section: string | null;
}

export class BusOptOutRowDto {
  @ApiProperty({ example: 5 })
  id: number;

  @ApiProperty({ type: BusStudentDto })
  student: BusStudentDto;

  @ApiProperty({ nullable: true, type: String, example: 'Anna Nagar' })
  route_name: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Bus 2' })
  bus_name: string | null;

  @ApiProperty({ enum: ['pickup', 'drop'], description: 'The trip the child skips' })
  mode: 'pickup' | 'drop';

  @ApiProperty({ nullable: true, type: String, example: 'Going with father' })
  reason: string | null;

  @ApiProperty()
  created_at: Date;
}

export class BusPickupPersonRowDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ type: BusStudentDto })
  student: BusStudentDto;

  @ApiProperty({ nullable: true, type: String, example: 'Anna Nagar' })
  route_name: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Bus 2' })
  bus_name: string | null;

  @ApiProperty({ example: 'Ravi Kumar' })
  name: string;

  @ApiProperty({ example: '9876543210' })
  mobile: string;

  @ApiProperty({ nullable: true, type: String, example: 'Uncle' })
  relation: string | null;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;
}

export class BusRequestsDayDto {
  @ApiProperty({ example: '2026-11-27' })
  date: string;

  @ApiProperty({ type: [BusOptOutRowDto], description: 'Children whose parent said no bus for a trip that day' })
  opt_outs: BusOptOutRowDto[];

  @ApiProperty({ type: [BusPickupPersonRowDto], description: 'One-time pickup persons for that day' })
  pickup_persons: BusPickupPersonRowDto[];
}

export class TransportRatingsDto {
  @ApiProperty({ type: [DriverRatingSummaryDto], description: 'Same as GET /admin/transport/driver-ratings/summary' })
  summary: DriverRatingSummaryDto[];

  @ApiProperty({ type: [DriverRatingDto], description: 'The 20 latest ratings, lowest rating first' })
  recent: DriverRatingDto[];
}

export class MaintenanceDueCountsDto {
  @ApiProperty({ example: 1 })
  overdue: number;

  @ApiProperty({ example: 3 })
  due_soon: number;
}

export class MaintenanceDueItemDto {
  @ApiProperty({ example: 2 })
  bus_id: number;

  @ApiProperty({ example: 'Bus 2' })
  bus_name: string;

  @ApiProperty({ example: 'TN01AB1234' })
  registration_no: string;

  @ApiProperty({ example: 'Engine oil and filter change' })
  task: string;

  @ApiProperty({ nullable: true, type: String, example: '2026-12-10' })
  due_on: string | null;

  @ApiProperty({ nullable: true, type: Number, example: 50000 })
  due_km: number | null;

  @ApiProperty({ enum: ['overdue', 'due_soon'] })
  status: 'overdue' | 'due_soon';

  @ApiProperty({ nullable: true, type: Number, example: 13, description: 'Negative when overdue' })
  days_left: number | null;
}

export class MaintenanceDueDto {
  @ApiProperty({ type: MaintenanceDueCountsDto })
  counts: MaintenanceDueCountsDto;

  @ApiProperty({ type: [MaintenanceDueItemDto], description: 'Overdue first, then the soonest' })
  items: MaintenanceDueItemDto[];
}

export class FuelTotalsDto {
  @ApiProperty({ example: 812.5 })
  litres: number;

  @ApiProperty({ example: 78400 })
  cost: number;

  @ApiProperty({ nullable: true, type: Number, example: 5.8 })
  km_per_litre: number | null;
}

export class BusMonthDto {
  @ApiProperty({ example: 2 })
  bus_id: number;

  @ApiProperty({ example: 'Bus 2' })
  bus_name: string;

  @ApiProperty({ example: 44 })
  trips_run: number;

  @ApiProperty({ example: 90.9 })
  on_time_percent: number;

  @ApiProperty({ example: 210 })
  litres: number;

  @ApiProperty({ example: 20300 })
  cost: number;

  @ApiProperty({ nullable: true, type: Number, example: 5.6 })
  km_per_litre: number | null;

  @ApiProperty({ example: 1 })
  incidents: number;
}

export class TransportMonthDto {
  @ApiProperty({ example: '2026-11' })
  month: string;

  @ApiProperty({ example: 176 })
  trips_run: number;

  @ApiProperty({ example: 160 })
  trips_on_time: number;

  @ApiProperty({ example: 90.9 })
  on_time_percent: number;

  @ApiProperty({ example: 3 })
  incidents: number;

  @ApiProperty({ example: 4.5, description: 'Approved driver and attendant leave days in the month' })
  leave_days: number;

  @ApiProperty({ type: FuelTotalsDto })
  fuel: FuelTotalsDto;

  @ApiProperty({ type: [BusMonthDto] })
  buses: BusMonthDto[];
}

export class LiveTripDto {
  @ApiProperty({ example: 41 })
  trip_id: number;

  @ApiProperty({ example: 3 })
  route_id: number;

  @ApiProperty({ example: 'Anna Nagar' })
  route_name: string;

  @ApiProperty({ enum: ['pickup', 'drop'] })
  direction: 'pickup' | 'drop';

  @ApiProperty()
  started_at: Date;

  @ApiProperty({ nullable: true, type: String, example: 'Anna Nagar 2nd Ave' })
  current_stop: string | null;

  @ApiProperty({ nullable: true, type: Number, example: 5 })
  delay_minutes: number | null;
}

export const LIVE_STATES = [...VEHICLE_STATES] as const;

export class LiveBusDto {
  @ApiProperty({ example: 2 })
  bus_id: number;

  @ApiProperty({ example: 'Bus 2' })
  bus_name: string;

  @ApiProperty({ example: 'TN01AB1234' })
  registration_no: string;

  @ApiProperty({
    enum: LIVE_STATES,
    description: 'moving, idle (stopped, engine on), parked (engine off), offline, no_data (no tracker or no reading)',
  })
  state: VehicleState;

  @ApiProperty({ example: true })
  online: boolean;

  @ApiProperty({ nullable: true, type: Number, example: 13.0849 })
  lat: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 80.2105 })
  lng: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 32, description: 'km/h' })
  speed: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 90 })
  heading: number | null;

  @ApiProperty({ nullable: true, type: String, description: 'Time of the last reading' })
  last_seen_at: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'Since when it is stopped, while idle or parked' })
  stopped_since: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    enum: ['telematics', 'trip'],
    description: 'telematics = the tracker; trip = last position saved on the running trip',
  })
  position_source: 'telematics' | 'trip' | null;

  @ApiProperty({ type: LiveTripDto, nullable: true, description: 'The trip running now' })
  trip: LiveTripDto | null;
}

export class LiveCountsDto {
  @ApiProperty({ example: 6 })
  total: number;

  @ApiProperty({ example: 3 })
  moving: number;

  @ApiProperty({ example: 1, description: 'idle + parked' })
  stopped: number;

  @ApiProperty({ example: 1 })
  offline: number;

  @ApiProperty({ example: 1 })
  no_data: number;

  @ApiProperty({ example: 2, description: 'Buses on a trip now' })
  on_trip: number;
}

export class TransportLiveDto {
  @ApiProperty({
    example: true,
    description: 'false when the Telematics service could not be reached; positions then come from running trips',
  })
  telematics_available: boolean;

  @ApiProperty({ type: LiveCountsDto })
  counts: LiveCountsDto;

  @ApiProperty({ type: [LiveBusDto] })
  buses: LiveBusDto[];
}
