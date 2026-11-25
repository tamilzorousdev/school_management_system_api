import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { RefDto } from '../../students/dto/student-response.dto';
import { GuardianContactDto, ParentTransportDto } from '../../transport/dto/transport.dto';
import { PASS_STATUSES, PassStatus } from '../../transport/entities/student-transport.entity';
import { RIDER_STATUSES, RiderStatus, TRIP_FLAGS, TripFlag } from '../boarding.logic';
import { TRIP_KINDS, TRIP_STATUSES, TripKind, TripStatus } from '../entities/transport-trip.entity';
import { BOARDING_METHODS, BoardingMethod } from '../entities/trip-boarding.entity';
import { TripDto } from './tracking.dto';

export class BoardingMarkDto {
  @ApiProperty({ example: 31, description: 'The boarding id; send it to the undo call' })
  id: number;

  @ApiProperty({ example: '2026-11-17T07:42:10+05:30' })
  at: Date;

  @ApiProperty({ enum: BOARDING_METHODS, example: 'manual' })
  method: BoardingMethod;

  @ApiProperty({ type: RefDto, nullable: true, description: 'The stop; null at the school gate' })
  stop: RefDto | null;

  @ApiProperty({ type: RefDto, nullable: true, description: 'Driver or attendant who marked it' })
  recorded_by: RefDto | null;

  @ApiProperty({ example: false, description: 'Got on with the bus pass on hold' })
  pass_on_hold: boolean;

  @ApiProperty({ nullable: true, type: String, example: 'Lakshmi Narayanan (Mother)', description: 'Drop only' })
  handed_to: string | null;
}

export class ChecklistSummaryDto {
  @ApiProperty({ example: 24, description: 'Students expected on this trip' })
  total: number;

  @ApiProperty({ example: 1, description: 'On leave or absent today' })
  away: number;

  @ApiProperty({ example: 5, description: 'Not boarded yet' })
  waiting: number;

  @ApiProperty({ example: 12, description: 'On the bus now' })
  on_bus: number;

  @ApiProperty({ example: 6, description: 'Got off' })
  off_bus: number;

  @ApiProperty({ example: 0, description: 'Trip ended and the student never boarded (away students are left out)' })
  not_boarded: number;

  @ApiProperty({ example: 0, description: 'Trip ended and the student was never marked off the bus' })
  not_alighted: number;

  @ApiProperty({ example: 1, description: 'The bus came and the child was not at the stop (marked missed)' })
  not_at_stop: number;

  @ApiPropertyOptional({ example: 0, description: 'Got on with the bus pass on hold (trip checklist only)' })
  boarded_on_hold?: number;
}

export class ChecklistStudentDto {
  @ApiProperty({ example: 12 })
  student_id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ nullable: true, type: String, example: '6 - A' })
  class_section: string | null;

  @ApiProperty({ type: RefDto, nullable: true, description: 'The student’s stop for this trip' })
  stop: RefDto | null;

  @ApiProperty({
    enum: RIDER_STATUSES,
    example: 'on_bus',
    description: 'away, waiting, not_at_stop (driver marked missed), on_bus or off_bus',
  })
  status: RiderStatus;

  @ApiProperty({
    enum: TRIP_FLAGS,
    nullable: true,
    example: null,
    description: 'Set only after the trip ends: not_boarded or not_alighted',
  })
  flag: TripFlag | null;

  @ApiProperty({ type: BoardingMarkDto, nullable: true })
  boarded: BoardingMarkDto | null;

  @ApiProperty({ type: BoardingMarkDto, nullable: true })
  alighted: BoardingMarkDto | null;

  @ApiProperty({ type: BoardingMarkDto, nullable: true, description: 'Marked "not at stop"' })
  missed: BoardingMarkDto | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Sports OD – District athletics',
    description: 'Why the student is not expected on this trip: On leave, Half-day leave, Sports OD or Marked absent',
  })
  away_note: string | null;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;

  @ApiProperty({
    type: [GuardianContactDto],
    description: 'Parents to call when the child is not at the stop, primary first',
  })
  parents: GuardianContactDto[];

  @ApiProperty({
    enum: PASS_STATUSES,
    example: 'active',
    description: 'on_hold: show "Bus pass on hold – contact office" next to the name. Never leave a child behind.',
  })
  pass_status: PassStatus;

  @ApiProperty({ nullable: true, type: String, example: 'Pass on hold – fee pending, contact office' })
  pass_label: string | null;
}

export class TripChecklistDto {
  @ApiProperty({ type: TripDto })
  trip: TripDto;

  @ApiProperty({ type: ChecklistSummaryDto })
  summary: ChecklistSummaryDto;

  @ApiProperty({ type: [ChecklistStudentDto], description: 'In stop order, then by name' })
  students: ChecklistStudentDto[];
}

export class TripHistoryDto extends TripDto {
  @ApiProperty({ type: ChecklistSummaryDto })
  summary: ChecklistSummaryDto;
}

export class BoardingHistoryQueryDto extends PaginationDto {
  @IsDateOnly('2026-10-18', true)
  from?: string;

  @IsDateOnly('2026-11-17', true)
  to?: string;
}

export class BusBoardingDateQueryDto {
  @IsDateOnly('2026-11-17', true)
  date?: string;
}

export class StudentTripDto {
  @ApiProperty({ example: 41 })
  trip_id: number;

  @ApiProperty({ example: '2026-11-17' })
  trip_date: string;

  @ApiProperty({ enum: TRIP_KINDS, example: 'pickup' })
  kind: TripKind;

  @ApiProperty({ enum: TRIP_STATUSES, example: 'ended' })
  trip_status: TripStatus;

  @ApiProperty({ type: RefDto })
  route: RefDto;

  @ApiProperty({ enum: RIDER_STATUSES, example: 'off_bus' })
  status: RiderStatus;

  @ApiProperty({ enum: TRIP_FLAGS, nullable: true, example: null })
  flag: TripFlag | null;

  @ApiProperty({ type: BoardingMarkDto, nullable: true })
  boarded: BoardingMarkDto | null;

  @ApiProperty({ type: BoardingMarkDto, nullable: true })
  alighted: BoardingMarkDto | null;

  @ApiProperty({ type: BoardingMarkDto, nullable: true, description: 'Marked "not at stop"' })
  missed: BoardingMarkDto | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Sports OD – District athletics',
    description: 'Why the student is not expected on this trip: On leave, Half-day leave, Sports OD or Marked absent',
  })
  away_note: string | null;
}

export class ParentTransportCardDto extends ParentTransportDto {
  @ApiProperty({
    type: [StudentTripDto],
    description:
      'Today’s trips that have started, morning first: status, boarded / alighted { at, stop, method }. Empty before the first trip starts.',
  })
  today: StudentTripDto[];
}

export class SectionBusStudentDto {
  @ApiProperty({ example: 12 })
  student_id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ type: [StudentTripDto], description: 'That day’s pickup and drop trips; empty when none ran' })
  trips: StudentTripDto[];
}

export class SectionBusBoardingDto {
  @ApiProperty({ example: '2026-11-17' })
  date: string;

  @ApiProperty({ type: [SectionBusStudentDto], description: 'Students of the class who use the bus' })
  students: SectionBusStudentDto[];
}
