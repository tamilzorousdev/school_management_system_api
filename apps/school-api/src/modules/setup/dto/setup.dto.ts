import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
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
import { RefDto } from '../../students/dto/student-response.dto';
import { HOLIDAY_TYPES, HolidayType } from '../entities/holiday.entity';
import { SUBJECT_TYPES, SubjectType } from '../entities/subject.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : typeof value === 'string' ? value.trim() : value;

export class AcademicYearInputDto {
  @ApiProperty({ example: '2026-27' })
  @Transform(trim)
  @Matches(/^\d{4}-\d{2,4}$/, { message: 'name must look like 2026-27' })
  name: string;

  @IsDateOnly('2026-06-01')
  start_date: string;

  @IsDateOnly('2027-04-30')
  end_date: string;

  @ApiPropertyOptional({ description: 'Make this the current year. The previous current year is switched off.' })
  @IsOptional()
  @IsBoolean()
  is_current?: boolean;
}

export class UpdateAcademicYearDto extends PartialType(AcademicYearInputDto) {}

export class TermInputDto {
  @ApiProperty({ example: 'Term 1' })
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  name: string;

  @IsDateOnly('2026-06-01')
  start_date: string;

  @IsDateOnly('2026-09-30')
  end_date: string;
}

export class UpdateTermDto extends PartialType(TermInputDto) {}

export class TermDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Term 1' })
  name: string;

  @ApiProperty({ example: '2026-06-01' })
  start_date: string;

  @ApiProperty({ example: '2026-09-30' })
  end_date: string;

  @ApiProperty({ example: 1 })
  sort_order: number;
}

export class AcademicYearDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: '2026-27' })
  name: string;

  @ApiProperty({ example: '2026-06-01' })
  start_date: string;

  @ApiProperty({ example: '2027-04-30' })
  end_date: string;

  @ApiProperty()
  is_current: boolean;

  @ApiProperty({ type: [TermDto] })
  terms: TermDto[];
}

export class ClassInputDto {
  @ApiProperty({ example: '6', description: 'LKG, UKG, 1 to 12 or any name the school uses' })
  @Transform(trim)
  @IsString()
  @Length(1, 30)
  name: string;

  @ApiProperty({ example: 6, description: 'Sort order: LKG -1, UKG 0, then 1 to 12' })
  @IsInt()
  @Min(-3)
  @Max(20)
  grade_level: number;
}

export class UpdateClassDto extends PartialType(ClassInputDto) {}

export class SectionInputDto {
  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(1)
  class_id: number;

  @ApiProperty({ example: 'A' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9]{1,10}$/, { message: 'name must be 1 to 10 letters or digits, for example A' })
  name: string;

  @ApiPropertyOptional({ example: 'Block B · 204', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(30)
  room?: string | null;

  @ApiPropertyOptional({ example: 40 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  capacity?: number;

  @ApiPropertyOptional({ example: 5, nullable: true, type: Number, description: 'User id of a teacher in this school' })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(1)
  class_teacher_user_id?: number | null;

  @ApiPropertyOptional({ example: 1, description: 'Defaults to the current academic year' })
  @IsOptional()
  @IsInt()
  @Min(1)
  academic_year_id?: number;
}

export class UpdateSectionDto extends PartialType(SectionInputDto) {}

export class YearQueryDto {
  @ApiPropertyOptional({ example: 1, description: 'Defaults to the current academic year' })
  @IsOptional()
  @IsInt()
  @Min(1)
  academic_year_id?: number;
}

export class SectionQueryDto extends YearQueryDto {
  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  class_id?: number;
}

export class PersonRefDto {
  @ApiProperty({ example: 5 })
  id: number;

  @ApiProperty({ example: 'Priya Venkatesh' })
  name: string;
}

export class SectionDto {
  @ApiProperty({ example: 11 })
  id: number;

  @ApiProperty({ example: 4 })
  class_id: number;

  @ApiProperty({ example: '6' })
  class_name: string;

  @ApiProperty({ example: 'A' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  room: string | null;

  @ApiProperty({ example: 40 })
  capacity: number;

  @ApiProperty({ type: PersonRefDto, nullable: true })
  class_teacher: PersonRefDto | null;

  @ApiProperty({ example: 32 })
  student_count: number;
}

export class ClassDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: '6' })
  name: string;

  @ApiProperty({ example: 6 })
  grade_level: number;

  @ApiProperty({ example: 64 })
  student_count: number;

  @ApiProperty({ type: [SectionDto] })
  sections: SectionDto[];
}

export class SubjectInputDto {
  @ApiProperty({ example: 'MATH' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9_-]{2,20}$/, { message: 'code must be 2 to 20 letters, digits, _ or -' })
  code: string;

  @ApiProperty({ example: 'Mathematics' })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name: string;

  @ApiPropertyOptional({ enum: SUBJECT_TYPES, default: 'theory' })
  @IsOptional()
  @IsIn(SUBJECT_TYPES)
  type?: SubjectType;
}

export class UpdateSubjectDto extends PartialType(SubjectInputDto) {}

export class SubjectQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: SUBJECT_TYPES })
  @IsOptional()
  @IsIn(SUBJECT_TYPES)
  type?: SubjectType;
}

export class SubjectDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'MATH' })
  code: string;

  @ApiProperty({ example: 'Mathematics' })
  name: string;

  @ApiProperty({ enum: SUBJECT_TYPES })
  type: SubjectType;

  @ApiProperty({ example: 8, description: 'Classes that take this subject in the current year' })
  class_count: number;
}

export class ClassSubjectItemDto {
  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  subject_id: number;

  @ApiPropertyOptional({ example: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  periods_per_week?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  is_optional?: boolean;
}

export class SetClassSubjectsDto {
  @ApiPropertyOptional({ example: 1, description: 'Defaults to the current academic year' })
  @IsOptional()
  @IsInt()
  @Min(1)
  academic_year_id?: number;

  @ApiProperty({ type: [ClassSubjectItemDto], description: 'Replaces the whole list for this class and year' })
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ClassSubjectItemDto)
  items: ClassSubjectItemDto[];
}

export class ClassSubjectDto {
  @ApiProperty({ example: 3 })
  subject_id: number;

  @ApiProperty({ example: 'MATH' })
  code: string;

  @ApiProperty({ example: 'Mathematics' })
  name: string;

  @ApiProperty({ enum: SUBJECT_TYPES })
  type: SubjectType;

  @ApiProperty({ example: 6 })
  periods_per_week: number;

  @ApiProperty()
  is_optional: boolean;
}

export class HolidayInputDto {
  @IsDateOnly('2026-11-08')
  date: string;

  @ApiPropertyOptional({
    example: '2026-11-09',
    nullable: true,
    type: String,
    description: 'Last day for a multi-day holiday',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_object, value) => value !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'end_date must be a date in YYYY-MM-DD format' })
  end_date?: string | null;

  @ApiProperty({ example: 'Deepavali' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiPropertyOptional({ enum: HOLIDAY_TYPES, default: 'holiday' })
  @IsOptional()
  @IsIn(HOLIDAY_TYPES)
  type?: HolidayType;

  @ApiPropertyOptional({
    type: [Number],
    nullable: true,
    example: [11, 12],
    description:
      'Only these classes are off (for example study leave). Leave out or null for the whole school. Attendance is not expected from these classes on these days.',
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one class, or leave it empty for the whole school' })
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsInt({ each: true })
  class_ids?: number[] | null;
}

export class UpdateHolidayDto extends PartialType(HolidayInputDto) {}

export class HolidayQueryDto {
  @IsDateOnly('2026-06-01', true)
  from?: string;

  @IsDateOnly('2027-04-30', true)
  to?: string;

  @ApiPropertyOptional({ enum: HOLIDAY_TYPES })
  @IsOptional()
  @IsIn(HOLIDAY_TYPES)
  type?: HolidayType;

  @ApiPropertyOptional({ description: 'true: only today and later' })
  @IsOptional()
  @Transform(toBoolean)
  @IsIn([true, false])
  upcoming?: boolean;
}

export class HolidayDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: '2026-11-08' })
  date: string;

  @ApiProperty({ example: '2026-11-09', nullable: true, type: String })
  end_date: string | null;

  @ApiProperty({ example: 'Deepavali' })
  name: string;

  @ApiProperty({ enum: HOLIDAY_TYPES })
  type: HolidayType;

  @ApiProperty({ example: 2 })
  days: number;

  @ApiProperty({ example: true, description: 'false when only some classes are off' })
  whole_school: boolean;

  @ApiProperty({
    type: [RefDto],
    example: [{ id: 11, name: '10' }],
    description: 'Classes that are off; empty for the whole school',
  })
  classes: RefDto[];
}

export class MobileHolidayDto extends HolidayDto {
  @ApiPropertyOptional({ example: 2, description: 'Days remaining until this holiday begins (null for past holidays)' })
  days_until?: number | null;
}

export class MobileHolidayOverviewDto {
  @ApiPropertyOptional({ type: MobileHolidayDto, nullable: true, description: 'The next upcoming holiday' })
  next_holiday: MobileHolidayDto | null;

  @ApiProperty({ type: [MobileHolidayDto], description: 'Upcoming holidays from today onward' })
  upcoming: MobileHolidayDto[];

  @ApiProperty({ type: [MobileHolidayDto], description: 'All holidays for the school year' })
  all: MobileHolidayDto[];
}

export class SetupSummaryDto {
  @ApiProperty({ type: AcademicYearDto, nullable: true })
  current_year: AcademicYearDto | null;

  @ApiProperty({ example: 14 })
  classes: number;

  @ApiProperty({ example: 22 })
  sections: number;

  @ApiProperty({ example: 12 })
  subjects: number;

  @ApiProperty({ example: 3, description: 'Sections without a class teacher' })
  sections_without_teacher: number;

  @ApiProperty({ type: HolidayDto, nullable: true })
  next_holiday: HolidayDto | null;
}
