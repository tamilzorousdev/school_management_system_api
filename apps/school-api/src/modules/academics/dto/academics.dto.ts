import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateSyllabusUnitDto {
  @ApiProperty()
  @IsInt()
  academic_year_id: number;

  @ApiProperty()
  @IsInt()
  class_id: number;

  @ApiProperty()
  @IsInt()
  subject_id: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  unit_number: number;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  unit_name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  total_planned_hours?: number;
}

export class UpdateSyllabusUnitDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  unit_number?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  unit_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  total_planned_hours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_completed?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  completion_percentage?: number;
}

export class CreateLessonPlanDto {
  @ApiProperty()
  @IsInt()
  unit_id: number;

  @ApiProperty()
  @IsInt()
  section_id: number;

  @ApiProperty({ example: '2026-11-25' })
  @IsDateString()
  planned_date: string;

  @ApiProperty()
  @IsString()
  @MaxLength(250)
  topic: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  learning_objectives?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  teaching_aid?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  homework_assigned?: string;

  @ApiPropertyOptional({ enum: ['draft', 'submitted', 'approved', 'completed'], default: 'draft' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateLessonPlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  planned_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(250)
  topic?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  learning_objectives?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  teaching_aid?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  homework_assigned?: string;

  @ApiPropertyOptional({ enum: ['draft', 'submitted', 'approved', 'completed'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  review_notes?: string;
}

export class CreateStudyMaterialDto {
  @ApiProperty()
  @IsInt()
  class_id: number;

  @ApiProperty()
  @IsInt()
  subject_id: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  section_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  unit_id?: number;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: ['document', 'video', 'link', 'worksheet', 'assignment'], default: 'document' })
  @IsOptional()
  @IsString()
  material_type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  file_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  file_url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  external_url?: string;
}

export class CreateOnlineClassDto {
  @ApiProperty()
  @IsInt()
  section_id: number;

  @ApiProperty()
  @IsInt()
  subject_id: number;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: '2026-11-25T09:00:00Z' })
  @IsDateString()
  scheduled_start: string;

  @ApiProperty({ example: '2026-11-25T09:45:00Z' })
  @IsDateString()
  scheduled_end: string;
}

export class UpdateOnlineClassStatusDto {
  @ApiProperty({ enum: ['scheduled', 'live', 'completed', 'cancelled'] })
  @IsString()
  status: string;
}
