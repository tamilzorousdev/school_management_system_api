import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
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
import { FEE_FREQUENCIES, FeeFrequency } from '../entities/fee-head.entity';
import { INVOICE_STATUSES, InvoiceStatus } from '../entities/fee-invoice.entity';
import {
  FEE_AUDIT_ACTIONS,
  FEE_AUDIT_ENTITIES,
  FeeAuditAction,
  FeeAuditEntity,
} from '../entities/fee-audit-log.entity';
import {
  MANUAL_PAYMENT_MODES,
  ManualPaymentMode,
  PAYMENT_MODES,
  PAYMENT_STATUSES,
  PaymentMode,
  PaymentStatus,
} from '../entities/fee-payment.entity';
import {
  BENEFIT_CALC_TYPES,
  BENEFIT_KINDS,
  BENEFIT_TYPES,
  BenefitCalcType,
  BenefitKind,
  BenefitType,
} from '../entities/fee-benefit.entity';
import { PLAN_VERSION_STATUSES, PlanVersionStatus } from '../entities/fee-plan-version.entity';
import { AWARD_STATUSES, AwardStatus } from '../entities/student-fee-benefit.entity';
import {
  FEE_REQUEST_KINDS,
  FEE_REQUEST_STATUSES,
  FeeRequestKind,
  FeeRequestStatus,
} from '../entities/fee-request.entity';
import { LATE_FEE_TYPES, LateFeeType } from '../entities/fee-settings.entity';
import { ORDER_STATUSES, OrderStatus } from '../entities/fee-payment-order.entity';
import { STUDENT_FEE_STATUSES, StudentFeeStatus } from '../fees.logic';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

export class FeeHeadDetailsDto {
  @ApiPropertyOptional({ example: 'Charged for every student, every term', nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiPropertyOptional({
    example: 'Academic',
    nullable: true,
    description: 'Group used to sort and report heads, such as Academic, Activities or Transport',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  fee_group?: string | null;

  @ApiPropertyOptional({ default: true, description: 'false: an optional fee such as sports or uniform' })
  @IsOptional()
  @IsBoolean()
  is_mandatory?: boolean;

  @ApiPropertyOptional({ enum: FEE_FREQUENCIES, default: 'custom', description: 'How often the head is charged' })
  @IsOptional()
  @IsIn(FEE_FREQUENCIES)
  frequency?: FeeFrequency;

  @ApiPropertyOptional({ default: false, description: 'Whether the school refunds it when a student leaves' })
  @IsOptional()
  @IsBoolean()
  is_refundable?: boolean;

  @ApiPropertyOptional({
    type: [Number],
    example: [5, 6, 7],
    description: 'Classes the head may be planned for. Empty means every class.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  applicable_class_ids?: number[];
}

export class FeeHeadInputDto extends FeeHeadDetailsDto {
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

export class UpdateFeeHeadDto extends FeeHeadDetailsDto {
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

  @ApiPropertyOptional({ description: 'true: mandatory heads only; false: optional heads only' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  is_mandatory?: boolean;

  @ApiPropertyOptional({ enum: FEE_FREQUENCIES })
  @IsOptional()
  @IsIn(FEE_FREQUENCIES)
  frequency?: FeeFrequency;

  @ApiPropertyOptional({ example: 'Academic' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  fee_group?: string;
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

  @ApiProperty({ example: null, nullable: true })
  description: string | null;

  @ApiProperty({ example: 'Academic', nullable: true })
  fee_group: string | null;

  @ApiProperty({ example: true })
  is_mandatory: boolean;

  @ApiProperty({ enum: FEE_FREQUENCIES, example: 'per_term' })
  frequency: FeeFrequency;

  @ApiProperty({ example: false })
  is_refundable: boolean;

  @ApiProperty({ type: [Number], example: [], description: 'Empty means every class' })
  applicable_class_ids: number[];

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

  @ApiProperty({
    type: [FeePlanLineInputDto],
    description: 'Every line of the draft. The published plan changes only when the draft is approved.',
  })
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

  @ApiProperty({ example: 2, nullable: true, description: 'Published version; null when nothing is published yet' })
  version: number | null;

  @ApiProperty({ type: () => FeePlanVersionDto, nullable: true, description: 'Draft or change waiting for approval' })
  draft: FeePlanVersionDto | null;
}

export class PlanUserDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 'Lakshmi Raman' })
  name: string;
}

export class FeePlanVersionLineDto {
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

export class FeePlanVersionDto {
  @ApiProperty({ example: 14 })
  id: number;

  @ApiProperty({ example: 3 })
  version: number;

  @ApiProperty({ enum: PLAN_VERSION_STATUSES, example: 'pending_approval' })
  status: PlanVersionStatus;

  @ApiProperty({ type: [FeePlanVersionLineDto] })
  lines: FeePlanVersionLineDto[];

  @ApiProperty({ type: [InstallmentTotalDto] })
  installments: InstallmentTotalDto[];

  @ApiProperty({ example: 29500 })
  total: number;

  @ApiProperty({ example: 'Tuition up 5% from Term 2', nullable: true })
  note: string | null;

  @ApiProperty({ type: PlanUserDto, nullable: true })
  created_by: PlanUserDto | null;

  @ApiProperty({ type: PlanUserDto, nullable: true })
  submitted_by: PlanUserDto | null;

  @ApiProperty({ example: '2026-11-18T10:00:00.000+05:30', nullable: true })
  submitted_at: Date | null;

  @ApiProperty({ type: PlanUserDto, nullable: true })
  reviewed_by: PlanUserDto | null;

  @ApiProperty({ example: null, nullable: true })
  reviewed_at: Date | null;

  @ApiProperty({ example: null, nullable: true, description: 'Why it was sent back, or the approver’s note' })
  review_comment: string | null;

  @ApiProperty({ example: null, nullable: true })
  published_at: Date | null;

  @ApiProperty({ example: '2026-11-18T09:40:00.000+05:30' })
  updated_at: Date;
}

export class SubmitPlanDto {
  @ApiPropertyOptional({ example: 'Tuition up 5% from Term 2' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class ReviewPlanDto {
  @ApiPropertyOptional({ example: 'Checked with the management' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  comment?: string;
}

export class RejectPlanDto {
  @ApiProperty({ example: 'Term 3 due date is a holiday' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  comment: string;
}

export class CopyPlanDto {
  @ApiPropertyOptional({ example: 2, description: 'Defaults to the current academic year' })
  @IsOptional()
  @IsInt()
  @Min(1)
  academic_year_id?: number;

  @ApiProperty({ type: [Number], example: [9, 10], description: 'Classes that get a draft copy' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  to_class_ids: number[];
}

export class CopyYearDto {
  @ApiProperty({ example: 1, description: 'Year whose plans in use are copied' })
  @IsInt()
  @Min(1)
  from_academic_year_id: number;

  @ApiPropertyOptional({ example: 2, description: 'Defaults to the current academic year' })
  @IsOptional()
  @IsInt()
  @Min(1)
  to_academic_year_id?: number;

  @ApiPropertyOptional({ type: [Number], example: [], description: 'Only these classes; leave out for every class' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  class_ids?: number[];
}

export class CopyPlanRowDto {
  @ApiProperty({ example: 9 })
  class_id: number;

  @ApiProperty({ example: '7' })
  class_name: string;

  @ApiProperty({ enum: ['drafted', 'skipped'], example: 'drafted' })
  status: 'drafted' | 'skipped';

  @ApiProperty({ example: 2, nullable: true, description: 'Draft version created or updated' })
  version: number | null;

  @ApiProperty({ example: 6, description: 'Lines copied' })
  lines: number;

  @ApiProperty({ example: 1, description: 'Lines left out: heads switched off, transport or not for this class' })
  left_out: number;

  @ApiProperty({ example: null, nullable: true, description: 'Why the class was skipped' })
  reason: string | null;
}

export class CopyPlanResultDto {
  @ApiProperty({ example: 3 })
  drafted: number;

  @ApiProperty({ example: 1 })
  skipped: number;

  @ApiProperty({ type: [CopyPlanRowDto] })
  classes: CopyPlanRowDto[];
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

  @ApiProperty({ example: 2, nullable: true, description: 'Published version' })
  version: number | null;

  @ApiProperty({
    enum: ['draft', 'pending_approval'],
    example: null,
    nullable: true,
    description: 'A change being prepared or waiting for approval',
  })
  draft_status: 'draft' | 'pending_approval' | null;
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

  @ApiProperty({ example: 5, description: 'Of the new invoices, how many have a concession or scholarship' })
  with_benefits: number;

  @ApiProperty({ example: 21000, description: 'Concessions and scholarships taken off the new invoices' })
  benefit_amount: number;

  @ApiProperty({ example: 598500, description: 'Billed after concessions and scholarships' })
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

  @ApiProperty({ example: 'Sibling concession agreed by the principal', description: 'Why, for the approver' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason: string;
}

export class CancelInvoiceDto {
  @ApiProperty({ example: 'Raised twice by mistake' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason: string;
}

export class PaymentInputDto {
  @ApiProperty({ example: 5000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10000000)
  amount: number;

  @ApiProperty({ enum: MANUAL_PAYMENT_MODES, example: 'upi' })
  @IsIn(MANUAL_PAYMENT_MODES)
  mode: ManualPaymentMode;

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

  @ApiPropertyOptional({ enum: PAYMENT_STATUSES, description: 'Leave out to list every payment, reversed ones too' })
  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  status?: PaymentStatus;
}

export class ReversePaymentDto {
  @ApiProperty({ example: 'Cheque bounced', description: 'Why the payment is being reversed' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason: string;
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

export class InvoiceBenefitDto {
  @ApiProperty({ example: 4 })
  benefit_id: number;

  @ApiProperty({ enum: BENEFIT_KINDS, example: 'concession' })
  kind: BenefitKind;

  @ApiProperty({ example: 'Sibling concession' })
  name: string;

  @ApiProperty({ example: 1, nullable: true })
  fee_head_id: number | null;

  @ApiProperty({ example: 1250 })
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

  @ApiProperty({
    enum: PAYMENT_STATUSES,
    example: 'success',
    description: 'reversed: the payment was taken back and no longer counts towards paid',
  })
  status: PaymentStatus;

  @ApiProperty({ example: null, nullable: true })
  reversed_at: Date | null;

  @ApiProperty({ example: null, nullable: true, description: 'Who reversed it' })
  reversed_by: string | null;

  @ApiProperty({ example: null, nullable: true })
  reversal_reason: string | null;

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

  @ApiProperty({ example: 1250, description: 'Concessions and scholarships, applied when the invoice was raised' })
  benefit: number;

  @ApiProperty({ example: 1000 })
  discount: number;

  @ApiProperty({ example: 'Sibling concession', nullable: true })
  discount_reason: string | null;

  @ApiProperty({ example: null, nullable: true, description: 'First due date, when the due date was moved' })
  original_due_date: string | null;

  @ApiProperty({ example: 0, description: 'Late fee added after the grace days (part of gross)' })
  late_fee: number;

  @ApiProperty({ example: 0, description: 'Refunded to the parent; paid still shows what was received' })
  refunded: number;

  @ApiProperty({ example: 15750, description: 'gross − benefit − discount' })
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

  @ApiProperty({ type: [InvoiceBenefitDto], description: 'Concessions first, then scholarships, per fee head' })
  benefits: InvoiceBenefitDto[];

  @ApiProperty({ type: () => [FeeRefundDto], description: 'Money returned on this invoice' })
  refunds: FeeRefundDto[];

  @ApiProperty({
    type: () => [PendingRequestDto],
    description: 'Discounts, cancellation, reversals and refunds waiting for approval',
  })
  pending_requests: PendingRequestDto[];

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

export class PreviousDuesDto {
  @ApiProperty({ example: 4500, description: 'Unpaid balance of invoices from earlier academic years' })
  amount: number;

  @ApiProperty({ example: 1 })
  invoices: number;

  @ApiProperty({ type: [String], example: ['2025-26'] })
  academic_years: string[];
}

export class AdvanceReceiptDto {
  @ApiProperty({ example: 12, description: 'Use with the advance receipt PDF route' })
  collection_id: number;

  @ApiProperty({ example: 'TZMS-RCP-2026-0042' })
  receipt_no: string;

  @ApiProperty({ example: 2000, description: 'Part of the payment kept as advance' })
  amount: number;

  @ApiProperty({ example: 11000, description: 'Whole amount paid that day' })
  collected: number;

  @ApiProperty({ enum: PAYMENT_MODES, example: 'upi' })
  mode: PaymentMode;

  @ApiProperty({ example: '2026-11-18' })
  paid_on: string;
}

export class StudentFeesDto extends FeeTotalsDto {
  @ApiProperty({ type: FeeStudentRefDto })
  student: FeeStudentRefDto;

  @ApiProperty({ example: 2000, description: 'Advance paid and not yet used; used on the next invoices' })
  credit_balance: number;

  @ApiProperty({
    type: PreviousDuesDto,
    description: 'Already counted in balance; shown apart so parents see what is left from earlier years',
  })
  previous_dues: PreviousDuesDto;

  @ApiProperty({
    type: [FeeInvoiceDetailDto],
    description: 'Every year, newest due date first, cancelled invoices last',
  })
  invoices: FeeInvoiceDetailDto[];

  @ApiProperty({ type: [FeePaymentDto], description: 'Newest first' })
  payments: FeePaymentDto[];

  @ApiProperty({ type: [AdvanceReceiptDto], description: 'Payments with a part kept as advance, newest first' })
  advances: AdvanceReceiptDto[];
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

  @ApiProperty({ example: 2000, description: 'Advance received today (paid ahead, kept as credit)' })
  todays_advance: number;

  @ApiProperty({ example: { unpaid: 20, partly_paid: 8, paid: 13 } })
  by_status: Record<Exclude<InvoiceStatus, 'cancelled'>, number>;

  @ApiProperty({ example: 42000, description: 'Concessions and scholarships on this year’s invoices' })
  concessions: number;

  @ApiProperty({ example: 8000 })
  discounts: number;

  @ApiProperty({ example: 1200 })
  late_fees: number;

  @ApiProperty({ example: 5000, description: 'Refunded to parents this year' })
  refunded: number;

  @ApiProperty({ example: 3, description: 'Discounts, cancellations, reversals, refunds and due date changes waiting' })
  pending_requests: number;
}

export class ReminderRunDto {
  @ApiProperty({ example: 4, description: 'Overdue invoices whose parents were reminded now' })
  sent: number;
}

export class FeeAuditQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: FEE_AUDIT_ENTITIES })
  @IsOptional()
  @IsIn(FEE_AUDIT_ENTITIES)
  entity?: FeeAuditEntity;

  @ApiPropertyOptional({ example: 21, description: 'Id of the head, invoice or payment; class id for fee_plan' })
  @IsOptional()
  @IsInt()
  @Min(1)
  entity_id?: number;

  @ApiPropertyOptional({ enum: FEE_AUDIT_ACTIONS })
  @IsOptional()
  @IsIn(FEE_AUDIT_ACTIONS)
  action?: FeeAuditAction;

  @ApiPropertyOptional({ example: 4, description: 'Who made the change' })
  @IsOptional()
  @IsInt()
  @Min(1)
  user_id?: number;

  @IsDateOnly('2026-11-01', true)
  from?: string;

  @IsDateOnly('2026-11-30', true)
  to?: string;
}

export class AuditUserDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 'Lakshmi Raman' })
  name: string;
}

export class FeeAuditLogDto {
  @ApiProperty({ example: 88 })
  id: number;

  @ApiProperty({ enum: FEE_AUDIT_ENTITIES, example: 'fee_payment' })
  entity: FeeAuditEntity;

  @ApiProperty({ example: 7, nullable: true, description: 'null for an invoice run' })
  entity_id: number | null;

  @ApiProperty({ enum: FEE_AUDIT_ACTIONS, example: 'reversed' })
  action: FeeAuditAction;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { status: 'success', invoice: { paid: 5000, balance: 4000, status: 'partly_paid' } },
  })
  before: Record<string, unknown> | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { status: 'reversed', invoice: { paid: 0, balance: 9000, status: 'unpaid' } },
  })
  after: Record<string, unknown> | null;

  @ApiProperty({ example: 'Cheque bounced', nullable: true })
  reason: string | null;

  @ApiProperty({ type: AuditUserDto, nullable: true, description: 'null for automatic changes' })
  user: AuditUserDto | null;

  @ApiProperty({ example: '2026-11-18T10:15:00.000+05:30' })
  created_at: Date;
}

export class InvoiceMismatchDto {
  @ApiProperty({ example: 21 })
  invoice_id: number;

  @ApiProperty({ example: 'TZMS-FEE-2026-0021' })
  invoice_no: string;

  @ApiProperty({ example: 12 })
  student_id: number;

  @ApiProperty({ enum: INVOICE_STATUSES, example: 'partly_paid' })
  status: InvoiceStatus;

  @ApiProperty({ example: 9000 })
  gross: number;

  @ApiProperty({ example: 0 })
  benefit: number;

  @ApiProperty({ example: 0 })
  discount: number;

  @ApiProperty({ example: 9000 })
  total: number;

  @ApiProperty({ example: 5000, description: 'Paid as stored on the invoice' })
  paid: number;

  @ApiProperty({ example: 4000 })
  balance: number;

  @ApiProperty({ example: 4000, description: 'Sum of the payments that are not reversed' })
  payments_total: number;
}

export class ReconciliationDto {
  @ApiProperty({ example: 1240 })
  invoices_checked: number;

  @ApiProperty({
    type: [InvoiceMismatchDto],
    description: 'Invoices whose paid, total or balance do not match their payments. Empty when everything agrees.',
  })
  mismatches: InvoiceMismatchDto[];
}

export class BenefitQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: 2, description: 'Defaults to the current academic year' })
  @IsOptional()
  @IsInt()
  @Min(1)
  academic_year_id?: number;

  @ApiPropertyOptional({ enum: BENEFIT_KINDS })
  @IsOptional()
  @IsIn(BENEFIT_KINDS)
  kind?: BenefitKind;

  @ApiPropertyOptional({ enum: BENEFIT_TYPES })
  @IsOptional()
  @IsIn(BENEFIT_TYPES)
  type?: BenefitType;

  @ApiPropertyOptional({ description: 'true: switched on only; false: switched off only' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  is_active?: boolean;
}

export class BenefitInputDto {
  @ApiPropertyOptional({ example: 2, description: 'Defaults to the current academic year' })
  @IsOptional()
  @IsInt()
  @Min(1)
  academic_year_id?: number;

  @ApiProperty({ enum: BENEFIT_KINDS, example: 'concession' })
  @IsIn(BENEFIT_KINDS)
  kind: BenefitKind;

  @ApiProperty({ example: 'Sibling concession' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @ApiProperty({
    enum: BENEFIT_TYPES,
    example: 'sibling',
    description:
      'Concession: sibling, staff_child, merit, sports, financial, management, other. Scholarship (who funds it): government, institution, trust, private, other.',
  })
  @IsIn(BENEFIT_TYPES)
  type: BenefitType;

  @ApiProperty({ enum: BENEFIT_CALC_TYPES, example: 'percent' })
  @IsIn(BENEFIT_CALC_TYPES)
  calc_type: BenefitCalcType;

  @ApiProperty({ example: 10, description: 'Percent (up to 100) or a yearly amount in rupees' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10000000)
  value: number;

  @ApiPropertyOptional({
    type: [Number],
    example: [1],
    description: 'Fee heads it applies to. Empty means every head except transport.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  fee_head_ids?: number[];

  @ApiPropertyOptional({ type: [Number], example: [], description: 'Classes it is open to. Empty means every class.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  class_ids?: number[];

  @ApiPropertyOptional({ example: 'For the second and later children of the same parents', nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateBenefitDto extends PartialType(OmitType(BenefitInputDto, ['academic_year_id', 'kind'] as const)) {}

export class FeeBenefitDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 2 })
  academic_year_id: number;

  @ApiProperty({ enum: BENEFIT_KINDS, example: 'concession' })
  kind: BenefitKind;

  @ApiProperty({ example: 'Sibling concession' })
  name: string;

  @ApiProperty({ enum: BENEFIT_TYPES, example: 'sibling' })
  type: BenefitType;

  @ApiProperty({ enum: BENEFIT_CALC_TYPES, example: 'percent' })
  calc_type: BenefitCalcType;

  @ApiProperty({ example: 10 })
  value: number;

  @ApiProperty({ type: [Number], example: [1] })
  fee_head_ids: number[];

  @ApiProperty({ type: [Number], example: [] })
  class_ids: number[];

  @ApiProperty({ example: null, nullable: true })
  description: string | null;

  @ApiProperty({ example: true })
  is_active: boolean;

  @ApiProperty({ example: 12, description: 'Students who have it now' })
  active_awards: number;

  @ApiProperty({ example: 18500, description: 'Taken off invoices that are not cancelled' })
  amount_given: number;

  @ApiProperty({ example: '2026-11-18T10:00:00.000+05:30' })
  created_at: Date;
}

export class AwardQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: 2, description: 'Defaults to the current academic year' })
  @IsOptional()
  @IsInt()
  @Min(1)
  academic_year_id?: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  benefit_id?: number;

  @ApiPropertyOptional({ enum: BENEFIT_KINDS })
  @IsOptional()
  @IsIn(BENEFIT_KINDS)
  kind?: BenefitKind;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  @Min(1)
  student_id?: number;

  @ApiPropertyOptional({ enum: AWARD_STATUSES })
  @IsOptional()
  @IsIn(AWARD_STATUSES)
  status?: AwardStatus;
}

export class AwardInputDto {
  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(1)
  benefit_id: number;

  @ApiProperty({ type: [Number], example: [12, 15] })
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  student_ids: number[];

  @ApiProperty({ example: 'Elder brother in class 9' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason: string;
}

export class RevokeAwardDto {
  @ApiProperty({ example: 'Sibling left the school' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason: string;
}

export class AwardBenefitRefDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ enum: BENEFIT_KINDS, example: 'concession' })
  kind: BenefitKind;

  @ApiProperty({ example: 'Sibling concession' })
  name: string;

  @ApiProperty({ enum: BENEFIT_CALC_TYPES, example: 'percent' })
  calc_type: BenefitCalcType;

  @ApiProperty({ example: 10 })
  value: number;
}

export class FeeAwardDto {
  @ApiProperty({ example: 31 })
  id: number;

  @ApiProperty({ type: FeeStudentRefDto })
  student: FeeStudentRefDto;

  @ApiProperty({ type: AwardBenefitRefDto })
  benefit: AwardBenefitRefDto;

  @ApiProperty({ enum: AWARD_STATUSES, example: 'active' })
  status: AwardStatus;

  @ApiProperty({ example: 'Elder brother in class 9', nullable: true })
  reason: string | null;

  @ApiProperty({ type: PlanUserDto, nullable: true })
  awarded_by: PlanUserDto | null;

  @ApiProperty({ example: '2026-11-18T10:00:00.000+05:30' })
  awarded_at: Date;

  @ApiProperty({ example: null, nullable: true })
  revoked_at: Date | null;

  @ApiProperty({ type: PlanUserDto, nullable: true })
  revoked_by: PlanUserDto | null;

  @ApiProperty({ example: null, nullable: true })
  revoke_reason: string | null;

  @ApiProperty({ example: 2500, description: 'Taken off this student’s invoices that are not cancelled' })
  amount_given: number;
}

export class AwardResultDto {
  @ApiProperty({ example: 2 })
  awarded: number;

  @ApiProperty({ example: 1, description: 'Students who already had it' })
  already_awarded: number;

  @ApiProperty({ type: [FeeAwardDto] })
  items: FeeAwardDto[];
}

export const REPORT_COLUMN_KINDS = ['text', 'money', 'number', 'percent', 'date'] as const;

export class FeeReportQueryDto {
  @ApiPropertyOptional({ example: 2, description: 'Defaults to the current academic year' })
  @IsOptional()
  @IsInt()
  @Min(1)
  academic_year_id?: number;

  @ApiPropertyOptional({ example: 8 })
  @IsOptional()
  @IsInt()
  @Min(1)
  class_id?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  @Min(1)
  section_id?: number;

  @ApiPropertyOptional({ example: 'Term 1' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  installment?: string;

  @ApiPropertyOptional({ example: 1, description: 'heads report only' })
  @IsOptional()
  @IsInt()
  @Min(1)
  fee_head_id?: number;

  @ApiPropertyOptional({ enum: BENEFIT_KINDS, description: 'benefits report only' })
  @IsOptional()
  @IsIn(BENEFIT_KINDS)
  kind?: BenefitKind;

  @ApiPropertyOptional({ description: 'defaulters report: only students with an overdue balance' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  overdue_only?: boolean;

  @IsDateOnly('2026-11-01', true)
  from?: string;

  @IsDateOnly('2026-11-30', true)
  to?: string;
}

export class ReportColumnDto {
  @ApiProperty({ example: 'collected' })
  key: string;

  @ApiProperty({ example: 'Collected' })
  label: string;

  @ApiProperty({ enum: REPORT_COLUMN_KINDS, example: 'money' })
  kind: (typeof REPORT_COLUMN_KINDS)[number];
}

export class FeeReportDto {
  @ApiProperty({ example: 'Class-wise collection' })
  title: string;

  @ApiProperty({ example: '2026-27' })
  academic_year: string;

  @ApiProperty({ example: null, nullable: true })
  note: string | null;

  @ApiProperty({ example: null, nullable: true, description: 'collections report: the date range used' })
  from: string | null;

  @ApiProperty({ example: null, nullable: true })
  to: string | null;

  @ApiProperty({ type: [ReportColumnDto] })
  columns: ReportColumnDto[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    example: [{ class_name: 'Class 6', billed: 420000, collected: 310000 }],
    description: 'One object per row, keyed by the column keys',
  })
  rows: Record<string, string | number | null>[];

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { class_name: 'Total', billed: 2400000 },
  })
  totals: Record<string, string | number | null> | null;
}

export class RefundInputDto {
  @ApiProperty({ example: 2000, description: 'At most the paid amount of refundable fee heads, less earlier refunds' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10000000)
  amount: number;

  @ApiProperty({ enum: MANUAL_PAYMENT_MODES, example: 'bank_transfer' })
  @IsIn(MANUAL_PAYMENT_MODES)
  mode: ManualPaymentMode;

  @ApiPropertyOptional({ example: 'NEFT N1234', nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  reference?: string | null;

  @IsDateOnly('2026-11-18', true)
  paid_on?: string;

  @ApiProperty({ example: 'Caution deposit returned on leaving' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason: string;
}

export class RescheduleInputDto {
  @IsDateOnly('2026-12-20')
  due_date: string;

  @ApiProperty({ example: 'Parent asked for time till the salary date' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason: string;
}

export class FeeRequestQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: FEE_REQUEST_STATUSES })
  @IsOptional()
  @IsIn(FEE_REQUEST_STATUSES)
  status?: FeeRequestStatus;

  @ApiPropertyOptional({ enum: FEE_REQUEST_KINDS })
  @IsOptional()
  @IsIn(FEE_REQUEST_KINDS)
  kind?: FeeRequestKind;

  @ApiPropertyOptional({ example: 21 })
  @IsOptional()
  @IsInt()
  @Min(1)
  invoice_id?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  @Min(1)
  student_id?: number;
}

export class DecideRequestDto {
  @ApiPropertyOptional({ example: 'Checked with the parent' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  comment?: string;
}

export class RejectRequestDto {
  @ApiProperty({ example: 'Discount is above the sibling policy' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  comment: string;
}

export class RequestInvoiceRefDto {
  @ApiProperty({ example: 21 })
  id: number;

  @ApiProperty({ example: 'TZMS-FEE-2026-0021' })
  invoice_no: string;

  @ApiProperty({ example: 'Term 1' })
  installment: string;

  @ApiProperty({ example: 18000 })
  gross: number;

  @ApiProperty({ example: 17000 })
  total: number;

  @ApiProperty({ example: 9000 })
  paid: number;

  @ApiProperty({ example: 8000 })
  balance: number;

  @ApiProperty({ enum: INVOICE_STATUSES, example: 'partly_paid' })
  status: InvoiceStatus;
}

export class RequestPaymentRefDto {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({ example: 'TZMS-RCP-2026-0007' })
  receipt_no: string;

  @ApiProperty({ example: 5000 })
  amount: number;

  @ApiProperty({ example: 'cheque' })
  mode: string;

  @ApiProperty({ example: '2026-11-02' })
  paid_on: string;
}

export class FeeRequestDto {
  @ApiProperty({ example: 5 })
  id: number;

  @ApiProperty({ enum: FEE_REQUEST_KINDS, example: 'discount' })
  kind: FeeRequestKind;

  @ApiProperty({ enum: FEE_REQUEST_STATUSES, example: 'pending' })
  status: FeeRequestStatus;

  @ApiProperty({ type: RequestInvoiceRefDto })
  invoice: RequestInvoiceRefDto;

  @ApiProperty({ type: RequestPaymentRefDto, nullable: true, description: 'Reversal only' })
  payment: RequestPaymentRefDto | null;

  @ApiProperty({ type: FeeStudentRefDto })
  student: FeeStudentRefDto;

  @ApiProperty({
    example: 1500,
    nullable: true,
    description: 'discount: the new discount; refund: the amount; reversal: the payment amount',
  })
  amount: number | null;

  @ApiProperty({ example: { mode: 'bank_transfer', reference: 'NEFT N1234', paid_on: '2026-11-18' } })
  details: Record<string, unknown>;

  @ApiProperty({ example: 'Sibling concession agreed by the principal' })
  reason: string;

  @ApiProperty({ type: PlanUserDto, nullable: true })
  requested_by: PlanUserDto | null;

  @ApiProperty({ example: '2026-11-18T10:00:00.000+05:30' })
  requested_at: Date;

  @ApiProperty({ type: PlanUserDto, nullable: true })
  decided_by: PlanUserDto | null;

  @ApiProperty({ example: null, nullable: true })
  decided_at: Date | null;

  @ApiProperty({ example: null, nullable: true })
  decision_comment: string | null;
}

export class FeeRefundDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'TZMS-RFD-2026-0003' })
  refund_no: string;

  @ApiProperty({ example: 2000 })
  amount: number;

  @ApiProperty({ enum: PAYMENT_MODES, example: 'bank_transfer' })
  mode: PaymentMode;

  @ApiProperty({ example: 'NEFT N1234', nullable: true })
  reference: string | null;

  @ApiProperty({ example: '2026-11-18' })
  paid_on: string;

  @ApiProperty({ example: 'Caution deposit returned on leaving' })
  reason: string;
}

export class PendingRequestDto {
  @ApiProperty({ example: 5 })
  id: number;

  @ApiProperty({ example: { due_date: '2026-12-20', old_due_date: '2026-12-10' } })
  details: Record<string, unknown>;

  @ApiProperty({ enum: FEE_REQUEST_KINDS, example: 'discount' })
  kind: FeeRequestKind;

  @ApiProperty({ example: 1500, nullable: true })
  amount: number | null;

  @ApiProperty({ example: 7, nullable: true })
  payment_id: number | null;

  @ApiProperty({ example: 'Sibling concession agreed by the principal' })
  reason: string;

  @ApiProperty({ type: PlanUserDto, nullable: true })
  requested_by: PlanUserDto | null;

  @ApiProperty({ example: '2026-11-18T10:00:00.000+05:30' })
  requested_at: Date;
}

export class FeeSettingsInputDto {
  @ApiProperty({ example: 7, description: 'Days after the due date before the late fee and overdue reminders start' })
  @IsInt()
  @Min(0)
  @Max(90)
  grace_days: number;

  @ApiProperty({ enum: LATE_FEE_TYPES, example: 'flat' })
  @IsIn(LATE_FEE_TYPES)
  late_fee_type: LateFeeType;

  @ApiProperty({ example: 100, description: 'Rupees for flat, percent of the unpaid balance for percent; 0 for none' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  late_fee_value: number;
}

export class FeeSettingsDto extends FeeSettingsInputDto {
  @ApiProperty({ type: PlanUserDto, nullable: true })
  updated_by: PlanUserDto | null;

  @ApiProperty({ example: null, nullable: true })
  updated_at: Date | null;
}

export class LateFeeRunDto {
  @ApiProperty({ example: 12, description: 'Invoices that got a late fee now' })
  invoices: number;

  @ApiProperty({ example: 1200 })
  amount: number;
}

export class CollectionPaymentDto {
  @ApiProperty({ example: 41 })
  id: number;

  @ApiProperty({ example: 21 })
  invoice_id: number;

  @ApiProperty({ example: 'TZMS-FEE-2026-0021' })
  invoice_no: string;

  @ApiProperty({ example: 'Term 1' })
  installment: string;

  @ApiProperty({ example: 9000 })
  amount: number;

  @ApiProperty({ example: 'TZMS-RCP-2026-0041' })
  receipt_no: string;

  @ApiProperty({ enum: PAYMENT_MODES, example: 'cash' })
  mode: PaymentMode;
}

export class CollectionResultDto {
  @ApiProperty({ example: 7, nullable: true })
  collection_id: number | null;

  @ApiProperty({ example: 20000 })
  amount: number;

  @ApiProperty({ example: 18000, description: 'Used on invoices, oldest due first' })
  applied_amount: number;

  @ApiProperty({ example: 2000, description: 'Kept as advance credit for the next invoices' })
  advance_amount: number;

  @ApiProperty({ example: 'TZMS-RCP-2026-0043', nullable: true, description: 'Receipt number for the advance' })
  advance_receipt_no: string | null;

  @ApiProperty({ example: 2000 })
  credit_balance: number;

  @ApiProperty({ example: false, description: 'true when the same Idempotency-Key was sent again' })
  replayed: boolean;

  @ApiProperty({ type: [CollectionPaymentDto] })
  payments: CollectionPaymentDto[];
}

export class OnlinePaymentStartDto {
  @ApiPropertyOptional({ example: 9000, description: 'Defaults to the whole balance; at most the balance' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10000000)
  amount?: number;
}

export class OnlinePaymentVerifyDto {
  @ApiProperty({ example: 'order_Nb7Ch9tq3Yd1aB' })
  @IsString()
  @Matches(/^order_[A-Za-z0-9]{6,30}$/)
  razorpay_order_id: string;

  @ApiProperty({ example: 'pay_Nb7DjE5tq3Yd2C' })
  @IsString()
  @Matches(/^pay_[A-Za-z0-9]{6,30}$/)
  razorpay_payment_id: string;

  @ApiProperty({ example: '9ef4dffbfd84f1318f6739a3ce19f9d85851857ae648f114332d8401e0949a3d' })
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  razorpay_signature: string;
}

export class PrefillDto {
  @ApiProperty({ example: 'Lakshmi Narayanan' })
  name: string;

  @ApiProperty({ example: '9000000005' })
  contact: string;
}

export class StartedOrderDto {
  @ApiProperty({ example: 'razorpay' })
  gateway: string;

  @ApiProperty({ example: 'rzp_test_1DP5mmOlF5G5ag', description: 'Pass to the Razorpay checkout as key' })
  key_id: string;

  @ApiProperty({ example: 'order_Nb7Ch9tq3Yd1aB' })
  order_id: string;

  @ApiProperty({ example: 900000 })
  amount_paise: number;

  @ApiProperty({ example: 9000 })
  amount: number;

  @ApiProperty({ example: 'INR' })
  currency: string;

  @ApiProperty({ example: 'Tamilzorous Model School' })
  name: string;

  @ApiProperty({ example: 'Term 1 fee · TZMS-FEE-2026-0021' })
  description: string;

  @ApiProperty({ type: PrefillDto })
  prefill: PrefillDto;
}

export class OnlineOrderQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: ORDER_STATUSES })
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;
}

export class OnlineOrderDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'razorpay' })
  gateway: string;

  @ApiProperty({ example: 'order_Nb7Ch9tq3Yd1aB' })
  gateway_order_id: string;

  @ApiProperty({ example: 'pay_Nb7DjE5tq3Yd2C', nullable: true })
  gateway_payment_id: string | null;

  @ApiProperty({ enum: ORDER_STATUSES, example: 'paid' })
  status: OrderStatus;

  @ApiProperty({ example: 9000 })
  amount: number;

  @ApiProperty({ example: 21 })
  invoice_id: number;

  @ApiProperty({ example: 'TZMS-FEE-2026-0021' })
  invoice_no: string;

  @ApiProperty({ type: FeeStudentRefDto })
  student: FeeStudentRefDto;

  @ApiProperty({ example: null, nullable: true })
  failure_reason: string | null;

  @ApiProperty({ example: null, nullable: true })
  paid_at: Date | null;

  @ApiProperty({ example: '2026-11-18T10:00:00.000+05:30' })
  created_at: Date;
}
