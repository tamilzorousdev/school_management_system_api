import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateSportsOnDutyDto {
  @ApiProperty({ type: [Number], example: [12, 15] })
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  student_ids: number[];

  @ApiProperty({ example: 'Football' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  sport_name: string;

  @ApiProperty({ example: 'District Tournament' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @ApiProperty({ example: '2026-11-14' })
  @IsDateString()
  from_date: string;

  @ApiProperty({ example: '2026-11-16' })
  @IsDateString()
  to_date: string;

  @ApiPropertyOptional({ example: 'morning', enum: ['morning', 'afternoon'] })
  @IsOptional()
  @IsIn(['morning', 'afternoon'])
  session?: 'morning' | 'afternoon' | null;

  @ApiPropertyOptional({ example: 'Nehru Stadium' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  venue?: string | null;

  @ApiPropertyOptional({ example: 'Under-14 team captain' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class UpdateSportsOnDutyDto {
  @ApiPropertyOptional({ example: 'Football' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  sport_name?: string;

  @ApiPropertyOptional({ example: 'District Tournament' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ example: '2026-11-14' })
  @IsOptional()
  @IsDateString()
  from_date?: string;

  @ApiPropertyOptional({ example: '2026-11-16' })
  @IsOptional()
  @IsDateString()
  to_date?: string;

  @ApiPropertyOptional({ example: 'morning', enum: ['morning', 'afternoon'] })
  @IsOptional()
  @IsIn(['morning', 'afternoon'])
  session?: 'morning' | 'afternoon' | null;

  @ApiPropertyOptional({ example: 'Nehru Stadium' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  venue?: string | null;

  @ApiPropertyOptional({ example: 'Notes' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class SportsOnDutyQueryDto {
  @ApiPropertyOptional({ example: '2026-11-14' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  student_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  class_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  section_id?: number;
}

export class SportsOnDutyStudentDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  name: string;

  @ApiProperty({ example: 'TZMS-2021-0001' })
  admission_no: string;

  @ApiProperty({ example: '6 - A', nullable: true })
  section_name: string | null;
}

export class SportsOnDutyDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ type: SportsOnDutyStudentDto })
  student: SportsOnDutyStudentDto;

  @ApiProperty({ example: 'Football' })
  sport_name: string;

  @ApiProperty({ example: 'District Tournament' })
  title: string;

  @ApiProperty({ example: '2026-11-14' })
  from_date: string;

  @ApiProperty({ example: '2026-11-16' })
  to_date: string;

  @ApiProperty({ example: null, nullable: true })
  session: string | null;

  @ApiProperty({ example: 'Nehru Stadium', nullable: true })
  venue: string | null;

  @ApiProperty({ example: null, nullable: true })
  notes: string | null;

  @ApiProperty()
  created_at: Date;
}
