import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { FINE_STATUSES, FineStatus } from '../entities/fee-fine.entity';
import { InvoiceStatus, INVOICE_STATUSES } from '../entities/fee-invoice.entity';
import { FeeStudentRefDto, PlanUserDto } from './fees.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class FineTypeInputDto {
  @ApiProperty({ example: 'Property damage' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @ApiProperty({ example: 500, description: 'Suggested amount; can be changed when the fine is raised' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1000000)
  default_amount: number;

  @ApiPropertyOptional({ example: 'Broken furniture, lab equipment or windows', nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateFineTypeDto extends PartialType(FineTypeInputDto) {}

export class FineTypeQueryDto {
  @ApiPropertyOptional({ example: true, description: 'true: only the types that can be used now' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}

export class FineTypeDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Property damage' })
  name: string;

  @ApiProperty({ example: 500 })
  default_amount: number;

  @ApiProperty({ example: 'Broken furniture, lab equipment or windows', nullable: true })
  description: string | null;

  @ApiProperty({ example: true })
  is_active: boolean;

  @ApiProperty({ example: 3, description: 'Fines raised with this type' })
  fines: number;
}

export class FineInputDto {
  @ApiProperty({ example: 12 })
  @IsInt()
  @Min(1)
  student_id: number;

  @ApiPropertyOptional({ example: 1, description: 'Fills the title and amount when they are left out' })
  @IsOptional()
  @IsInt()
  @Min(1)
  fine_type_id?: number;

  @ApiPropertyOptional({ example: 'Broke the lab microscope', description: 'Defaults to the fine type name' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ example: 1500, description: 'Defaults to the fine type amount' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1000000)
  amount?: number;

  @IsDateOnly('2026-11-19', true)
  incident_on?: string;

  @ApiPropertyOptional({ example: 'Dropped it while playing during the lab period', nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  details?: string;
}

export class StudentFineInputDto {
  @ApiPropertyOptional({ example: 1, description: 'Fills the title and amount when they are left out' })
  @IsOptional()
  @IsInt()
  @Min(1)
  fine_type_id?: number;

  @ApiPropertyOptional({ example: 'Broke the lab microscope' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ example: 1500 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1000000)
  amount?: number;

  @IsDateOnly('2026-11-19', true)
  incident_on?: string;

  @ApiPropertyOptional({ example: 'Dropped it while playing during the lab period' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  details?: string;
}

export class ApproveFineDto {
  @IsDateOnly('2026-11-26', true)
  due_date?: string;

  @ApiPropertyOptional({ example: 'Seen the lab register' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  comment?: string;
}

export class RejectFineDto {
  @ApiProperty({ example: 'Warning is enough for a first time' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  comment: string;
}

export class FineQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: FINE_STATUSES })
  @IsOptional()
  @IsIn(FINE_STATUSES)
  status?: FineStatus;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  @Min(1)
  student_id?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  fine_type_id?: number;
}

export class MyFineQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: FINE_STATUSES })
  @IsOptional()
  @IsIn(FINE_STATUSES)
  status?: FineStatus;
}

export class FineInvoiceRefDto {
  @ApiProperty({ example: 301 })
  id: number;

  @ApiProperty({ example: 'TZMS-FEE-2026-0301' })
  invoice_no: string;

  @ApiProperty({ example: '2026-11-26' })
  due_date: string;

  @ApiProperty({ example: 1500 })
  balance: number;

  @ApiProperty({ enum: INVOICE_STATUSES, example: 'unpaid' })
  status: InvoiceStatus;
}

export class FineDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 'TZMS-FIN-2026-0004' })
  fine_no: string;

  @ApiProperty({ enum: FINE_STATUSES, example: 'pending' })
  status: FineStatus;

  @ApiProperty({ type: FeeStudentRefDto })
  student: FeeStudentRefDto;

  @ApiProperty({ example: { id: 1, name: 'Property damage' }, nullable: true })
  fine_type: { id: number; name: string } | null;

  @ApiProperty({ example: 'Broke the lab microscope' })
  title: string;

  @ApiProperty({ example: 1500 })
  amount: number;

  @ApiProperty({ example: '2026-11-19' })
  incident_on: string;

  @ApiProperty({ example: 'Dropped it while playing during the lab period', nullable: true })
  details: string | null;

  @ApiProperty({ type: PlanUserDto, nullable: true })
  raised_by: PlanUserDto | null;

  @ApiProperty({ example: '2026-11-19T10:00:00.000+05:30' })
  raised_at: Date;

  @ApiProperty({ type: PlanUserDto, nullable: true })
  decided_by: PlanUserDto | null;

  @ApiProperty({ example: null, nullable: true })
  decided_at: Date | null;

  @ApiProperty({ example: null, nullable: true })
  decision_comment: string | null;

  @ApiProperty({ type: FineInvoiceRefDto, nullable: true, description: 'Set once approved; pay it like any invoice' })
  invoice: FineInvoiceRefDto | null;

  @ApiProperty({ example: 88, nullable: true, description: 'The behaviour note written with the fine' })
  behaviour_note_id: number | null;
}
