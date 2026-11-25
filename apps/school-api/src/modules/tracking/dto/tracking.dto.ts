import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ListQueryDto } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { RefDto } from '../../students/dto/student-response.dto';
import { BoardingDto, ChildBoardingDto } from './boarding.dto';
import { TRANSPORT_MODES, TransportMode } from '../../transport/entities/student-transport.entity';
import {
  STOP_STATUSES,
  StopStatus,
  TRIP_KINDS,
  TRIP_STATUSES,
  TRIP_TRACKING,
  TripKind,
  TripStatus,
  TripTracking,
} from '../entities/transport-trip.entity';
import { TRIP_EVENT_TYPES, TripEventType } from '../entities/trip-event.entity';
import { CHILD_BUS_STATUSES, ChildBusStatus } from '../tracking.logic';
import { TRIP_FLAG_FILTERS, TripFlagFilter } from '../boarding.logic';
import { BOARDING_STATUSES, BoardingStatus, TIMELINE_SOURCES, TimelineSource } from '../bus-timeline.logic';

export class StartTripDto {
  @ApiProperty({ example: 1, description: 'A route run by your bus' })
  @IsInt()
  route_id: number;

  @ApiProperty({
    enum: TRIP_KINDS,
    example: 'pickup',
    description: 'pickup: stops to school (morning); drop: school to stops (evening)',
  })
  @IsIn(TRIP_KINDS)
  kind: TripKind;
}

export class PhonePositionDto {
  @ApiProperty({ example: 13.0849 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ example: 80.2105 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  @ApiPropertyOptional({ example: 28, description: 'km/h' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200)
  speed?: number;

  @ApiPropertyOptional({ example: 90 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  @ApiPropertyOptional({
    example: '2026-11-09T07:12:30+05:30',
    description: 'When the phone took the fix; defaults to now',
  })
  @IsOptional()
  @IsString()
  recorded_at?: string;
}

export class TripQueryDto extends ListQueryDto {
  @IsDateOnly('2026-11-09', true)
  date?: string;

  @ApiPropertyOptional({ enum: TRIP_STATUSES })
  @IsOptional()
  @IsIn(TRIP_STATUSES)
  status?: TripStatus;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  route_id?: number;

  @ApiPropertyOptional({ example: 1, description: 'The bus (vehicles.id)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  vehicle_id?: number;

  @ApiPropertyOptional({
    enum: TRIP_FLAG_FILTERS,
    description:
      'Ended trips with a problem: not_alighted (a child marked on the bus and never off), not_boarded (a child who was not away and never got on) or any',
  })
  @IsOptional()
  @IsIn(TRIP_FLAG_FILTERS)
  flag?: TripFlagFilter;
}

export class TripPositionDto {
  @ApiProperty({ example: 13.0849 })
  lat: number;

  @ApiProperty({ example: 80.2105 })
  lng: number;

  @ApiProperty({ example: 28, nullable: true, type: Number })
  speed: number | null;

  @ApiProperty({ example: 90, nullable: true, type: Number })
  heading: number | null;

  @ApiProperty({ example: '2026-11-09T07:12:30.000+05:30' })
  recorded_at: string;

  @ApiProperty({
    example: 'device',
    nullable: true,
    type: String,
    description: 'device (GPS tracker) or phone (driver app fallback)',
  })
  source: string | null;
}

export class TripStopDto {
  @ApiProperty({ example: 4 })
  stop_id: number;

  @ApiProperty({ example: 'Anna Nagar Roundtana' })
  name: string;

  @ApiProperty({ example: 4 })
  sequence: number;

  @ApiProperty({ example: 13.0849 })
  lat: number;

  @ApiProperty({ example: 80.2105 })
  lng: number;

  @ApiProperty({ example: 120, description: 'Geofence radius in metres' })
  radius_m: number;

  @ApiProperty({ nullable: true, type: String, example: '07:28' })
  planned_time: string | null;

  @ApiProperty({ enum: STOP_STATUSES })
  status: StopStatus;

  @ApiProperty({ nullable: true, type: Number, example: 240, description: 'Seconds until the bus reaches this stop' })
  eta_seconds: number | null;

  @ApiProperty({ nullable: true, type: String })
  approached_at: string | null;

  @ApiProperty({ nullable: true, type: String })
  arrived_at: string | null;

  @ApiProperty({ nullable: true, type: String })
  departed_at: string | null;

  @ApiProperty({ example: 4, description: 'Students who board or get down here on this trip' })
  riders: number;
}

export class TripVehicleDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'TN 09 AB 1234' })
  registration_no: string;

  @ApiProperty({ example: 'Bus 1' })
  name: string;

  @ApiProperty({ example: 1, nullable: true, type: Number, description: 'GPS tracker id (matches /admin/fleet/live)' })
  device_id: number | null;
}

export class TripDto {
  @ApiProperty({ example: 41 })
  id: number;

  @ApiProperty({ enum: TRIP_KINDS })
  kind: TripKind;

  @ApiProperty({ enum: TRIP_STATUSES })
  status: TripStatus;

  @ApiProperty({ example: '2026-11-09' })
  trip_date: string;

  @ApiProperty({ type: RefDto })
  route: RefDto;

  @ApiProperty({ type: TripVehicleDto })
  vehicle: TripVehicleDto;

  @ApiProperty({ type: RefDto, nullable: true, description: 'Who started it' })
  started_by: RefDto | null;

  @ApiProperty()
  started_at: Date;

  @ApiProperty({ nullable: true, type: Date })
  ended_at: Date | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'arrived_school',
    description: 'arrived_school, route_complete, driver, admin or timeout',
  })
  end_reason: string | null;

  @ApiProperty({ type: TripPositionDto, nullable: true })
  position: TripPositionDto | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 1260,
    description: 'Seconds to school (pickup) or to the last stop (drop)',
  })
  destination_eta_seconds: number | null;

  @ApiProperty({ example: 2, description: 'Stops done (departed or skipped)' })
  stops_done: number;

  @ApiProperty({ example: 4 })
  stops_total: number;

  @ApiProperty({ type: () => TripDelayDto, nullable: true, description: 'Last delay the driver reported' })
  delay: TripDelayDto | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: null,
    description: 'This trip took over from that trip (breakdown)',
  })
  handover_of: number | null;

  @ApiProperty({ nullable: true, type: Number, example: null, description: 'This trip was handed over to that trip' })
  replaced_by: number | null;

  @ApiProperty({
    enum: TRIP_TRACKING,
    example: 'phone',
    description:
      'telematics: the GPS tracker moves the stops by itself. phone: no tracker, the driver taps Reached, Left and Skip on each stop',
  })
  tracking: TripTracking;

  @ApiProperty({
    nullable: true,
    type: Date,
    description: 'When the driver checked that no child was left on the bus (end-of-trip sweep)',
  })
  swept_at: Date | null;
}

export class HandoverInputDto {
  @ApiProperty({ example: 2, description: 'The bus that takes over' })
  @Type(() => Number)
  @IsInt()
  vehicle_id: number;

  @ApiPropertyOptional({ example: 'Puncture near Koyambedu', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Also run this route with the new bus for the rest of today (the other trip of the day)',
  })
  @IsOptional()
  @IsBoolean()
  keep_for_today?: boolean;
}

export class HandoverResultDto {
  @ApiProperty({ type: () => TripDto, description: 'The broken-down trip, now ended with end_reason breakdown' })
  old_trip: TripDto;

  @ApiProperty({ type: () => TripDto, description: 'The new trip on the new bus for the stops that are left' })
  new_trip: TripDto;

  @ApiProperty({ example: 9, description: 'Children already on board, moved to the new trip' })
  on_board: number;

  @ApiProperty({ example: 14, description: 'Children still to be picked up or dropped' })
  waiting: number;

  @ApiProperty({ example: 30, description: 'Parents told' })
  parents_told: number;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Set when the new bus also runs its own route at that time',
  })
  warning: string | null;
}

export class TripDelayDto {
  @ApiProperty({ example: 20 })
  minutes: number;

  @ApiProperty({ nullable: true, type: String, example: 'Traffic jam at Koyambedu' })
  reason: string | null;

  @ApiProperty()
  at: Date;
}

export class BusDelayInputDto {
  @ApiProperty({ example: 20, minimum: 5, maximum: 180, description: 'About how many minutes late (10, 20, 30 …)' })
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(180)
  minutes: number;

  @ApiPropertyOptional({ example: 'Traffic jam at Koyambedu', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class TripFlagCountsDto {
  @ApiProperty({ example: 1, description: 'Riders who were not away and never got on' })
  not_boarded: number;

  @ApiProperty({ example: 0, description: 'Riders marked on the bus and never marked off' })
  not_alighted: number;
}

export class TripListItemDto extends TripDto {
  @ApiProperty({ type: TripFlagCountsDto, nullable: true, description: 'Only for ended trips; null while running' })
  flags: TripFlagCountsDto | null;
}

export class TripEventDto {
  @ApiProperty({ example: 120 })
  id: number;

  @ApiProperty({ enum: TRIP_EVENT_TYPES })
  type: TripEventType;

  @ApiProperty({ type: RefDto, nullable: true })
  stop: RefDto | null;

  @ApiProperty({ nullable: true, type: Number })
  eta_seconds: number | null;

  @ApiProperty()
  occurred_at: Date;

  @ApiProperty({ example: 6, description: 'Parents or teachers told about this event' })
  notified: number;
}

export class RiderDto {
  @ApiProperty({ example: 12 })
  student_id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ nullable: true, type: String, example: '6 - A' })
  class_section: string | null;

  @ApiProperty({ example: 4 })
  stop_id: number;

  @ApiProperty({ enum: TRANSPORT_MODES })
  mode: TransportMode;

  @ApiProperty({ example: 'P7f3a9c2e1b4d' })
  passenger_ref: string;

  @ApiProperty({ example: false })
  boarded: boolean;

  @ApiProperty({ example: false, description: 'Got off the bus (scanned or tapped as alighted)' })
  alighted: boolean;

  @ApiProperty({
    example: false,
    description: 'Not expected on this trip: leave (half-day leave only for its half), sports OD or marked absent',
  })
  away_today: boolean;

  @ApiProperty({ example: false, description: 'The driver marked "not at stop" on this trip' })
  missed: boolean;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Sports OD – District athletics',
    description: 'Why the student is not expected on this trip: On leave, Half-day leave, Sports OD or Marked absent',
  })
  away_note: string | null;
}

export class TripDetailDto extends TripDto {
  @ApiProperty({ type: [TripStopDto], description: 'Stops in travel order with live status and ETA' })
  stop_list: TripStopDto[];

  @ApiProperty({
    type: TripPositionDto,
    nullable: true,
    description: 'School gate (the end of a pickup, the start of a drop)',
  })
  school: { lat: number; lng: number } | null;

  @ApiProperty({ type: [TripEventDto] })
  events: TripEventDto[];

  @ApiProperty({ type: [RiderDto], description: 'Students expected on this trip' })
  riders: RiderDto[];

  @ApiProperty({ type: [RiderDto], description: 'Expected but not boarded yet (students away today are left out)' })
  not_boarded: RiderDto[];

  @ApiProperty({
    type: [RiderDto],
    description: 'After the trip ends: boarded but never marked off the bus. Empty while the trip runs.',
  })
  not_alighted: RiderDto[];

  @ApiProperty({ type: [BoardingDto], description: 'Who boarded or got off, newest first, with time and method' })
  boardings: BoardingDto[];
}

export class DriverRouteTodayDto {
  @ApiProperty({ type: RefDto })
  route: RefDto;

  @ApiProperty({ example: 'R1' })
  code: string;

  @ApiProperty({ example: 4 })
  stops: number;

  @ApiProperty({ example: 13 })
  students: number;

  @ApiProperty({ nullable: true, type: String, example: '07:00' })
  first_pickup: string | null;

  @ApiProperty({ type: [TripDto], description: 'Trips on this route today' })
  trips: TripDto[];
}

export class DriverTodayDto {
  @ApiProperty({ type: TripVehicleDto, nullable: true })
  vehicle: TripVehicleDto | null;

  @ApiProperty({
    example: true,
    description: 'false when the bus has no GPS tracker yet: use the phone position calls',
  })
  has_tracker: boolean;

  @ApiProperty({ type: TripDto, nullable: true, description: 'The trip running now, if any' })
  active_trip: TripDto | null;

  @ApiProperty({ type: [DriverRouteTodayDto] })
  routes: DriverRouteTodayDto[];
}

export class ChildBusDto {
  @ApiProperty({
    enum: CHILD_BUS_STATUSES,
    description: 'no_trip, on_the_way, approaching, at_stop, passed, trip_ended',
  })
  status: ChildBusStatus;

  @ApiProperty({ example: 'Bus is 4 min away', description: 'Ready-to-show line' })
  headline: string;

  @ApiProperty({ type: RefDto })
  route: RefDto;

  @ApiProperty({ type: TripStopDto, nullable: true, description: 'The child’s own stop on this trip' })
  stop: TripStopDto | null;

  @ApiProperty({ type: TripVehicleDto, nullable: true })
  vehicle: TripVehicleDto | null;

  @ApiProperty({
    type: TripDto,
    nullable: true,
    description: 'Today’s trip for the child; subscribe to it over the live socket',
  })
  trip: TripDto | null;

  @ApiProperty({ nullable: true, type: Number, example: 240 })
  eta_seconds: number | null;

  @ApiProperty({
    type: TripPositionDto,
    nullable: true,
    description: 'Live position on a trip, or the last known position of the bus',
  })
  position: TripPositionDto | null;

  @ApiProperty({ example: false, description: 'true when position is older than 2 minutes' })
  position_stale: boolean;

  @ApiProperty({
    type: ChildBoardingDto,
    nullable: true,
    description: 'The child’s latest scan on this trip (boarded or alighted); null before the first scan',
  })
  boarding: ChildBoardingDto | null;
}

export class TimelineStopDto {
  @ApiProperty({ example: 12 })
  stop_id: number;

  @ApiProperty({ example: 'Anna Nagar Roundtana' })
  name: string;

  @ApiProperty({ example: 3, description: 'Stop number on the route' })
  sequence: number;

  @ApiProperty({ nullable: true, type: String, example: '07:25', description: 'Planned time for this trip kind' })
  planned_time: string | null;

  @ApiProperty({ nullable: true, type: String, example: '2026-11-04T07:25:00.000+05:30' })
  planned_at: Date | null;

  @ApiProperty({ enum: STOP_STATUSES, example: 'pending' })
  status: StopStatus;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 540,
    description: 'Upcoming stops only (pending, approaching): seconds from the last bus position',
  })
  eta_seconds: number | null;

  @ApiProperty({ nullable: true, type: String, example: '2026-11-04T07:31:00.000+05:30' })
  eta_at: Date | null;

  @ApiProperty({ nullable: true, type: String, example: null, description: 'Past stops only' })
  arrived_at: Date | null;

  @ApiProperty({ nullable: true, type: String, example: null, description: 'Past stops only' })
  departed_at: Date | null;

  @ApiProperty({ example: true, description: 'true for the child’s own stop' })
  is_child_stop: boolean;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 6,
    description:
      'Minutes behind the planned time (negative = early): actual arrival for past stops, ETA for upcoming ones; null when unknown or skipped',
  })
  minutes_late: number | null;
}

export class ChildBusTimelineDto {
  @ApiProperty({
    enum: TIMELINE_SOURCES,
    example: 'live',
    description: 'live: the trip running now; scheduled: no trip is running, this is the next planned trip',
  })
  source: TimelineSource;

  @ApiProperty({ nullable: true, type: Number, example: 41, description: 'null for a scheduled trip' })
  trip_id: number | null;

  @ApiProperty({ enum: TRIP_KINDS, example: 'pickup' })
  kind: TripKind;

  @ApiProperty({ example: '2026-11-04' })
  trip_date: string;

  @ApiProperty({ example: 12 })
  child_stop_id: number;

  @ApiProperty({ type: [TimelineStopDto], description: 'Every stop in travel order' })
  stops: TimelineStopDto[];
}

export class ChildBusV2Dto extends ChildBusDto {
  @ApiProperty({
    enum: BOARDING_STATUSES,
    example: 'boarded',
    description: 'not_yet, boarded, alighted or not_at_stop (the bus came and the child was not there) on today’s trip',
  })
  boarding_status: BoardingStatus;

  @ApiProperty({ nullable: true, type: String, example: '2026-11-04T07:22:41.000+05:30' })
  last_position_at: string | null;

  @ApiProperty({
    type: ChildBusTimelineDto,
    nullable: true,
    description: 'Stop timeline of the running trip, or of the next scheduled trip when none is running',
  })
  timeline: ChildBusTimelineDto | null;
}

export const STOP_ACTIONS = ['arrived', 'departed', 'skipped'] as const;
export type StopAction = (typeof STOP_ACTIONS)[number];

export class StopActionInputDto {
  @ApiPropertyOptional({
    example: 'No students at this stop today',
    maxLength: 200,
    description: 'Only for skipped: why the bus did not stop. Parents of that stop see it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @ApiPropertyOptional({ example: 13.0849, description: 'Phone location when the driver tapped' })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ example: 80.2105 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;
}

export class TripSweepInputDto {
  @ApiProperty({ example: 812, description: 'Photo of the empty bus, uploaded first with POST /files' })
  @Type(() => Number)
  @IsInt()
  photo_file_id: number;
}
