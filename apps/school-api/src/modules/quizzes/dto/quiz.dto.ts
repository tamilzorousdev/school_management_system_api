import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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

  @ApiProperty({ type: [QuizOptionDto] })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => QuizOptionDto)
  options: QuizOptionDto[];

  @ApiProperty({ example: 'A' })
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
  @ApiProperty({ example: 1 })
  @IsInt()
  academic_year_id: number;

  @ApiProperty({ example: 2 })
  @IsInt()
  subject_id: number;

  @ApiProperty({ example: 3 })
  @IsInt()
  section_id: number;

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

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  pass_marks?: number;

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
  pass_marks?: number;

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
}
