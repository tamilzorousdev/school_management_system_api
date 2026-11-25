import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import {
  ROSTER_STATUSES,
  RosterStatus,
  STUDY_MARKS,
  StudyMark,
  SWAP_STATUSES,
  SwapStatus,
} from '../entities/hostel-duty.entity';
import { HostelStudentDto } from './hostel-admission.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const notNull = (_object: unknown, value: unknown) => value !== null && value !== undefined;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeMessage = (field: string) => ({ message: `${field} must be a time as HH:mm` });

export const HALL_STATUSES = ['open', 'closed'] as const;
export type HallStatus = (typeof HALL_STATUSES)[number];

export class DutyShiftDto {
  @ApiProperty({ example: 2 }) id: number;
  @ApiProperty({ example: 'Night' }) name: string;
  @ApiProperty({ example: '21:00' }) start_time: string;
  @ApiProperty({ example: '06:00' }) end_time: string;
  @ApiProperty({ example: true }) is_night: boolean;
  @ApiProperty({ example: true, description: 'The shift ends on the next day' }) crosses_midnight: boolean;
  @ApiProperty({ example: true }) active: boolean;
}

export class DutyShiftInputDto {
  @ApiProperty({ example: 'Night' }) @Transform(trim) @IsString() @Length(1, 40) name: string;
  @ApiProperty({ example: '21:00' }) @Matches(TIME, timeMessage('start_time')) start_time: string;
  @ApiProperty({ example: '06:00', description: 'Earlier than start_time means the shift ends the next day' })
  @Matches(TIME, timeMessage('end_time'))
  end_time: string;
  @ApiPropertyOptional({ description: 'Default true when the shift crosses midnight' })
  @IsOptional()
  @IsBoolean()
  is_night?: boolean;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() active?: boolean;
}

export class DutyShiftPatchDto {
  @ApiPropertyOptional({ example: 'Night' }) @IsOptional() @Transform(trim) @IsString() @Length(1, 40) name?: string;
  @ApiPropertyOptional({ example: '21:00' })
  @IsOptional()
  @Matches(TIME, timeMessage('start_time'))
  start_time?: string;
  @ApiPropertyOptional({ example: '06:00' }) @IsOptional() @Matches(TIME, timeMessage('end_time')) end_time?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_night?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

export class DutyShiftQueryDto {
  @ApiPropertyOptional({ description: 'Only active shifts' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}

export class RosterRowDto {
  @ApiProperty({ example: 40 }) id: number;
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ nullable: true, type: Number }) block_id: number | null;
  @ApiProperty({ nullable: true, type: String, example: 'A Block' }) block_name: string | null;
  @ApiProperty({ example: '2026-07-14' }) duty_date: string;
  @ApiProperty({ example: 2 }) shift_id: number;
  @ApiProperty({ example: 'Night' }) shift_name: string;
  @ApiProperty({ example: '21:00' }) start_time: string;
  @ApiProperty({ example: '06:00' }) end_time: string;
  @ApiProperty({ example: true }) is_night: boolean;
  @ApiProperty({ example: 12 }) user_id: number;
  @ApiProperty({ example: 'R. Kumar' }) user_name: string;
  @ApiProperty({ nullable: true, type: String, example: '9000000004' }) user_mobile: string | null;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty({ enum: ROSTER_STATUSES }) status: RosterStatus;
  @ApiProperty({ description: 'Shift start as a timestamp' }) shift_start_at: Date;
  @ApiProperty({ description: 'Shift end as a timestamp (next day for a night shift)' }) shift_end_at: Date;
  @ApiProperty({ nullable: true, type: String }) check_in_at: Date | null;
  @ApiProperty({ nullable: true, type: String }) check_out_at: Date | null;
  @ApiProperty({ nullable: true, type: Number, example: 12 }) late_minutes: number | null;
  @ApiProperty({ example: false, description: 'Still scheduled after the shift started' }) running_late: boolean;
  @ApiProperty({ example: false, description: 'A swap request is waiting for approval' }) swap_pending: boolean;
}

export class RosterQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) user_id?: number;
  @IsDateOnly('2026-07-13', true) from?: string;
  @IsDateOnly('2026-07-19', true) to?: string;
}

export class DateRangeQueryDto {
  @IsDateOnly('2026-07-13', true) from?: string;
  @IsDateOnly('2026-07-26', true) to?: string;
}

export class RosterEntryInputDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) hostel_id: number;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  block_id?: number | null;
  @IsDateOnly('2026-07-14') duty_date: string;
  @ApiProperty({ example: 2 }) @IsInt() @Min(1) shift_id: number;
  @ApiProperty({ example: 12, description: 'Active staff member of this school' }) @IsInt() @Min(1) user_id: number;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Cover the main gate till 22:00' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  note?: string | null;
}

export class RosterInputDto {
  @ApiProperty({ type: [RosterEntryInputDto], description: 'Up to 200 duties at a time' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RosterEntryInputDto)
  entries: RosterEntryInputDto[];
}

export class SwapInputDto {
  @ApiProperty({ example: 14, description: 'Staff member who will take the duty' }) @IsInt() @Min(1) to_user_id: number;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Family function' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  reason?: string | null;
}

export class SwapDto {
  @ApiProperty({ example: 5 }) id: number;
  @ApiProperty({ example: 40 }) roster_id: number;
  @ApiProperty({ example: '2026-07-14' }) duty_date: string;
  @ApiProperty({ example: 'Night' }) shift_name: string;
  @ApiProperty({ example: '21:00' }) start_time: string;
  @ApiProperty({ example: '06:00' }) end_time: string;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ example: 12 }) from_user_id: number;
  @ApiProperty({ example: 'R. Kumar' }) from_user_name: string;
  @ApiProperty({ example: 14 }) to_user_id: number;
  @ApiProperty({ example: 'S. Devi' }) to_user_name: string;
  @ApiProperty({ nullable: true, type: String }) reason: string | null;
  @ApiProperty({ enum: SWAP_STATUSES }) status: SwapStatus;
  @ApiProperty({ nullable: true, type: String }) decided_by_name: string | null;
  @ApiProperty({ nullable: true, type: String }) decided_at: Date | null;
  @ApiProperty() created_at: Date;
}

export class SwapQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: SWAP_STATUSES }) @IsOptional() @IsIn(SWAP_STATUSES) status?: SwapStatus;
  @ApiPropertyOptional({ description: 'Only swaps I asked for or was asked to take' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  mine?: boolean;
}

export class NightRoundInputDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) hostel_id: number;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  block_id?: number | null;
  @ApiProperty({ example: true }) @IsBoolean() all_ok: boolean;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: 'Room A-104 lights on after 23:00',
    description: 'Required when all_ok is false',
  })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  issues?: string | null;
}

export class NightRoundDto {
  @ApiProperty({ example: 3 }) id: number;
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ nullable: true, type: Number }) block_id: number | null;
  @ApiProperty({ nullable: true, type: String }) block_name: string | null;
  @ApiProperty({ example: 12 }) user_id: number;
  @ApiProperty({ example: 'R. Kumar' }) user_name: string;
  @ApiProperty() round_at: Date;
  @ApiProperty({ example: true }) all_ok: boolean;
  @ApiProperty({ nullable: true, type: String }) issues: string | null;
}

export class RoundQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @IsDateOnly('2026-07-14', true) date?: string;
}

export class DutyReportQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @IsDateOnly('2026-07-01', true) from?: string;
  @IsDateOnly('2026-07-31', true) to?: string;
}

export class DutyReportRowDto {
  @ApiProperty({ example: 12 }) user_id: number;
  @ApiProperty({ example: 'R. Kumar' }) user_name: string;
  @ApiProperty({ example: 22 }) scheduled: number;
  @ApiProperty({ example: 20, description: 'Checked in or completed' }) attended: number;
  @ApiProperty({ example: 3 }) late: number;
  @ApiProperty({ example: 2, description: 'Marked absent, or never checked in for a past duty' }) absent: number;
  @ApiProperty({ example: 6.5 }) average_late_minutes: number;
}

export class StudyScheduleDto {
  @ApiProperty({ example: 4 }) id: number;
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ nullable: true, type: Number }) block_id: number | null;
  @ApiProperty({ nullable: true, type: String }) block_name: string | null;
  @ApiProperty({ nullable: true, type: Number }) hall_id: number | null;
  @ApiProperty({ nullable: true, type: String }) hall_name: string | null;
  @ApiProperty({ example: 'Evening prep' }) name: string;
  @ApiProperty({ type: [Number], example: [1, 2, 3, 4, 5], description: '0 = Sunday … 6 = Saturday' }) days: number[];
  @ApiProperty({ example: '18:30' }) start_time: string;
  @ApiProperty({ example: '20:30' }) end_time: string;
  @ApiProperty({ nullable: true, type: Number }) supervisor_user_id: number | null;
  @ApiProperty({ nullable: true, type: String }) supervisor_name: string | null;
  @ApiProperty({ example: true }) active: boolean;
}

export class StudyScheduleInputDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) hostel_id: number;
  @ApiPropertyOptional({ nullable: true, type: Number, description: 'Only residents of this block' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  block_id?: number | null;
  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: 'Only students with a seat in this study hall (study hall module must be on)',
  })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  hall_id?: number | null;
  @ApiProperty({ example: 'Evening prep' }) @Transform(trim) @IsString() @Length(1, 60) name: string;
  @ApiProperty({ type: [Number], example: [1, 2, 3, 4, 5], description: '0 = Sunday … 6 = Saturday' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days: number[];
  @ApiProperty({ example: '18:30' }) @Matches(TIME, timeMessage('start_time')) start_time: string;
  @ApiProperty({ example: '20:30' }) @Matches(TIME, timeMessage('end_time')) end_time: string;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  supervisor_user_id?: number | null;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() active?: boolean;
}

export class StudySchedulePatchDto {
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  block_id?: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  hall_id?: number | null;
  @ApiPropertyOptional({ example: 'Evening prep' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name?: string;
  @ApiPropertyOptional({ type: [Number], example: [1, 2, 3, 4, 5] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days?: number[];
  @ApiPropertyOptional({ example: '18:30' })
  @IsOptional()
  @Matches(TIME, timeMessage('start_time'))
  start_time?: string;
  @ApiPropertyOptional({ example: '20:30' }) @IsOptional() @Matches(TIME, timeMessage('end_time')) end_time?: string;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  supervisor_user_id?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

export class StudyScheduleQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(toBoolean) @IsBoolean() active?: boolean;
}

export class StudyCountsDto {
  @ApiProperty({ example: 60 }) total: number;
  @ApiProperty({ example: 50 }) marked: number;
  @ApiProperty({ example: 10 }) unmarked: number;
  @ApiProperty({ example: 44 }) present: number;
  @ApiProperty({ example: 2 }) absent: number;
  @ApiProperty({ example: 3 }) late: number;
  @ApiProperty({ example: 1 }) excused: number;
}

export class StudyTodayDto extends StudyScheduleDto {
  @ApiProperty({ example: '2026-07-14' }) date: string;
  @ApiProperty({ type: StudyCountsDto }) counts: StudyCountsDto;
}

export class StudySheetQueryDto {
  @ApiProperty({ example: 4 }) @IsInt() @Min(1) schedule_id: number;
  @IsDateOnly('2026-07-14', true) date?: string;
}

export class StudySheetEntryDto {
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ nullable: true, type: String }) block_name: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'A-101' }) room_no: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'B' }) bed_no: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'S12', description: 'Seat in the schedule’s study hall' })
  seat_no: string | null;
  @ApiProperty({ nullable: true, enum: STUDY_MARKS }) status: StudyMark | null;
  @ApiProperty({ nullable: true, enum: STUDY_MARKS, description: 'excused when the student is away on leave' })
  suggested_status: StudyMark | null;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty({ nullable: true, type: String }) marked_at: Date | null;
}

export class StudySheetDto {
  @ApiProperty({ type: StudyScheduleDto }) schedule: StudyScheduleDto;
  @ApiProperty({ example: '2026-07-14' }) date: string;
  @ApiProperty({ example: true, description: 'The schedule runs on this weekday' }) runs_on_date: boolean;
  @ApiProperty({ type: StudyCountsDto }) counts: StudyCountsDto;
  @ApiProperty({ type: [StudySheetEntryDto] }) students: StudySheetEntryDto[];
}

export class StudyMarkItemDto {
  @ApiProperty({ example: 21 }) @IsInt() @Min(1) admission_id: number;
  @ApiProperty({ enum: STUDY_MARKS }) @IsIn(STUDY_MARKS) status: StudyMark;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  note?: string | null;
}

export class StudyMarkDto {
  @ApiProperty({ example: 4 }) @IsInt() @Min(1) schedule_id: number;
  @IsDateOnly('2026-07-14', true) date?: string;
  @ApiProperty({ type: [StudyMarkItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => StudyMarkItemDto)
  entries: StudyMarkItemDto[];
}

export class StudyReportQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @IsDateOnly('2026-07-01', true) from?: string;
  @IsDateOnly('2026-07-31', true) to?: string;
}

export class StudyReportRowDto {
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ example: 20, description: 'Marked study sessions in the range' }) sessions: number;
  @ApiProperty({ example: 16 }) present: number;
  @ApiProperty({ example: 2 }) late: number;
  @ApiProperty({ example: 1 }) absent: number;
  @ApiProperty({ example: 1 }) excused: number;
  @ApiProperty({ example: 90, description: '(present + late) of sessions, in percent' }) percent: number;
}

export class StudyHistoryItemDto {
  @ApiProperty({ example: '2026-07-14' }) date: string;
  @ApiProperty({ example: 4 }) schedule_id: number;
  @ApiProperty({ example: 'Evening prep' }) schedule_name: string;
  @ApiProperty({ example: '18:30' }) start_time: string;
  @ApiProperty({ example: '20:30' }) end_time: string;
  @ApiProperty({ enum: STUDY_MARKS }) status: StudyMark;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty() marked_at: Date;
}

export class StudyHallDto {
  @ApiProperty({ example: 2 }) id: number;
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ example: 'Prep Hall 1' }) name: string;
  @ApiProperty({ nullable: true, type: String, example: 'Ground floor, A Block' }) location: string | null;
  @ApiProperty({ example: 60 }) capacity: number;
  @ApiProperty({ nullable: true, type: Number }) supervisor_user_id: number | null;
  @ApiProperty({ nullable: true, type: String }) supervisor_name: string | null;
  @ApiProperty({ enum: HALL_STATUSES }) status: HallStatus;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
  @ApiProperty({ example: 60 }) seats_active: number;
  @ApiProperty({ example: 48 }) seats_taken: number;
  @ApiProperty({ example: 12 }) seats_free: number;
}

export class StudyHallInputDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) hostel_id: number;
  @ApiProperty({ example: 'Prep Hall 1' }) @Transform(trim) @IsString() @Length(1, 60) name: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  location?: string | null;
  @ApiProperty({ example: 60, description: 'Seats S1..Sn are created' }) @IsInt() @Min(1) @Max(500) capacity: number;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  supervisor_user_id?: number | null;
  @ApiPropertyOptional({ enum: HALL_STATUSES, default: 'open' }) @IsOptional() @IsIn(HALL_STATUSES) status?: HallStatus;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  notes?: string | null;
}

export class StudyHallPatchDto {
  @ApiPropertyOptional({ example: 'Prep Hall 1' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name?: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  location?: string | null;
  @ApiPropertyOptional({
    example: 64,
    description: 'More seats are added; fewer deactivates free seats only (409 when seats are taken)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  capacity?: number;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  supervisor_user_id?: number | null;
  @ApiPropertyOptional({ enum: HALL_STATUSES }) @IsOptional() @IsIn(HALL_STATUSES) status?: HallStatus;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  notes?: string | null;
}

export class HallQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
}

export class SeatDto {
  @ApiProperty({ example: 31 }) id: number;
  @ApiProperty({ example: 'S12' }) seat_no: string;
  @ApiProperty({ example: true }) active: boolean;
  @ApiProperty({ nullable: true, type: Number }) allocation_id: number | null;
  @ApiProperty({ nullable: true, type: Number }) admission_id: number | null;
  @ApiProperty({ nullable: true, type: HostelStudentDto }) student: HostelStudentDto | null;
  @ApiProperty({ nullable: true, type: String, example: '2026-07-01' }) since: string | null;
}

export class SeatMapDto {
  @ApiProperty({ type: StudyHallDto }) hall: StudyHallDto;
  @ApiProperty({ type: [SeatDto] }) seats: SeatDto[];
}

export class SeatAllocateDto {
  @ApiProperty({ example: 31 }) @IsInt() @Min(1) seat_id: number;
  @ApiProperty({ example: 21 }) @IsInt() @Min(1) admission_id: number;
}

export class AutoAssignDto {
  @ApiPropertyOptional({ type: [Number], description: 'Only these residents, in this order' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  admission_ids?: number[];
  @ApiPropertyOptional({ description: 'Only residents of this block' })
  @IsOptional()
  @IsInt()
  @Min(1)
  block_id?: number;
}

export class AutoAssignedDto {
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ example: 'Arun Kumar' }) student_name: string;
  @ApiProperty({ example: 31 }) seat_id: number;
  @ApiProperty({ example: 'S12' }) seat_no: string;
}

export class AutoSkippedDto {
  @ApiProperty({ example: 22 }) admission_id: number;
  @ApiProperty({ nullable: true, type: String }) student_name: string | null;
  @ApiProperty({ example: 'No free seat left' }) reason: string;
}

export class AutoAssignResultDto {
  @ApiProperty({ type: [AutoAssignedDto] }) assigned: AutoAssignedDto[];
  @ApiProperty({ type: [AutoSkippedDto] }) skipped: AutoSkippedDto[];
}

export class ParentStudyScheduleDto {
  @ApiProperty({ example: 4 }) id: number;
  @ApiProperty({ example: 'Evening prep' }) name: string;
  @ApiProperty({ type: [Number], example: [1, 2, 3, 4, 5] }) days: number[];
  @ApiProperty({ example: '18:30' }) start_time: string;
  @ApiProperty({ example: '20:30' }) end_time: string;
  @ApiProperty({ nullable: true, type: String }) hall_name: string | null;
}

export class ParentSeatDto {
  @ApiProperty({ example: 'Prep Hall 1' }) hall_name: string;
  @ApiProperty({ example: 'S12' }) seat_no: string;
  @ApiProperty({ example: '2026-07-01' }) since: string;
}

export class ParentStudyDto {
  @ApiProperty({ type: [ParentStudyScheduleDto] }) schedules: ParentStudyScheduleDto[];
  @ApiProperty({ type: [StudyHistoryItemDto], description: 'Last 30 days, newest first' })
  marks: StudyHistoryItemDto[];
  @ApiProperty({ nullable: true, type: ParentSeatDto }) seat: ParentSeatDto | null;
}
