import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import {
  CONSENT_STATES,
  ConsentState,
  ID_PROOF_TYPES,
  IdProofType,
  LEAVE_KINDS,
  LEAVE_SOURCES,
  LEAVE_STATES,
  LeaveKind,
  LeaveSource,
  MARK_METHODS,
  MarkMethod,
  VISIT_STATUSES,
  VisitStatus,
} from '../entities/hostel-movement.entity';
import { LeaveState, ROLL_SLOTS, ROLL_STATUSES, RollSlot, RollStatus } from '../hostel.logic';
import { HostelStudentDto } from './hostel-admission.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const notNull = (_object: unknown, value: unknown) => value !== null && value !== undefined;
const MOBILE = /^[6-9]\d{9}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class RollSheetQueryDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) hostel_id: number;
  @ApiProperty({ enum: ROLL_SLOTS }) @IsIn(ROLL_SLOTS) slot: RollSlot;
  @IsDateOnly('2026-07-01', true) date?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) block_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) floor_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) room_id?: number;
  @ApiPropertyOptional({ description: 'Only students not marked yet' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  unmarked?: boolean;
}

export class RollCountsDto {
  @ApiProperty({ example: 120 }) total: number;
  @ApiProperty({ example: 110 }) present: number;
  @ApiProperty({ example: 1 }) absent: number;
  @ApiProperty({ example: 2 }) late: number;
  @ApiProperty({ example: 4 }) on_leave: number;
  @ApiProperty({ example: 1 }) outing: number;
  @ApiProperty({ example: 1 }) sick: number;
  @ApiProperty({ example: 1 }) unmarked: number;
}

export class RollEntryDto {
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ nullable: true, type: String, example: 'A-101' }) room_no: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'B' }) bed_no: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'A Block' }) block_name: string | null;
  @ApiProperty({ nullable: true, enum: ROLL_STATUSES }) status: RollStatus | null;
  @ApiProperty({
    nullable: true,
    enum: ROLL_STATUSES,
    description: 'What the app should pre-select: on_leave or outing when the student is out on a hostel pass',
  })
  suggested_status: RollStatus | null;
  @ApiProperty({ nullable: true, enum: MARK_METHODS }) method: MarkMethod | null;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty({ nullable: true, type: String }) marked_at: Date | null;
}

export class RollSheetDto {
  @ApiProperty({ nullable: true, type: Number }) roll_call_id: number | null;
  @ApiProperty({ example: '2026-07-01' }) date: string;
  @ApiProperty({ enum: ROLL_SLOTS }) slot: RollSlot;
  @ApiProperty({ nullable: true, type: String }) finished_at: Date | null;
  @ApiProperty({ example: false, description: 'Holiday mode is on: roll call is paused' }) holiday_mode: boolean;
  @ApiProperty({ type: RollCountsDto }) counts: RollCountsDto;
  @ApiProperty({ type: [RollEntryDto] }) students: RollEntryDto[];
}

export class RollMarkItemDto {
  @ApiProperty({ example: 21 }) @IsInt() @Min(1) admission_id: number;
  @ApiProperty({ enum: ROLL_STATUSES }) @IsIn(ROLL_STATUSES) status: RollStatus;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  note?: string | null;
}

export class RollMarkDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) hostel_id: number;
  @ApiProperty({ enum: ROLL_SLOTS }) @IsIn(ROLL_SLOTS) slot: RollSlot;
  @IsDateOnly('2026-07-01', true) date?: string;
  @ApiProperty({ type: [RollMarkItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => RollMarkItemDto)
  entries: RollMarkItemDto[];
}

export class RollScanDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) hostel_id: number;
  @ApiProperty({ enum: ROLL_SLOTS }) @IsIn(ROLL_SLOTS) slot: RollSlot;
  @IsDateOnly('2026-07-01', true) date?: string;
  @ApiProperty({ example: 'TZS1.312.1.Xyz...', description: 'QR on the student ID card' })
  @Transform(trim)
  @IsString()
  @Length(10, 200)
  qr: string;
  @ApiPropertyOptional({ enum: ['present', 'late'], default: 'present' })
  @IsOptional()
  @IsIn(['present', 'late'])
  status?: 'present' | 'late';
}

export class RollScanResultDto {
  @ApiProperty({ type: RollEntryDto }) entry: RollEntryDto;
  @ApiProperty({ example: false, description: 'Already marked before this scan (the status is kept up to date)' })
  already_marked: boolean;
}

export class RollFinishDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) hostel_id: number;
  @ApiProperty({ enum: ROLL_SLOTS }) @IsIn(ROLL_SLOTS) slot: RollSlot;
  @IsDateOnly('2026-07-01', true) date?: string;
  @ApiProperty({
    enum: ['present', 'absent'],
    description: 'Mark everyone still unmarked as this. Students out on a hostel pass get on_leave or outing instead.',
  })
  @IsIn(['present', 'absent'])
  unmarked_as: 'present' | 'absent';
  @ApiPropertyOptional({ description: 'Only this block' }) @IsOptional() @IsInt() @Min(1) block_id?: number;
}

export class RollSessionDto {
  @ApiProperty({ example: 4 }) id: number;
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ example: '2026-07-01' }) roll_date: string;
  @ApiProperty({ enum: ROLL_SLOTS }) slot: RollSlot;
  @ApiProperty({ nullable: true, type: String }) finished_at: Date | null;
  @ApiProperty({ example: 110 }) present: number;
  @ApiProperty({ example: 2 }) absent: number;
  @ApiProperty({ example: 1 }) late: number;
  @ApiProperty({ example: 5 }) away: number;
  @ApiProperty({ example: 120 }) marked: number;
}

export class RollSessionQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional({ enum: ROLL_SLOTS }) @IsOptional() @IsIn(ROLL_SLOTS) slot?: RollSlot;
  @IsDateOnly('2026-07-01', true) from?: string;
  @IsDateOnly('2026-07-31', true) to?: string;
}

export class RollHistoryQueryDto {
  @IsDateOnly('2026-07-01', true) from?: string;
  @IsDateOnly('2026-07-31', true) to?: string;
}

export class RollHistoryItemDto {
  @ApiProperty({ example: '2026-07-01' }) date: string;
  @ApiProperty({ enum: ROLL_SLOTS }) slot: RollSlot;
  @ApiProperty({ enum: ROLL_STATUSES }) status: RollStatus;
  @ApiProperty({ enum: MARK_METHODS }) method: MarkMethod;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty() marked_at: Date;
}

export class LeaveDto {
  @ApiProperty({ example: 9 }) id: number;
  @ApiProperty({ example: 'HLV-2026-0009' }) leave_no: string;
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ nullable: true, type: String, example: 'A-101 / B' }) bed: string | null;
  @ApiProperty({ enum: LEAVE_KINDS }) kind: LeaveKind;
  @ApiProperty({ example: '2026-07-10' }) from_date: string;
  @ApiProperty({ example: '2026-07-12' }) to_date: string;
  @ApiProperty({ nullable: true, type: String, example: '16:00' }) depart_time: string | null;
  @ApiProperty({ nullable: true, type: String, example: '18:00' }) return_time: string | null;
  @ApiProperty({ description: 'Back in the hostel by this time' }) expected_return_at: Date;
  @ApiProperty({ example: 'Grandmother’s birthday' }) reason: string;
  @ApiProperty({ enum: LEAVE_SOURCES }) source: LeaveSource;
  @ApiProperty({ enum: LEAVE_STATES }) status: LeaveState;
  @ApiProperty({ enum: CONSENT_STATES }) consent_status: ConsentState;
  @ApiProperty({ nullable: true, type: String }) escort_name: string | null;
  @ApiProperty({ nullable: true, type: String }) escort_relation: string | null;
  @ApiProperty({ nullable: true, type: String }) escort_mobile: string | null;
  @ApiProperty({ nullable: true, type: String }) decision_note: string | null;
  @ApiProperty({ nullable: true, type: String }) decided_by_name: string | null;
  @ApiProperty({ nullable: true, type: String }) departed_at: Date | null;
  @ApiProperty({ nullable: true, type: String }) returned_at: Date | null;
  @ApiProperty({ nullable: true, type: Number, example: 25 }) late_minutes: number | null;
  @ApiProperty({ example: false, description: 'Out and past the expected return time' }) overdue: boolean;
  @ApiProperty({
    nullable: true,
    type: String,
    example: 'TZH1.9.1.Xyz...',
    description: 'Hostel pass QR, only while approved or out',
  })
  qr_token: string | null;
  @ApiProperty() created_at: Date;
}

export class LeaveInputDto {
  @ApiProperty({ enum: LEAVE_KINDS, description: 'outing: same-day, inside the outing window' })
  @IsIn(LEAVE_KINDS)
  kind: LeaveKind;
  @IsDateOnly('2026-07-10') from_date: string;
  @IsDateOnly('2026-07-12', true) to_date?: string;
  @ApiPropertyOptional({ example: '16:00', description: 'Required for an outing' })
  @IsOptional()
  @Matches(TIME, { message: 'depart_time must be a time as HH:mm' })
  depart_time?: string;
  @ApiPropertyOptional({
    example: '18:00',
    description: 'Back by this time on to_date. Required for an outing; default the hostel in-time.',
  })
  @IsOptional()
  @Matches(TIME, { message: 'return_time must be a time as HH:mm' })
  return_time?: string;
  @ApiProperty({ example: 'Grandmother’s birthday' }) @Transform(trim) @IsString() @Length(3, 500) reason: string;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Kumar R' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  escort_name?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'father' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(40)
  escort_relation?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: '9000000005' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @Matches(MOBILE, { message: 'escort_mobile must be a valid 10-digit Indian mobile number' })
  escort_mobile?: string | null;
}

export class StaffLeaveInputDto extends LeaveInputDto {
  @ApiProperty({ example: 21 }) @IsInt() @Min(1) admission_id: number;
  @ApiPropertyOptional({
    default: false,
    description: 'Approve at once when no parent consent is needed (needs hostel.leave_approve)',
  })
  @IsOptional()
  @IsBoolean()
  approve_now?: boolean;
}

export class LeaveQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) admission_id?: number;
  @ApiPropertyOptional({ enum: LEAVE_STATES }) @IsOptional() @IsIn(LEAVE_STATES) status?: LeaveState;
  @ApiPropertyOptional({ enum: LEAVE_KINDS }) @IsOptional() @IsIn(LEAVE_KINDS) kind?: LeaveKind;
  @ApiPropertyOptional({ description: 'Out past the expected return time' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  overdue?: boolean;
  @IsDateOnly('2026-07-01', true) on_date?: string;
}

export class LeaveDecisionDto {
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  note?: string | null;
}

export class ConsentDto extends LeaveDecisionDto {
  @ApiProperty({ example: true }) @IsBoolean() agree: boolean;
}

export class PassCheckDto {
  @ApiPropertyOptional({ example: 'TZH1.9.1.Xyz...', description: 'Scanned hostel pass QR' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(10, 200)
  qr?: string;
  @ApiPropertyOptional({ example: 'HLV-2026-0009', description: 'Or type the pass number' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 40)
  leave_no?: string;
}

export const PASS_VERDICTS = ['can_go_out', 'can_come_in', 'not_approved', 'not_started', 'expired', 'closed'] as const;
export type PassVerdict = (typeof PASS_VERDICTS)[number];

export class PassCheckResultDto {
  @ApiProperty({ example: true, description: 'Green: go ahead with out or in' }) ok: boolean;
  @ApiProperty({ enum: PASS_VERDICTS }) verdict: PassVerdict;
  @ApiProperty({ example: 'Valid. Check the escort, then mark the student out.' }) message: string;
  @ApiProperty({ type: LeaveDto }) leave: LeaveDto;
}

export class VisitDto {
  @ApiProperty({ example: 3 }) id: number;
  @ApiProperty({ example: 'HVS-2026-0003' }) visit_no: string;
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ example: 'Kumar R' }) visitor_name: string;
  @ApiProperty({ example: 'father' }) relation: string;
  @ApiProperty({ example: '9000000005' }) mobile: string;
  @ApiProperty({ example: 2 }) people_count: number;
  @ApiProperty({ nullable: true, enum: ID_PROOF_TYPES }) id_proof_type: IdProofType | null;
  @ApiProperty({ nullable: true, type: String, example: '4321' }) id_proof_last4: string | null;
  @ApiProperty({ nullable: true, type: Number }) photo_file_id: number | null;
  @ApiProperty({ nullable: true, type: String }) purpose: string | null;
  @ApiProperty({ example: true, description: 'A registered parent or on the approved visitor list' }) is_known: boolean;
  @ApiProperty({ enum: VISIT_STATUSES }) status: VisitStatus;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty({ nullable: true, type: String }) in_at: Date | null;
  @ApiProperty({ nullable: true, type: String }) out_at: Date | null;
}

export class VisitInputDto {
  @ApiProperty({ example: 21, description: 'Resident being visited' }) @IsInt() @Min(1) admission_id: number;
  @ApiProperty({ example: 'Kumar R' }) @Transform(trim) @IsString() @Length(2, 120) visitor_name: string;
  @ApiProperty({ example: 'father' }) @Transform(trim) @IsString() @Length(2, 40) relation: string;
  @ApiProperty({ example: '9000000005' })
  @Transform(trim)
  @Matches(MOBILE, { message: 'mobile must be a valid 10-digit Indian mobile number' })
  mobile: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(20) people_count?: number;
  @ApiPropertyOptional({ enum: ID_PROOF_TYPES }) @IsOptional() @IsIn(ID_PROOF_TYPES) id_proof_type?: IdProofType;
  @ApiPropertyOptional({ example: '4321', description: 'Only the last 4 characters are kept' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().slice(-4) : value))
  @Matches(/^[A-Za-z0-9]{4}$/, { message: 'id_proof_last4 must be 4 letters or digits' })
  id_proof_last4?: string;
  @ApiPropertyOptional({ description: 'Photo uploaded through /files' })
  @IsOptional()
  @IsInt()
  @Min(1)
  photo_file_id?: number;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  purpose?: string | null;
  @ApiPropertyOptional({ default: false, description: 'Record the visitor as turned away instead of letting them in' })
  @IsOptional()
  @IsBoolean()
  deny?: boolean;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  note?: string | null;
}

export class VisitQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) admission_id?: number;
  @ApiPropertyOptional({ enum: VISIT_STATUSES }) @IsOptional() @IsIn(VISIT_STATUSES) status?: VisitStatus;
  @IsDateOnly('2026-07-01', true) date?: string;
}

export class VisitorLookupQueryDto {
  @ApiProperty({ example: '9000000005' })
  @Transform(trim)
  @Matches(MOBILE, { message: 'mobile must be a valid 10-digit Indian mobile number' })
  mobile: string;
  @ApiPropertyOptional({ example: 21 }) @IsOptional() @IsInt() @Min(1) admission_id?: number;
}

export class VisitorLookupDto {
  @ApiProperty({ example: false }) blocked: boolean;
  @ApiProperty({ nullable: true, type: String }) blocked_reason: string | null;
  @ApiProperty({ example: true, description: 'Registered parent or approved visitor of this student' }) known: boolean;
  @ApiProperty({ nullable: true, type: String, example: 'Kumar R' }) known_name: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'father' }) known_relation: string | null;
  @ApiProperty({ nullable: true, type: Number }) photo_file_id: number | null;
  @ApiProperty({ nullable: true, type: String }) last_visit_at: Date | null;
}

export class ApprovedVisitorDto {
  @ApiProperty({ example: 5 }) id: number;
  @ApiProperty({ example: 312 }) student_id: number;
  @ApiProperty({ example: 'Suresh M' }) name: string;
  @ApiProperty({ example: 'uncle' }) relation: string;
  @ApiProperty({ example: '9000000020' }) mobile: string;
  @ApiProperty({ nullable: true, type: Number }) photo_file_id: number | null;
  @ApiProperty({ enum: ['parent', 'staff'] }) added_by_role: 'parent' | 'staff';
  @ApiProperty() created_at: Date;
}

export class ApprovedVisitorInputDto {
  @ApiProperty({ example: 'Suresh M' }) @Transform(trim) @IsString() @Length(2, 120) name: string;
  @ApiProperty({ example: 'uncle' }) @Transform(trim) @IsString() @Length(2, 40) relation: string;
  @ApiProperty({ example: '9000000020' })
  @Transform(trim)
  @Matches(MOBILE, { message: 'mobile must be a valid 10-digit Indian mobile number' })
  mobile: string;
  @ApiPropertyOptional({ description: 'Photo uploaded through /files' })
  @IsOptional()
  @IsInt()
  @Min(1)
  photo_file_id?: number;
}

export class BlocklistDto {
  @ApiProperty({ example: 2 }) id: number;
  @ApiProperty({ example: '9000000099' }) mobile: string;
  @ApiProperty({ nullable: true, type: String }) name: string | null;
  @ApiProperty({ example: 'Not allowed by parents' }) reason: string;
  @ApiProperty() created_at: Date;
}

export class BlocklistInputDto {
  @ApiProperty({ example: '9000000099' })
  @Transform(trim)
  @Matches(MOBILE, { message: 'mobile must be a valid 10-digit Indian mobile number' })
  mobile: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  name?: string | null;
  @ApiProperty({ example: 'Not allowed by parents' }) @Transform(trim) @IsString() @Length(3, 255) reason: string;
}

export class WardenContactDto {
  @ApiProperty({ nullable: true, type: String, example: 'R. Kumar' }) name: string | null;
  @ApiProperty({ nullable: true, type: String, example: '9000000013' }) phone: string | null;
}

export class ParentHostelDto {
  @ApiProperty({ example: true }) in_hostel: boolean;
  @ApiProperty({ nullable: true, type: Number }) admission_id: number | null;
  @ApiProperty({ nullable: true, type: String, example: 'HST-2026-0021' }) admission_no: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'Boys Hostel' }) hostel_name: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'A-101 / B' }) bed: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'A Block' }) block_name: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'active' }) status: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'veg' }) diet: string | null;
  @ApiProperty({ type: WardenContactDto }) warden: WardenContactDto;
  @ApiProperty({ type: [RollHistoryItemDto], description: 'Today’s roll calls so far' }) today: RollHistoryItemDto[];
  @ApiProperty({ nullable: true, type: LeaveDto, description: 'Leave waiting for me, approved or in progress' })
  current_leave: LeaveDto | null;
  @ApiProperty({ example: 0, description: 'Leave requests waiting for my consent' }) consent_waiting: number;
}
