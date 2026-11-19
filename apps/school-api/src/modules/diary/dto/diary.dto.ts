import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ListQueryDto, PaginationDto } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { DIARY_REVIEW_MODES, DiaryReviewMode } from '../../schools/entities/school.entity';
import { FileDto } from '../../files/dto/file.dto';
import { RefDto } from '../../students/dto/student-response.dto';
import {
  DIARY_SCOPES,
  DIARY_STATUSES,
  DIARY_TYPES,
  DiaryScope,
  DiaryStatus,
  DiaryType,
} from '../entities/diary-entry.entity';
import { SUBMISSION_STATUSES, SubmissionStatus } from '../entities/diary-submission.entity';
import { MAX_ATTACHMENTS, MAX_STUDENTS } from '../diary.logic';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

class DiaryContentDto {
  @ApiProperty({ example: 'Exercise 4.2, questions 1 to 10', maxLength: 150 })
  @Transform(trim)
  @MaxLength(150)
  @IsString()
  @IsNotEmpty({ message: 'Enter a title' })
  title: string;

  @ApiProperty({ example: 'Write the answers in the maths notebook. Show every step.', maxLength: 2000 })
  @Transform(trim)
  @MaxLength(2000)
  @IsString()
  @IsNotEmpty({ message: 'Write the message for parents' })
  body: string;

  @ApiPropertyOptional({ example: 7, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @Min(1)
  @IsInt()
  subject_id?: number | null;

  @IsDateOnly('2026-11-12', true)
  @ValidateIf((_dto, value) => value !== null)
  due_date?: string | null;

  @ApiPropertyOptional({
    example: [41],
    type: Number,
    isArray: true,
    description: `Up to ${MAX_ATTACHMENTS} uploaded files`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTACHMENTS, { message: `Attach up to ${MAX_ATTACHMENTS} files` })
  @IsInt({ each: true })
  file_ids?: number[];
}

export class DiaryInputDto extends DiaryContentDto {
  @ApiProperty({ enum: DIARY_TYPES, example: 'homework' })
  @IsIn(DIARY_TYPES, { message: 'type must be homework, remark, feedback or note' })
  type: DiaryType;

  @ApiProperty({ enum: DIARY_SCOPES, example: 'section', description: 'Who receives it' })
  @IsIn(DIARY_SCOPES, { message: 'scope must be class, section or students' })
  scope: DiaryScope;

  @ApiPropertyOptional({ example: 3, description: 'scope=class: every section of the class (you must teach them all)' })
  @IsOptional()
  @Min(1)
  @IsInt()
  class_id?: number;

  @ApiPropertyOptional({ example: 4, description: 'scope=section' })
  @IsOptional()
  @Min(1)
  @IsInt()
  section_id?: number;

  @ApiPropertyOptional({
    example: [12, 15],
    type: Number,
    isArray: true,
    description: `scope=students: up to ${MAX_STUDENTS}`,
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  student_ids?: number[];
}

export class DiaryUpdateDto extends DiaryContentDto {}

export class DiaryReviewDto {
  @ApiProperty({ example: 'Please write this more kindly', maxLength: 255 })
  @Transform(trim)
  @MaxLength(255)
  @IsString()
  @IsNotEmpty({ message: 'Give the teacher a reason' })
  note: string;
}

export class DiaryOptionalNoteDto {
  @ApiPropertyOptional({ example: null, nullable: true, type: String, maxLength: 255 })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_dto, value) => value !== null)
  @MaxLength(255)
  @IsString()
  note?: string | null;
}

export class TeacherDiaryQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: DIARY_STATUSES })
  @IsOptional()
  @IsIn(DIARY_STATUSES)
  status?: DiaryStatus;

  @ApiPropertyOptional({ enum: DIARY_TYPES })
  @IsOptional()
  @IsIn(DIARY_TYPES)
  type?: DiaryType;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @IsInt()
  section_id?: number;
}

export class ParentDiaryQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: DIARY_TYPES })
  @IsOptional()
  @IsIn(DIARY_TYPES)
  type?: DiaryType;
}

export class DiaryQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: DIARY_STATUSES })
  @IsOptional()
  @IsIn(DIARY_STATUSES)
  status?: DiaryStatus;

  @ApiPropertyOptional({ enum: DIARY_TYPES })
  @IsOptional()
  @IsIn(DIARY_TYPES)
  type?: DiaryType;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @IsInt()
  class_id?: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @IsInt()
  section_id?: number;

  @ApiPropertyOptional({ example: 9, description: 'Teacher who posted it' })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @IsInt()
  author_user_id?: number;
}

export class DiaryReviewInfoDto {
  @ApiProperty({ type: RefDto, nullable: true })
  by: RefDto | null;

  @ApiProperty({ nullable: true, type: Date })
  at: Date | null;

  @ApiProperty({ nullable: true, type: String })
  note: string | null;
}

export class DiaryEntryDto {
  @ApiProperty({ example: 21 })
  id: number;

  @ApiProperty({ enum: DIARY_TYPES, example: 'homework' })
  type: DiaryType;

  @ApiProperty({ example: 'Exercise 4.2, questions 1 to 10' })
  title: string;

  @ApiProperty({ example: 'Write the answers in the maths notebook.' })
  body: string;

  @ApiProperty({ example: '2026-11-12', nullable: true, type: String })
  due_date: string | null;

  @ApiProperty({ type: RefDto, nullable: true })
  subject: RefDto | null;

  @ApiProperty({ enum: DIARY_SCOPES, example: 'section' })
  scope: DiaryScope;

  @ApiProperty({ example: '6 - A', description: 'Who it was sent to' })
  target_label: string;

  @ApiProperty({ type: RefDto, nullable: true })
  class: RefDto | null;

  @ApiProperty({ type: RefDto, nullable: true })
  section: RefDto | null;

  @ApiProperty({ type: RefDto, description: 'Teacher who posted it' })
  author: RefDto;

  @ApiProperty({ enum: DIARY_STATUSES, example: 'published' })
  status: DiaryStatus;

  @ApiProperty({ type: DiaryReviewInfoDto })
  review: DiaryReviewInfoDto;

  @ApiProperty({ nullable: true, type: Date })
  published_at: Date | null;

  @ApiProperty({ type: FileDto, isArray: true })
  attachments: FileDto[];

  @ApiProperty({ example: 38, description: 'Students it reaches' })
  recipient_count: number;

  @ApiProperty({ example: 21, description: 'Children whose parent has opened it' })
  seen_count: number;

  @ApiPropertyOptional({ example: 25, description: 'How many students submitted homework' })
  submission_count?: number;

  @ApiPropertyOptional({ example: 20, description: 'How many submissions graded' })
  graded_count?: number;

  @ApiProperty({ type: RefDto })
  academic_year: RefDto;

  @ApiProperty({ example: '2026-11-04T09:12:00.000+05:30' })
  created_at: Date;
}

export class DiaryRecipientDto {
  @ApiProperty({ type: RefDto })
  student: RefDto;

  @ApiProperty({ example: '6 - A', nullable: true, type: String })
  class_section: string | null;

  @ApiProperty({ nullable: true, type: Date })
  seen_at: Date | null;

  @ApiProperty({ type: RefDto, nullable: true, description: 'Parent who opened it' })
  seen_by: RefDto | null;
}

export class DiaryDetailDto extends DiaryEntryDto {
  @ApiProperty({ type: DiaryRecipientDto, isArray: true })
  recipients: DiaryRecipientDto[];
}

export class DiaryFeedItemDto {
  @ApiProperty({ example: 21 })
  id: number;

  @ApiProperty({ enum: DIARY_TYPES, example: 'homework' })
  type: DiaryType;

  @ApiProperty({ example: 'Exercise 4.2, questions 1 to 10' })
  title: string;

  @ApiProperty({ example: 'Write the answers in the maths notebook.' })
  body: string;

  @ApiProperty({ example: '2026-11-12', nullable: true, type: String })
  due_date: string | null;

  @ApiProperty({ type: RefDto, nullable: true })
  subject: RefDto | null;

  @ApiProperty({ type: RefDto, description: 'Teacher who posted it' })
  teacher: RefDto;

  @ApiProperty({ type: FileDto, isArray: true })
  attachments: FileDto[];

  @ApiProperty({ example: '2026-11-04T09:12:00.000+05:30' })
  published_at: Date;

  @ApiProperty({ example: false })
  seen: boolean;

  @ApiProperty({ nullable: true, type: Date })
  seen_at: Date | null;

  @ApiPropertyOptional({ type: () => DiarySubmissionDto, nullable: true })
  submission?: DiarySubmissionDto | null;
}

export class SubmitHomeworkDto {
  @ApiPropertyOptional({
    example: [52, 53],
    type: Number,
    isArray: true,
    description: `Up to ${MAX_ATTACHMENTS} uploaded notebook photos or files`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTACHMENTS, { message: `Attach up to ${MAX_ATTACHMENTS} files` })
  @IsInt({ each: true })
  file_ids?: number[];

  @ApiPropertyOptional({ example: 'Completed exercises 1 to 5.', maxLength: 1000 })
  @IsOptional()
  @Transform(trimToNull)
  @MaxLength(1000)
  @IsString()
  student_notes?: string | null;
}

export class GradeHomeworkDto {
  @ApiProperty({ enum: ['graded', 'resubmit_requested'], example: 'graded' })
  @IsIn(['graded', 'resubmit_requested'], { message: 'status must be graded or resubmit_requested' })
  status: 'graded' | 'resubmit_requested';

  @ApiPropertyOptional({ example: 'A+', maxLength: 10 })
  @IsOptional()
  @Transform(trimToNull)
  @MaxLength(10)
  @IsString()
  grade?: string | null;

  @ApiPropertyOptional({ example: 9.5 })
  @IsOptional()
  @Min(0)
  @IsNumber()
  marks?: number | null;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Min(0)
  @IsNumber()
  max_marks?: number | null;

  @ApiPropertyOptional({ example: 'Very good handwriting. Check question 4 calculation again.', maxLength: 1000 })
  @IsOptional()
  @Transform(trimToNull)
  @MaxLength(1000)
  @IsString()
  teacher_feedback?: string | null;
}

export class DiarySubmissionDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 21 })
  entry_id: number;

  @ApiProperty({ example: 101 })
  student_id: number;

  @ApiProperty({ example: 'Aadhavan Senthil' })
  student_name: string;

  @ApiProperty({ example: '6 - A', nullable: true })
  class_section: string | null;

  @ApiProperty({ example: '2026-11-12T14:30:00.000Z' })
  submitted_at: Date;

  @ApiProperty({ example: false })
  is_late: boolean;

  @ApiProperty({ example: 'Finished all sums', nullable: true })
  student_notes: string | null;

  @ApiProperty({ enum: SUBMISSION_STATUSES, example: 'graded' })
  status: SubmissionStatus;

  @ApiProperty({ example: 'A', nullable: true })
  grade: string | null;

  @ApiProperty({ example: 9, nullable: true })
  marks: number | null;

  @ApiProperty({ example: 10, nullable: true })
  max_marks: number | null;

  @ApiProperty({ example: 'Well done!', nullable: true })
  teacher_feedback: string | null;

  @ApiProperty({ type: RefDto, nullable: true })
  graded_by: RefDto | null;

  @ApiProperty({ nullable: true })
  graded_at: Date | null;

  @ApiProperty({ type: FileDto, isArray: true })
  attachments: FileDto[];
}

export class DiaryInsightsDto {
  @ApiProperty({ example: 3 })
  pending_review: number;

  @ApiProperty({ example: 12 })
  published_today: number;

  @ApiProperty({ example: 140 })
  published: number;

  @ApiProperty({ example: 2 })
  rejected: number;

  @ApiProperty({ example: 1 })
  hidden: number;

  @ApiProperty({ example: 9, description: 'Published homework due in the next 7 days' })
  homework_due_this_week: number;

  @ApiProperty({ enum: DIARY_REVIEW_MODES, example: 'remarks', description: 'The school setting in force' })
  review_mode: DiaryReviewMode;
}
