import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { ListQueryDto } from '@app/common';

export const TRANSPORT_FEE_STATUSES = ['paid', 'pending', 'overdue', 'not_billed'] as const;
export type TransportFeeStatus = (typeof TRANSPORT_FEE_STATUSES)[number];

export class TransportFeeSummaryQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  route_id?: number;
}

export class TransportFeeQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  route_id?: number;

  @ApiPropertyOptional({ example: 4, description: 'Pickup or drop stop' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  stop_id?: number;

  @ApiPropertyOptional({ enum: TRANSPORT_FEE_STATUSES })
  @IsOptional()
  @IsIn(TRANSPORT_FEE_STATUSES)
  status?: TransportFeeStatus;

  @ApiPropertyOptional({ example: 12, description: 'One student' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  student_id?: number;
}

export class TransportFeeFiguresDto {
  @ApiProperty({ example: 34, description: 'Students billed for the bus this year' })
  students: number;

  @ApiProperty({ example: 120000 })
  billed: number;

  @ApiProperty({ example: 90000, description: 'Share of payments that went to the bus fee' })
  collected: number;

  @ApiProperty({ example: 30000 })
  pending: number;

  @ApiProperty({ example: 12000, description: 'Pending amount already past its due date' })
  overdue: number;
}

export class TransportFeeStopDto extends TransportFeeFiguresDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 'Anna Nagar Tower' })
  name: string;

  @ApiProperty({ example: 1 })
  sequence: number;

  @ApiProperty({ example: 1200, description: 'Fee a month at this stop now' })
  monthly_fee: number;
}

export class TransportFeeRouteDto extends TransportFeeFiguresDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'R1' })
  code: string;

  @ApiProperty({ example: 'Anna Nagar - School' })
  name: string;

  @ApiProperty({ example: 1200 })
  monthly_fee: number;

  @ApiProperty({ example: 36, description: 'Students on this route now' })
  riders: number;

  @ApiProperty({ type: [TransportFeeStopDto] })
  stops: TransportFeeStopDto[];
}

export class TransportFeeSummaryDto {
  @ApiProperty({ type: TransportFeeFiguresDto })
  totals: TransportFeeFiguresDto;

  @ApiProperty({ type: [TransportFeeRouteDto] })
  routes: TransportFeeRouteDto[];
}

export class TransportFeeRefDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 'Anna Nagar Tower' })
  name: string;
}

export class TransportFeeStudentDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Kavin Kumar' })
  full_name: string;

  @ApiProperty({ example: 'TZMS-2026-0012' })
  admission_no: string;

  @ApiProperty({ nullable: true, type: String, example: '6 - A' })
  class_section: string | null;
}

export class TransportFeeRowDto {
  @ApiProperty({ type: TransportFeeStudentDto })
  student: TransportFeeStudentDto;

  @ApiProperty({ type: TransportFeeRefDto })
  route: TransportFeeRefDto;

  @ApiProperty({ type: TransportFeeRefDto })
  stop: TransportFeeRefDto;

  @ApiProperty({ type: TransportFeeRefDto, nullable: true })
  drop_stop: TransportFeeRefDto | null;

  @ApiProperty({ example: 1200 })
  monthly_fee: number;

  @ApiProperty({ example: 3600 })
  billed: number;

  @ApiProperty({ example: 2400 })
  paid: number;

  @ApiProperty({ example: 1200 })
  pending: number;

  @ApiProperty({ example: 0 })
  overdue: number;

  @ApiProperty({ nullable: true, type: String, example: '2026-12-10' })
  next_due_date: string | null;

  @ApiProperty({ enum: TRANSPORT_FEE_STATUSES })
  status: TransportFeeStatus;
}

export class ParentTransportFeeDto {
  @ApiProperty({ example: 1200 })
  monthly_fee: number;

  @ApiProperty({ example: 3600, description: 'Bus fee billed this year' })
  billed: number;

  @ApiProperty({ example: 2400 })
  paid: number;

  @ApiProperty({ example: 1200 })
  pending: number;

  @ApiProperty({ nullable: true, type: String, example: '2026-12-10' })
  next_due_date: string | null;

  @ApiProperty({ enum: TRANSPORT_FEE_STATUSES })
  status: TransportFeeStatus;
}
