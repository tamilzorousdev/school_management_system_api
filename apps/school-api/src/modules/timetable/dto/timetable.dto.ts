import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
import { RefDto } from '../../students/dto/student-response.dto';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export class BellPeriodInputDto {
  @ApiProperty({ example: 'Period 1' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 30)
  name: string;

  @ApiProperty({ example: '08:50' })
  @Matches(TIME, { message: 'start_time must be HH:MM' })
  start_time: string;

  @ApiProperty({ example: '09:35' })
  @Matches(TIME, { message: 'end_time must be HH:MM' })
  end_time: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  is_break?: boolean;
}

export class BellScheduleQueryDto {
  @ApiPropertyOptional({ example: 1, description: 'Class id to get class-specific bell schedule' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  class_id?: number;
}

export class BellScheduleDto {
  @ApiPropertyOptional({ example: 1, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  class_id?: number | null;

  @ApiProperty({ type: [BellPeriodInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => BellPeriodInputDto)
  items: BellPeriodInputDto[];
}

export class SlotInputDto {
  @ApiProperty({ example: 1, description: '1 Monday … 6 Saturday' })
  @IsInt()
  @Min(1)
  @Max(6)
  day_of_week: number;

  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  @Max(12)
  period_no: number;

  @ApiProperty({ example: 4 })
  @IsInt()
  subject_id: number;

  @ApiPropertyOptional({
    example: 9,
    nullable: true,
    type: Number,
    description: 'Leave out to use the teacher assigned to this subject in Teacher assignments',
  })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  teacher_user_id?: number | null;

  @ApiPropertyOptional({ example: 'Lab 1', nullable: true, type: String, description: 'Defaults to the section room' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(20)
  room?: string | null;
}

export class SlotQueryDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(6)
  day_of_week: number;

  @ApiProperty({ example: 3 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  period_no: number;
}

export class BellPeriodDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiPropertyOptional({ example: 1, nullable: true })
  class_id?: number | null;

  @ApiProperty({ example: 1, nullable: true, type: Number, description: 'null for breaks' })
  period_no: number | null;

  @ApiProperty({ example: 'Period 1' })
  name: string;

  @ApiProperty({ example: '08:50' })
  start_time: string;

  @ApiProperty({ example: '09:35' })
  end_time: string;

  @ApiProperty()
  is_break: boolean;
}

export class SlotSubjectDto extends RefDto {
  @ApiProperty({ example: 'MATH' })
  code: string;
}

export class SlotDto {
  @ApiProperty({ example: 41 })
  id: number;

  @ApiProperty({ example: 1 })
  day_of_week: number;

  @ApiProperty({ example: 3 })
  period_no: number;

  @ApiProperty({ type: RefDto, description: 'Section, for example 6 - A' })
  section: RefDto;

  @ApiProperty({ type: SlotSubjectDto })
  subject: SlotSubjectDto;

  @ApiProperty({ type: RefDto, nullable: true })
  teacher: RefDto | null;

  @ApiProperty({ nullable: true, type: String })
  room: string | null;
}

export class SubjectPlanDto {
  @ApiProperty({ type: SlotSubjectDto })
  subject: SlotSubjectDto;

  @ApiProperty({ example: 7, description: 'Periods a week the class should get' })
  required: number;

  @ApiProperty({ example: 6, description: 'Periods a week in the timetable' })
  scheduled: number;

  @ApiProperty({ type: RefDto, nullable: true, description: 'From Teacher assignments' })
  teacher: RefDto | null;
}

export class SectionTimetableDto {
  @ApiProperty({ type: RefDto })
  section: RefDto;

  @ApiProperty({ nullable: true, type: String })
  room: string | null;

  @ApiProperty({ type: [Number], example: [1, 2, 3, 4, 5, 6] })
  days: number[];

  @ApiProperty({ type: [BellPeriodDto] })
  periods: BellPeriodDto[];

  @ApiProperty({ type: [SlotDto] })
  slots: SlotDto[];

  @ApiProperty({ type: [SubjectPlanDto] })
  plan: SubjectPlanDto[];
}

export class TeacherTimetableDto {
  @ApiProperty({ type: RefDto })
  teacher: RefDto;

  @ApiProperty({ type: [BellPeriodDto] })
  periods: BellPeriodDto[];

  @ApiProperty({ type: [SlotDto] })
  slots: SlotDto[];

  @ApiProperty({ example: 26 })
  periods_per_week: number;
}

export class WorkloadRowDto {
  @ApiProperty({ type: RefDto })
  teacher: RefDto;

  @ApiProperty({ nullable: true, type: String })
  department: string | null;

  @ApiProperty({ example: 26, description: 'Periods a week in the timetable' })
  scheduled: number;

  @ApiProperty({ example: 28, description: 'Periods a week in Teacher assignments' })
  assigned: number;

  @ApiProperty({ example: 30 })
  max_periods_per_week: number;

  @ApiProperty({ type: [Number], example: [5, 4, 5, 4, 5, 3], description: 'Periods Monday to Saturday' })
  by_day: number[];

  @ApiProperty({ example: 22, description: 'Teaching periods in the week with no class' })
  free: number;

  @ApiProperty({ description: 'Scheduled or assigned periods are above max_periods_per_week' })
  overloaded: boolean;
}

export class WorkloadDto {
  @ApiProperty({ example: 48, description: 'Teaching periods in a week (6 days)' })
  periods_in_week: number;

  @ApiProperty({ example: 18.4 })
  average_scheduled: number;

  @ApiProperty({ example: 1 })
  overloaded: number;

  @ApiProperty({ example: 12, description: 'Subject periods still to place across all sections' })
  unscheduled: number;

  @ApiProperty({ type: [WorkloadRowDto] })
  teachers: WorkloadRowDto[];
}
