import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ListQueryDto } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { RefDto } from '../../students/dto/student-response.dto';
import { STAFF_LEAVE_STATUSES, StaffLeaveStatus } from '../entities/staff-leave.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class LeaveTypeInputDto {
  @ApiProperty({ example: 'CL' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9]{1,10}$/, { message: 'code must be 1 to 10 letters or digits' })
  code: string;

  @ApiProperty({ example: 'Casual leave' })
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name: string;

  @ApiProperty({ example: 12, description: '0 means no limit (for example loss of pay)' })
  @IsInt()
  @Min(0)
  @Max(365)
  days_per_year: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_paid?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateLeaveTypeDto extends PartialType(LeaveTypeInputDto) {}

export class StaffLeaveInputDto {
  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  leave_type_id: number;

  @IsDateOnly('2026-11-10')
  from_date: string;

  @IsDateOnly('2026-11-11')
  to_date: string;

  @ApiPropertyOptional({ default: false, description: 'Half a day; from_date and to_date must be the same' })
  @IsOptional()
  @IsBoolean()
  half_day?: boolean;

  @ApiProperty({ example: 'Family function' })
  @Transform(trim)
  @IsString()
  @Length(3, 500)
  reason: string;
}

export class StaffLeaveDecisionDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected'])
  status: 'approved' | 'rejected';

  @ApiPropertyOptional({ nullable: true, type: String, example: 'Arrange a substitute for 6-A' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(
    (dto: StaffLeaveDecisionDto) => dto.status === 'rejected' || (dto.note !== undefined && dto.note !== null),
  )
  @IsString({ message: 'Give a reason for rejecting' })
  @MaxLength(255)
  note?: string | null;
}

export const STAFF_LEAVE_FILTERS = [...STAFF_LEAVE_STATUSES, 'waiting'] as const;

export class StaffLeaveQueryDto extends ListQueryDto {
  @ApiPropertyOptional({
    enum: STAFF_LEAVE_FILTERS,
    description: 'waiting = pending_hod or pending_principal',
  })
  @IsOptional()
  @IsIn(STAFF_LEAVE_FILTERS)
  status?: StaffLeaveStatus | 'waiting';

  @ApiPropertyOptional({ example: 9 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  user_id?: number;
}

export class LeaveTypeDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'CL' })
  code: string;

  @ApiProperty({ example: 'Casual leave' })
  name: string;

  @ApiProperty({ example: 12 })
  days_per_year: number;

  @ApiProperty()
  is_paid: boolean;

  @ApiProperty()
  is_active: boolean;
}

export class LeaveBalanceDto {
  @ApiProperty({ type: LeaveTypeDto })
  leave_type: LeaveTypeDto;

  @ApiProperty({ example: 12, nullable: true, type: Number, description: 'null when there is no limit' })
  allowed: number | null;

  @ApiProperty({ example: 3 })
  used: number;

  @ApiProperty({ example: 1, description: 'Waiting for approval' })
  pending: number;

  @ApiProperty({ example: 8, nullable: true, type: Number })
  remaining: number | null;
}

export class StaffLeaveDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ type: RefDto })
  staff: RefDto;

  @ApiProperty({ nullable: true, type: String })
  department: string | null;

  @ApiProperty({ type: LeaveTypeDto })
  leave_type: LeaveTypeDto;

  @ApiProperty({ example: '2026-11-10' })
  from_date: string;

  @ApiProperty({ example: '2026-11-11' })
  to_date: string;

  @ApiProperty()
  half_day: boolean;

  @ApiProperty({ example: 2 })
  days: number;

  @ApiProperty({ example: 'Family function' })
  reason: string;

  @ApiProperty({ enum: STAFF_LEAVE_STATUSES })
  status: StaffLeaveStatus;

  @ApiProperty({ type: RefDto, nullable: true, description: 'HOD who approves first' })
  hod: RefDto | null;

  @ApiProperty({ nullable: true, type: String })
  hod_note: string | null;

  @ApiProperty({ type: RefDto, nullable: true })
  principal: RefDto | null;

  @ApiProperty({ nullable: true, type: String })
  principal_note: string | null;

  @ApiProperty()
  created_at: Date;
}
