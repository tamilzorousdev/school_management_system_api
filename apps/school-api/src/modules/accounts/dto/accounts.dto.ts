import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { FileDto } from '../../files/dto/file.dto';
import { MAX_ENTRY_AMOUNT } from '../accounts.logic';
import { ACCOUNT_KINDS, AccountKind } from '../entities/account-category.entity';
import {
  ACCOUNT_PAYMENT_MODES,
  AccountPaymentMode,
  ENTRY_STATUSES,
  EntryStatus,
} from '../entities/account-entry.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const present = (_dto: object, value: unknown) => value !== undefined;

export const ACCOUNT_REPORT_TYPES = ['monthly', 'categories', 'register'] as const;
export type AccountReportType = (typeof ACCOUNT_REPORT_TYPES)[number];

export class CategoryQueryDto {
  @ApiPropertyOptional({ enum: ACCOUNT_KINDS })
  @IsOptional()
  @IsIn(ACCOUNT_KINDS)
  kind?: AccountKind;

  @ApiPropertyOptional({ description: 'Include categories that were switched off' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  include_inactive?: boolean;
}

export class CategoryInputDto {
  @ApiProperty({ enum: ACCOUNT_KINDS, example: 'expense' })
  @IsIn(ACCOUNT_KINDS)
  kind: AccountKind;

  @ApiProperty({ example: 'Generator diesel' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: 'Generator fuel' })
  @ValidateIf(present)
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ example: false })
  @ValidateIf(present)
  @IsBoolean()
  is_active?: boolean;
}

export class CategoryDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ enum: ACCOUNT_KINDS, example: 'expense' })
  kind: AccountKind;

  @ApiProperty({ example: 'Electricity' })
  name: string;

  @ApiProperty({ example: true })
  is_active: boolean;

  @ApiProperty({ example: 12, description: 'Entries in this category, any status' })
  entries: number;
}

export class EntryQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: ACCOUNT_KINDS })
  @IsOptional()
  @IsIn(ACCOUNT_KINDS)
  kind?: AccountKind;

  @ApiPropertyOptional({ enum: ENTRY_STATUSES })
  @IsOptional()
  @IsIn(ENTRY_STATUSES)
  status?: EntryStatus;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  category_id?: number;

  @ApiPropertyOptional({ enum: ACCOUNT_PAYMENT_MODES })
  @IsOptional()
  @IsIn(ACCOUNT_PAYMENT_MODES)
  payment_mode?: AccountPaymentMode;

  @IsDateOnly('2026-11-01', true)
  from?: string;

  @IsDateOnly('2026-11-30', true)
  to?: string;
}

export class EntryInputDto {
  @ApiProperty({ enum: ACCOUNT_KINDS, example: 'expense' })
  @IsIn(ACCOUNT_KINDS)
  kind: AccountKind;

  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(1)
  category_id: number;

  @IsDateOnly('2026-11-18')
  entry_date: string;

  @ApiProperty({ example: 8450 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(MAX_ENTRY_AMOUNT)
  amount: number;

  @ApiPropertyOptional({ enum: ACCOUNT_PAYMENT_MODES, example: 'bank_transfer' })
  @IsOptional()
  @IsIn(ACCOUNT_PAYMENT_MODES)
  payment_mode?: AccountPaymentMode;

  @ApiPropertyOptional({
    example: 'TNEB',
    nullable: true,
    type: String,
    description: 'Paid to (expense) or received from (income)',
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(120)
  party?: string | null;

  @ApiPropertyOptional({ example: 'BILL-20931', nullable: true, type: String, description: 'Bill, cheque or UTR no.' })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(60)
  reference?: string | null;

  @ApiPropertyOptional({ example: 51, nullable: true, type: Number, description: 'Uploaded bill or receipt' })
  @IsOptional()
  @IsInt()
  @Min(1)
  file_id?: number | null;

  @ApiPropertyOptional({ example: 'October bill', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class UpdateEntryDto {
  @ApiPropertyOptional({ example: 4 })
  @ValidateIf(present)
  @IsInt()
  @Min(1)
  category_id?: number;

  @ApiPropertyOptional({ example: '2026-11-18', format: 'date' })
  @ValidateIf(present)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'entry_date must be a date in YYYY-MM-DD format' })
  entry_date?: string;

  @ApiPropertyOptional({ example: 8450 })
  @ValidateIf(present)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(MAX_ENTRY_AMOUNT)
  amount?: number;

  @ApiPropertyOptional({ enum: ACCOUNT_PAYMENT_MODES })
  @ValidateIf(present)
  @IsIn(ACCOUNT_PAYMENT_MODES)
  payment_mode?: AccountPaymentMode;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(120)
  party?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(60)
  reference?: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  file_id?: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class DecisionDto {
  @ApiPropertyOptional({ example: 'Bill is not attached', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class VoidEntryDto {
  @ApiProperty({ example: 'Entered twice' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason: string;
}

export class PersonRefDto {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({ example: 'Kumar S' })
  name: string;
}

export class CategoryRefDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 'Electricity' })
  name: string;
}

export class EntryDto {
  @ApiProperty({ example: 18 })
  id: number;

  @ApiProperty({ enum: ACCOUNT_KINDS, example: 'expense' })
  kind: AccountKind;

  @ApiProperty({ example: 'TZMS-EXP-2026-0018' })
  entry_no: string;

  @ApiProperty({ type: CategoryRefDto })
  category: CategoryRefDto;

  @ApiProperty({ example: '2026-11-18' })
  entry_date: string;

  @ApiProperty({ example: 8450 })
  amount: number;

  @ApiProperty({ enum: ACCOUNT_PAYMENT_MODES, example: 'bank_transfer' })
  payment_mode: AccountPaymentMode;

  @ApiProperty({ example: 'TNEB', nullable: true })
  party: string | null;

  @ApiProperty({ example: 'BILL-20931', nullable: true })
  reference: string | null;

  @ApiProperty({ type: FileDto, nullable: true })
  file: FileDto | null;

  @ApiProperty({ example: 'October bill', nullable: true })
  note: string | null;

  @ApiProperty({ enum: ENTRY_STATUSES, example: 'approved' })
  status: EntryStatus;

  @ApiProperty({ type: PersonRefDto, nullable: true })
  created_by: PersonRefDto | null;

  @ApiProperty({ example: '2026-11-18T10:20:00+05:30' })
  created_at: Date;

  @ApiProperty({ type: PersonRefDto, nullable: true })
  decided_by: PersonRefDto | null;

  @ApiProperty({ example: '2026-11-18T12:05:00+05:30', nullable: true })
  decided_at: Date | null;

  @ApiProperty({ example: null, nullable: true, description: 'Reject note or void reason' })
  decision_note: string | null;

  @ApiProperty({ example: true, description: 'The caller may edit or delete it now' })
  can_edit: boolean;
}

export class CategoryAmountDto {
  @ApiProperty({ example: 'Electricity' })
  category: string;

  @ApiProperty({ example: 18400 })
  amount: number;
}

export class AccountInsightsDto {
  @ApiProperty({ example: '2026-11-01' })
  month_start: string;

  @ApiProperty({ example: 42500, description: 'Approved other income this month' })
  income_this_month: number;

  @ApiProperty({ example: 96300, description: 'Approved school expenses this month' })
  expense_this_month: number;

  @ApiProperty({ example: 3, description: 'Entries waiting for approval' })
  pending: number;

  @ApiProperty({ example: 12800 })
  pending_amount: number;

  @ApiProperty({ example: 2 })
  pending_expense: number;

  @ApiProperty({ example: 1 })
  pending_income: number;

  @ApiProperty({ type: [CategoryAmountDto] })
  expense_by_category: CategoryAmountDto[];

  @ApiProperty({ type: [CategoryAmountDto] })
  income_by_category: CategoryAmountDto[];
}

export class AccountReportQueryDto {
  @IsDateOnly('2026-06-01', true)
  from?: string;

  @IsDateOnly('2026-11-30', true)
  to?: string;

  @ApiPropertyOptional({ enum: ACCOUNT_KINDS, description: 'register report only' })
  @IsOptional()
  @IsIn(ACCOUNT_KINDS)
  kind?: AccountKind;
}
