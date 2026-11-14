import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ListQueryDto } from '@app/common';
import { RefDto } from '../../students/dto/student-response.dto';
import { BEHAVIOURS, Behaviour, RATING_CYCLES } from '../entities/feedback.entity';

export class FeedbackSettingsInputDto {
  @ApiPropertyOptional({ example: true, description: 'Parents can rate their child’s teachers' })
  @IsOptional()
  @IsBoolean()
  teacher_rating_enabled?: boolean;

  @ApiPropertyOptional({
    enum: RATING_CYCLES,
    example: 3,
    description: 'How often a parent can rate the same teacher: every 1, 2, 3, 6 or 12 months',
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(RATING_CYCLES, { message: 'teacher_rating_months must be 1, 2, 3, 6 or 12' })
  teacher_rating_months?: number;

  @ApiPropertyOptional({ example: true, description: 'Teachers can give each student feedback once a term' })
  @IsOptional()
  @IsBoolean()
  student_feedback_enabled?: boolean;
}

export class PeriodDto {
  @ApiProperty({ example: '2026-09-01' })
  start: string;

  @ApiProperty({ example: '2026-11-30' })
  end: string;
}

export class TermRefDto extends PeriodDto {
  @ApiProperty({ example: 2, description: '0 when the year has no terms (the whole year counts as one)' })
  id: number;

  @ApiProperty({ example: 'Term 2' })
  name: string;
}

export class FeedbackSettingsDto {
  @ApiProperty({ example: true })
  teacher_rating_enabled: boolean;

  @ApiProperty({ enum: RATING_CYCLES, example: 3 })
  teacher_rating_months: number;

  @ApiProperty({ example: true })
  student_feedback_enabled: boolean;

  @ApiProperty({ type: PeriodDto, nullable: true, description: 'The rating window parents are in today' })
  cycle: PeriodDto | null;

  @ApiProperty({ type: TermRefDto, nullable: true, description: 'The term teachers give student feedback for today' })
  term: TermRefDto | null;
}

export class RateTeacherDto {
  @ApiProperty({ example: 31, description: 'A teacher of this child (class teacher or subject teacher)' })
  @Type(() => Number)
  @IsInt()
  teacher_user_id: number;

  @ApiProperty({ example: 4, minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  stars: number;

  @ApiProperty({ enum: BEHAVIOURS, example: 'good' })
  @IsIn(BEHAVIOURS, { message: 'behaviour must be good or bad' })
  behaviour: Behaviour;

  @ApiPropertyOptional({ example: 'Explains maths patiently.', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}

export class MyRatingDto {
  @ApiProperty({ example: 4 })
  stars: number;

  @ApiProperty({ example: 'Very good' })
  stars_label: string;

  @ApiProperty({ enum: BEHAVIOURS, example: 'good' })
  behaviour: Behaviour;

  @ApiProperty({ nullable: true, type: String })
  remark: string | null;

  @ApiProperty()
  rated_at: Date;
}

export class RateableTeacherDto {
  @ApiProperty({ example: 31 })
  teacher_user_id: number;

  @ApiProperty({ example: 'Priya Venkatesh' })
  name: string;

  @ApiProperty({ type: [String], example: ['Mathematics'] })
  subjects: string[];

  @ApiProperty({ example: true })
  is_class_teacher: boolean;

  @ApiProperty({ description: 'Already rated in this window' })
  rated: boolean;

  @ApiProperty({ type: MyRatingDto, nullable: true, description: 'My rating in this window' })
  my_rating: MyRatingDto | null;
}

export class RateableTeachersDto {
  @ApiProperty({ description: 'The school has turned parent ratings on' })
  enabled: boolean;

  @ApiProperty({ example: 3 })
  months: number;

  @ApiProperty({ type: PeriodDto, nullable: true, description: 'One rating per teacher in this window' })
  cycle: PeriodDto | null;

  @ApiProperty({ type: [RateableTeacherDto] })
  teachers: RateableTeacherDto[];
}

export class RatingDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ type: RefDto })
  teacher: RefDto;

  @ApiProperty({ type: RefDto, description: 'The parent who rated (office only)' })
  parent: RefDto;

  @ApiProperty({ type: RefDto })
  student: RefDto;

  @ApiProperty({ nullable: true, type: String, example: '7 - A' })
  section: string | null;

  @ApiProperty({ example: 4 })
  stars: number;

  @ApiProperty({ example: 'Very good' })
  stars_label: string;

  @ApiProperty({ enum: BEHAVIOURS })
  behaviour: Behaviour;

  @ApiProperty({ nullable: true, type: String })
  remark: string | null;

  @ApiProperty({ type: PeriodDto })
  cycle: PeriodDto;

  @ApiProperty()
  created_at: Date;
}

export class RatingsQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: 31 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  teacher_user_id?: number;

  @ApiPropertyOptional({ enum: BEHAVIOURS })
  @IsOptional()
  @IsIn(BEHAVIOURS, { message: 'behaviour must be good or bad' })
  behaviour?: Behaviour;

  @ApiPropertyOptional({ example: 2, description: 'Only ratings with this many stars or fewer' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  max_stars?: number;
}

export class RatingSummaryDto {
  @ApiProperty({ example: 12 })
  ratings: number;

  @ApiProperty({ nullable: true, type: Number, example: 4.3 })
  average_stars: number | null;

  @ApiProperty({ example: 11 })
  good: number;

  @ApiProperty({ example: 1 })
  bad: number;

  @ApiProperty({ nullable: true, type: Number, example: 91.7 })
  good_percent: number | null;
}

export class RankingRowDto extends RatingSummaryDto {
  @ApiProperty({ nullable: true, type: Number, example: 1, description: 'null until the teacher has a rating' })
  rank: number | null;

  @ApiProperty({ example: 31 })
  teacher_user_id: number;

  @ApiProperty({ example: 'Priya Venkatesh' })
  name: string;

  @ApiProperty({ nullable: true, type: String, example: 'PGT Mathematics' })
  designation: string | null;
}

export class OwnRemarkDto {
  @ApiProperty({ example: 4 })
  stars: number;

  @ApiProperty({ example: 'Very good' })
  stars_label: string;

  @ApiProperty({ enum: BEHAVIOURS })
  behaviour: Behaviour;

  @ApiProperty({ nullable: true, type: String })
  remark: string | null;

  @ApiProperty({ type: PeriodDto, description: 'Window only, never the parent, child or exact time' })
  cycle: PeriodDto;
}

export class OwnRatingsDto {
  @ApiProperty()
  enabled: boolean;

  @ApiProperty({ type: RatingSummaryDto, description: 'This academic year' })
  summary: RatingSummaryDto;

  @ApiProperty({ type: RatingSummaryDto, nullable: true, description: 'The current window' })
  this_cycle: RatingSummaryDto | null;

  @ApiProperty({ type: PeriodDto, nullable: true })
  cycle: PeriodDto | null;

  @ApiProperty({ type: [OwnRemarkDto], description: 'Newest window first; parents are never named' })
  remarks: OwnRemarkDto[];
}

export class StudentFeedbackInputDto {
  @ApiProperty({ example: 4, minimum: 1, maximum: 5, description: '5 Excellent … 1 Needs improvement' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  studies: number;

  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  behaviour: number;

  @ApiPropertyOptional({ example: 3, minimum: 1, maximum: 5, description: 'Leave out when the teacher cannot judge' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  sports?: number;

  @ApiPropertyOptional({ example: 'Needs to practise algebra daily.', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}

export class StudentFeedbackDto {
  @ApiProperty({ example: 5 })
  id: number;

  @ApiProperty({ type: TermRefDto })
  term: TermRefDto;

  @ApiProperty({ type: RefDto })
  teacher: RefDto;

  @ApiProperty({ type: RefDto })
  student: RefDto;

  @ApiProperty({ nullable: true, type: String, example: '7 - A' })
  section: string | null;

  @ApiProperty({ example: 4 })
  studies: number;

  @ApiProperty({ example: 'Very good' })
  studies_label: string;

  @ApiProperty({ example: 5 })
  behaviour: number;

  @ApiProperty({ example: 'Excellent' })
  behaviour_label: string;

  @ApiProperty({ nullable: true, type: Number })
  sports: number | null;

  @ApiProperty({ nullable: true, type: String })
  sports_label: string | null;

  @ApiProperty({ nullable: true, type: String })
  remark: string | null;

  @ApiProperty()
  created_at: Date;
}

export class FeedbackRosterStudentDto {
  @ApiProperty({ example: 41 })
  student_id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  name: string;

  @ApiProperty({ nullable: true, type: Number })
  roll_no: number | null;

  @ApiProperty({ type: StudentFeedbackDto, nullable: true, description: 'Mine for this term, if given' })
  feedback: StudentFeedbackDto | null;
}

export class FeedbackRosterDto {
  @ApiProperty({ description: 'The school has turned student feedback on' })
  enabled: boolean;

  @ApiProperty({ type: TermRefDto, nullable: true })
  term: TermRefDto | null;

  @ApiProperty({ example: 38 })
  total: number;

  @ApiProperty({ example: 12 })
  given: number;

  @ApiProperty({ type: [FeedbackRosterStudentDto] })
  students: FeedbackRosterStudentDto[];
}

export class StudentFeedbackQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: 21 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  section_id?: number;

  @ApiPropertyOptional({ example: 31 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  teacher_user_id?: number;

  @ApiPropertyOptional({ example: 2, description: 'Term id; 0 for a year without terms' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  term_id?: number;
}

export class TeacherReportQueryDto {
  @ApiPropertyOptional({ example: 4, description: 'One published exam; leave out for every exam this year' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  exam_id?: number;

  @ApiPropertyOptional({ example: 31 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  teacher_user_id?: number;
}

export class TeacherClassResultDto {
  @ApiProperty({ example: 21 })
  section_id: number;

  @ApiProperty({ example: '7 - A' })
  section: string;

  @ApiProperty({ example: 4 })
  subject_id: number;

  @ApiProperty({ example: 'Mathematics' })
  subject: string;

  @ApiProperty({ example: 38, description: 'Students with marks in this subject' })
  students: number;

  @ApiProperty({ example: 76, description: 'Subject papers: one per student per exam' })
  papers: number;

  @ApiProperty({ nullable: true, type: Number, example: 100 })
  pass_percent: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 0 })
  fail_percent: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 78.4 })
  average_percent: number | null;
}

export class TeacherResultTotalsDto {
  @ApiProperty({ example: 152 })
  papers: number;

  @ApiProperty({ nullable: true, type: Number, example: 95.4 })
  pass_percent: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 4.6 })
  fail_percent: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 74.1 })
  average_percent: number | null;
}

export class TeacherReportRowDto {
  @ApiProperty({ example: 31 })
  teacher_user_id: number;

  @ApiProperty({ example: 'Priya Venkatesh' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  designation: string | null;

  @ApiProperty({ type: TeacherResultTotalsDto })
  overall: TeacherResultTotalsDto;

  @ApiProperty({ type: [TeacherClassResultDto], description: 'Each class and subject the teacher takes' })
  classes: TeacherClassResultDto[];

  @ApiProperty({ type: RatingSummaryDto, description: 'Parent ratings this academic year' })
  rating: RatingSummaryDto;

  @ApiProperty({ type: [String], description: 'Latest parent remarks, newest first (up to 5)' })
  remarks: string[];
}

export class TeacherReportDto {
  @ApiProperty({ type: RefDto, nullable: true })
  exam: RefDto | null;

  @ApiProperty({ type: [TeacherReportRowDto] })
  teachers: TeacherReportRowDto[];
}
