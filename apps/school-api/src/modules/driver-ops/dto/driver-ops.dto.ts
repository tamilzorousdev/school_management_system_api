import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ListQueryDto } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { IsMobile } from '../../../shared/mobile';
import { RefDto } from '../../students/dto/student-response.dto';
import {
  DUTY_PLACES,
  DutyPlace,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  IncidentStatus,
  IncidentType,
  OPT_OUT_TRIPS,
  OptOutTrip,
} from '../entities/driver-ops.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class GeoPointInputDto {
  @ApiPropertyOptional({ example: 13.0849 })
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

export class DutyCheckInDto extends GeoPointInputDto {
  @ApiPropertyOptional({ example: 640, description: 'Selfie, uploaded first with POST /files' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  photo_file_id?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Is the attendant (helper) of my bus with me today? The office is told when false.',
  })
  @IsOptional()
  @IsBoolean()
  attendant_present?: boolean;
}

export class DutyCheckOutDto extends GeoPointInputDto {
  @ApiPropertyOptional({ example: 641, description: 'Selfie, uploaded first with POST /files' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  photo_file_id?: number;
}

export class DutyMonthQueryDto {
  @ApiPropertyOptional({ example: '2026-11', description: 'YYYY-MM; defaults to this month' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' })
  month?: string;
}

export class DutyDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: '2026-11-25' })
  duty_date: string;

  @ApiProperty({ type: RefDto })
  driver: RefDto;

  @ApiProperty({ type: RefDto, nullable: true, description: 'The bus I drive' })
  vehicle: RefDto | null;

  @ApiProperty()
  check_in_at: Date;

  @ApiProperty({
    enum: DUTY_PLACES,
    description: 'Where I checked in: school, stop (a stop of my route), other, or unknown (no location)',
  })
  check_in_place: DutyPlace;

  @ApiProperty({ nullable: true, type: String, example: 'https://…/selfie.jpg' })
  check_in_photo_url: string | null;

  @ApiProperty({ nullable: true, type: String, example: '07:00', description: 'First stop time minus 15 minutes' })
  reporting_time: string | null;

  @ApiProperty({ example: 0, description: 'Minutes after the reporting time; 0 when on time' })
  late_minutes: number;

  @ApiProperty({ type: RefDto, nullable: true, description: 'Attendant (helper) of my bus' })
  attendant: RefDto | null;

  @ApiProperty({ nullable: true, type: Boolean, description: 'null when the bus has no attendant' })
  attendant_present: boolean | null;

  @ApiProperty({ nullable: true, type: Date })
  check_out_at: Date | null;

  @ApiProperty({ nullable: true, type: String })
  check_out_photo_url: string | null;

  @ApiProperty({ nullable: true, type: Number, example: 9.5, description: 'Hours between check-in and check-out' })
  hours: number | null;
}

export class DutyTodayDto {
  @ApiProperty({ example: '2026-11-25' })
  date: string;

  @ApiProperty({ type: RefDto, nullable: true, description: 'My bus today; null when I have none' })
  vehicle: RefDto | null;

  @ApiProperty({ type: RefDto, nullable: true })
  attendant: RefDto | null;

  @ApiProperty({ nullable: true, type: String, example: '07:00' })
  reporting_time: string | null;

  @ApiProperty({ nullable: true, type: String, example: '07:15', description: 'First pickup time of my routes' })
  first_stop_time: string | null;

  @ApiProperty({ type: DutyDto, nullable: true, description: 'null until I check in' })
  duty: DutyDto | null;

  @ApiProperty({ example: false, description: 'true when the office blocked me (documents expired)' })
  blocked: boolean;

  @ApiProperty({ nullable: true, type: String, example: 'Driving licence expired on 20 Nov' })
  blocked_reason: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '04426201234',
    description: 'School office number for the Call office button',
  })
  office_phone: string | null;
}

export class DutyMonthDto {
  @ApiProperty({ example: '2026-11' })
  month: string;

  @ApiProperty({ example: 21 })
  days_on_duty: number;

  @ApiProperty({ example: 2 })
  late_days: number;

  @ApiProperty({ example: 25 })
  late_minutes: number;

  @ApiProperty({ type: [DutyDto] })
  days: DutyDto[];
}

export class IncidentInputDto extends GeoPointInputDto {
  @ApiProperty({ enum: INCIDENT_TYPES, example: 'injury' })
  @IsIn(INCIDENT_TYPES, { message: `type must be one of ${INCIDENT_TYPES.join(', ')}` })
  type: IncidentType;

  @ApiProperty({ example: 'Kavin slipped on the steps and hurt his knee', maxLength: 2000 })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  description: string;

  @ApiPropertyOptional({ example: [12], description: 'Students involved' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsInt({ each: true })
  student_ids?: number[];

  @ApiPropertyOptional({ example: [812], description: 'Photos, uploaded first with POST /files' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsInt({ each: true })
  photo_file_ids?: number[];

  @ApiPropertyOptional({ example: 41, description: 'The trip it happened on' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  trip_id?: number;
}

export class BreakdownInputDto extends GeoPointInputDto {
  @ApiPropertyOptional({ example: 'Front tyre puncture near Koyambedu', maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ example: [812] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsInt({ each: true })
  photo_file_ids?: number[];
}

export class ResolveIncidentDto {
  @ApiProperty({ example: 'Parent informed, first aid given at school', maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note: string;
}

export class IncidentQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: INCIDENT_STATUSES })
  @IsOptional()
  @IsIn(INCIDENT_STATUSES)
  status?: IncidentStatus;

  @ApiPropertyOptional({ enum: INCIDENT_TYPES })
  @IsOptional()
  @IsIn(INCIDENT_TYPES)
  type?: IncidentType;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  vehicle_id?: number;
}

export class FileLinkDto {
  @ApiProperty({ example: 812 })
  id: number;

  @ApiProperty({ example: 'https://…/photo.jpg' })
  url: string;
}

export class IncidentDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ enum: INCIDENT_TYPES })
  type: IncidentType;

  @ApiProperty({ example: 'Kavin slipped on the steps and hurt his knee' })
  description: string;

  @ApiProperty({ enum: INCIDENT_STATUSES })
  status: IncidentStatus;

  @ApiProperty({ type: RefDto, nullable: true })
  vehicle: RefDto | null;

  @ApiProperty({ nullable: true, type: Number })
  trip_id: number | null;

  @ApiProperty({ type: RefDto })
  reported_by: RefDto;

  @ApiProperty({ type: [RefDto] })
  students: RefDto[];

  @ApiProperty({ type: [FileLinkDto] })
  photos: FileLinkDto[];

  @ApiProperty({ nullable: true, type: Number })
  lat: number | null;

  @ApiProperty({ nullable: true, type: Number })
  lng: number | null;

  @ApiProperty()
  occurred_at: Date;

  @ApiProperty({ type: RefDto, nullable: true })
  resolved_by: RefDto | null;

  @ApiProperty({ nullable: true, type: Date })
  resolved_at: Date | null;

  @ApiProperty({ nullable: true, type: String })
  resolution_note: string | null;
}

export class IncidentInsightsDto {
  @ApiProperty({ example: 2 })
  open: number;

  @ApiProperty({ example: 1 })
  today: number;

  @ApiProperty({ example: 3 })
  this_month: number;

  @ApiProperty({ example: 1, description: 'Breakdowns this month' })
  breakdowns: number;
}

export class OptOutInputDto {
  @IsDateOnly('2026-11-26')
  date: string;

  @ApiProperty({
    example: ['pickup'],
    description: 'pickup (morning, to school), drop (evening, home) or both',
    enum: OPT_OUT_TRIPS,
    isArray: true,
  })
  @IsArray()
  @ArrayMaxSize(2)
  @IsIn(OPT_OUT_TRIPS, { each: true })
  trips: OptOutTrip[];

  @ApiPropertyOptional({ example: 'I will drop him myself', maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class OptOutDto {
  @ApiProperty({ example: 9 })
  id: number;

  @ApiProperty({ example: '2026-11-26' })
  date: string;

  @ApiProperty({ enum: OPT_OUT_TRIPS })
  trip: OptOutTrip;

  @ApiProperty({ nullable: true, type: String })
  reason: string | null;

  @ApiProperty()
  created_at: Date;
}

export class PickupPersonInputDto {
  @IsDateOnly('2026-11-25')
  date: string;

  @ApiProperty({ example: 'Murugan', maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'Uncle', maxLength: 40 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  relation: string;

  @IsMobile()
  mobile: string;

  @ApiPropertyOptional({ example: 900, description: 'Photo of the person, uploaded first with POST /files' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  photo_file_id?: number;
}

export class PickupPersonDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: '2026-11-25' })
  date: string;

  @ApiProperty({ example: 'Murugan' })
  name: string;

  @ApiProperty({ example: 'Uncle' })
  relation: string;

  @ApiProperty({ example: '9876543210' })
  mobile: string;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;
}

export class ChildBusTodayDto {
  @ApiProperty({ example: '2026-11-25' })
  date: string;

  @ApiProperty({ type: [OptOutDto], description: 'Days I said the child will not take the bus (today onwards)' })
  opt_outs: OptOutDto[];

  @ApiProperty({ type: [PickupPersonDto], description: 'One-time pickup persons, today onwards' })
  pickup_persons: PickupPersonDto[];
}

export class HandoverPersonDto {
  @ApiProperty({ example: 'Lakshmi Narayanan' })
  name: string;

  @ApiProperty({ example: 'Mother' })
  relation: string;

  @ApiProperty({ nullable: true, type: String, example: '98******10', description: 'Masked' })
  mobile: string | null;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;

  @ApiProperty({ example: false, description: 'true for a one-time person the parent added for today' })
  one_time: boolean;
}

export class StudentHandoverDto {
  @ApiProperty({ example: 12 })
  student_id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ type: [HandoverPersonDto], description: 'Hand the child only to one of these people' })
  persons: HandoverPersonDto[];

  @ApiProperty({ nullable: true, type: String, example: 'Peanut allergy; inhaler in bag' })
  medical_note: string | null;
}

export class OperationsQueryDto {
  @IsDateOnly('2026-11-25', true)
  date?: string;
}

export const BOARD_STATUSES = ['not_started', 'late_start', 'running', 'delayed', 'completed'] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

export class BoardTripDto {
  @ApiProperty({ type: RefDto })
  route: RefDto;

  @ApiProperty({ example: 'R1' })
  route_code: string;

  @ApiProperty({ enum: ['pickup', 'drop'] })
  kind: 'pickup' | 'drop';

  @ApiProperty({ type: RefDto, nullable: true, description: 'Bus running the route today' })
  vehicle: RefDto | null;

  @ApiProperty({ type: RefDto, nullable: true })
  driver: RefDto | null;

  @ApiProperty({ nullable: true, type: String, example: '07:15' })
  planned_start: string | null;

  @ApiProperty({ enum: BOARD_STATUSES })
  status: BoardStatus;

  @ApiProperty({ nullable: true, type: Number, example: 41 })
  trip_id: number | null;

  @ApiProperty({ nullable: true, type: String, enum: ['telematics', 'phone'] })
  tracking: 'telematics' | 'phone' | null;

  @ApiProperty({ nullable: true, type: Date })
  started_at: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  ended_at: Date | null;

  @ApiProperty({ example: 2 })
  stops_done: number;

  @ApiProperty({ example: 6 })
  stops_total: number;

  @ApiProperty({ nullable: true, type: String, example: 'Anna Nagar' })
  current_stop: string | null;

  @ApiProperty({ example: 18 })
  expected: number;

  @ApiProperty({ example: 15 })
  boarded: number;

  @ApiProperty({ example: 2, description: 'On leave, absent or parent said no bus today' })
  away: number;

  @ApiProperty({ example: 1, description: 'Driver marked "not at stop"' })
  not_at_stop: number;

  @ApiProperty({ example: 1, description: 'Got on with the bus pass on hold' })
  boarded_on_hold: number;

  @ApiProperty({ nullable: true, type: Number, example: 10 })
  delay_minutes: number | null;

  @ApiProperty({
    nullable: true,
    type: Object,
    example: { lat: 13.08, lng: 80.21, recorded_at: '2026-11-25T07:40:00Z' },
  })
  position: { lat: number; lng: number; recorded_at: string } | null;

  @ApiProperty({ nullable: true, type: Date, description: 'End-of-trip sweep; null when not done' })
  swept_at: Date | null;
}

export const EXCEPTION_KINDS = [
  'late_start',
  'delayed',
  'no_sweep',
  'not_boarded',
  'attendant_absent',
  'driver_not_checked_in',
  'open_incident',
  'sos',
  'boarded_on_hold',
] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

export class BoardExceptionDto {
  @ApiProperty({ enum: EXCEPTION_KINDS })
  kind: ExceptionKind;

  @ApiProperty({ example: 'R1 Anna Nagar pickup has not started (planned 07:15)' })
  message: string;

  @ApiProperty({ nullable: true, type: Number })
  trip_id: number | null;

  @ApiProperty({ nullable: true, type: Number })
  vehicle_id: number | null;

  @ApiProperty({ nullable: true, type: Number })
  incident_id: number | null;
}

export class OperationsBoardDto {
  @ApiProperty({ example: '2026-11-25' })
  date: string;

  @ApiProperty({
    example: { total: 8, not_started: 2, running: 3, delayed: 1, completed: 2 },
    description: 'Counts of the trips below',
  })
  summary: { total: number; not_started: number; running: number; delayed: number; completed: number };

  @ApiProperty({ example: { checked_in: 5, total: 6, late: 1 } })
  drivers: { checked_in: number; total: number; late: number };

  @ApiProperty({ type: [BoardTripDto] })
  trips: BoardTripDto[];

  @ApiProperty({ type: [BoardExceptionDto] })
  exceptions: BoardExceptionDto[];
}

export class DutyListQueryDto {
  @IsDateOnly('2026-11-25', true)
  date?: string;
}

export class DriverDayDto {
  @ApiProperty({ type: RefDto })
  driver: RefDto;

  @ApiProperty({ nullable: true, type: String, example: '9876543210' })
  mobile: string | null;

  @ApiProperty({ type: RefDto, nullable: true })
  vehicle: RefDto | null;

  @ApiProperty({ type: DutyDto, nullable: true, description: 'null when the driver has not checked in' })
  duty: DutyDto | null;
}

export class BusAttendanceQueryDto {
  @IsDateOnly('2026-11-25', true)
  date?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  route_id?: number;
}

export class BusAttendanceRowDto {
  @ApiProperty({ example: 12 })
  student_id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ nullable: true, type: String, example: '6 - A' })
  class_section: string | null;

  @ApiProperty({ type: RefDto })
  route: RefDto;

  @ApiProperty({ nullable: true, type: String, example: 'Anna Nagar' })
  stop: string | null;

  @ApiProperty({
    example: 'boarded',
    description: 'Morning: boarded, not_at_stop, not_boarded, waiting, away, no_trip or not_riding',
  })
  pickup: string;

  @ApiProperty({ nullable: true, type: Date })
  pickup_at: Date | null;

  @ApiProperty({ example: 'dropped', description: 'Evening: dropped, on_bus, not_boarded, away or no_trip' })
  drop: string;

  @ApiProperty({ nullable: true, type: Date })
  drop_at: Date | null;

  @ApiProperty({ nullable: true, type: String, example: 'Lakshmi Narayanan (Mother)' })
  handed_to: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Parent: not taking the bus' })
  away_note: string | null;

  @ApiProperty({ example: false, description: 'The bus pass is on hold now' })
  pass_on_hold: boolean;

  @ApiProperty({ example: false, description: 'Got on today with the pass on hold' })
  boarded_on_hold: boolean;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'present',
    description: 'Class attendance the same morning: present, absent, leave, od or null when not marked',
  })
  class_attendance: string | null;

  @ApiProperty({
    example: false,
    description: 'true when bus and class do not agree (boarded but absent in class, or present but not boarded)',
  })
  mismatch: boolean;
}

export class TodayAwayDto {
  @ApiProperty({ enum: ['leave', 'half_day', 'od', 'absent', 'no_bus', 'early_leave'], example: 'leave' })
  reason: string;

  @ApiProperty({ example: 'On leave' })
  note: string;
}

export class TodayRiderDto {
  @ApiProperty({ type: RefDto })
  student: RefDto;

  @ApiProperty({ nullable: true, type: String, example: 'TZMS-2024-0004' })
  admission_no: string | null;

  @ApiProperty({ nullable: true, type: String, example: '10 - A' })
  class_section: string | null;

  @ApiProperty({ type: RefDto })
  route: RefDto;

  @ApiProperty({ type: RefDto, nullable: true, description: 'The bus running the route that day (a swap counts)' })
  bus: RefDto | null;

  @ApiProperty({ nullable: true, type: String, example: 'Anna Nagar West depot' })
  stop: string | null;
}

export class TodayEarlyLeaveDto extends TodayRiderDto {
  @ApiProperty({ enum: ['approved', 'released'], description: 'approved: waiting at the gate; released: gone home' })
  status: 'approved' | 'released';

  @ApiProperty({ nullable: true, type: String, example: 'Lakshmi' })
  pickup_name: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Mother' })
  pickup_relation: string | null;

  @ApiProperty({ example: 'Fever' })
  reason: string;

  @ApiProperty({ nullable: true, type: Date })
  released_at: Date | null;
}

export class TodayNotComingDto extends TodayRiderDto {
  @ApiProperty({ type: TodayAwayDto, nullable: true, description: 'Why the child is not on the morning pickup' })
  pickup: TodayAwayDto | null;

  @ApiProperty({ type: TodayAwayDto, nullable: true, description: 'Why the child is not on the evening drop' })
  drop: TodayAwayDto | null;
}

export class TodayOnHoldDto extends TodayRiderDto {
  @ApiProperty({ nullable: true, type: String, enum: ['fee', 'office'], example: 'fee' })
  hold_kind: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Bus fee pending for Term 2' })
  pass_note: string | null;
}

export class StudentsTodaySummaryDto {
  @ApiProperty({ example: 120, description: 'Children with a bus' })
  riders: number;

  @ApiProperty({ example: 112, description: 'Riders on at least one trip today' })
  coming: number;

  @ApiProperty({ example: 6 })
  away_pickup: number;

  @ApiProperty({ example: 9 })
  away_drop: number;

  @ApiProperty({ example: 2, description: 'Released through the gate' })
  early_leave: number;

  @ApiProperty({ example: 1, description: 'Gate pass approved, not out of the gate yet' })
  early_leave_waiting: number;

  @ApiProperty({ example: 3 })
  passes_on_hold: number;
}

export class StudentsTodayDto {
  @ApiProperty({ example: '2026-11-26' })
  date: string;

  @ApiProperty({ type: StudentsTodaySummaryDto })
  summary: StudentsTodaySummaryDto;

  @ApiProperty({ type: [TodayEarlyLeaveDto] })
  early_leaves: TodayEarlyLeaveDto[];

  @ApiProperty({ type: [TodayNotComingDto] })
  away: TodayNotComingDto[];

  @ApiProperty({ type: [TodayOnHoldDto] })
  on_hold: TodayOnHoldDto[];
}
