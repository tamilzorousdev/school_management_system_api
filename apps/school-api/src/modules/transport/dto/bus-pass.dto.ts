import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationDto } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { RefDto } from '../../students/dto/student-response.dto';
import { BUS_PASS_STATES, BusPassState, FEE_STANDINGS, FeeStanding, HOLD_KINDS, HoldKind } from '../bus-pass.logic';

export class BusPassSettingsDto {
  @ApiProperty({
    example: 7,
    description: 'Days after a bus fee due date before the student shows on the fee pending list',
  })
  grace_days: number;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2027-04-30',
    description: 'Default end date of new passes; null = end of the academic year',
  })
  valid_until: string | null;

  @ApiProperty({ example: '2027-03-31', description: 'End of the current academic year' })
  year_ends: string;
}

export class BusPassSettingsInputDto {
  @ApiPropertyOptional({ example: 7, minimum: 0, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(90)
  grace_days?: number;

  @ApiPropertyOptional({ example: '2027-04-30', nullable: true, description: 'null goes back to the end of the year' })
  @IsOptional()
  @IsDateOnly('2027-04-30', true)
  valid_until?: string | null;
}

export class BusPassStopDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 'Mogappair East bus stand' })
  name: string;

  @ApiProperty({ nullable: true, type: String, example: '07:00' })
  time: string | null;
}

export class BusPassBusDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Bus 1' })
  name: string;

  @ApiProperty({ example: 'TN 09 AB 1234' })
  registration_no: string;

  @ApiProperty({ example: false, description: 'true on a day another bus runs the route' })
  today_only: boolean;
}

export class BusFeeDto {
  @ApiProperty({ enum: FEE_STANDINGS, description: 'clear, due (within the grace days) or past_grace' })
  standing: FeeStanding;

  @ApiProperty({ nullable: true, type: String, example: '2026-11-10' })
  oldest_due: string | null;

  @ApiProperty({ nullable: true, type: String, example: '2026-11-17' })
  grace_ends: string | null;

  @ApiProperty({ example: 1500, description: 'Bus fee on invoices not fully paid' })
  pending_amount: number;

  @ApiProperty({ example: true, description: 'false until a bus fee invoice is raised this year' })
  billed: boolean;
}

export class BusPassStudentDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ example: 'ADM-2026-012' })
  admission_no: string;

  @ApiProperty({ nullable: true, type: String, example: '6 - A' })
  class_section: string | null;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;
}

export class BusPassDto {
  @ApiProperty({ example: 'TZMS-BP-2026-0042' })
  pass_no: string;

  @ApiProperty({ enum: BUS_PASS_STATES, description: 'awaiting_payment, active, on_hold or expired' })
  state: BusPassState;

  @ApiProperty({ enum: HOLD_KINDS, nullable: true, description: 'fee or office, when on hold' })
  hold_kind: HoldKind | null;

  @ApiProperty({ nullable: true, type: String, description: 'Office note when on hold' })
  hold_note: string | null;

  @ApiProperty({ type: BusPassStudentDto })
  student: BusPassStudentDto;

  @ApiProperty({ example: '2026-06-01' })
  valid_from: string;

  @ApiProperty({ example: '2027-03-31' })
  valid_until: string;

  @ApiProperty({ nullable: true, type: Date })
  issued_at: Date | null;

  @ApiProperty({ type: RefDto })
  route: RefDto;

  @ApiProperty({ type: BusPassStopDto, nullable: true, description: 'Morning stop; null for evening only' })
  pickup: BusPassStopDto | null;

  @ApiProperty({ type: BusPassStopDto, nullable: true, description: 'Evening stop; null for morning only' })
  drop: BusPassStopDto | null;

  @ApiProperty({ type: BusPassBusDto, nullable: true, description: 'The bus today' })
  bus: BusPassBusDto | null;

  @ApiProperty({ type: BusFeeDto })
  fee: BusFeeDto;
}

export class ParentBusPassDto extends BusPassDto {
  @ApiProperty({ example: 'Tamilzorous Model School' })
  school: string;

  @ApiProperty({ example: 'Show this pass when you board the school bus.' })
  message: string;

  @ApiProperty({ nullable: true, type: String, description: 'Signed QR (same as the ID card); null unless active' })
  qr: string | null;
}

export class BusPassQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'kavin', description: 'Student name, admission number or pass number' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({ enum: BUS_PASS_STATES })
  @IsOptional()
  @IsIn(BUS_PASS_STATES)
  state?: BusPassState;

  @ApiPropertyOptional({ enum: FEE_STANDINGS, description: 'past_grace = the fee pending list' })
  @IsOptional()
  @IsIn(FEE_STANDINGS)
  fee?: FeeStanding;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  route_id?: number;
}

export class BusPassInsightsDto {
  @ApiProperty({ example: 52 })
  total: number;

  @ApiProperty({ example: 40 })
  active: number;

  @ApiProperty({ example: 5, description: 'Bus fee not paid yet, so no pass' })
  awaiting_payment: number;

  @ApiProperty({ example: 3 })
  on_hold: number;

  @ApiProperty({ example: 4, description: 'Bus fee due, still within the grace days' })
  fee_due: number;

  @ApiProperty({ example: 6, description: 'Past the grace days and not on hold yet: the fee pending list' })
  fee_past_grace: number;

  @ApiProperty({ example: 0 })
  expired: number;
}

export class BusPassActionDto {
  @ApiProperty({ type: [Number], example: [12, 15] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  student_ids: number[];

  @ApiPropertyOptional({ example: 'Please meet the office', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}

export class BusPassActionResultDto {
  @ApiProperty({ example: 2 })
  changed: number;

  @ApiProperty({ example: 3, description: 'Parents told' })
  parents_told: number;
}

export class BusPassValidityDto {
  @IsDateOnly('2027-04-30')
  valid_until: string;
}

export class CrewHeldPassDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ nullable: true, type: String, example: '6 - A' })
  class_section: string | null;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;

  @ApiProperty({ type: RefDto })
  route: RefDto;

  @ApiProperty({ nullable: true, type: String, example: 'Mogappair East bus stand' })
  stop: string | null;

  @ApiProperty({ example: 'Pass on hold – fee pending, contact office' })
  label: string;
}
