import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
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
  ValidateNested,
} from 'class-validator';
import { IsDateOnly } from '../../../shared/dates';
import { GradingTier } from '../entities/grading-scale.entity';

export class CreateExamHallDto {
  @ApiProperty({ example: 'Main Auditorium' })
  @IsString()
  @Length(2, 80)
  name: string;

  @ApiPropertyOptional({ example: 'Block A' })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  building?: string;

  @ApiPropertyOptional({ example: 'Ground Floor' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  floor?: string;

  @ApiProperty({ example: 30 })
  @IsInt()
  @Min(1)
  @Max(500)
  capacity: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  rows_count?: number;

  @ApiPropertyOptional({ example: 6 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  columns_count?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateExamHallDto {
  @ApiPropertyOptional({ example: 'Main Auditorium' })
  @IsOptional()
  @IsString()
  @Length(2, 80)
  name?: string;

  @ApiPropertyOptional({ example: 'Block A' })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  building?: string;

  @ApiPropertyOptional({ example: 'Ground Floor' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  floor?: string;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  capacity?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  rows_count?: number;

  @ApiPropertyOptional({ example: 6 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  columns_count?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class AutoAllocateHallsDto {
  @ApiProperty({ example: [1, 2], description: 'Hall IDs to allocate seats in, ordered by fill priority' })
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  hall_ids: number[];

  @ApiPropertyOptional({
    enum: ['sequential', 'alternate_section'],
    default: 'alternate_section',
    description:
      'Seating pattern: sequential fills section by section, alternate_section mixes sections to prevent copying',
  })
  @IsOptional()
  @IsIn(['sequential', 'alternate_section'])
  strategy?: 'sequential' | 'alternate_section';
}

export class AssignInvigilatorDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  hall_id: number;

  @ApiProperty({ example: 5 })
  @IsInt()
  teacher_user_id: number;

  @IsDateOnly('2026-09-15')
  exam_date: string;

  @ApiPropertyOptional({ example: 'Morning', default: 'Morning' })
  @IsOptional()
  @IsString()
  session?: string;
}

export class GradingTierDto implements GradingTier {
  @ApiProperty({ example: 'A1' })
  @IsString()
  grade: string;

  @ApiProperty({ example: 91 })
  @IsNumber()
  @Min(0)
  @Max(100)
  min_percentage: number;

  @ApiProperty({ example: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  max_percentage: number;

  @ApiPropertyOptional({ example: 10.0 })
  @IsOptional()
  @IsNumber()
  grade_point?: number;

  @ApiPropertyOptional({ example: 'Outstanding' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class SaveGradingScaleDto {
  @ApiProperty({ example: 'CBSE', enum: ['CBSE', 'STATE', 'ICSE', 'CUSTOM'] })
  @IsString()
  board: string;

  @ApiProperty({ example: 'Standard CBSE 8-Tier' })
  @IsString()
  @Length(2, 80)
  name: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @ApiProperty({ type: [GradingTierDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GradingTierDto)
  tiers: GradingTierDto[];
}
