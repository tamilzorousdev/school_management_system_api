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
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { RefDto } from '../../students/dto/student-response.dto';
import { EXAM_STATUSES, ExamStatus } from '../entities/exam.entity';
import { ResultStatus } from '../exam-results';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ExamQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: EXAM_STATUSES })
  @IsOptional()
  @IsIn(EXAM_STATUSES)
  status?: ExamStatus;

  @ApiPropertyOptional({ example: 2, description: 'Defaults to every year' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  academic_year_id?: number;
}

export class ExamSubjectInputDto {
  @ApiProperty({ example: 6 })
  @IsInt()
  class_id: number;

  @ApiProperty({ example: 4 })
  @IsInt()
  subject_id: number;

  @ApiProperty({ example: 100 })
  @IsInt()
  @Min(1)
  @Max(500)
  max_marks: number;

  @ApiProperty({ example: 35 })
  @IsInt()
  @Min(0)
  @Max(500)
  pass_marks: number;

  @IsDateOnly('2026-09-15', true)
  exam_date?: string | null;
}

export class ExamInputDto {
  @ApiProperty({ example: 'Quarterly exam' })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name: string;

  @ApiPropertyOptional({ example: 2, description: 'Defaults to the current academic year' })
  @IsOptional()
  @IsInt()
  academic_year_id?: number;

  @ApiPropertyOptional({ example: 3, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  term_id?: number | null;

  @IsDateOnly('2026-09-14')
  start_date: string;

  @IsDateOnly('2026-09-24')
  end_date: string;

  @ApiProperty({
    example: [6, 7, 8],
    description: 'Classes that write this exam. Subjects come from each class’s subjects (activities left out).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsInt({ each: true })
  class_ids: number[];

  @ApiPropertyOptional({
    type: [ExamSubjectInputDto],
    description: 'Specific subject exam dates, max marks and pass marks',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExamSubjectInputDto)
  subjects?: ExamSubjectInputDto[];
}

export class UpdateExamDto {
  @ApiPropertyOptional({ example: 'Quarterly exam' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name?: string;

  @ApiPropertyOptional({ example: 3, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  term_id?: number | null;

  @IsDateOnly('2026-09-14', true)
  start_date?: string;

  @IsDateOnly('2026-09-24', true)
  end_date?: string;

  @ApiPropertyOptional({
    example: [6, 7, 8],
    description: 'Add or remove classes. A class that already has marks cannot be removed.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsInt({ each: true })
  class_ids?: number[];

  @ApiPropertyOptional({
    type: [ExamSubjectInputDto],
    description: 'Specific subject exam dates, max marks and pass marks',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExamSubjectInputDto)
  subjects?: ExamSubjectInputDto[];
}

export class ExamSubjectsInputDto {
  @ApiProperty({
    type: [ExamSubjectInputDto],
    description: 'The full list. Rows left out are removed; a subject with marks cannot be removed.',
  })
  @IsArray()
  @ArrayMaxSize(400)
  @ValidateNested({ each: true })
  @Type(() => ExamSubjectInputDto)
  items: ExamSubjectInputDto[];
}

export class MarksQueryDto {
  @ApiProperty({ example: 4 })
  @Type(() => Number)
  @IsInt()
  subject_id: number;
}

export class MarkEntryDto {
  @ApiProperty({ example: 12 })
  @IsInt()
  student_id: number;

  @ApiProperty({ example: 78.5, nullable: true, type: Number, description: 'null with is_absent false clears it' })
  @ValidateIf((_dto, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  marks: number | null;

  @ApiProperty({ example: false })
  @IsBoolean()
  is_absent: boolean;
}

export class SaveMarksDto {
  @ApiProperty({ type: [MarkEntryDto], description: 'Students of the section, each at most once' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => MarkEntryDto)
  items: MarkEntryDto[];
}

export class ToppersQueryDto {
  @ApiPropertyOptional({ example: 3, default: 3, minimum: 1, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}

export class RankingQueryDto {
  @ApiPropertyOptional({ example: 1, description: 'Defaults to the latest published exam of the section’s class' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  exam_id?: number;
}

export class ExamDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Quarterly exam' })
  name: string;

  @ApiProperty({ type: RefDto })
  academic_year: RefDto;

  @ApiProperty({ type: RefDto, nullable: true })
  term: RefDto | null;

  @ApiProperty({ example: '2026-09-14' })
  start_date: string;

  @ApiProperty({ example: '2026-09-24' })
  end_date: string;

  @ApiProperty({ enum: EXAM_STATUSES, example: 'published' })
  status: ExamStatus;

  @ApiProperty({ example: '2026-10-03T10:30:00.000+05:30', nullable: true, type: String })
  published_at: Date | null;

  @ApiProperty({ type: [RefDto], description: 'Classes writing this exam' })
  classes: RefDto[];

  @ApiProperty({ example: 18, description: 'Class and subject papers' })
  paper_count: number;

  @ApiProperty({ example: 210, description: 'Marks entered (absent counts as entered)' })
  marks_entered: number;

  @ApiProperty({ example: 216, description: 'Marks expected: every paper times the students of its class' })
  marks_expected: number;

  @ApiProperty({ example: '2026-09-01T09:00:00.000+05:30' })
  created_at: Date;
}

export class ExamSubjectDto {
  @ApiProperty({ example: 11 })
  id: number;

  @ApiProperty({ type: RefDto })
  class: RefDto;

  @ApiProperty({ example: 4 })
  subject_id: number;

  @ApiProperty({ example: 'Mathematics' })
  subject_name: string;

  @ApiProperty({ example: 'MATH' })
  subject_code: string;

  @ApiProperty({ example: 100 })
  max_marks: number;

  @ApiProperty({ example: 35 })
  pass_marks: number;

  @ApiProperty({ example: '2026-09-16', nullable: true, type: String })
  exam_date: string | null;

  @ApiProperty({ example: 15, description: 'Students with marks entered for this paper' })
  marks_entered: number;
}

export class ExamSectionDto {
  @ApiProperty({ example: 8 })
  id: number;

  @ApiProperty({ example: 'A' })
  name: string;

  @ApiProperty({ example: 9 })
  student_count: number;
}

export class ExamClassDto {
  @ApiProperty({ example: 6 })
  id: number;

  @ApiProperty({ example: '6' })
  name: string;

  @ApiProperty({ type: [ExamSectionDto] })
  sections: ExamSectionDto[];

  @ApiProperty({ type: [ExamSubjectDto] })
  subjects: ExamSubjectDto[];
}

export class ExamDetailDto extends ExamDto {
  @ApiProperty({ type: [ExamClassDto] })
  class_details: ExamClassDto[];
}

export class MarkSubjectDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 'Mathematics' })
  name: string;

  @ApiProperty({ example: 'MATH' })
  code: string;

  @ApiProperty({ example: 100 })
  max_marks: number;

  @ApiProperty({ example: 35 })
  pass_marks: number;

  @ApiProperty({ example: '2026-09-16', nullable: true, type: String })
  exam_date: string | null;
}

export class SectionRefDto {
  @ApiProperty({ example: 8 })
  id: number;

  @ApiProperty({ example: '6 - A' })
  name: string;

  @ApiProperty({ example: 6 })
  class_id: number;

  @ApiProperty({ example: '6' })
  class_name: string;

  @ApiProperty({ example: 'A' })
  section_name: string;
}

export class ExamRefDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Quarterly exam' })
  name: string;

  @ApiProperty({ enum: EXAM_STATUSES, example: 'published' })
  status: ExamStatus;

  @ApiProperty({ example: '2026-09-14' })
  start_date: string;

  @ApiProperty({ example: '2026-09-24' })
  end_date: string;

  @ApiProperty({ example: '2026-10-03T10:30:00.000+05:30', nullable: true, type: String })
  published_at: Date | null;
}

export class MarkRowDto {
  @ApiProperty({ example: 12 })
  student_id: number;

  @ApiProperty({ example: 'TZMS-2026-0012' })
  admission_no: string;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ example: 12, nullable: true, type: Number })
  roll_no: number | null;

  @ApiProperty({ example: 78.5, nullable: true, type: Number })
  marks: number | null;

  @ApiProperty({ example: false })
  is_absent: boolean;

  @ApiProperty({ example: true, description: 'false until marks or absent are saved' })
  entered: boolean;
}

export class MarksSheetDto {
  @ApiProperty({ type: ExamRefDto })
  exam: ExamRefDto;

  @ApiProperty({ type: SectionRefDto })
  section: SectionRefDto;

  @ApiProperty({ type: MarkSubjectDto })
  subject: MarkSubjectDto;

  @ApiPropertyOptional({ type: RefDto, nullable: true })
  teacher?: RefDto | null;

  @ApiPropertyOptional({ type: RefDto, nullable: true })
  class_teacher?: RefDto | null;

  @ApiProperty({ example: true, description: 'true only if caller is the assigned class or subject teacher' })
  editable: boolean;

  @ApiProperty({ example: 8 })
  entered: number;

  @ApiProperty({ example: 9 })
  total: number;

  @ApiProperty({ type: [MarkRowDto] })
  students: MarkRowDto[];
}

export class SubjectResultDto {
  @ApiProperty({ example: 4 })
  subject_id: number;

  @ApiProperty({ example: 92, nullable: true, type: Number })
  marks: number | null;

  @ApiProperty({ example: false })
  is_absent: boolean;

  @ApiProperty({ example: true, nullable: true, type: Boolean, description: 'null while not entered' })
  passed: boolean | null;
}

export class ResultRowDto {
  @ApiProperty({ example: 12 })
  student_id: number;

  @ApiProperty({ example: 'TZMS-2026-0012' })
  admission_no: string;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ example: 12, nullable: true, type: Number })
  roll_no: number | null;

  @ApiProperty({ example: 8 })
  section_id: number;

  @ApiProperty({ example: 'A' })
  section_name: string;

  @ApiProperty({ example: 452 })
  total: number;

  @ApiProperty({ example: 500 })
  max_total: number;

  @ApiProperty({ example: 90.4, nullable: true, type: Number, description: 'null while incomplete' })
  percent: number | null;

  @ApiProperty({ example: 'A2', nullable: true, type: String })
  grade: string | null;

  @ApiProperty({ enum: ['pass', 'fail', 'incomplete'], example: 'pass' })
  result: ResultStatus;

  @ApiProperty({ example: 1, nullable: true, type: Number, description: 'Competition ranking (1, 2, 2, 4) on total' })
  section_rank: number | null;

  @ApiProperty({ example: 2, nullable: true, type: Number })
  class_rank: number | null;

  @ApiPropertyOptional({ example: 94.5, nullable: true, type: Number })
  percentile?: number | null;

  @ApiProperty({ type: [SubjectResultDto] })
  subjects: SubjectResultDto[];
}

export class ResultSummaryDto {
  @ApiProperty({ example: 9 })
  students: number;

  @ApiProperty({ example: 8 })
  ranked: number;

  @ApiProperty({ example: 7 })
  passed: number;

  @ApiProperty({ example: 1 })
  failed: number;

  @ApiProperty({ example: 1 })
  incomplete: number;

  @ApiProperty({ example: 74.6, nullable: true, type: Number })
  average_percent: number | null;

  @ApiProperty({ example: 96.2, nullable: true, type: Number })
  highest_percent: number | null;
}

export class SectionResultsDto {
  @ApiProperty({ type: ExamRefDto })
  exam: ExamRefDto;

  @ApiProperty({ type: SectionRefDto })
  section: SectionRefDto;

  @ApiProperty({ type: [MarkSubjectDto] })
  subjects: MarkSubjectDto[];

  @ApiProperty({ type: ResultSummaryDto })
  summary: ResultSummaryDto;

  @ApiProperty({ type: [ResultRowDto], description: 'Ranked students first by rank, then incomplete by roll number' })
  rows: ResultRowDto[];
}

export class TopperDto {
  @ApiProperty({ example: 1 })
  rank: number;

  @ApiProperty({ example: 12 })
  student_id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ example: 'TZMS-2026-0012' })
  admission_no: string;

  @ApiProperty({ example: 8 })
  section_id: number;

  @ApiProperty({ example: 'A' })
  section_name: string;

  @ApiProperty({ example: 481 })
  total: number;

  @ApiProperty({ example: 500 })
  max_total: number;

  @ApiProperty({ example: 96.2 })
  percent: number;

  @ApiProperty({ example: 'A1' })
  grade: string;
}

export class ClassToppersDto {
  @ApiProperty({ example: 6 })
  class_id: number;

  @ApiProperty({ example: '6' })
  class_name: string;

  @ApiProperty({ example: 15 })
  students: number;

  @ApiProperty({ type: [TopperDto], description: 'Class rank up to the limit; a tie can add one more' })
  toppers: TopperDto[];
}

export class ExamToppersDto {
  @ApiProperty({ type: ExamRefDto })
  exam: ExamRefDto;

  @ApiProperty({ type: [ClassToppersDto] })
  classes: ClassToppersDto[];
}

export class StudentSubjectResultDto extends SubjectResultDto {
  @ApiProperty({ example: 'Mathematics' })
  name: string;

  @ApiProperty({ example: 'MATH' })
  code: string;

  @ApiProperty({ example: 100 })
  max_marks: number;

  @ApiProperty({ example: 35 })
  pass_marks: number;
}

export class StudentExamResultDto {
  @ApiProperty({ type: ExamRefDto })
  exam: ExamRefDto;

  @ApiProperty({ example: '6' })
  class_name: string;

  @ApiProperty({ example: 'A' })
  section_name: string;

  @ApiProperty({ example: 452 })
  total: number;

  @ApiProperty({ example: 500 })
  max_total: number;

  @ApiProperty({ example: 90.4, nullable: true, type: Number })
  percent: number | null;

  @ApiProperty({ example: 'A2', nullable: true, type: String })
  grade: string | null;

  @ApiProperty({ enum: ['pass', 'fail', 'incomplete'], example: 'pass' })
  result: ResultStatus;

  @ApiProperty({ example: 1, nullable: true, type: Number })
  section_rank: number | null;

  @ApiProperty({ example: 9 })
  section_size: number;

  @ApiProperty({ example: 2, nullable: true, type: Number })
  class_rank: number | null;

  @ApiProperty({ example: 15 })
  class_size: number;

  @ApiPropertyOptional({ example: 94.5, nullable: true, type: Number })
  percentile?: number | null;

  @ApiProperty({ type: [StudentSubjectResultDto] })
  subjects: StudentSubjectResultDto[];
}

export class TeacherExamSubjectDto {
  @ApiProperty({ example: 4 })
  subject_id: number;

  @ApiProperty({ example: 'Mathematics' })
  name: string;

  @ApiProperty({ example: 'MATH' })
  code: string;

  @ApiProperty({ example: 100 })
  max_marks: number;

  @ApiProperty({ example: '2026-09-16', nullable: true, type: String })
  exam_date: string | null;

  @ApiProperty({ example: 8 })
  entered: number;

  @ApiProperty({ example: 9 })
  total: number;
}

export class TeacherExamSectionDto {
  @ApiProperty({ example: 8 })
  section_id: number;

  @ApiProperty({ example: '6' })
  class_name: string;

  @ApiProperty({ example: 'A' })
  section_name: string;

  @ApiProperty({ example: true })
  is_class_teacher: boolean;

  @ApiProperty({ type: [TeacherExamSubjectDto], description: 'Subjects I can enter marks for' })
  subjects: TeacherExamSubjectDto[];
}

export class TeacherExamDto extends ExamRefDto {
  @ApiProperty({ type: [TeacherExamSectionDto] })
  sections: TeacherExamSectionDto[];
}

export class RankingRowDto {
  @ApiProperty({ example: 1, nullable: true, type: Number, description: 'null while incomplete' })
  rank: number | null;

  @ApiProperty({ example: 12 })
  student_id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ example: 12, nullable: true, type: Number })
  roll_no: number | null;

  @ApiProperty({ example: 452 })
  total: number;

  @ApiProperty({ example: 500 })
  max_total: number;

  @ApiProperty({ example: 90.4, nullable: true, type: Number })
  percent: number | null;

  @ApiProperty({ example: 'A2', nullable: true, type: String })
  grade: string | null;

  @ApiProperty({ enum: ['pass', 'fail', 'incomplete'], example: 'pass' })
  result: ResultStatus;

  @ApiProperty({ example: 2, nullable: true, type: Number })
  class_rank: number | null;

  @ApiPropertyOptional({ example: 94.5, nullable: true, type: Number })
  percentile?: number | null;
}

export class SectionRankingDto {
  @ApiProperty({ type: ExamRefDto, nullable: true, description: 'null when the class has no published exam yet' })
  exam: ExamRefDto | null;

  @ApiProperty({ type: SectionRefDto })
  section: SectionRefDto;

  @ApiProperty({ type: [RankingRowDto] })
  rows: RankingRowDto[];
}
