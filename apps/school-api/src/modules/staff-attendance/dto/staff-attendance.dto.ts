import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsDateOnly } from '../../../shared/dates';
import { BoardQueryDto } from '../../attendance/dto/attendance.dto';
import {
  PUNCH_SOURCES,
  PunchSource,
  STAFF_ATTENDANCE_STATUSES,
  StaffAttendanceStatus,
} from '../entities/staff-attendance.entity';

export class LocationDto {
  @ApiProperty({ example: 13.0879 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ example: 80.2102 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  @ApiPropertyOptional({ example: 12, description: 'GPS accuracy in metres from the phone' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5000)
  accuracy_m?: number;
}

export class ManualMarkDto {
  @IsDateOnly('2026-11-05')
  date: string;

  @ApiProperty({ enum: STAFF_ATTENDANCE_STATUSES })
  @IsIn(STAFF_ATTENDANCE_STATUSES)
  status: StaffAttendanceStatus;

  @ApiPropertyOptional({ example: '2026-11-05T08:40:00+05:30', nullable: true, type: String })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsISO8601()
  check_in_at?: string | null;

  @ApiPropertyOptional({ example: '2026-11-05T16:30:00+05:30', nullable: true, type: String })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsISO8601()
  check_out_at?: string | null;

  @ApiProperty({ example: 'Phone GPS was not working' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(3, 255)
  remarks: string;
}

export class PunchDto {
  @ApiProperty({ example: 'TZMS-EMP-0004' })
  @IsString()
  @Length(1, 30)
  employee_no: string;

  @ApiProperty({ example: '2026-11-05T08:39:12+05:30' })
  @IsISO8601()
  punched_at: string;
}

export class BiometricPunchesDto {
  @ApiProperty({ example: 'TZMS' })
  @IsString()
  @Length(2, 20)
  school_code: string;

  @ApiPropertyOptional({ example: 'GATE-1' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  device_id?: string;

  @ApiProperty({ type: [PunchDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => PunchDto)
  punches: PunchDto[];
}

export const BOARD_STATUSES = [...STAFF_ATTENDANCE_STATUSES, 'on_leave', 'not_checked_in'] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

export class StaffDayDto {
  @ApiProperty({ example: '2026-11-05' })
  date: string;

  @ApiProperty({ enum: BOARD_STATUSES })
  status: BoardStatus;

  @ApiProperty({ nullable: true, type: Date })
  check_in_at: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  check_out_at: Date | null;

  @ApiProperty({ nullable: true, type: Number, example: 35, description: 'Metres from the school at check-in' })
  check_in_distance_m: number | null;

  @ApiProperty({ enum: PUNCH_SOURCES, nullable: true })
  source: PunchSource | null;

  @ApiProperty({ nullable: true, type: String })
  remarks: string | null;
}

export class CheckInStatusDto extends StaffDayDto {
  @ApiProperty({ example: '08:45' })
  reporting_time: string;

  @ApiProperty({ example: 200 })
  geofence_radius_m: number;

  @ApiProperty({
    example: 13.0878,
    nullable: true,
    type: Number,
    description: 'School gate latitude, so the app can show the live distance before check-in',
  })
  school_latitude: number | null;

  @ApiProperty({ example: 80.2101, nullable: true, type: Number })
  school_longitude: number | null;

  @ApiProperty({ description: 'The school location is set, so check-in can work' })
  geofence_ready: boolean;

  @ApiProperty()
  can_check_in: boolean;

  @ApiProperty()
  can_check_out: boolean;
}

export class StaffBoardRowDto extends StaffDayDto {
  @ApiProperty({ example: 9 })
  user_id: number;

  @ApiProperty({ example: 4 })
  staff_id: number;

  @ApiProperty({ example: 'Priya Venkatesh' })
  name: string;

  @ApiProperty({ example: 'PG Assistant' })
  designation: string;

  @ApiProperty({ nullable: true, type: String })
  department: string | null;
}

export class StaffBoardDto {
  @ApiProperty({ example: '2026-11-05' })
  date: string;

  @ApiProperty({ example: '08:45' })
  reporting_time: string;

  @ApiProperty({ example: 13 })
  total: number;

  @ApiProperty({ example: 10 })
  present: number;

  @ApiProperty({ example: 2 })
  late: number;

  @ApiProperty({ example: 1 })
  on_leave: number;

  @ApiProperty({ example: 0 })
  not_checked_in: number;

  @ApiProperty({ type: [StaffBoardRowDto] })
  staff: StaffBoardRowDto[];
}

export class PunchResultDto {
  @ApiProperty({ example: 42 })
  accepted: number;

  @ApiProperty({ type: [String], example: ['TZMS-EMP-0099'] })
  unknown_employees: string[];
}

export class StaffMonthDto {
  @ApiProperty({ example: '2026-11' })
  month: string;

  @ApiProperty({ example: 18 })
  working_days: number;

  @ApiProperty({ example: 16 })
  present: number;

  @ApiProperty({ example: 2 })
  late: number;

  @ApiProperty({ example: 1 })
  on_leave: number;

  @ApiProperty({ example: 1 })
  absent: number;

  @ApiProperty({ type: [StaffDayDto] })
  days: StaffDayDto[];
}

const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class StaffBoardQueryDto extends BoardQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ example: 'priya', description: 'Name, designation or department' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    enum: BOARD_STATUSES,
    description: 'Only staff with this status (not_checked_in also lists absent, like the card)',
  })
  @IsOptional()
  @IsIn(BOARD_STATUSES)
  status?: BoardStatus;
}

export class StaffBoardPageDto extends StaffBoardDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 30, description: 'Staff after search and status filter' })
  filtered_total: number;

  @ApiProperty({ example: 2 })
  total_pages: number;

  @ApiProperty({ example: true })
  has_next: boolean;
}

export class BulkStaffMarkDto {
  @IsDateOnly('2026-11-10')
  date: string;

  @ApiPropertyOptional({
    type: [Number],
    example: [9, 12, 15],
    description: 'Staff user ids. Leave out and set all_not_checked_in to mark everyone not checked in yet.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one staff member' })
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsInt({ each: true })
  user_ids?: number[];

  @ApiPropertyOptional({ example: false, description: 'Mark every staff member who has not checked in (not on leave)' })
  @IsOptional()
  @IsBoolean()
  all_not_checked_in?: boolean;

  @ApiProperty({ enum: STAFF_ATTENDANCE_STATUSES, example: 'present' })
  @IsIn(STAFF_ATTENDANCE_STATUSES)
  status: StaffAttendanceStatus;

  @ApiPropertyOptional({ example: '2026-11-10T08:40:00+05:30', nullable: true, type: String })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsISO8601()
  check_in_at?: string | null;

  @ApiPropertyOptional({ example: '2026-11-10T16:30:00+05:30', nullable: true, type: String })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsISO8601()
  check_out_at?: string | null;

  @ApiPropertyOptional({ example: 'Biometric machine was down', nullable: true, type: String, description: 'Optional' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(255)
  remarks?: string | null;
}

export class BulkSkipDto {
  @ApiProperty({ example: 15 })
  id: number;

  @ApiProperty({ example: 'Divya Bharathi' })
  name: string;

  @ApiProperty({ example: 'On approved leave' })
  reason: string;
}

export class BulkStaffResultDto {
  @ApiProperty({ example: '2026-11-10' })
  date: string;

  @ApiProperty({ example: 27 })
  marked: number;

  @ApiProperty({ type: [BulkSkipDto] })
  skipped: BulkSkipDto[];
}
