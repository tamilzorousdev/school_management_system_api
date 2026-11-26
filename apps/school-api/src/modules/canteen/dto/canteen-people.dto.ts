import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { IsMobile } from '../../../shared/mobile';
import {
  CANTEEN_ATTENDANCE_STATUSES,
  CANTEEN_STAFF_ROLES,
  CANTEEN_STAFF_STATUSES,
  CanteenAttendanceStatus,
  CanteenStaffRole,
  CanteenStaffStatus,
  FEEDBACK_CATEGORIES,
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  FeedbackCategory,
  FeedbackKind,
  FeedbackStatus,
} from '../entities/canteen-people.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class CanteenStaffInputDto {
  @ApiProperty({ example: 'Meena Devi', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsMobile()
  @IsOptional()
  mobile?: string;

  @ApiProperty({ enum: CANTEEN_STAFF_ROLES, example: 'cook' })
  @IsIn(CANTEEN_STAFF_ROLES)
  role: CanteenStaffRole;

  @ApiPropertyOptional({ example: 12, description: 'Link to a school staff record' })
  @IsOptional()
  @IsInt()
  @Min(1)
  staff_id?: number;

  @IsDateOnly('2026-06-01', true) joined_on?: string;

  @ApiPropertyOptional({ example: 650, minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999)
  daily_wage?: number;

  @ApiPropertyOptional({ enum: CANTEEN_STAFF_STATUSES, default: 'active' })
  @IsOptional()
  @IsIn(CANTEEN_STAFF_STATUSES)
  status?: CanteenStaffStatus;

  @ApiPropertyOptional({ example: '12 Gandhi Street, Madurai', maxLength: 300 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  address?: string;
}

export class CanteenStaffUpdateDto {
  @ApiPropertyOptional({ example: 'Meena Devi' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: '9876543210', nullable: true, type: String })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @Transform(({ value }) => (value === null ? null : normalize(value)))
  @Matches(/^[6-9]\d{9}$/, { message: 'mobile must be a valid 10-digit Indian mobile number' })
  mobile?: string | null;

  @ApiPropertyOptional({ enum: CANTEEN_STAFF_ROLES })
  @IsOptional()
  @IsIn(CANTEEN_STAFF_ROLES)
  role?: CanteenStaffRole;

  @ApiPropertyOptional({ example: 12, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(1)
  staff_id?: number | null;

  @IsDateOnly('2026-06-01', true) joined_on?: string;

  @ApiPropertyOptional({ example: 650, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999)
  daily_wage?: number | null;

  @ApiPropertyOptional({ enum: CANTEEN_STAFF_STATUSES })
  @IsOptional()
  @IsIn(CANTEEN_STAFF_STATUSES)
  status?: CanteenStaffStatus;

  @ApiPropertyOptional({ example: '12 Gandhi Street, Madurai', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(300)
  address?: string | null;
}

function normalize(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const digits = value.replace(/[\s()-]/g, '').replace(/^\+/, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

export class CanteenStaffQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: CANTEEN_STAFF_ROLES })
  @IsOptional()
  @IsIn(CANTEEN_STAFF_ROLES)
  role?: CanteenStaffRole;

  @ApiPropertyOptional({ enum: CANTEEN_STAFF_STATUSES })
  @IsOptional()
  @IsIn(CANTEEN_STAFF_STATUSES)
  status?: CanteenStaffStatus;
}

export class CanteenStaffDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ example: 'Meena Devi' }) name: string;
  @ApiProperty({ example: '9876543210', nullable: true, type: String }) mobile: string | null;
  @ApiProperty({ enum: CANTEEN_STAFF_ROLES, example: 'cook' }) role: CanteenStaffRole;
  @ApiProperty({ example: 12, nullable: true, type: Number }) staff_id: number | null;
  @ApiProperty({ example: '2026-06-01', nullable: true, type: String }) joined_on: string | null;
  @ApiProperty({ example: 650, nullable: true, type: Number }) daily_wage: number | null;
  @ApiProperty({ enum: CANTEEN_STAFF_STATUSES, example: 'active' }) status: CanteenStaffStatus;
  @ApiProperty({ example: '12 Gandhi Street, Madurai', nullable: true, type: String }) address: string | null;
  @ApiProperty({ example: '2026-06-01T09:00:00+05:30' }) created_at: Date;
}

export class CountByDto {
  @ApiProperty({ example: 'cook' }) key: string;
  @ApiProperty({ example: 3 }) count: number;
}

export class CanteenStaffInsightsDto {
  @ApiProperty({ example: 9 }) total: number;
  @ApiProperty({ example: 8 }) active: number;
  @ApiProperty({ example: 1 }) inactive: number;
  @ApiProperty({ type: [CountByDto] }) by_role: CountByDto[];
}

export class AttendanceMarkDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  canteen_staff_id: number;

  @ApiProperty({ enum: CANTEEN_ATTENDANCE_STATUSES, example: 'present' })
  @IsIn(CANTEEN_ATTENDANCE_STATUSES)
  status: CanteenAttendanceStatus;

  @ApiPropertyOptional({ example: '2026-06-01T08:05:00+05:30' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/, { message: 'check_in_at must be an ISO date-time' })
  check_in_at?: string;

  @ApiPropertyOptional({ example: '2026-06-01T16:30:00+05:30' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/, { message: 'check_out_at must be an ISO date-time' })
  check_out_at?: string;

  @ApiPropertyOptional({ example: 'Came late', maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class AttendanceDayDto {
  @IsDateOnly('2026-06-01', false) date: string;

  @ApiProperty({ type: [AttendanceMarkDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttendanceMarkDto)
  marks: AttendanceMarkDto[];
}

export class AttendanceDateQueryDto {
  @IsDateOnly('2026-06-01', true) date?: string;
}

export class AttendanceClockDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  canteen_staff_id: number;
}

export class AttendanceRangeQueryDto {
  @IsDateOnly('2026-06-01', true) from?: string;
  @IsDateOnly('2026-06-30', true) to?: string;
}

export class AttendanceMonthQueryDto {
  @ApiPropertyOptional({ example: '2026-06', description: 'Month as YYYY-MM, default current month' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be in YYYY-MM format' })
  month?: string;
}

export class RosterRowDto {
  @ApiProperty({ example: 1 }) canteen_staff_id: number;
  @ApiProperty({ example: 'Meena Devi' }) name: string;
  @ApiProperty({ enum: CANTEEN_STAFF_ROLES, example: 'cook' }) role: CanteenStaffRole;
  @ApiProperty({ example: 650, nullable: true, type: Number }) daily_wage: number | null;
  @ApiProperty({ example: 4, nullable: true, type: Number, description: 'Null while unmarked' }) attendance_id:
    number | null;
  @ApiProperty({ enum: CANTEEN_ATTENDANCE_STATUSES, nullable: true, type: String, example: 'present' })
  status: CanteenAttendanceStatus | null;
  @ApiProperty({ example: '2026-06-01T08:05:00+05:30', nullable: true, type: Date }) check_in_at: Date | null;
  @ApiProperty({ example: '2026-06-01T16:30:00+05:30', nullable: true, type: Date }) check_out_at: Date | null;
  @ApiProperty({ example: 'Came late', nullable: true, type: String }) note: string | null;
}

export class RosterSummaryDto {
  @ApiProperty({ example: 8 }) total: number;
  @ApiProperty({ example: 5 }) present: number;
  @ApiProperty({ example: 1 }) half_day: number;
  @ApiProperty({ example: 1 }) absent: number;
  @ApiProperty({ example: 0 }) leave: number;
  @ApiProperty({ example: 1 }) unmarked: number;
}

export class RosterDto {
  @ApiProperty({ example: '2026-06-01' }) date: string;
  @ApiProperty({ type: RosterSummaryDto }) summary: RosterSummaryDto;
  @ApiProperty({ type: [RosterRowDto] }) rows: RosterRowDto[];
}

export class AttendanceSummaryRowDto {
  @ApiProperty({ example: 1 }) canteen_staff_id: number;
  @ApiProperty({ example: 'Meena Devi' }) name: string;
  @ApiProperty({ enum: CANTEEN_STAFF_ROLES, example: 'cook' }) role: CanteenStaffRole;
  @ApiProperty({ example: 22 }) present: number;
  @ApiProperty({ example: 2 }) half_day: number;
  @ApiProperty({ example: 1 }) absent: number;
  @ApiProperty({ example: 1 }) leave: number;
  @ApiProperty({ example: 26, description: 'Days marked in the range' }) marked_days: number;
  @ApiProperty({ example: 88.46 }) attendance_rate: number;
}

export class AttendanceSummaryDto {
  @ApiProperty({ example: '2026-06-01' }) from: string;
  @ApiProperty({ example: '2026-06-30' }) to: string;
  @ApiProperty({ type: [AttendanceSummaryRowDto] }) rows: AttendanceSummaryRowDto[];
}

export class CalendarDayDto {
  @ApiProperty({ example: '2026-06-01' }) date: string;
  @ApiProperty({ enum: CANTEEN_ATTENDANCE_STATUSES, nullable: true, type: String, example: 'present' })
  status: CanteenAttendanceStatus | null;
  @ApiProperty({ example: '2026-06-01T08:05:00+05:30', nullable: true, type: Date }) check_in_at: Date | null;
  @ApiProperty({ example: '2026-06-01T16:30:00+05:30', nullable: true, type: Date }) check_out_at: Date | null;
  @ApiProperty({ example: null, nullable: true, type: String }) note: string | null;
}

export class StaffMonthDto {
  @ApiProperty({ example: 1 }) canteen_staff_id: number;
  @ApiProperty({ example: 'Meena Devi' }) name: string;
  @ApiProperty({ example: '2026-06' }) month: string;
  @ApiProperty({ example: 650, nullable: true, type: Number }) daily_wage: number | null;
  @ApiProperty({ example: 22 }) present: number;
  @ApiProperty({ example: 2 }) half_day: number;
  @ApiProperty({ example: 1 }) absent: number;
  @ApiProperty({ example: 1 }) leave: number;
  @ApiProperty({ example: 88.46 }) attendance_rate: number;
  @ApiProperty({ example: 15275, description: 'present days x wage + half days x wage / 2' }) wage_estimate: number;
  @ApiProperty({ type: [CalendarDayDto] }) days: CalendarDayDto[];
}

export class FeedbackInputDto {
  @ApiProperty({ enum: FEEDBACK_KINDS, example: 'feedback' })
  @IsIn(FEEDBACK_KINDS)
  kind: FeedbackKind;

  @ApiProperty({ enum: FEEDBACK_CATEGORIES, example: 'food_quality' })
  @IsIn(FEEDBACK_CATEGORIES)
  category: FeedbackCategory;

  @ApiPropertyOptional({ example: 4, minimum: 1, maximum: 5, description: 'Required when kind is feedback' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiProperty({ example: 'Lunch was great', maxLength: 150 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  subject: string;

  @ApiProperty({ example: 'The sambar rice was hot and tasty.' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  message: string;

  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @IsInt()
  @Min(1)
  diner_id?: number;

  @ApiPropertyOptional({ example: 120 })
  @IsOptional()
  @IsInt()
  @Min(1)
  order_id?: number;
}

export class FeedbackStatusDto {
  @ApiProperty({ enum: FEEDBACK_STATUSES, example: 'resolved' })
  @IsIn(FEEDBACK_STATUSES)
  status: FeedbackStatus;

  @ApiPropertyOptional({ example: 'Cook warned and recipe corrected', description: 'Required to resolve' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  resolution?: string;
}

export class FeedbackQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: FEEDBACK_KINDS })
  @IsOptional()
  @IsIn(FEEDBACK_KINDS)
  kind?: FeedbackKind;

  @ApiPropertyOptional({ enum: FEEDBACK_CATEGORIES })
  @IsOptional()
  @IsIn(FEEDBACK_CATEGORIES)
  category?: FeedbackCategory;

  @ApiPropertyOptional({ enum: FEEDBACK_STATUSES })
  @IsOptional()
  @IsIn(FEEDBACK_STATUSES)
  status?: FeedbackStatus;

  @ApiPropertyOptional({ example: 4, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsDateOnly('2026-06-01', true) from?: string;
  @IsDateOnly('2026-06-30', true) to?: string;
}

export class FeedbackDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ enum: FEEDBACK_KINDS, example: 'feedback' }) kind: FeedbackKind;
  @ApiProperty({ enum: FEEDBACK_CATEGORIES, example: 'food_quality' }) category: FeedbackCategory;
  @ApiProperty({ example: 4, nullable: true, type: Number }) rating: number | null;
  @ApiProperty({ example: 'Lunch was great' }) subject: string;
  @ApiProperty({ example: 'The sambar rice was hot and tasty.' }) message: string;
  @ApiProperty({ example: 7, nullable: true, type: Number }) diner_id: number | null;
  @ApiProperty({ example: 120, nullable: true, type: Number }) order_id: number | null;
  @ApiProperty({ enum: FEEDBACK_STATUSES, example: 'open' }) status: FeedbackStatus;
  @ApiProperty({ example: null, nullable: true, type: String }) resolution: string | null;
  @ApiProperty({ example: null, nullable: true, type: Date }) resolved_at: Date | null;
  @ApiProperty({ example: null, nullable: true, type: Number }) resolved_by: number | null;
  @ApiProperty({ example: '2026-06-01T12:30:00+05:30' }) created_at: Date;
}

export class RatingDistributionDto {
  @ApiProperty({ example: 1 }) '1': number;
  @ApiProperty({ example: 0 }) '2': number;
  @ApiProperty({ example: 2 }) '3': number;
  @ApiProperty({ example: 5 }) '4': number;
  @ApiProperty({ example: 9 }) '5': number;
}

export class FeedbackInsightsDto {
  @ApiProperty({ example: 17 }) total: number;
  @ApiProperty({ type: [CountByDto], description: 'open, in_progress, resolved, closed' }) by_status: CountByDto[];
  @ApiProperty({ type: [CountByDto], description: 'feedback, complaint' }) by_kind: CountByDto[];
  @ApiProperty({ example: 4.31, nullable: true, type: Number }) average_rating: number | null;
  @ApiProperty({ type: RatingDistributionDto }) rating_distribution: RatingDistributionDto;
  @ApiProperty({ type: [CountByDto], description: 'Most frequent categories first' }) top_categories: CountByDto[];
}
