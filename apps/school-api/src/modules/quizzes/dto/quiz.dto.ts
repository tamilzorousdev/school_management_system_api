import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto } from '@app/common';
import { QUIZ_STATUSES, QuizStatus } from '../entities/online-quiz.entity';
import { MAX_OPTIONS, MIN_OPTIONS, QUESTION_TYPES, QuestionType } from '../quiz-questions.logic';

export class QuizOptionDto {
  @ApiProperty({ example: 'A' })
  @IsString()
  key: string;

  @ApiProperty({ example: 'Paris' })
  @IsString()
  text: string;
}

export class QuizQuestionInputDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  sequence?: number;

  @ApiProperty({ example: 'What is the capital of France?' })
  @IsString()
  @Length(3, 1000)
  question_text: string;

  @ApiPropertyOptional({
    enum: QUESTION_TYPES,
    example: 'single_choice',
    description:
      'single_choice: one right answer. multiple_choice: two or more right answers, all-or-nothing marks. true_false: exactly two options (True/False or Yes/No).',
  })
  @IsOptional()
  @IsIn(QUESTION_TYPES)
  question_type?: QuestionType;

  @ApiProperty({ type: [QuizOptionDto], description: 'Keys are assigned A, B, C... in order' })
  @IsArray()
  @ArrayMinSize(MIN_OPTIONS)
  @ArrayMaxSize(MAX_OPTIONS)
  @ValidateNested({ each: true })
  @Type(() => QuizOptionDto)
  options: QuizOptionDto[];

  @ApiProperty({
    example: 'A',
    description: 'Key of the right option. multiple_choice: keys joined by comma, like A,C',
  })
  @IsString()
  correct_option: string;

  @ApiPropertyOptional({ example: 'Paris is the capital and most populous city of France.' })
  @IsOptional()
  @IsString()
  explanation?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(100)
  marks?: number;
}

export class CreateQuizDto {
  @ApiPropertyOptional({ example: 1, description: 'Defaults to the current academic year' })
  @IsOptional()
  @IsInt()
  academic_year_id?: number;

  @ApiProperty({ example: 2 })
  @IsInt()
  subject_id: number;

  @ApiProperty({ example: 3 })
  @IsInt()
  section_id: number;

  @ApiPropertyOptional({ example: 45, description: 'Teacher user ID (optional for admin)' })
  @IsOptional()
  @IsInt()
  teacher_user_id?: number;

  @ApiProperty({ example: 'Unit 1 Science Quiz' })
  @IsString()
  @Length(3, 150)
  title: string;

  @ApiPropertyOptional({ example: 'Covers chapter 1 and 2.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'Attempt all questions. Each correct answer carries 1 mark.' })
  @IsOptional()
  @IsString()
  instructions?: string;

  @ApiPropertyOptional({
    example: 5,
    nullable: true,
    description:
      'Minimum marks to pass. Leave out for a quiz without pass or fail: the apps then show only the score and percentage.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  pass_marks?: number | null;

  @ApiProperty({ example: 30, description: 'Duration in minutes' })
  @IsInt()
  @Min(5)
  @Max(180)
  duration_minutes: number;

  @ApiProperty({ example: '2026-11-20T10:00:00.000Z' })
  @IsDateString()
  start_at: string;

  @ApiProperty({ example: '2026-11-20T18:00:00.000Z' })
  @IsDateString()
  end_at: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  expire_on_exit?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  require_camera?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  require_microphone?: boolean;

  @ApiPropertyOptional({ example: 'approved', enum: ['draft', 'approved'] })
  @IsOptional()
  @IsIn(['draft', 'approved'])
  status?: QuizStatus;

  @ApiProperty({ type: [QuizQuestionInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuizQuestionInputDto)
  questions: QuizQuestionInputDto[];
}

export class UpdateQuizDto {
  @ApiPropertyOptional({ example: 'Updated Quiz Title' })
  @IsOptional()
  @IsString()
  @Length(3, 150)
  title?: string;

  @ApiPropertyOptional({ example: 'Updated description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'Updated instructions' })
  @IsOptional()
  @IsString()
  instructions?: string;

  @ApiPropertyOptional({ example: 6 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  pass_marks?: number | null;

  @ApiPropertyOptional({ example: 45 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(180)
  duration_minutes?: number;

  @ApiPropertyOptional({ example: '2026-11-20T11:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  start_at?: string;

  @ApiPropertyOptional({ example: '2026-11-20T19:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  end_at?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  expire_on_exit?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  require_camera?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  require_microphone?: boolean;

  @ApiPropertyOptional({ example: 'approved', enum: ['draft', 'approved'] })
  @IsOptional()
  @IsIn(['draft', 'approved'])
  status?: QuizStatus;

  @ApiPropertyOptional({ type: [QuizQuestionInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuizQuestionInputDto)
  questions?: QuizQuestionInputDto[];
}

export class RejectQuizDto {
  @ApiProperty({ example: 'Please add at least 10 questions and revise question 3.' })
  @IsString()
  @Length(3, 500)
  reason: string;
}

export class UpdateQuizPermissionsDto {
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  allow_all_teachers?: boolean;

  @ApiPropertyOptional({ example: [10, 15] })
  @IsOptional()
  @IsArray()
  permitted_user_ids?: number[];
}

export class QuizQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: QUIZ_STATUSES })
  @IsOptional()
  @IsIn(QUIZ_STATUSES)
  status?: QuizStatus;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  section_id?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  subject_id?: number;
}

export class SubmitAnswerItemDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  question_id: number;

  @ApiPropertyOptional({ example: 'A' })
  @IsOptional()
  @IsString()
  selected_option?: string;
}

export class SubmitQuizDto {
  @ApiProperty({ type: [SubmitAnswerItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitAnswerItemDto)
  answers: SubmitAnswerItemDto[];

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  auto_submitted?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  exit_terminated?: boolean;
}
