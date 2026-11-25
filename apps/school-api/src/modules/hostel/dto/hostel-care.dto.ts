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
  IsISO8601,
  IsNumber,
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
import { IsDateOnly, IsNullableDate } from '../../../shared/dates';
import { DIETS, Diet } from '../entities/hostel-admission.entity';
import {
  DOSE_STATUSES,
  DoseStatus,
  HEALTH_KINDS,
  HealthKind,
  LAUNDRY_STATUSES,
  LaundryStatus,
  Meal,
  MEAL_MARKS,
  MealMark,
  MEALS,
  SKIP_SOURCES,
  SkipSource,
} from '../entities/hostel-care.entity';
import { MenuSource } from '../hostel-care.logic';
import { HostelStudentDto } from './hostel-admission.dto';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MENU_SOURCES = ['override', 'hostel_week', 'school_week', 'none'] as const;
const DOSE_VIEW_STATUSES = ['pending', ...DOSE_STATUSES] as const;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const notNull = (_object: unknown, value: unknown) => value !== null && value !== undefined;

export class MessMenuQueryDto {
  @ApiPropertyOptional({
    description: 'Hostel; its own rows win over the school-wide menu. Left out: school-wide only',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  hostel_id?: number;
}

export class MessMealDto {
  @ApiProperty({ enum: MEALS }) meal: Meal;
  @ApiProperty({ nullable: true, type: String, example: 'Idli, sambar, chutney' }) items: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'Egg curry' }) non_veg_items: string | null;
  @ApiProperty({ enum: MENU_SOURCES, description: 'Where the items come from' }) source: MenuSource;
}

export class MessWeekDayDto {
  @ApiProperty({ example: 1, description: '0 = Sunday' }) day_of_week: number;
  @ApiProperty({ example: 'Monday' }) day_name: string;
  @ApiProperty({ type: [MessMealDto] }) meals: MessMealDto[];
}

export class MessWeekDto {
  @ApiProperty({ nullable: true, type: Number, example: 1 }) hostel_id: number | null;
  @ApiProperty({ type: [MessWeekDayDto] }) days: MessWeekDayDto[];
}

export class MessMenuEntryInputDto {
  @ApiProperty({ example: 1, description: '0 = Sunday ... 6 = Saturday' })
  @IsInt()
  @Min(0)
  @Max(6)
  day_of_week: number;
  @ApiProperty({ enum: MEALS }) @IsIn(MEALS) meal: Meal;
  @ApiProperty({ example: 'Idli, sambar, chutney, tea' }) @Transform(trim) @IsString() @Length(1, 500) items: string;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Boiled egg' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(300)
  non_veg_items?: string | null;
}

export class MessMenuInputDto {
  @ApiPropertyOptional({ description: 'Hostel to set its own menu; left out sets the school-wide menu' })
  @IsOptional()
  @IsInt()
  @Min(1)
  hostel_id?: number;
  @ApiProperty({ type: [MessMenuEntryInputDto], description: 'Whole week for this scope; replaces what was there' })
  @IsArray()
  @ArrayMaxSize(28)
  @ValidateNested({ each: true })
  @Type(() => MessMenuEntryInputDto)
  entries: MessMenuEntryInputDto[];
}

export class MessOverrideQueryDto {
  @IsDateOnly('2026-07-01', true) from?: string;
  @IsDateOnly('2026-07-31', true) to?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
}

export class MessOverrideInputDto {
  @ApiPropertyOptional({ description: 'Only this hostel; left out applies to every hostel' })
  @IsOptional()
  @IsInt()
  @Min(1)
  hostel_id?: number;
  @IsDateOnly('2026-08-15') menu_date: string;
  @ApiProperty({ enum: MEALS }) @IsIn(MEALS) meal: Meal;
  @ApiProperty({ example: 'Veg biryani, raita, payasam' }) @Transform(trim) @IsString() @Length(1, 500) items: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(300)
  non_veg_items?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Independence Day special' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  note?: string | null;
}

export class MessOverrideDto {
  @ApiProperty({ example: 5 }) id: number;
  @ApiProperty({ nullable: true, type: Number }) hostel_id: number | null;
  @ApiProperty({ nullable: true, type: String, example: 'Boys Hostel' }) hostel_name: string | null;
  @ApiProperty({ example: '2026-08-15' }) menu_date: string;
  @ApiProperty({ enum: MEALS }) meal: Meal;
  @ApiProperty({ example: 'Veg biryani, raita, payasam' }) items: string;
  @ApiProperty({ nullable: true, type: String }) non_veg_items: string | null;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty() created_at: Date;
}

export class MessDayQueryDto {
  @IsDateOnly('2026-07-01', true) date?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
}

export class ParentMessDayQueryDto {
  @IsDateOnly('2026-07-01', true) date?: string;
}

export class MessDayMealDto extends MessMealDto {
  @ApiProperty({ nullable: true, type: String, description: 'Note of a date override' }) note: string | null;
}

export class MessDayDto {
  @ApiProperty({ example: '2026-07-01' }) date: string;
  @ApiProperty({ example: 3 }) day_of_week: number;
  @ApiProperty({ example: 'Wednesday' }) day_name: string;
  @ApiProperty({ nullable: true, type: Number }) hostel_id: number | null;
  @ApiProperty({ type: [MessDayMealDto] }) meals: MessDayMealDto[];
}

export class MessSlotQueryDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) hostel_id: number;
  @IsDateOnly('2026-07-01', true) date?: string;
  @ApiProperty({ enum: MEALS }) @IsIn(MEALS) meal: Meal;
}

export class MessDietCountDto {
  @ApiProperty({ example: 80 }) veg: number;
  @ApiProperty({ example: 52 }) non_veg: number;
  @ApiProperty({ example: 8 }) eggetarian: number;
}

export class MessHeadcountDto {
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: '2026-07-01' }) date: string;
  @ApiProperty({ enum: MEALS }) meal: Meal;
  @ApiProperty({ example: 160, description: 'Residents on the date' }) residents: number;
  @ApiProperty({ example: 12, description: 'Away on home leave' }) on_leave: number;
  @ApiProperty({ example: 8, description: 'In the hostel but with a meal skip' }) skipping: number;
  @ApiProperty({ example: 140, description: 'Meals to cook' }) expected: number;
  @ApiProperty({ type: MessDietCountDto, description: 'Expected split by diet' }) by_diet: MessDietCountDto;
  @ApiProperty({ example: 96 }) ate: number;
  @ApiProperty({ example: 4 }) skipped: number;
  @ApiProperty({ example: 60 }) unmarked: number;
}

export class MessAttendanceEntryDto {
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ nullable: true, type: String, example: 'A-101' }) room_no: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'B' }) bed_no: string | null;
  @ApiProperty({ enum: DIETS }) diet: Diet;
  @ApiProperty({ nullable: true, enum: MEAL_MARKS }) status: MealMark | null;
  @ApiProperty({ nullable: true, enum: ['manual', 'qr'] }) method: 'manual' | 'qr' | null;
  @ApiProperty({ nullable: true, type: String }) marked_at: Date | null;
  @ApiProperty({ nullable: true, type: Number, description: 'Active meal skip covering this meal' })
  skip_id: number | null;
  @ApiProperty({ example: false, description: 'Away on home leave' }) on_leave: boolean;
}

export class MessAttendanceCountsDto {
  @ApiProperty({ example: 160 }) total: number;
  @ApiProperty({ example: 96 }) ate: number;
  @ApiProperty({ example: 4 }) skipped: number;
  @ApiProperty({ example: 60 }) unmarked: number;
  @ApiProperty({ example: 12 }) on_leave: number;
  @ApiProperty({ example: 8 }) skip_requested: number;
}

export class MessAttendanceSheetDto {
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: '2026-07-01' }) date: string;
  @ApiProperty({ enum: MEALS }) meal: Meal;
  @ApiProperty({ type: MessAttendanceCountsDto }) counts: MessAttendanceCountsDto;
  @ApiProperty({ type: [MessAttendanceEntryDto] }) students: MessAttendanceEntryDto[];
}

export class MessMarkEntryInputDto {
  @ApiProperty({ example: 21 }) @IsInt() @Min(1) admission_id: number;
  @ApiProperty({ enum: MEAL_MARKS }) @IsIn(MEAL_MARKS) status: MealMark;
}

export class MessMarkDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) hostel_id: number;
  @ApiPropertyOptional({ example: '2026-07-01', format: 'date', description: 'Today (default) or yesterday' })
  @IsDateOnly('2026-07-01', true)
  date?: string;
  @ApiProperty({ enum: MEALS }) @IsIn(MEALS) meal: Meal;
  @ApiProperty({ type: [MessMarkEntryInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => MessMarkEntryInputDto)
  entries: MessMarkEntryInputDto[];
}

export class MessScanDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) hostel_id: number;
  @ApiProperty({ enum: MEALS }) @IsIn(MEALS) meal: Meal;
  @ApiProperty({ example: 'TZS1.312.1.Xyz...', description: 'QR on the student ID card' })
  @Transform(trim)
  @IsString()
  @Length(10, 200)
  qr: string;
}

export class MessScanResultDto {
  @ApiProperty({ type: MessAttendanceEntryDto }) entry: MessAttendanceEntryDto;
  @ApiProperty({ example: false, description: 'Already marked ate for this meal before the scan' })
  already_marked: boolean;
}

export class MessSkipQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) admission_id?: number;
  @ApiPropertyOptional({ description: 'true: active skips not over yet; false: cancelled or over' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}

export class ParentMessSkipQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ description: 'true: active skips not over yet' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}

export class ParentMessSkipInputDto {
  @ApiProperty({ example: '2026-07-04', format: 'date', description: 'Today or later' })
  @IsDateOnly('2026-07-04')
  from_date: string;
  @ApiProperty({ example: '2026-07-05', format: 'date', description: 'At most 30 days after from_date' })
  @IsDateOnly('2026-07-05')
  to_date: string;
  @ApiProperty({ enum: MEALS, isArray: true, example: ['lunch', 'dinner'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsIn(MEALS, { each: true })
  meals: Meal[];
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Fasting for a festival' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  reason?: string | null;
}

export class MessSkipInputDto extends ParentMessSkipInputDto {
  @ApiProperty({ example: 21 }) @IsInt() @Min(1) admission_id: number;
}

export class MessSkipDto {
  @ApiProperty({ example: 9 }) id: number;
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ example: '2026-07-04' }) from_date: string;
  @ApiProperty({ example: '2026-07-05' }) to_date: string;
  @ApiProperty({ enum: MEALS, isArray: true }) meals: Meal[];
  @ApiProperty({ nullable: true, type: String }) reason: string | null;
  @ApiProperty({ enum: SKIP_SOURCES }) source: SkipSource;
  @ApiProperty({ enum: ['active', 'cancelled'] }) status: 'active' | 'cancelled';
  @ApiProperty({ nullable: true, type: String }) created_by_name: string | null;
  @ApiProperty() created_at: Date;
}

export class ParentMessFeedbackInputDto {
  @ApiProperty({ example: '2026-07-01', format: 'date', description: 'Today or the last 7 days' })
  @IsDateOnly('2026-07-01')
  date: string;
  @ApiProperty({ enum: MEALS }) @IsIn(MEALS) meal: Meal;
  @ApiProperty({ example: 4 }) @IsInt() @Min(1) @Max(5) rating: number;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Sambar was too spicy' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  comment?: string | null;
}

export class MessFeedbackInputDto extends ParentMessFeedbackInputDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) hostel_id: number;
}

export class MessFeedbackDto {
  @ApiProperty({ example: 14 }) id: number;
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ nullable: true, type: Number }) admission_id: number | null;
  @ApiProperty({ nullable: true, type: String, example: 'Arun Kumar' }) student_name: string | null;
  @ApiProperty({ example: '2026-07-01' }) meal_date: string;
  @ApiProperty({ enum: MEALS }) meal: Meal;
  @ApiProperty({ example: 4 }) rating: number;
  @ApiProperty({ nullable: true, type: String }) comment: string | null;
  @ApiProperty({ enum: ['parent', 'staff'] }) by_role: 'parent' | 'staff';
  @ApiProperty({ nullable: true, type: String }) created_by_name: string | null;
  @ApiProperty() created_at: Date;
}

export class MessFeedbackQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional({ enum: MEALS }) @IsOptional() @IsIn(MEALS) meal?: Meal;
  @ApiPropertyOptional({ enum: ['parent', 'staff'] }) @IsOptional() @IsIn(['parent', 'staff']) by_role?: string;
  @ApiPropertyOptional({ example: 2, description: 'Only ratings up to this value (complaints)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  max_rating?: number;
  @IsDateOnly('2026-07-01', true) from?: string;
  @IsDateOnly('2026-07-31', true) to?: string;
}

export class MessFeedbackSummaryQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional({ example: '2026-07-01', format: 'date', description: 'Default 30 days before to' })
  @IsDateOnly('2026-07-01', true)
  from?: string;
  @ApiPropertyOptional({ example: '2026-07-31', format: 'date', description: 'Default today' })
  @IsDateOnly('2026-07-31', true)
  to?: string;
}

export class MessMealRatingDto {
  @ApiProperty({ enum: MEALS }) meal: Meal;
  @ApiProperty({ nullable: true, type: Number, example: 3.8 }) average: number | null;
  @ApiProperty({ example: 42 }) count: number;
  @ApiProperty({ example: 5, description: 'Ratings of 1 or 2' }) low: number;
}

export class MessFeedbackSummaryDto {
  @ApiProperty({ example: '2026-07-01' }) from: string;
  @ApiProperty({ example: '2026-07-31' }) to: string;
  @ApiProperty({ nullable: true, type: Number, example: 3.9 }) average: number | null;
  @ApiProperty({ example: 160 }) count: number;
  @ApiProperty({ type: [MessMealRatingDto] }) meals: MessMealRatingDto[];
}

export class HealthLogDto {
  @ApiProperty({ example: 6 }) id: number;
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ nullable: true, type: String, example: 'A-101 / B' }) bed: string | null;
  @ApiProperty({ enum: HEALTH_KINDS }) kind: HealthKind;
  @ApiProperty() logged_at: Date;
  @ApiProperty({ example: 'Fever and headache since morning' }) symptoms: string;
  @ApiProperty({ nullable: true, type: Number, example: 100.4 }) temperature: number | null;
  @ApiProperty({ nullable: true, type: String, example: 'Paracetamol 500 mg given' }) action_taken: string | null;
  @ApiProperty({ nullable: true, type: String }) doctor_name: string | null;
  @ApiProperty({ example: false }) hospital_visit: boolean;
  @ApiProperty({ example: true }) parent_informed: boolean;
  @ApiProperty({ enum: ['open', 'closed'] }) status: 'open' | 'closed';
  @ApiProperty({ example: true, description: 'In the sick bay now' }) in_sick_bay: boolean;
  @ApiProperty({ nullable: true, type: String }) sick_bay_from: Date | null;
  @ApiProperty({ nullable: true, type: String }) sick_bay_to: Date | null;
  @ApiProperty({ nullable: true, type: String }) closed_at: Date | null;
  @ApiProperty({ nullable: true, type: String, example: 'R. Kumar' }) logged_by_name: string | null;
  @ApiProperty() created_at: Date;
}

export class HealthLogQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) admission_id?: number;
  @ApiPropertyOptional({ enum: ['open', 'closed'] }) @IsOptional() @IsIn(['open', 'closed']) status?: string;
  @ApiPropertyOptional({ enum: HEALTH_KINDS }) @IsOptional() @IsIn(HEALTH_KINDS) kind?: HealthKind;
  @ApiPropertyOptional({ description: 'Only students in the sick bay now' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  in_sick_bay?: boolean;
}

export class HealthLogInputDto {
  @ApiProperty({ example: 21 }) @IsInt() @Min(1) admission_id: number;
  @ApiProperty({ enum: HEALTH_KINDS }) @IsIn(HEALTH_KINDS) kind: HealthKind;
  @ApiPropertyOptional({ example: '2026-07-01T07:30:00+05:30', description: 'Default now' })
  @IsOptional()
  @IsISO8601()
  logged_at?: string;
  @ApiProperty({ example: 'Fever and headache since morning' })
  @Transform(trim)
  @IsString()
  @Length(2, 500)
  symptoms: string;
  @ApiPropertyOptional({ nullable: true, type: Number, example: 100.4, description: 'Body temperature as measured' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(30)
  @Max(110)
  temperature?: number | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Paracetamol 500 mg given' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  action_taken?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Dr. Priya' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  doctor_name?: string | null;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() hospital_visit?: boolean;
  @ApiPropertyOptional({ default: false, description: 'Move the student to the sick bay now' })
  @IsOptional()
  @IsBoolean()
  sick_bay?: boolean;
  @ApiPropertyOptional({ default: true, description: 'Send HOSTEL_HEALTH to the parents' })
  @IsOptional()
  @IsBoolean()
  notify_parent?: boolean;
}

export class HealthLogPatchDto {
  @ApiPropertyOptional({ enum: HEALTH_KINDS }) @IsOptional() @IsIn(HEALTH_KINDS) kind?: HealthKind;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 500) symptoms?: string;
  @ApiPropertyOptional({ nullable: true, type: Number, example: 99.1 })
  @IsOptional()
  @ValidateIf(notNull)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(30)
  @Max(110)
  temperature?: number | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  action_taken?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  doctor_name?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hospital_visit?: boolean;
  @ApiPropertyOptional({ description: 'true moves the student to the sick bay, false discharges' })
  @IsOptional()
  @IsBoolean()
  sick_bay?: boolean;
  @ApiPropertyOptional({ default: false, description: 'Send HOSTEL_HEALTH to the parents about this update' })
  @IsOptional()
  @IsBoolean()
  notify_parent?: boolean;
}

export class HealthLogNoteDto {
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Fever down, back to class tomorrow' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  note?: string | null;
  @ApiPropertyOptional({ default: false, description: 'Send HOSTEL_HEALTH to the parents' })
  @IsOptional()
  @IsBoolean()
  notify_parent?: boolean;
}

export class MedicationDto {
  @ApiProperty({ example: 3 }) id: number;
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ nullable: true, type: String, example: 'A-101 / B' }) bed: string | null;
  @ApiProperty({ example: 'Amoxicillin 250 mg' }) medicine: string;
  @ApiProperty({ example: '1 tablet' }) dose: string;
  @ApiProperty({ example: ['08:00', '20:00'] }) times: string[];
  @ApiProperty({ example: '2026-07-01' }) from_date: string;
  @ApiProperty({ nullable: true, type: String, example: '2026-07-05' }) to_date: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'After food' }) instructions: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'Dr. Priya' }) prescribed_by: string | null;
  @ApiProperty({ example: true }) active: boolean;
  @ApiProperty({ nullable: true, type: String }) created_by_name: string | null;
  @ApiProperty() created_at: Date;
}

export class MedicationQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) admission_id?: number;
  @ApiPropertyOptional({ description: 'true: running courses (active and not past to_date)' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}

export class ParentMedicationQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ description: 'true: running courses only' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}

export class MedicationInputDto {
  @ApiProperty({ example: 21 }) @IsInt() @Min(1) admission_id: number;
  @ApiProperty({ example: 'Amoxicillin 250 mg' }) @Transform(trim) @IsString() @Length(2, 120) medicine: string;
  @ApiProperty({ example: '1 tablet' }) @Transform(trim) @IsString() @Length(1, 60) dose: string;
  @ApiProperty({ example: ['08:00', '20:00'], description: 'Times of day as HH:mm' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ArrayUnique()
  @Matches(TIME, { each: true, message: 'times must be times as HH:mm' })
  times: string[];
  @IsDateOnly('2026-07-01') from_date: string;
  @IsNullableDate('2026-07-05') to_date?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'After food' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  instructions?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Dr. Priya' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  prescribed_by?: string | null;
}

export class MedicationDueQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @IsDateOnly('2026-07-01', true) date?: string;
}

export class MedicationDueDto {
  @ApiProperty({ example: 3 }) medication_id: number;
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ nullable: true, type: String, example: 'A-101 / B' }) bed: string | null;
  @ApiProperty({ example: 'Amoxicillin 250 mg' }) medicine: string;
  @ApiProperty({ example: '1 tablet' }) dose: string;
  @ApiProperty({ nullable: true, type: String }) instructions: string | null;
  @ApiProperty({ example: '2026-07-01' }) dose_date: string;
  @ApiProperty({ example: '08:00' }) dose_time: string;
  @ApiProperty({ enum: DOSE_VIEW_STATUSES }) status: 'pending' | DoseStatus;
  @ApiProperty({ example: false, description: 'Still pending after its time' }) overdue: boolean;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty({ nullable: true, type: String }) given_by_name: string | null;
  @ApiProperty({ nullable: true, type: String }) given_at: Date | null;
}

export class DoseInputDto {
  @IsDateOnly('2026-07-01') dose_date: string;
  @ApiProperty({ example: '08:00', description: 'One of the medication times' })
  @Matches(TIME, { message: 'dose_time must be a time as HH:mm' })
  dose_time: string;
  @ApiProperty({ enum: DOSE_STATUSES }) @IsIn(DOSE_STATUSES) status: DoseStatus;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Vomited, will retry' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  note?: string | null;
}

export class DoseDto {
  @ApiProperty({ example: 40 }) id: number;
  @ApiProperty({ example: 3 }) medication_id: number;
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ example: '2026-07-01' }) dose_date: string;
  @ApiProperty({ example: '08:00' }) dose_time: string;
  @ApiProperty({ enum: DOSE_STATUSES }) status: DoseStatus;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty({ nullable: true, type: String }) given_by_name: string | null;
  @ApiProperty() given_at: Date;
}

export class LaundryQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional({ enum: LAUNDRY_STATUSES }) @IsOptional() @IsIn(LAUNDRY_STATUSES) status?: LaundryStatus;
  @ApiPropertyOptional({ description: 'Batches with clothes of this resident' })
  @IsOptional()
  @IsInt()
  @Min(1)
  admission_id?: number;
}

export class LaundryItemInputDto {
  @ApiProperty({ example: 21 }) @IsInt() @Min(1) admission_id: number;
  @ApiProperty({ example: 6, description: 'Clothes handed in' }) @IsInt() @Min(1) @Max(100) items_given: number;
}

export class LaundryItemsInputDto {
  @ApiProperty({ type: [LaundryItemInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => LaundryItemInputDto)
  items: LaundryItemInputDto[];
}

export class LaundryInputDto extends LaundryItemsInputDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) hostel_id: number;
  @IsDateOnly('2026-07-01', true) collected_on?: string;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Sri Laundry' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  vendor_name?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  notes?: string | null;
}

export class LaundrySentDto {
  @IsDateOnly('2026-07-02', true) sent_on?: string;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Sri Laundry' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  vendor_name?: string | null;
}

export class LaundryReturnItemDto {
  @ApiProperty({ example: 21 }) @IsInt() @Min(1) admission_id: number;
  @ApiProperty({ example: 5 }) @IsInt() @Min(0) @Max(100) items_returned: number;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Blue towel missing' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  missing_note?: string | null;
}

export class LaundryReturnDto {
  @IsDateOnly('2026-07-04', true) returned_on?: string;
  @ApiProperty({
    type: [LaundryReturnItemDto],
    description: 'Residents whose count differs; residents left out got everything back',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => LaundryReturnItemDto)
  items: LaundryReturnItemDto[];
}

export class LaundryBatchDto {
  @ApiProperty({ example: 12 }) id: number;
  @ApiProperty({ example: 'HLB-2026-0012' }) batch_no: string;
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ example: '2026-07-01' }) collected_on: string;
  @ApiProperty({ nullable: true, type: String }) vendor_name: string | null;
  @ApiProperty({ enum: LAUNDRY_STATUSES }) status: LaundryStatus;
  @ApiProperty({ nullable: true, type: String }) sent_on: string | null;
  @ApiProperty({ nullable: true, type: String }) returned_on: string | null;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
  @ApiProperty({ example: 40 }) students: number;
  @ApiProperty({ example: 236 }) items_given: number;
  @ApiProperty({ nullable: true, type: Number, example: 234 }) items_returned: number | null;
  @ApiProperty({ example: 2 }) items_missing: number;
  @ApiProperty({ nullable: true, type: String }) created_by_name: string | null;
  @ApiProperty() created_at: Date;
}

export class LaundryItemDto {
  @ApiProperty({ example: 88 }) id: number;
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ nullable: true, type: String, example: 'A-101 / B' }) bed: string | null;
  @ApiProperty({ example: 6 }) items_given: number;
  @ApiProperty({ nullable: true, type: Number, example: 5 }) items_returned: number | null;
  @ApiProperty({ example: 1 }) missing: number;
  @ApiProperty({ nullable: true, type: String }) missing_note: string | null;
}

export class LaundryDetailDto extends LaundryBatchDto {
  @ApiProperty({ type: [LaundryItemDto] }) items: LaundryItemDto[];
}

export class LaundryMissingQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional({ example: '2026-06-01', format: 'date', description: 'Default 90 days before to' })
  @IsDateOnly('2026-06-01', true)
  from?: string;
  @ApiPropertyOptional({ example: '2026-07-31', format: 'date', description: 'Default today' })
  @IsDateOnly('2026-07-31', true)
  to?: string;
}

export class LaundryMissingRowDto {
  @ApiProperty({ example: 12 }) batch_id: number;
  @ApiProperty({ example: 'HLB-2026-0012' }) batch_no: string;
  @ApiProperty({ nullable: true, type: String, example: '2026-07-04' }) returned_on: string | null;
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ example: 6 }) items_given: number;
  @ApiProperty({ example: 5 }) items_returned: number;
  @ApiProperty({ example: 1 }) missing: number;
  @ApiProperty({ nullable: true, type: String }) missing_note: string | null;
}

export class LaundryMissingDto {
  @ApiProperty({ example: '2026-06-01' }) from: string;
  @ApiProperty({ example: '2026-07-31' }) to: string;
  @ApiProperty({ example: 9, description: 'Returned batches collected in the range' }) batches: number;
  @ApiProperty({ example: 1840 }) items_given: number;
  @ApiProperty({ example: 7 }) items_missing: number;
  @ApiProperty({ type: [LaundryMissingRowDto] }) rows: LaundryMissingRowDto[];
}

export class ParentLaundryDto {
  @ApiProperty({ example: 12 }) batch_id: number;
  @ApiProperty({ example: 'HLB-2026-0012' }) batch_no: string;
  @ApiProperty({ example: '2026-07-01' }) collected_on: string;
  @ApiProperty({ enum: LAUNDRY_STATUSES }) status: LaundryStatus;
  @ApiProperty({ nullable: true, type: String }) sent_on: string | null;
  @ApiProperty({ nullable: true, type: String }) returned_on: string | null;
  @ApiProperty({ example: 6 }) items_given: number;
  @ApiProperty({ nullable: true, type: Number, example: 6 }) items_returned: number | null;
  @ApiProperty({ example: 0 }) missing: number;
  @ApiProperty({ nullable: true, type: String }) missing_note: string | null;
}
