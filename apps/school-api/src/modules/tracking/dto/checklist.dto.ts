import { ApiProperty } from '@nestjs/swagger';
import { PaginationDto } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { RefDto } from '../../students/dto/student-response.dto';
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

  @ApiProperty({ enum: RIDER_STATUSES, example: 'on_bus', description: 'away, waiting, on_bus or off_bus' })
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
