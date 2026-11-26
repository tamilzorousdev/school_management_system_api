import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { KRA_APPLICABILITY, KRA_CATEGORIES, KraApplicability, KraCategory } from '../entities/kra-config.entity';
import { OVERALL_RATINGS, OverallRating } from '../entities/staff-appraisal.entity';

export class KraConfigDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 1 })
  school_id: number;

  @ApiPropertyOptional({ example: 1 })
  academic_year_id: number | null;

  @ApiProperty({ example: 'curriculum_pedagogy' })
  code: string;

  @ApiProperty({ example: 'Curriculum Delivery & Innovative Pedagogy' })
  title: string;

  @ApiPropertyOptional({ example: 'Lesson plan completion and classroom presentation' })
  description: string | null;

  @ApiProperty({ enum: KRA_CATEGORIES, example: 'pedagogy' })
  category: KraCategory;

  @ApiProperty({ example: 25.0 })
  weightage_percent: number;

  @ApiProperty({ example: 1.0 })
  min_score: number;

  @ApiProperty({ example: 5.0 })
  max_score: number;

  @ApiProperty({ enum: KRA_APPLICABILITY, example: 'teaching' })
  applicable_to: KraApplicability;

  @ApiProperty({ example: 1 })
  sort_order: number;

  @ApiProperty({ example: true })
  is_active: boolean;

  @ApiProperty({ example: '2026-11-20T10:00:00.000Z' })
  created_at: string;

  @ApiProperty({ example: '2026-11-20T10:00:00.000Z' })
  updated_at: string;
}

export class CreateKraConfigDto {
  @ApiProperty({ example: 'student_outcomes', description: 'Unique code/slug for the KRA' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code: string;

  @ApiProperty({ example: 'Student Academic Growth & Outcomes' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @ApiPropertyOptional({ example: 'Class pass percentage and remedial attention' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: KRA_CATEGORIES, default: 'academics' })
  @IsEnum(KRA_CATEGORIES)
  @IsOptional()
  category?: KraCategory;

  @ApiProperty({ example: 25.0, description: 'Weightage in percentage (0 to 100)' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  weightage_percent: number;

  @ApiPropertyOptional({ example: 1.0, default: 1.0 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  @Min(0)
  min_score?: number;

  @ApiPropertyOptional({ example: 5.0, default: 5.0 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  @Max(10)
  max_score?: number;

  @ApiPropertyOptional({ enum: KRA_APPLICABILITY, default: 'all' })
  @IsEnum(KRA_APPLICABILITY)
  @IsOptional()
  applicable_to?: KraApplicability;

  @ApiPropertyOptional({ example: 1 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  sort_order?: number;
}

export class UpdateKraConfigDto {
  @ApiPropertyOptional({ example: 'Curriculum Delivery & Modern Pedagogy' })
  @IsString()
  @IsOptional()
  @MaxLength(150)
  title?: string;

  @ApiPropertyOptional({ example: 'Updated guidelines for evaluation' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: KRA_CATEGORIES })
  @IsEnum(KRA_CATEGORIES)
  @IsOptional()
  category?: KraCategory;

  @ApiPropertyOptional({ example: 30.0 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  weightage_percent?: number;

  @ApiPropertyOptional({ example: 1.0 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  min_score?: number;

  @ApiPropertyOptional({ example: 5.0 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  max_score?: number;

  @ApiPropertyOptional({ enum: KRA_APPLICABILITY })
  @IsEnum(KRA_APPLICABILITY)
  @IsOptional()
  applicable_to?: KraApplicability;

  @ApiPropertyOptional({ example: 2 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  sort_order?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class BulkUpdateKraItemDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsNumber()
  id: number;

  @ApiProperty({ example: 25.0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  weightage_percent: number;

  @ApiPropertyOptional({ example: 1 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  sort_order?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class BulkUpdateKraConfigDto {
  @ApiProperty({ type: [BulkUpdateKraItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateKraItemDto)
  items: BulkUpdateKraItemDto[];
}

export class AppraisalAppealDto {
  @ApiProperty({
    example: 'Achieved 100% pass rate in 10th grade Mathematics board exams and conducted extra remedial batches.',
    description: 'Teacher justification for appraisal appeal',
  })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiPropertyOptional({ example: 15.0, description: 'Requested hike percentage' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  requested_hike?: number;
}

export class ResolveAppealDto {
  @ApiProperty({ enum: ['accept', 'reject'], example: 'accept' })
  @IsIn(['accept', 'reject'])
  decision: 'accept' | 'reject';

  @ApiPropertyOptional({ enum: OVERALL_RATINGS, example: 'outstanding' })
  @IsEnum(OVERALL_RATINGS)
  @IsOptional()
  revised_rating?: OverallRating;

  @ApiPropertyOptional({ example: 13.5, description: 'Revised approved increment percentage' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  revised_hike?: number;

  @ApiProperty({
    example: 'Board exam achievements reviewed and validated. Revised hike approved.',
    description: 'Management feedback to teacher',
  })
  @IsString()
  @IsNotEmpty()
  feedback: string;
}
