import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { CrewDetailDto } from '../../crew/dto/crew.dto';
import { BoardExceptionDto, StudentsTodaySummaryDto } from '../../driver-ops/dto/driver-ops.dto';
import { StaffLeaveDto } from '../../staff-leave/dto/staff-leave.dto';
import { AlertDto } from '../../tracking/dto/fleet-alert.dto';
import { ExpiryDto, VehicleDocumentDto, VehicleDto } from '../../transport/dto/transport.dto';

export const CREW_LEAVE_FILTERS = ['waiting', 'approved', 'rejected'] as const;
export type CrewLeaveFilter = (typeof CREW_LEAVE_FILTERS)[number];

export class CrewLeaveQueryDto {
  @ApiPropertyOptional({ enum: CREW_LEAVE_FILTERS, default: 'waiting' })
  @IsOptional()
  @IsIn(CREW_LEAVE_FILTERS)
  status?: CrewLeaveFilter;
}

export class TripCountsDto {
  @ApiProperty({ example: 8 })
  total: number;

  @ApiProperty({ example: 2 })
  not_started: number;

  @ApiProperty({ example: 3 })
  running: number;

  @ApiProperty({ example: 1 })
  delayed: number;

  @ApiProperty({ example: 2 })
  completed: number;
}

export class DriverCountsDto {
  @ApiProperty({ example: 5 })
  checked_in: number;

  @ApiProperty({ example: 6 })
  total: number;

  @ApiProperty({ example: 1 })
  late: number;
}

export class PaperCountsDto {
  @ApiProperty({ example: 2, description: 'Bus and crew papers already expired' })
  expired: number;

  @ApiProperty({ example: 4, description: 'Bus and crew papers expiring in the next 30 days' })
  due_soon: number;

  @ApiProperty({ type: [ExpiryDto], description: 'The ten most urgent, expired first' })
  items: ExpiryDto[];
}

export class TransportHomeDto {
  @ApiProperty({ example: '2026-11-26' })
  date: string;

  @ApiProperty({ type: TripCountsDto })
  trips: TripCountsDto;

  @ApiProperty({ type: DriverCountsDto })
  drivers: DriverCountsDto;

  @ApiProperty({ type: [AlertDto], description: 'SOS still open or acknowledged, newest first' })
  sos: AlertDto[];

  @ApiProperty({ type: [BoardExceptionDto], description: 'The five most urgent exceptions of the day' })
  exceptions: BoardExceptionDto[];

  @ApiProperty({ type: StudentsTodaySummaryDto })
  students: StudentsTodaySummaryDto;

  @ApiProperty({ type: PaperCountsDto })
  papers: PaperCountsDto;

  @ApiProperty({ example: 3, description: 'Fuel entries waiting for review' })
  fuel_pending: number;

  @ApiProperty({ example: 1, description: 'Driver and attendant leave requests waiting' })
  leaves_pending: number;

  @ApiProperty({ type: [StaffLeaveDto], description: 'Drivers and attendants on approved leave that day' })
  crew_on_leave: StaffLeaveDto[];
}

export class BusDetailDto {
  @ApiProperty({ type: VehicleDto })
  vehicle: VehicleDto;

  @ApiProperty({ type: [VehicleDocumentDto], description: 'The current copy of each paper' })
  documents: VehicleDocumentDto[];
}

export class CrewRatingDto {
  @ApiProperty({ nullable: true, type: Number, example: 4.3 })
  average: number | null;

  @ApiProperty({ example: 18 })
  count: number;

  @ApiProperty({ nullable: true, type: Number, example: 4.5 })
  month_average: number | null;

  @ApiProperty({ example: 1, description: 'Ratings of 1 or 2 stars' })
  low_count: number;
}

export class CrewMemberDto {
  @ApiProperty({ type: CrewDetailDto })
  crew: CrewDetailDto;

  @ApiProperty({ type: CrewRatingDto, nullable: true, description: 'Parent ratings; drivers only' })
  rating: CrewRatingDto | null;
}
