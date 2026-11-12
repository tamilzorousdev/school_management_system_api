import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
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
import { RefDto } from '../../students/dto/student-response.dto';
import {
  DAY_PARTS,
  DayPart,
  SPECIAL_ATTENDANCE,
  SPECIAL_KINDS,
  SPECIAL_TIMINGS,
  SpecialAttendanceStatus,
  SpecialKind,
  SpecialTiming,
} from '../entities/special-class.entity';

const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class PerformanceQueryDto {
  @ApiPropertyOptional({ example: 3, description: 'One published exam. Leave out for every published exam this year.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  exam_id?: number;

  @ApiPropertyOptional({ example: 2, description: 'Only the sections of this class' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  class_id?: number;
}

export const STUDENT_BANDS = ['below', 'average', 'range'] as const;
export type StudentBand = (typeof STUDENT_BANDS)[number];

export class BelowAverageQueryDto {
  @ApiPropertyOptional({ example: 3, description: 'One published exam. Leave out for every published exam this year.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  exam_id?: number;

  @ApiPropertyOptional({
    enum: STUDENT_BANDS,
    default: 'below',
    description:
      'below: under the section average (or under below %). average: within 10 points of the section average. range: between from and to %.',
  })
  @IsOptional()
  @IsIn(STUDENT_BANDS)
  band?: StudentBand;

  @ApiPropertyOptional({
    example: 50,
    description: 'band=below only: students below this result %. Leave out to use the section average.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  below?: number;

  @ApiPropertyOptional({ example: 35, description: 'band=range: lowest %' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  from?: number;

  @ApiPropertyOptional({ example: 60, description: 'band=range: highest %' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  to?: number;
}

export class SectionPerformanceDto {
  @ApiProperty({ example: 7 })
  section_id: number;

  @ApiProperty({ example: 2 })
  class_id: number;

  @ApiProperty({ example: '6 - A' })
  name: string;

  @ApiProperty({ example: 'Priya Venkatesh', nullable: true, type: String })
  class_teacher: string | null;

  @ApiProperty({ example: 32, description: 'Students in the section' })
  students: number;

  @ApiProperty({ example: 30, description: 'Students with at least one published result' })
  assessed: number;

  @ApiProperty({ example: 71.4, nullable: true, type: Number, description: 'Average result %' })
  average_percent: number | null;

  @ApiProperty({ example: 86.7, nullable: true, type: Number, description: 'Results with every subject passed' })
  pass_percent: number | null;

  @ApiProperty({ example: 13.3, nullable: true, type: Number, description: 'Results with a subject failed or missed' })
  fail_percent: number | null;

  @ApiProperty({ example: 94.2, nullable: true, type: Number, description: 'Attendance % this academic year' })
  attendance_percent: number | null;

  @ApiProperty({ example: 12, description: 'Students below the section average' })
  below_average: number;

  @ApiProperty({ example: 1, description: 'Special classes running for this section' })
  special_classes: number;
}

export class PerformanceTotalsDto {
  @ApiProperty({ example: 140 })
  students: number;

  @ApiProperty({ example: 132 })
  assessed: number;

  @ApiProperty({ example: 70.3, nullable: true, type: Number })
  average_percent: number | null;

  @ApiProperty({ example: 76.8, nullable: true, type: Number })
  pass_percent: number | null;

  @ApiProperty({ example: 23.2, nullable: true, type: Number })
  fail_percent: number | null;

  @ApiProperty({ example: 95.1, nullable: true, type: Number })
  attendance_percent: number | null;

  @ApiProperty({ example: 58 })
  below_average: number;
}

export class ClassPerformanceDto {
  @ApiProperty({ type: RefDto })
  academic_year: RefDto;

  @ApiProperty({ type: RefDto, nullable: true, description: 'null when every published exam is counted' })
  exam: RefDto | null;

  @ApiProperty({ type: PerformanceTotalsDto, description: 'Whole school' })
  totals: PerformanceTotalsDto;

  @ApiProperty({ type: [SectionPerformanceDto], description: 'Class by class, section by section' })
  sections: SectionPerformanceDto[];
}

export class WeakSubjectDto {
  @ApiProperty({ example: 5 })
  subject_id: number;

  @ApiProperty({ example: 'Mathematics' })
  name: string;

  @ApiProperty({ example: 41.5, description: 'The student’s %' })
  percent: number;

  @ApiProperty({ example: 68.2, description: 'Section average % in this subject' })
  section_percent: number;
}

export class SpecialClassRefDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'Maths support' })
  title: string;
}

export class BelowAverageStudentDto {
  @ApiProperty({ example: 41 })
  student_id: number;

  @ApiProperty({ example: 'Harini Narayanan' })
  full_name: string;

  @ApiProperty({ example: 12, nullable: true, type: Number })
  roll_no: number | null;

  @ApiProperty({ example: 48.6, description: 'Average result %' })
  percent: number;

  @ApiProperty({ example: 22.8, description: 'Points below the line' })
  gap: number;

  @ApiProperty({ example: 2, description: 'Results with a subject failed or missed' })
  failed_results: number;

  @ApiProperty({ example: 88.5, nullable: true, type: Number, description: 'Attendance % this academic year' })
  attendance_percent: number | null;

  @ApiProperty({ type: [WeakSubjectDto], description: 'Up to 3 subjects most below the section average' })
  weak_subjects: WeakSubjectDto[];

  @ApiProperty({ type: [SpecialClassRefDto], description: 'Special classes the student already attends' })
  special_classes: SpecialClassRefDto[];
}

export class BelowAverageDto {
  @ApiProperty({ type: RefDto })
  section: RefDto;

  @ApiProperty({ type: RefDto, nullable: true })
  exam: RefDto | null;

  @ApiProperty({ example: 71.4, nullable: true, type: Number, description: 'Section average result %' })
  section_average: number | null;

  @ApiProperty({ example: 71.4, nullable: true, type: Number, description: 'Students below this % are listed' })
  line: number | null;

  @ApiProperty({ enum: STUDENT_BANDS, example: 'below' })
  band: StudentBand;

  @ApiProperty({ example: 61.4, nullable: true, type: Number, description: 'Lowest % shown' })
  from: number | null;

  @ApiProperty({ example: 81.4, nullable: true, type: Number, description: 'Highest % shown' })
  to: number | null;

  @ApiProperty({ type: [BelowAverageStudentDto], description: 'Lowest first' })
  students: BelowAverageStudentDto[];
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class SpecialClassInputDto {
  @ApiPropertyOptional({
    enum: SPECIAL_KINDS,
    default: 'extra',
    description:
      'extra: only the chosen students (for example below-average students). special: the whole section; every student is included, also students who join later.',
  })
  @IsOptional()
  @IsIn(SPECIAL_KINDS)
  kind?: SpecialKind;

  @ApiPropertyOptional({
    enum: SPECIAL_TIMINGS,
    default: 'period',
    description:
      'period: one period of the bell schedule every week (the students miss that regular period). extra_time: before or after school, in a break or lunch, or on a Sunday or holiday, with its own start and end time.',
  })
  @IsOptional()
  @IsIn(SPECIAL_TIMINGS)
  timing?: SpecialTiming;

  @ApiProperty({ example: 7 })
  @IsInt()
  @Min(1)
  section_id: number;

  @ApiPropertyOptional({ example: 5, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  @Min(1)
  subject_id?: number | null;

  @ApiProperty({ example: 31, description: 'Teacher who takes the class' })
  @IsInt()
  @Min(1)
  teacher_user_id: number;

  @ApiPropertyOptional({ example: 3, description: 'timing=period: 1 = Monday ... 6 = Saturday' })
  @ValidateIf((dto: SpecialClassInputDto) => (dto.timing ?? 'period') === 'period')
  @IsInt()
  @Min(1)
  @Max(6)
  day_of_week?: number;

  @ApiPropertyOptional({ example: 7, description: 'timing=period: the period kept for the class every week' })
  @ValidateIf((dto: SpecialClassInputDto) => (dto.timing ?? 'period') === 'period')
  @IsInt()
  @Min(1)
  @Max(12)
  period_no?: number;

  @ApiPropertyOptional({
    type: [Number],
    example: [1, 3],
    description:
      'timing=extra_time: weekdays it repeats on, 0 = Sunday ... 6 = Saturday. Empty for one date only (start_date).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days?: number[];

  @ApiPropertyOptional({ example: '16:00', description: 'timing=extra_time: 24-hour HH:MM' })
  @ValidateIf((dto: SpecialClassInputDto) => dto.timing === 'extra_time')
  @Matches(TIME, { message: 'start_time must look like 16:00' })
  start_time?: string;

  @ApiPropertyOptional({ example: '17:00', description: 'timing=extra_time: 24-hour HH:MM, after start_time' })
  @ValidateIf((dto: SpecialClassInputDto) => dto.timing === 'extra_time')
  @Matches(TIME, { message: 'end_time must look like 17:00' })
  end_time?: string;

  @ApiPropertyOptional({
    example: '2026-12-01',
    description: 'First day. Required for extra_time; for period it limits the weeks (leave out for the whole year).',
  })
  @ValidateIf((dto: SpecialClassInputDto) => dto.timing === 'extra_time' || dto.start_date !== undefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'start_date must be a date in YYYY-MM-DD format' })
  start_date?: string;

  @ApiPropertyOptional({ example: '2027-02-28', description: 'Last day. Same rules as start_date.' })
  @ValidateIf((dto: SpecialClassInputDto) => dto.timing === 'extra_time' || dto.end_date !== undefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'end_date must be a date in YYYY-MM-DD format' })
  end_date?: string;

  @ApiPropertyOptional({
    enum: DAY_PARTS,
    example: 'custom',
    description: 'How the time was picked, shown to people: full day, morning half, afternoon half or custom hours',
  })
  @IsOptional()
  @IsIn(DAY_PARTS)
  day_part?: DayPart;

  @ApiProperty({ example: 'Maths support' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  title: string;

  @ApiPropertyOptional({ example: 'Fractions and decimals', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  @ApiPropertyOptional({
    type: [Number],
    example: [41, 44, 52],
    description: 'kind=extra: students of this section who attend. Ignored for kind=special.',
  })
  @ValidateIf((dto: SpecialClassInputDto) => (dto.kind ?? 'extra') === 'extra')
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one student' })
  @ArrayMaxSize(80)
  @ArrayUnique()
  @IsInt({ each: true })
  student_ids?: number[];
}

export class UpdateSpecialClassDto extends PartialType(SpecialClassInputDto) {}

export class SpecialClassQueryDto {
  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  section_id?: number;

  @ApiPropertyOptional({ example: 31, description: 'Classes this teacher takes' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  teacher_user_id?: number;
}

export class SpecialClassStudentDto {
  @ApiProperty({ example: 41 })
  id: number;

  @ApiProperty({ example: 'Harini Narayanan' })
  name: string;

  @ApiProperty({ example: 12, nullable: true, type: Number })
  roll_no: number | null;
}

export class SpecialAttendanceSummaryDto {
  @ApiProperty({ example: 8, description: 'Days attendance was taken' })
  days: number;

  @ApiProperty({ example: 7 })
  present: number;

  @ApiProperty({ example: 1 })
  absent: number;

  @ApiProperty({ example: 0 })
  late: number;

  @ApiProperty({ example: 87.5, nullable: true, type: Number })
  percent: number | null;
}

export class SpecialClassDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ enum: SPECIAL_KINDS, example: 'extra' })
  kind: SpecialKind;

  @ApiProperty({ enum: SPECIAL_TIMINGS, example: 'extra_time' })
  timing: SpecialTiming;

  @ApiProperty({ example: 'Maths support' })
  title: string;

  @ApiProperty({ example: 'Fractions and decimals', nullable: true, type: String })
  notes: string | null;

  @ApiProperty({ type: RefDto, description: 'Section, for example 6 - A' })
  section: RefDto;

  @ApiProperty({ example: 2 })
  class_id: number;

  @ApiProperty({ type: RefDto, nullable: true })
  subject: RefDto | null;

  @ApiProperty({ type: RefDto })
  teacher: RefDto;

  @ApiProperty({ example: 3, nullable: true, type: Number, description: 'timing=period' })
  day_of_week: number | null;

  @ApiProperty({
    example: 'Wednesday',
    description: 'timing=period: the weekday; extra_time: the weekdays, comma separated',
  })
  day: string;

  @ApiProperty({ example: 7, nullable: true, type: Number, description: 'timing=period' })
  period_no: number | null;

  @ApiProperty({ type: [Number], example: [1, 3], description: 'timing=extra_time weekdays, 0 = Sunday' })
  days: number[];

  @ApiProperty({ example: '16:00', nullable: true, type: String })
  start_time: string | null;

  @ApiProperty({ example: '17:00', nullable: true, type: String })
  end_time: string | null;

  @ApiProperty({ example: '2026-12-01', nullable: true, type: String })
  start_date: string | null;

  @ApiProperty({ example: '2027-02-28', nullable: true, type: String })
  end_date: string | null;

  @ApiProperty({ enum: DAY_PARTS, nullable: true, example: 'custom' })
  day_part: DayPart | null;

  @ApiProperty({ example: 'every Mon, Wed, 4:00 PM – 5:00 PM, 1 Dec to 28 Feb', description: 'Ready to show' })
  when: string;

  @ApiProperty({ type: [SpecialClassStudentDto] })
  students: SpecialClassStudentDto[];

  @ApiProperty({
    type: SpecialAttendanceSummaryDto,
    nullable: true,
    description: 'Parent app: the child\u2019s attendance in this class. null elsewhere.',
  })
  attendance: SpecialAttendanceSummaryDto | null;
}

export class SpecialRosterStudentDto {
  @ApiProperty({ example: 41 })
  student_id: number;

  @ApiProperty({ example: 'Harini Narayanan' })
  full_name: string;

  @ApiProperty({ example: 12, nullable: true, type: Number })
  roll_no: number | null;

  @ApiProperty({
    enum: SPECIAL_ATTENDANCE,
    example: 'present',
    description: 'Saved status, or present when not taken yet',
  })
  status: SpecialAttendanceStatus;
}

export class SpecialRosterDto {
  @ApiProperty({ type: SpecialClassDto })
  special_class: SpecialClassDto;

  @ApiProperty({ example: '2026-12-02' })
  date: string;

  @ApiProperty({ example: true, description: 'false when the class does not run on this date' })
  runs_today: boolean;

  @ApiProperty({ example: false })
  marked: boolean;

  @ApiProperty({ type: [SpecialRosterStudentDto] })
  students: SpecialRosterStudentDto[];
}

export class SpecialRosterQueryDto {
  @ApiProperty({ example: '2026-12-02' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be a date in YYYY-MM-DD format' })
  date: string;
}

export class SpecialMarkItemDto {
  @ApiProperty({ example: 41 })
  @IsInt()
  student_id: number;

  @ApiProperty({ enum: SPECIAL_ATTENDANCE, example: 'absent' })
  @IsIn(SPECIAL_ATTENDANCE)
  status: SpecialAttendanceStatus;
}

export class SpecialMarkDto {
  @ApiProperty({ example: '2026-12-02' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be a date in YYYY-MM-DD format' })
  date: string;

  @ApiProperty({ type: [SpecialMarkItemDto], description: 'Students to mark; the rest stay present' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SpecialMarkItemDto)
  items: SpecialMarkItemDto[];
}

export class SpecialClassSettingsDto {
  @ApiProperty({
    type: [Number],
    nullable: true,
    example: [9, 10, 11, 12],
    description: 'Classes that can have a whole-class special class. null = every class.',
  })
  @ValidateIf((_dto, value) => value !== null)
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsInt({ each: true })
  class_ids: number[] | null;
}

export class SpecialClassSettingsResultDto {
  @ApiProperty({ type: [RefDto], description: 'Classes allowed; every class when all is true' })
  classes: RefDto[];

  @ApiProperty({ example: true })
  all: boolean;
}
