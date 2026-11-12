import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { RefDto } from '../../students/dto/student-response.dto';

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

export class BelowAverageQueryDto {
  @ApiPropertyOptional({ example: 3, description: 'One published exam. Leave out for every published exam this year.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  exam_id?: number;

  @ApiPropertyOptional({
    example: 50,
    description: 'Show students below this result %. Leave out to use the section average.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  below?: number;
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

  @ApiProperty({ type: [BelowAverageStudentDto], description: 'Lowest first' })
  students: BelowAverageStudentDto[];
}

export class SpecialClassInputDto {
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

  @ApiProperty({ example: 31, description: 'Teacher who takes the special class' })
  @IsInt()
  @Min(1)
  teacher_user_id: number;

  @ApiProperty({ example: 3, description: '1 = Monday ... 6 = Saturday' })
  @IsInt()
  @Min(1)
  @Max(6)
  day_of_week: number;

  @ApiProperty({ example: 7, description: 'Period of the bell schedule kept for the special class every week' })
  @IsInt()
  @Min(1)
  @Max(12)
  period_no: number;

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

  @ApiProperty({ type: [Number], example: [41, 44, 52], description: 'Students of this section who attend' })
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one student' })
  @ArrayMaxSize(60)
  @ArrayUnique()
  @IsInt({ each: true })
  student_ids: number[];
}

export class UpdateSpecialClassDto extends PartialType(SpecialClassInputDto) {}

export class SpecialClassQueryDto {
  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  section_id?: number;
}

export class SpecialClassStudentDto {
  @ApiProperty({ example: 41 })
  id: number;

  @ApiProperty({ example: 'Harini Narayanan' })
  name: string;

  @ApiProperty({ example: 12, nullable: true, type: Number })
  roll_no: number | null;
}

export class SpecialClassDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'Maths support' })
  title: string;

  @ApiProperty({ example: 'Fractions and decimals', nullable: true, type: String })
  notes: string | null;

  @ApiProperty({ type: RefDto, description: 'Section, for example 6 - A' })
  section: RefDto;

  @ApiProperty({ type: RefDto, nullable: true })
  subject: RefDto | null;

  @ApiProperty({ type: RefDto })
  teacher: RefDto;

  @ApiProperty({ example: 3 })
  day_of_week: number;

  @ApiProperty({ example: 'Wednesday' })
  day: string;

  @ApiProperty({ example: 7 })
  period_no: number;

  @ApiProperty({ example: '14:30', nullable: true, type: String })
  start_time: string | null;

  @ApiProperty({ example: '15:15', nullable: true, type: String })
  end_time: string | null;

  @ApiProperty({ type: [SpecialClassStudentDto] })
  students: SpecialClassStudentDto[];
}
