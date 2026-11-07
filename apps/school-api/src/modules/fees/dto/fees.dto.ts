import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { INVOICE_STATUSES, InvoiceStatus } from '../entities/fee-invoice.entity';
import { PAYMENT_MODES, PaymentMode } from '../entities/fee-payment.entity';
import { STUDENT_FEE_STATUSES, StudentFeeStatus } from '../fees.logic';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

export class FeeHeadInputDto {
  @ApiProperty({ example: 'Tuition fee' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @ApiProperty({ example: 'TUITION', description: 'Short code, letters, digits and underscores' })
  @Transform(upper)
  @IsString()
  @Matches(/^[A-Z0-9_]{2,20}$/, { message: 'code must be 2 to 20 letters, digits or underscores' })
  code: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Transport head: its amount comes from the student’s bus stop, never from the plan',
  })
  @IsOptional()
  @IsBoolean()
  is_transport?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateFeeHeadDto {
  @ApiPropertyOptional({ example: 'Tuition fee' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ example: 'TUITION' })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @Matches(/^[A-Z0-9_]{2,20}$/, { message: 'code must be 2 to 20 letters, digits or underscores' })
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_transport?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class FeeHeadQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ description: 'true: active heads only; false: inactive only' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  is_active?: boolean;
}

export class FeeHeadDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Tuition fee' })
  name: string;

  @ApiProperty({ example: 'TUITION' })
  code: string;

  @ApiProperty({ example: false })
  is_transport: boolean;

  @ApiProperty({ example: true })
  is_active: boolean;

  @ApiProperty({ example: 6, description: 'Plan lines using this head this year' })
  plan_lines: number;

  @ApiProperty({ example: '2026-11-03T10:00:00.000+05:30' })
  created_at: Date;
}

export class FeePlanLineInputDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  fee_head_id: number;

  @ApiProperty({ example: 'Term 1' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  installment: string;

  @ApiProperty({ example: 12500 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000000)
  amount: number;

  @IsDateOnly('2026-10-03')
  due_date: string;
}

export class FeePlanInputDto {
  @ApiPropertyOptional({ example: 2, description: 'Defaults to the current academic year' })
  @IsOptional()
  @IsInt()
  @Min(1)
  academic_year_id?: number;

  @ApiProperty({ type: [FeePlanLineInputDto], description: 'Replaces every line of this class for the year' })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => FeePlanLineInputDto)
  lines: FeePlanLineInputDto[];
}

export class YearQueryDto {
  @ApiPropertyOptional({ example: 2, description: 'Defaults to the current academic year' })
  @IsOptional()
  @IsInt()
  @Min(1)
  academic_year_id?: number;
}

export class FeePlanLineDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 1 })
  fee_head_id: number;

  @ApiProperty({ example: 'Tuition fee' })
  head_name: string;

  @ApiProperty({ example: 'Term 1' })
  installment: string;

  @ApiProperty({ example: 12500 })
  amount: number;

  @ApiProperty({ example: '2026-10-03' })
  due_date: string;
}

export class InstallmentTotalDto {
  @ApiProperty({ example: 'Term 1' })
  installment: string;

  @ApiProperty({ example: '2026-10-03' })
  due_date: string;

  @ApiProperty({ example: 14000 })
  amount: number;
}

export class FeePlanDto {
  @ApiProperty({ example: 8 })
  class_id: number;

  @ApiProperty({ example: '6' })
  class_name: string;

  @ApiProperty({ example: 2 })
  academic_year_id: number;

  @ApiProperty({ example: '2026-27' })
  academic_year: string;

  @ApiProperty({ type: [FeePlanLineDto] })
  lines: FeePlanLineDto[];

  @ApiProperty({ type: [InstallmentTotalDto] })
  installments: InstallmentTotalDto[];

  @ApiProperty({ example: 28000, description: 'Year total without transport' })
  total: number;
}

export class FeePlanSummaryDto {
  @ApiProperty({ example: 8 })
  class_id: number;

  @ApiProperty({ example: '6' })
  class_name: string;

  @ApiProperty({ example: 16 })
  student_count: number;

  @ApiProperty({ type: [InstallmentTotalDto] })
  installments: InstallmentTotalDto[];

  @ApiProperty({ example: 28000 })
  total: number;
}

export class GenerateInvoicesDto {
  @ApiPropertyOptional({ example: 8, description: 'Leave out to bill every class that has this installment' })
  @IsOptional()
  @IsInt()
  @Min(1)
  class_id?: number;

  @ApiProperty({ example: 'Term 2' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  installment: string;

  @IsDateOnly('2026-12-03', true)
  due_date?: string;
}

export class GenerateResultDto {
  @ApiProperty({ example: 'Term 2' })
  installment: string;

  @ApiProperty({ example: 3 })
  classes: number;

  @ApiProperty({ example: 41, description: 'New invoices' })
  created: number;

  @ApiProperty({ example: 14, description: 'Students who already had an invoice for this installment' })
  already_invoiced: number;

  @ApiProperty({ example: 6, description: 'Of the new invoices, how many have a transport line' })
  with_transport: number;

  @ApiProperty({ example: 598500 })
  total_amount: number;
}

export class InvoiceQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: INVOICE_STATUSES })
  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: InvoiceStatus;

  @ApiPropertyOptional({ example: 8 })
  @IsOptional()
  @IsInt()
  @Min(1)
  class_id?: number;

  @ApiPropertyOptional({ example: 8 })
  @IsOptional()
  @IsInt()
  @Min(1)
  section_id?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  @Min(1)
  student_id?: number;

  @ApiPropertyOptional({ description: 'true: only invoices with a balance past the due date' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  overdue?: boolean;

  @ApiPropertyOptional({ example: 'Term 1' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  installment?: string;

  @ApiPropertyOptional({ example: 2, description: 'Defaults to the current academic year' })
  @IsOptional()
  @IsInt()
  @Min(1)
  academic_year_id?: number;
}

export class DiscountDto {
  @ApiProperty({ example: 1500, description: '0 removes the discount' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000000)
  discount: number;

  @ApiPropertyOptional({ example: 'Sibling concession', description: 'Required when the discount is above 0' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  reason?: string | null;
}

export class CancelInvoiceDto {
  @ApiPropertyOptional({ example: 'Raised twice by mistake' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class PaymentInputDto {
  @ApiProperty({ example: 5000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10000000)
  amount: number;

  @ApiProperty({ enum: PAYMENT_MODES, example: 'upi' })
  @IsIn(PAYMENT_MODES)
  mode: PaymentMode;

  @ApiPropertyOptional({ example: 'UPI 412233445566', description: 'Transaction, cheque or card reference' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  reference?: string;

  @IsDateOnly('2026-11-03', true)
  paid_on?: string;

  @ApiPropertyOptional({ example: 'Paid by the father at the counter' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  notes?: string;
}

export class PaymentQueryDto extends ListQueryDto {
  @IsDateOnly('2026-11-01', true)
  from?: string;

  @IsDateOnly('2026-11-30', true)
  to?: string;

  @ApiPropertyOptional({ enum: PAYMENT_MODES })
  @IsOptional()
  @IsIn(PAYMENT_MODES)
  mode?: PaymentMode;

  @ApiPropertyOptional({ example: 8 })
  @IsOptional()
  @IsInt()
  @Min(1)
  class_id?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  @Min(1)
  student_id?: number;
}

export class PaymentSummaryQueryDto {
  @IsDateOnly('2026-11-01', true)
  from?: string;

  @IsDateOnly('2026-11-30', true)
  to?: string;

  @ApiPropertyOptional({ enum: PAYMENT_MODES })
  @IsOptional()
  @IsIn(PAYMENT_MODES)
  mode?: PaymentMode;

  @ApiPropertyOptional({ example: 8 })
  @IsOptional()
  @IsInt()
  @Min(1)
  class_id?: number;
}

export class FeeStudentRefDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ example: 'TZMS-2026-0012' })
  admission_no: string;

  @ApiProperty({ example: '6 - A', nullable: true })
  class_section: string | null;
}

export class InvoiceLineDto {
  @ApiProperty({ example: 31 })
  id: number;

  @ApiProperty({ example: 1, nullable: true })
  fee_head_id: number | null;

  @ApiProperty({ example: 'Transport' })
  head_name: string;

  @ApiProperty({ example: 'Thirumangalam metro · Rs. 1,000.00 × 4 months', nullable: true })
  description: string | null;

  @ApiProperty({ example: 4000 })
  amount: number;
}

export class FeePaymentDto {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({ example: 'TZMS-RCP-2026-0007' })
  receipt_no: string;

  @ApiProperty({ example: 21 })
  invoice_id: number;

  @ApiProperty({ example: 'TZMS-FEE-2026-0021' })
  invoice_no: string;

  @ApiProperty({ example: 'Term 1' })
  installment: string;

  @ApiProperty({ type: FeeStudentRefDto })
  student: FeeStudentRefDto;

  @ApiProperty({ example: 5000 })
  amount: number;

  @ApiProperty({ enum: PAYMENT_MODES, example: 'upi' })
  mode: PaymentMode;

  @ApiProperty({ example: 'UPI 412233445566', nullable: true })
  reference: string | null;

  @ApiProperty({ example: '2026-11-03' })
  paid_on: string;

  @ApiProperty({ example: 'Lakshmi Raman', nullable: true })
  received_by: string | null;

  @ApiProperty({ example: null, nullable: true })
  notes: string | null;

  @ApiProperty({ example: 9000, description: 'Invoice balance after all payments so far' })
  invoice_balance: number;

  @ApiProperty({ example: '2026-11-03T10:15:00.000+05:30' })
  created_at: Date;
}

export class FeeInvoiceDto {
  @ApiProperty({ example: 21 })
  id: number;

  @ApiProperty({ example: 'TZMS-FEE-2026-0021' })
  invoice_no: string;

  @ApiProperty({ example: 2 })
  academic_year_id: number;

  @ApiProperty({ example: 'Term 1' })
  installment: string;

  @ApiProperty({ example: '2026-10-03' })
  due_date: string;

  @ApiProperty({ type: FeeStudentRefDto })
  student: FeeStudentRefDto;

  @ApiProperty({ example: 8 })
  class_id: number;

  @ApiProperty({ example: 8, nullable: true })
  section_id: number | null;

  @ApiProperty({ example: 18000, description: 'Sum of the lines' })
  gross: number;

  @ApiProperty({ example: 1000 })
  discount: number;

  @ApiProperty({ example: 'Sibling concession', nullable: true })
  discount_reason: string | null;

  @ApiProperty({ example: 17000, description: 'gross − discount' })
  total: number;

  @ApiProperty({ example: 8000 })
  paid: number;

  @ApiProperty({ example: 9000 })
  balance: number;

  @ApiProperty({ enum: INVOICE_STATUSES, example: 'partly_paid' })
  status: InvoiceStatus;

  @ApiProperty({ example: true, description: 'Balance left after the due date' })
  is_overdue: boolean;

  @ApiProperty({ example: 31, description: 'Days past the due date; 0 when not overdue' })
  days_overdue: number;

  @ApiProperty({ example: null, nullable: true })
  cancel_reason: string | null;

  @ApiProperty({ example: '2026-09-03T10:00:00.000+05:30' })
  created_at: Date;
}

export class FeeInvoiceDetailDto extends FeeInvoiceDto {
  @ApiProperty({ type: [InvoiceLineDto] })
  lines: InvoiceLineDto[];

  @ApiProperty({ type: [FeePaymentDto] })
  payments: FeePaymentDto[];
}

export class LastPaymentDto {
  @ApiProperty({ example: '2026-10-28' })
  date: string;

  @ApiProperty({ example: 5000 })
  amount: number;
}

export class FeeStatusDto {
  @ApiProperty({ enum: STUDENT_FEE_STATUSES, example: 'overdue' })
  status: StudentFeeStatus;

  @ApiProperty({ example: 9000 })
  balance: number;

  @ApiProperty({ example: '2026-12-03', nullable: true })
  next_due_date: string | null;

  @ApiProperty({ example: 4000 })
  overdue_amount: number;
}

export class FeeTotalsDto extends FeeStatusDto {
  @ApiProperty({ example: 31000 })
  total: number;

  @ApiProperty({ example: 22000 })
  paid: number;

  @ApiProperty({ type: LastPaymentDto, nullable: true })
  last_payment: LastPaymentDto | null;
}

export class StudentFeesDto extends FeeTotalsDto {
  @ApiProperty({ type: FeeStudentRefDto })
  student: FeeStudentRefDto;

  @ApiProperty({ type: [FeeInvoiceDetailDto], description: 'This year, cancelled invoices last' })
  invoices: FeeInvoiceDetailDto[];

  @ApiProperty({ type: [FeePaymentDto], description: 'Newest first' })
  payments: FeePaymentDto[];
}

export class SectionFeeRowDto extends FeeTotalsDto {
  @ApiProperty({ example: 12 })
  student_id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ example: 'TZMS-2026-0012' })
  admission_no: string;

  @ApiProperty({ example: 12, nullable: true })
  roll_no: number | null;

  @ApiProperty({ example: null, nullable: true })
  photo_file_id: number | null;
}

export class SectionFeesDto {
  @ApiProperty({ example: 8 })
  section_id: number;

  @ApiProperty({ example: '6 - A' })
  class_section: string;

  @ApiProperty({ example: { paid: 3, partly_paid: 2, due: 2, overdue: 2 } })
  counts: Record<StudentFeeStatus, number>;

  @ApiProperty({ example: 12000, description: 'Overdue amount across the section' })
  overdue_amount: number;

  @ApiProperty({ type: [SectionFeeRowDto] })
  students: SectionFeeRowDto[];
}

export class ModeTotalDto {
  @ApiProperty({ enum: PAYMENT_MODES, example: 'upi' })
  mode: PaymentMode;

  @ApiProperty({ example: 12 })
  count: number;

  @ApiProperty({ example: 84500 })
  amount: number;
}

export class PaymentSummaryDto {
  @ApiProperty({ example: 31 })
  count: number;

  @ApiProperty({ example: 212000 })
  amount: number;

  @ApiProperty({ type: [ModeTotalDto] })
  by_mode: ModeTotalDto[];
}

export class FeeInsightsDto {
  @ApiProperty({ example: '2026-27' })
  academic_year: string;

  @ApiProperty({ example: 41, description: 'Invoices this year, not cancelled' })
  invoices: number;

  @ApiProperty({ example: 1250000 })
  total_billed: number;

  @ApiProperty({ example: 640000 })
  collected: number;

  @ApiProperty({ example: 610000 })
  outstanding: number;

  @ApiProperty({ example: 182000 })
  overdue_amount: number;

  @ApiProperty({ example: 9, description: 'Students with an overdue balance' })
  students_overdue: number;

  @ApiProperty({ example: 12500 })
  todays_collection: number;

  @ApiProperty({ example: 3 })
  todays_payments: number;

  @ApiProperty({ example: { unpaid: 20, partly_paid: 8, paid: 13 } })
  by_status: Record<Exclude<InvoiceStatus, 'cancelled'>, number>;
}

export class ReminderRunDto {
  @ApiProperty({ example: 4, description: 'Overdue invoices whose parents were reminded now' })
  sent: number;
}
