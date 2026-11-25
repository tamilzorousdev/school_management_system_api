import { ApiProperty, ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
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
  ValidateIf,
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import {
  ADMISSION_STATUSES,
  AdmissionStatus,
  APPLICATION_SOURCES,
  APPLICATION_STATUSES,
  ApplicationSource,
  ApplicationStatus,
  CHECKOUT_REASONS,
  CHECKOUT_STATUSES,
  CheckoutReason,
  CheckoutStatus,
  CLEARANCE_STATUSES,
  ClearanceStatus,
  Diet,
  DIETS,
  TRANSFER_KINDS,
  TransferKind,
} from '../entities/hostel-admission.entity';

const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const notNull = (_object: unknown, value: unknown) => value !== null && value !== undefined;
const MOBILE = /^[6-9]\d{9}$/;

export class HostelStudentDto {
  @ApiProperty({ example: 312 }) id: number;
  @ApiProperty({ example: 'Arun Kumar' }) name: string;
  @ApiProperty({ example: 'TZS-2026-0042' }) admission_no: string;
  @ApiProperty({ example: 'male' }) gender: string;
  @ApiProperty({ nullable: true, type: String, example: '8' }) class_name: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'A' }) section_name: string | null;
  @ApiProperty({ nullable: true, type: Number }) photo_file_id: number | null;
}

export class GuardianContactDto {
  @ApiProperty({ example: 'Kumar R' }) name: string;
  @ApiProperty({ example: '9000000005' }) mobile: string;
  @ApiProperty({ example: 'father' }) relation: string;
}

export class CurrentBedDto {
  @ApiProperty({ example: 41 }) bed_id: number;
  @ApiProperty({ example: 'B' }) bed_no: string;
  @ApiProperty({ example: 12 }) room_id: number;
  @ApiProperty({ example: 'A-101' }) room_no: string;
  @ApiProperty({ example: 'A Block' }) block_name: string;
  @ApiProperty({ example: 'Ground floor' }) floor_name: string;
  @ApiProperty({ example: '2026-06-02' }) from_date: string;
}

export class ApplicationDto {
  @ApiProperty({ example: 5 }) id: number;
  @ApiProperty({ example: 'HAP-2026-0005' }) application_no: string;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ nullable: true, type: Number }) hostel_id: number | null;
  @ApiProperty({ nullable: true, type: String, example: 'Boys Hostel' }) hostel_name: string | null;
  @ApiProperty({ nullable: true, type: Number }) room_type_id: number | null;
  @ApiProperty({ nullable: true, type: String }) room_type_name: string | null;
  @ApiProperty({ enum: APPLICATION_SOURCES }) source: ApplicationSource;
  @ApiProperty({ enum: APPLICATION_STATUSES }) status: ApplicationStatus;
  @ApiProperty({ example: 0, description: 'Higher comes first in the waitlist' }) priority: number;
  @ApiProperty({ nullable: true, type: String, example: '2026-06-01' }) wanted_from: string | null;
  @ApiProperty({ nullable: true, type: String }) reason: string | null;
  @ApiProperty({ nullable: true, type: String }) decision_note: string | null;
  @ApiProperty({ nullable: true, type: String }) decided_at: Date | null;
  @ApiProperty({ nullable: true, type: Number }) admission_id: number | null;
  @ApiProperty() created_at: Date;
}

export class ApplicationInputDto {
  @ApiProperty({ example: 312 }) @IsInt() @Min(1) student_id: number;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  hostel_id?: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  room_type_id?: number | null;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(100) priority?: number;
  @IsDateOnly('2026-06-01', true) wanted_from?: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}

export class ApplicationQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: APPLICATION_STATUSES })
  @IsOptional()
  @IsIn(APPLICATION_STATUSES)
  status?: ApplicationStatus;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
}

export class DecisionDto {
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  note?: string | null;
}

export class AdmissionDetailsInputDto {
  @ApiPropertyOptional({ enum: DIETS, default: 'veg' }) @IsOptional() @IsIn(DIETS) diet?: Diet;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Suresh M' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  local_guardian_name?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: '9000000020' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @Matches(MOBILE, { message: 'local_guardian_mobile must be a valid 10-digit Indian mobile number' })
  local_guardian_mobile?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'uncle' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(40)
  local_guardian_relation?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  local_guardian_address?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Asthma; inhaler in bag' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  medical_notes?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class AdmissionInputDto extends AdmissionDetailsInputDto {
  @ApiProperty({ example: 312 }) @IsInt() @Min(1) student_id: number;
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) hostel_id: number;
  @ApiPropertyOptional({ description: 'Approved application this admission fills' })
  @IsOptional()
  @IsInt()
  @Min(1)
  application_id?: number;
  @ApiPropertyOptional({ description: 'Allocate this vacant bed now. Leave out to allocate later.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  bed_id?: number;
  @IsDateOnly('2026-06-01', true) admitted_on?: string;
}

export class AdmissionUpdateDto extends PartialType(AdmissionDetailsInputDto) {}

export class AdmissionDto {
  @ApiProperty({ example: 21 }) id: number;
  @ApiProperty({ example: 'HST-2026-0021' }) admission_no: string;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ enum: ADMISSION_STATUSES }) status: AdmissionStatus;
  @ApiProperty({ example: '2026-06-01' }) admitted_on: string;
  @ApiProperty({ nullable: true, type: String }) checked_out_on: string | null;
  @ApiProperty({ enum: DIETS }) diet: Diet;
  @ApiProperty({ nullable: true, type: CurrentBedDto }) bed: CurrentBedDto | null;
  @ApiProperty({ nullable: true, type: GuardianContactDto }) primary_guardian: GuardianContactDto | null;
  @ApiProperty({ nullable: true, type: String }) local_guardian_name: string | null;
  @ApiProperty({ nullable: true, type: String }) local_guardian_mobile: string | null;
  @ApiProperty({ nullable: true, type: String }) local_guardian_relation: string | null;
  @ApiProperty({ nullable: true, type: String }) local_guardian_address: string | null;
  @ApiProperty({ nullable: true, type: String }) medical_notes: string | null;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
}

export class AllocationHistoryDto {
  @ApiProperty({ example: 9 }) id: number;
  @ApiProperty({ example: 'A-101' }) room_no: string;
  @ApiProperty({ example: 'B' }) bed_no: string;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ example: '2026-06-01' }) from_date: string;
  @ApiProperty({ nullable: true, type: String }) to_date: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'transfer' }) end_reason: string | null;
}

export class TransferHistoryDto {
  @ApiProperty({ example: 4 }) id: number;
  @ApiProperty({ enum: TRANSFER_KINDS }) kind: TransferKind;
  @ApiProperty({ nullable: true, type: String, example: 'A-101 / B' }) from_bed: string | null;
  @ApiProperty({ example: 'A-204 / A' }) to_bed: string;
  @ApiProperty({ example: '2026-07-10' }) transfer_date: string;
  @ApiProperty({ nullable: true, type: String }) reason: string | null;
}

export class AdmissionDetailDto extends AdmissionDto {
  @ApiProperty({ type: [AllocationHistoryDto] }) allocations: AllocationHistoryDto[];
  @ApiProperty({ type: [TransferHistoryDto] }) transfers: TransferHistoryDto[];
  @ApiProperty({ nullable: true, type: Number }) open_checkout_id: number | null;
}

export class AdmissionQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) block_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) room_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) class_id?: number;
  @ApiPropertyOptional({ enum: ADMISSION_STATUSES, description: 'Default: everyone not checked out' })
  @IsOptional()
  @IsIn(ADMISSION_STATUSES)
  status?: AdmissionStatus;
  @ApiPropertyOptional({ description: 'true: has a bed; false: admitted but no bed yet' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  has_bed?: boolean;
}

export class AdmissionInsightsDto {
  @ApiProperty({ example: 280 }) active: number;
  @ApiProperty({ example: 6 }) on_leave: number;
  @ApiProperty({ example: 2 }) checking_out: number;
  @ApiProperty({ example: 3, description: 'Admitted, not checked out, no bed yet' }) without_bed: number;
  @ApiProperty({ example: 12, description: 'Checked out in the academic year being viewed' }) checked_out: number;
  @ApiProperty({ example: 9 }) pending_applications: number;
  @ApiProperty({ example: 4 }) waitlisted_applications: number;
}

export class AllocateDto {
  @ApiProperty({ example: 41 }) @IsInt() @Min(1) bed_id: number;
  @IsDateOnly('2026-06-01', true) from_date?: string;
}

export class TransferDto {
  @ApiProperty({ example: 57, description: 'Vacant bed to move to (any hostel that fits the student)' })
  @IsInt()
  @Min(1)
  bed_id: number;
  @IsDateOnly('2026-07-10', true) transfer_date?: string;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Moved closer to study hall' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  reason?: string | null;
}

export class SwapDto extends PickType(TransferDto, ['transfer_date', 'reason'] as const) {
  @ApiProperty({ example: 22, description: 'The other admission; both students swap beds' })
  @IsInt()
  @Min(1)
  other_admission_id: number;
}

export class VacateDto extends PickType(TransferDto, ['reason'] as const) {
  @IsDateOnly('2026-07-10', true) date?: string;
}

export class ClearanceItemDto {
  @ApiProperty({ example: 'key_return' }) code: string;
  @ApiProperty({ example: 'Room key returned' }) label: string;
  @ApiProperty({ enum: CLEARANCE_STATUSES }) status: ClearanceStatus;
  @ApiProperty({ nullable: true, type: Number, example: 250 }) amount: number | null;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty({ nullable: true, type: String }) cleared_by_name: string | null;
  @ApiProperty({ nullable: true, type: String }) cleared_at: Date | null;
}

export class CheckoutDto {
  @ApiProperty({ example: 3 }) id: number;
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ example: 'HST-2026-0021' }) admission_no: string;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ nullable: true, type: String, example: 'A-101 / B' }) bed: string | null;
  @ApiProperty({ enum: CHECKOUT_STATUSES }) status: CheckoutStatus;
  @ApiProperty({ enum: CHECKOUT_REASONS }) reason: CheckoutReason;
  @ApiProperty({ example: '2027-04-15' }) checkout_date: string;
  @ApiProperty({ nullable: true, type: String }) forwarding_address: string | null;
  @ApiProperty({ nullable: true, type: String }) remarks: string | null;
  @ApiProperty({ example: 2 }) pending_items: number;
  @ApiProperty({ type: [ClearanceItemDto] }) items: ClearanceItemDto[];
  @ApiProperty({ nullable: true, type: String }) completed_at: Date | null;
  @ApiProperty() created_at: Date;
}

export class CheckoutStartDto {
  @ApiProperty({ enum: CHECKOUT_REASONS }) @IsIn(CHECKOUT_REASONS) reason: CheckoutReason;
  @IsDateOnly('2027-04-15', true) checkout_date?: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  forwarding_address?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  remarks?: string | null;
}

export class ClearanceUpdateDto {
  @ApiProperty({ enum: CLEARANCE_STATUSES }) @IsIn(CLEARANCE_STATUSES) status: ClearanceStatus;
  @ApiPropertyOptional({ nullable: true, type: Number, example: 250, description: 'Charge or refund amount, if any' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999)
  amount?: number | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  note?: string | null;
}

export class CheckoutQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: CHECKOUT_STATUSES }) @IsOptional() @IsIn(CHECKOUT_STATUSES) status?: CheckoutStatus;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
}

export class AuditLogDto {
  @ApiProperty({ example: 88 }) id: number;
  @ApiProperty({ example: 'admission' }) entity: string;
  @ApiProperty({ example: 21 }) entity_id: number;
  @ApiProperty({ example: 'transfer' }) action: string;
  @ApiProperty({ nullable: true, type: Number }) student_id: number | null;
  @ApiProperty({ nullable: true, type: String }) student_name: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'R. Kumar' }) actor_name: string | null;
  @ApiProperty({ nullable: true, type: Object }) changes: Record<string, unknown> | null;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty() created_at: Date;
}

export class AuditQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: 'admission' }) @IsOptional() @IsString() @MaxLength(30) entity?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) student_id?: number;
  @IsDateOnly('2026-06-01', true) from?: string;
  @IsDateOnly('2026-06-30', true) to?: string;
}

export class StudentSearchQueryDto {
  @ApiProperty({ example: 'arun', description: 'Name or admission number, at least 2 characters' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^.{2,60}$/, { message: 'search must be 2 to 60 characters' })
  search: string;
}

export class StudentPickDto extends HostelStudentDto {
  @ApiProperty({ nullable: true, type: Number, description: 'Open hostel admission, if the student is already in' })
  hostel_admission_id: number | null;
  @ApiProperty({ nullable: true, type: Number, description: 'Open application, if any' })
  application_id: number | null;
  @ApiProperty({ nullable: true, type: String, example: 'approved' }) application_status: string | null;
}

export class StudentHostelDto {
  @ApiProperty({ nullable: true, type: AdmissionDetailDto }) current: AdmissionDetailDto | null;
  @ApiProperty({ type: [AdmissionDto] }) history: AdmissionDto[];
}
