import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
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
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { FileDto } from '../../files/dto/file.dto';
import {
  CHECK_METHODS,
  CheckMethod,
  CONSENT_STATUSES,
  ConsentStatus,
  GATE_EVENT_KINDS,
  GateEventKind,
  ID_PROOFS,
  IdProof,
  PASS_SOURCES,
  PASS_STATUSES,
  PassSource,
  PassStatus,
  PICKUP_KINDS,
  PickupKind,
  VISIT_PURPOSES,
  VISIT_STATUSES,
  VisitPurpose,
  VisitStatus,
} from '../entities/gate.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() || null : value;
const present = (_dto: object, value: unknown) => value !== undefined;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MOBILE = /^[6-9]\d{9}$/;

export class RefDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 'Priya Venkatesh' })
  name: string;
}

export class PickupInputDto {
  @ApiProperty({
    enum: PICKUP_KINDS,
    description: 'guardian = a registered parent, authorised = a saved pickup person, other = anyone else',
  })
  @IsIn(PICKUP_KINDS)
  kind: PickupKind;

  @ApiPropertyOptional({ example: 12, description: 'kind guardian' })
  @ValidateIf((dto: PickupInputDto) => dto.kind === 'guardian')
  @IsInt()
  @Min(1)
  guardian_id?: number;

  @ApiPropertyOptional({ example: 3, description: 'kind authorised' })
  @ValidateIf((dto: PickupInputDto) => dto.kind === 'authorised')
  @IsInt()
  @Min(1)
  authorised_id?: number;

  @ApiPropertyOptional({ example: 'Ravi Kumar', description: 'kind other' })
  @ValidateIf((dto: PickupInputDto) => dto.kind === 'other')
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name?: string;

  @ApiPropertyOptional({ example: 'Uncle', description: 'kind other' })
  @ValidateIf((dto: PickupInputDto) => dto.kind === 'other')
  @Transform(trim)
  @IsString()
  @Length(2, 40)
  relation?: string;

  @ApiPropertyOptional({ example: '9876500011', description: 'kind other' })
  @ValidateIf((dto: PickupInputDto) => dto.kind === 'other')
  @Matches(MOBILE, { message: 'mobile must be a 10-digit Indian mobile number' })
  mobile?: string;

  @ApiPropertyOptional({ example: 31, description: 'Photo of the person (POST /files)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  photo_file_id?: number;
}

export class PassRequestDto {
  @IsDateOnly('2026-11-19')
  pass_date: string;

  @ApiProperty({ example: '11:30', description: 'From when the student may leave (HH:MM)' })
  @Matches(TIME, { message: 'from_time must be HH:MM' })
  from_time: string;

  @ApiPropertyOptional({
    example: '13:30',
    description: 'Until when the pass works (HH:MM); default 2 hours after from_time',
  })
  @IsOptional()
  @Matches(TIME, { message: 'until_time must be HH:MM' })
  until_time?: string;

  @ApiProperty({ example: 'Doctor appointment' })
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason: string;

  @ApiProperty({ type: PickupInputDto })
  @ValidateNested()
  @Type(() => PickupInputDto)
  pickup: PickupInputDto;
}

export class StaffPassDto extends PassRequestDto {
  @ApiProperty({ example: 25 })
  @IsInt()
  @Min(1)
  student_id: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Approve at once (for a parent who phoned or came to the office)',
  })
  @IsOptional()
  @IsBoolean()
  approve_now?: boolean;
}

export class DecisionDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  approve: boolean;

  @ApiPropertyOptional({ example: 'Parent confirmed on the phone', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class CheckDto {
  @ApiPropertyOptional({ example: 'TZG1.p.42.1.Xyz...', description: 'Scanned QR text' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  qr?: string;

  @ApiPropertyOptional({ example: '4821', description: 'The 4-digit code' })
  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'code must be 4 digits' })
  code?: string;

  @ApiPropertyOptional({ example: 'GP-2026-0042', description: 'Pass or visitor slip number' })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @MaxLength(20)
  number?: string;
}

export class ReleaseDto {
  @ApiProperty({ enum: CHECK_METHODS, description: 'How the pass was checked; manual needs a photo and the ID proof' })
  @IsIn(CHECK_METHODS)
  method: CheckMethod;

  @ApiPropertyOptional({ example: 31, description: 'Photo of the person taken at the gate (POST /files)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  photo_file_id?: number;

  @ApiPropertyOptional({ enum: ID_PROOFS })
  @IsOptional()
  @IsIn(ID_PROOFS)
  id_proof_kind?: IdProof;

  @ApiPropertyOptional({ example: '4821', description: 'Last 4 digits of the ID number only' })
  @IsOptional()
  @Matches(/^[0-9A-Za-z]{4}$/, { message: 'id_proof_last4 must be the last 4 characters of the ID' })
  id_proof_last4?: string;
}

export class EmergencyDto {
  @ApiProperty({ example: 25 })
  @IsInt()
  @Min(1)
  student_id: number;

  @ApiProperty({ example: 'Grandmother in hospital' })
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason: string;

  @ApiProperty({ type: PickupInputDto, description: 'Who is at the gate. kind other also needs photo_file_id' })
  @ValidateNested()
  @Type(() => PickupInputDto)
  pickup: PickupInputDto;

  @ApiPropertyOptional({ enum: ID_PROOFS })
  @IsOptional()
  @IsIn(ID_PROOFS)
  id_proof_kind?: IdProof;

  @ApiPropertyOptional({ example: '4821' })
  @IsOptional()
  @Matches(/^[0-9A-Za-z]{4}$/, { message: 'id_proof_last4 must be the last 4 characters of the ID' })
  id_proof_last4?: string;
}

export class ConsentCodeDto {
  @ApiProperty({ example: '7310', description: 'The code the parent read out to the person' })
  @Matches(/^\d{4}$/, { message: 'code must be 4 digits' })
  code: string;
}

export class AuthorisedPickupInputDto {
  @ApiProperty({ example: 'Murugan S' })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name: string;

  @ApiProperty({ example: 'Grandfather' })
  @Transform(trim)
  @IsString()
  @Length(2, 40)
  relation: string;

  @ApiProperty({ example: '9876500022' })
  @Matches(MOBILE, { message: 'mobile must be a 10-digit Indian mobile number' })
  mobile: string;

  @ApiPropertyOptional({ example: 33, nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  photo_file_id?: number | null;

  @ApiPropertyOptional({ example: '2027-04-30', nullable: true, type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'valid_until must be a date in YYYY-MM-DD format' })
  valid_until?: string | null;
}

export class UpdateAuthorisedPickupDto {
  @ApiPropertyOptional({ example: 'Murugan S' })
  @ValidateIf(present)
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name?: string;

  @ApiPropertyOptional({ example: 'Grandfather' })
  @ValidateIf(present)
  @Transform(trim)
  @IsString()
  @Length(2, 40)
  relation?: string;

  @ApiPropertyOptional({ example: '9876500022' })
  @ValidateIf(present)
  @Matches(MOBILE, { message: 'mobile must be a 10-digit Indian mobile number' })
  mobile?: string;

  @ApiPropertyOptional({ example: 33, nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  photo_file_id?: number | null;

  @ApiPropertyOptional({ example: '2027-04-30', nullable: true, type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'valid_until must be a date in YYYY-MM-DD format' })
  valid_until?: string | null;

  @ApiPropertyOptional({ example: true })
  @ValidateIf(present)
  @IsBoolean()
  is_active?: boolean;
}

export class VisitorBaseDto {
  @ApiProperty({ example: 'Suresh Babu' })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name: string;

  @ApiProperty({ example: '9876500033' })
  @Matches(MOBILE, { message: 'mobile must be a 10-digit Indian mobile number' })
  mobile: string;

  @ApiProperty({ enum: VISIT_PURPOSES, example: 'meet_staff' })
  @IsIn(VISIT_PURPOSES)
  purpose: VisitPurpose;

  @ApiPropertyOptional({ example: 'Science fair stall setup', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  purpose_note?: string | null;

  @ApiPropertyOptional({
    example: 4,
    nullable: true,
    type: Number,
    description: 'Staff member to meet; empty = the office decides',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  host_user_id?: number | null;

  @ApiPropertyOptional({ example: 25, nullable: true, type: Number, description: 'The student it is about, if any' })
  @IsOptional()
  @IsInt()
  @Min(1)
  student_id?: number | null;

  @ApiPropertyOptional({ example: 'Lab Supplies Co', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  company?: string | null;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  people_count?: number;

  @ApiPropertyOptional({ example: 'TN09AB1234', nullable: true, type: String })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @MaxLength(15)
  vehicle_no?: string | null;
}

export class WalkInDto extends VisitorBaseDto {
  @ApiPropertyOptional({ example: 34, description: 'Photo of the visitor (required when the school setting says so)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  photo_file_id?: number;

  @ApiPropertyOptional({ enum: ID_PROOFS })
  @IsOptional()
  @IsIn(ID_PROOFS)
  id_proof_kind?: IdProof;

  @ApiPropertyOptional({ example: '4821' })
  @IsOptional()
  @Matches(/^[0-9A-Za-z]{4}$/, { message: 'id_proof_last4 must be the last 4 characters of the ID' })
  id_proof_last4?: string;
}

export class InviteDto extends VisitorBaseDto {
  @IsDateOnly('2026-11-20')
  visit_date: string;

  @ApiPropertyOptional({ example: '10:00', nullable: true, type: String })
  @IsOptional()
  @Matches(TIME, { message: 'expected_from must be HH:MM' })
  expected_from?: string | null;

  @ApiPropertyOptional({ example: '12:00', nullable: true, type: String })
  @IsOptional()
  @Matches(TIME, { message: 'expected_until must be HH:MM' })
  expected_until?: string | null;
}

export class VisitDecisionDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  allow: boolean;

  @ApiPropertyOptional({ example: 'Send to the staff room', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class VisitMoveDto {
  @ApiProperty({ enum: CHECK_METHODS, example: 'qr' })
  @IsIn(CHECK_METHODS)
  method: CheckMethod;
}

export class BlockInputDto {
  @ApiProperty({ example: 'Ravi Kumar' })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name: string;

  @ApiPropertyOptional({ example: '9876500044', nullable: true, type: String })
  @IsOptional()
  @Matches(MOBILE, { message: 'mobile must be a 10-digit Indian mobile number' })
  mobile?: string | null;

  @ApiProperty({ example: 'Court order: not allowed to take the student' })
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateBlockDto {
  @ApiPropertyOptional({ example: 'Ravi Kumar' })
  @ValidateIf(present)
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name?: string;

  @ApiPropertyOptional({ example: '9876500044', nullable: true, type: String })
  @IsOptional()
  @Matches(MOBILE, { message: 'mobile must be a 10-digit Indian mobile number' })
  mobile?: string | null;

  @ApiPropertyOptional({ example: 'Court order' })
  @ValidateIf(present)
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason?: string;

  @ApiPropertyOptional({ example: false })
  @ValidateIf(present)
  @IsBoolean()
  is_active?: boolean;
}

export class GateSettingsDto {
  @ApiProperty({ example: 30, description: 'Minutes a pass works before from_time and after until_time' })
  grace_minutes: number;

  @ApiProperty({
    example: 10,
    description: 'After this, an unanswered emergency request tells the gate to call the office',
  })
  emergency_wait_minutes: number;

  @ApiProperty({
    example: 30,
    description: 'A gate pass still waiting after this many minutes goes to the head AO',
  })
  office_escalate_minutes: number;

  @ApiProperty({ example: true })
  visitor_photo_required: boolean;

  @ApiProperty({ example: false })
  visitor_id_required: boolean;

  @ApiProperty({ example: '18:00', description: 'Visitors still inside are checked out at this time' })
  visitor_checkout_time: string;

  @ApiProperty({ example: true, description: 'Tell the office every time a student is released by a manual check' })
  notify_office_on_manual: boolean;
}

export class UpdateGateSettingsDto {
  @ApiPropertyOptional({ example: 30 })
  @ValidateIf(present)
  @IsInt()
  @Min(0)
  @Max(120)
  grace_minutes?: number;

  @ApiPropertyOptional({ example: 10 })
  @ValidateIf(present)
  @IsInt()
  @Min(2)
  @Max(60)
  emergency_wait_minutes?: number;

  @ApiPropertyOptional({ example: 30 })
  @ValidateIf(present)
  @IsInt()
  @Min(5)
  @Max(240)
  office_escalate_minutes?: number;

  @ApiPropertyOptional({ example: true })
  @ValidateIf(present)
  @IsBoolean()
  visitor_photo_required?: boolean;

  @ApiPropertyOptional({ example: false })
  @ValidateIf(present)
  @IsBoolean()
  visitor_id_required?: boolean;

  @ApiPropertyOptional({ example: '18:00' })
  @ValidateIf(present)
  @Matches(TIME, { message: 'visitor_checkout_time must be HH:MM' })
  visitor_checkout_time?: string;

  @ApiPropertyOptional({ example: true })
  @ValidateIf(present)
  @IsBoolean()
  notify_office_on_manual?: boolean;
}

export class PassQueryDto extends ListQueryDto {
  @IsDateOnly('2026-11-01', true)
  from?: string;

  @IsDateOnly('2026-11-30', true)
  to?: string;

  @ApiPropertyOptional({ enum: PASS_STATUSES })
  @IsOptional()
  @IsIn(PASS_STATUSES)
  status?: PassStatus;

  @ApiPropertyOptional({ enum: PASS_SOURCES })
  @IsOptional()
  @IsIn(PASS_SOURCES)
  source?: PassSource;

  @ApiPropertyOptional({ enum: CHECK_METHODS })
  @IsOptional()
  @IsIn(CHECK_METHODS)
  method?: CheckMethod;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  emergency?: boolean;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  class_id?: number;

  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  section_id?: number;
}

export class VisitQueryDto extends ListQueryDto {
  @IsDateOnly('2026-11-01', true)
  from?: string;

  @IsDateOnly('2026-11-30', true)
  to?: string;

  @ApiPropertyOptional({ enum: VISIT_STATUSES })
  @IsOptional()
  @IsIn(VISIT_STATUSES)
  status?: VisitStatus;

  @ApiPropertyOptional({ enum: VISIT_PURPOSES })
  @IsOptional()
  @IsIn(VISIT_PURPOSES)
  purpose?: VisitPurpose;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  host_user_id?: number;
}

export class EventQueryDto extends ListQueryDto {
  @IsDateOnly('2026-11-01', true)
  from?: string;

  @IsDateOnly('2026-11-30', true)
  to?: string;

  @ApiPropertyOptional({ enum: GATE_EVENT_KINDS })
  @IsOptional()
  @IsIn(GATE_EVENT_KINDS)
  kind?: GateEventKind;

  @ApiPropertyOptional({ example: 42 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pass_id?: number;

  @ApiPropertyOptional({ example: 9 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  visit_id?: number;
}

export class StudentSearchDto {
  @ApiProperty({ example: 'arun', description: 'Name, admission number or class like 5A (2+ characters)' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  search: string;
}

export class RangeDto {
  @IsDateOnly('2026-11-01', true)
  from?: string;

  @IsDateOnly('2026-11-30', true)
  to?: string;
}

export class GateStudentDto {
  @ApiProperty({ example: 25 })
  id: number;

  @ApiProperty({ example: 'Arun Kumar' })
  name: string;

  @ApiProperty({ example: 'ADM-2024-0012' })
  admission_no: string;

  @ApiProperty({ example: '5 - A', nullable: true, type: String })
  class_section: string | null;

  @ApiProperty({ type: FileDto, nullable: true })
  photo: FileDto | null;
}

export class PickupPersonDto {
  @ApiProperty({ enum: PICKUP_KINDS, example: 'guardian' })
  kind: PickupKind;

  @ApiProperty({ example: 12, nullable: true, type: Number, description: 'guardian_id or authorised_id' })
  id: number | null;

  @ApiProperty({ example: 'Lakshmi Narayanan' })
  name: string;

  @ApiProperty({ example: 'Mother', nullable: true, type: String })
  relation: string | null;

  @ApiProperty({ example: '9000000005', nullable: true, type: String })
  mobile: string | null;

  @ApiProperty({ type: FileDto, nullable: true })
  photo: FileDto | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'Authorised persons: last day they may pick up',
  })
  valid_until: string | null;
}

export class GatePassDto {
  @ApiProperty({ example: 42 })
  id: number;

  @ApiProperty({ example: 'GP-2026-0042' })
  pass_no: string;

  @ApiProperty({ type: GateStudentDto })
  student: GateStudentDto;

  @ApiProperty({ example: '2026-11-19' })
  pass_date: string;

  @ApiProperty({ example: '11:30' })
  from_time: string;

  @ApiProperty({ example: '13:30' })
  until_time: string;

  @ApiProperty({ example: 'Doctor appointment' })
  reason: string;

  @ApiProperty({ type: PickupPersonDto })
  pickup: PickupPersonDto;

  @ApiProperty({ enum: PASS_STATUSES, example: 'approved' })
  status: PassStatus;

  @ApiProperty({ enum: PASS_SOURCES, example: 'parent' })
  source: PassSource;

  @ApiProperty({ example: false })
  is_emergency: boolean;

  @ApiProperty({ example: false, description: 'Person is not registered: the parent must agree and give a code' })
  needs_consent: boolean;

  @ApiProperty({ enum: CONSENT_STATUSES, nullable: true, example: null })
  consent_status: ConsentStatus | null;

  @ApiProperty({ example: false, description: 'The gate entered the parent’s code' })
  consent_verified: boolean;

  @ApiProperty({ type: RefDto, nullable: true })
  requested_by: RefDto | null;

  @ApiProperty({ type: RefDto, nullable: true })
  decided_by: RefDto | null;

  @ApiProperty({ example: null, nullable: true, type: Date })
  decided_at: Date | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  decision_note: string | null;

  @ApiProperty({ example: null, nullable: true, type: Date })
  released_at: Date | null;

  @ApiProperty({ type: RefDto, nullable: true })
  released_by: RefDto | null;

  @ApiProperty({ enum: CHECK_METHODS, nullable: true, example: null })
  release_method: CheckMethod | null;

  @ApiProperty({ type: FileDto, nullable: true })
  release_photo: FileDto | null;

  @ApiProperty({ enum: ID_PROOFS, nullable: true, example: null })
  id_proof_kind: IdProof | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  id_proof_last4: string | null;

  @ApiProperty({ example: false, description: 'Emergency not answered in time; the gate was told to call the office' })
  escalated: boolean;

  @ApiProperty({
    example: false,
    description: 'Still waiting after office_escalate_minutes, so it was sent to the head AO',
  })
  escalated_to_head_ao: boolean;

  @ApiProperty({
    example: 'TZG1.p.42.1.Xyz',
    nullable: true,
    type: String,
    description: 'QR text, only for the parent and the office, only while approved',
  })
  qr_token: string | null;

  @ApiProperty({ example: '4821', nullable: true, type: String, description: 'Only for the parent and the office' })
  code: string | null;

  @ApiProperty({ example: '2026-11-19T08:10:00.000+05:30' })
  created_at: Date;
}

export class CheckResultDto {
  @ApiProperty({ example: true, description: 'Green (true) or red (false)' })
  ok: boolean;

  @ApiProperty({ enum: ['pass', 'visit'], example: 'pass' })
  kind: 'pass' | 'visit';

  @ApiProperty({
    example: 'ok',
    description:
      'pass: ok, not_approved, rejected, cancelled, used, expired, not_today, too_early, consent_needed, student_absent. visit: ok_in, ok_out, waiting, declined, cancelled, left, not_today',
  })
  verdict: string;

  @ApiProperty({ example: 'Valid. Check the person against the photo, then release.' })
  message: string;

  @ApiProperty({ type: GatePassDto, nullable: true })
  pass: GatePassDto | null;

  @ApiProperty({ type: () => VisitDto, nullable: true })
  visit: VisitDto | null;
}

export class GateStudentCardDto {
  @ApiProperty({ type: GateStudentDto })
  student: GateStudentDto;

  @ApiProperty({
    type: [PickupPersonDto],
    description: 'Registered parents who may pick up and saved pickup persons, with photos',
  })
  people: PickupPersonDto[];

  @ApiProperty({ type: [GatePassDto], description: 'Today’s passes of the student' })
  today_passes: GatePassDto[];

  @ApiProperty({ example: false })
  absent_today: boolean;
}

export class AuthorisedPickupDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 25 })
  student_id: number;

  @ApiProperty({ example: 'Murugan S' })
  name: string;

  @ApiProperty({ example: 'Grandfather' })
  relation: string;

  @ApiProperty({ example: '9876500022' })
  mobile: string;

  @ApiProperty({ type: FileDto, nullable: true })
  photo: FileDto | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  valid_until: string | null;

  @ApiProperty({ example: true })
  is_active: boolean;

  @ApiProperty({ type: RefDto, nullable: true })
  added_by: RefDto | null;
}

export class ConsentRequestDto {
  @ApiProperty({ example: 42, description: 'The gate pass id' })
  pass_id: number;

  @ApiProperty({ type: GateStudentDto })
  student: GateStudentDto;

  @ApiProperty({ type: PickupPersonDto })
  person: PickupPersonDto;

  @ApiProperty({ example: 'Grandmother in hospital' })
  reason: string;

  @ApiProperty({ enum: CONSENT_STATUSES, example: 'waiting' })
  status: ConsentStatus;

  @ApiProperty({
    example: '7310',
    nullable: true,
    type: String,
    description: 'After you agree: read this code to the person',
  })
  code: string | null;

  @ApiProperty({ example: '2026-11-19T11:20:00.000+05:30' })
  asked_at: Date;
}

export class VisitDto {
  @ApiProperty({ example: 9 })
  id: number;

  @ApiProperty({ example: 'VP-2026-0009' })
  visit_no: string;

  @ApiProperty({ example: '2026-11-19' })
  visit_date: string;

  @ApiProperty({ example: 'Suresh Babu' })
  name: string;

  @ApiProperty({ example: '9876500033' })
  mobile: string;

  @ApiProperty({ type: FileDto, nullable: true })
  photo: FileDto | null;

  @ApiProperty({ enum: ID_PROOFS, nullable: true, example: null })
  id_proof_kind: IdProof | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  id_proof_last4: string | null;

  @ApiProperty({ enum: VISIT_PURPOSES, example: 'meet_staff' })
  purpose: VisitPurpose;

  @ApiProperty({ example: null, nullable: true, type: String })
  purpose_note: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  company: string | null;

  @ApiProperty({ example: 1 })
  people_count: number;

  @ApiProperty({ example: null, nullable: true, type: String })
  vehicle_no: string | null;

  @ApiProperty({ type: RefDto, nullable: true })
  host: RefDto | null;

  @ApiProperty({ type: GateStudentDto, nullable: true })
  student: GateStudentDto | null;

  @ApiProperty({ enum: VISIT_STATUSES, example: 'inside' })
  status: VisitStatus;

  @ApiProperty({ example: '10:00', nullable: true, type: String })
  expected_from: string | null;

  @ApiProperty({ example: '12:00', nullable: true, type: String })
  expected_until: string | null;

  @ApiProperty({ type: RefDto, nullable: true })
  invited_by: RefDto | null;

  @ApiProperty({ type: RefDto, nullable: true })
  decided_by: RefDto | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  decision_note: string | null;

  @ApiProperty({ example: null, nullable: true, type: Date })
  checked_in_at: Date | null;

  @ApiProperty({ enum: CHECK_METHODS, nullable: true, example: 'qr' })
  check_in_method: CheckMethod | null;

  @ApiProperty({ example: null, nullable: true, type: Date })
  checked_out_at: Date | null;

  @ApiProperty({ example: null, nullable: true, type: String, description: 'qr, code, manual or auto (end of day)' })
  check_out_method: string | null;

  @ApiProperty({ example: false, description: 'Inside past the expected time' })
  overstay: boolean;

  @ApiProperty({ example: false, description: 'Matched the blocked list' })
  blocked: boolean;

  @ApiProperty({ example: 'TZG1.v.9.1.Xyz', nullable: true, type: String, description: 'Only for the office' })
  qr_token: string | null;

  @ApiProperty({ example: '5521', nullable: true, type: String, description: 'Only for the office' })
  code: string | null;

  @ApiProperty({ example: '2026-11-19T09:40:00.000+05:30' })
  created_at: Date;
}

export class GateEventDto {
  @ApiProperty({ example: 120 })
  id: number;

  @ApiProperty({ enum: GATE_EVENT_KINDS, example: 'released' })
  kind: GateEventKind;

  @ApiProperty({ example: 'Student released' })
  label: string;

  @ApiProperty({ example: '2026-11-19T11:42:00.000+05:30' })
  at: Date;

  @ApiProperty({ type: RefDto, nullable: true })
  actor: RefDto | null;

  @ApiProperty({ example: 'qr', nullable: true, type: String })
  method: string | null;

  @ApiProperty({ example: 'GP-2026-0042 · Arun Kumar (5 - A) to Lakshmi Narayanan', nullable: true, type: String })
  note: string | null;

  @ApiProperty({ example: 42, nullable: true, type: Number })
  pass_id: number | null;

  @ApiProperty({ example: null, nullable: true, type: Number })
  visit_id: number | null;
}

export class GateCountsDto {
  @ApiProperty({ example: 6, description: 'Approved passes for today not yet used' })
  waiting_release: number;

  @ApiProperty({ example: 4 })
  released_today: number;

  @ApiProperty({ example: 1, description: 'Requests waiting for approval (any date)' })
  pending_approvals: number;

  @ApiProperty({ example: 0 })
  emergencies_waiting: number;

  @ApiProperty({ example: 1, description: 'Released today by a manual check' })
  manual_today: number;

  @ApiProperty({ example: 3 })
  visitors_inside: number;

  @ApiProperty({ example: 2 })
  visitors_expected: number;

  @ApiProperty({ example: 1 })
  visitors_waiting: number;

  @ApiProperty({ example: 0 })
  overstays: number;

  @ApiProperty({ example: 0, description: 'Blocked people who came today' })
  blocked_today: number;
}

export class GateTodayDto {
  @ApiProperty({ example: '2026-11-19' })
  date: string;

  @ApiProperty({ type: GateCountsDto })
  counts: GateCountsDto;

  @ApiProperty({ type: [GatePassDto], description: 'Approved passes for today, earliest first' })
  due: GatePassDto[];

  @ApiProperty({ type: [GatePassDto], description: 'Emergency requests not decided yet' })
  emergencies: GatePassDto[];

  @ApiProperty({ type: [VisitDto], description: 'Visitors inside now' })
  inside: VisitDto[];

  @ApiProperty({ type: [VisitDto], description: 'Visitors waiting for a decision or expected today' })
  coming: VisitDto[];

  @ApiProperty({ type: [GateEventDto], description: 'Latest 20 gate events' })
  recent: GateEventDto[];
}

export class GateVisitorsTodayDto {
  @ApiProperty({ type: [VisitDto], description: 'Inside now' })
  inside: VisitDto[];

  @ApiProperty({ type: [VisitDto], description: 'Waiting, allowed or expected today' })
  coming: VisitDto[];
}

export class GateDayRowDto {
  @ApiProperty({ example: '2026-11-19' })
  date: string;

  @ApiProperty({ example: 5 })
  requested: number;

  @ApiProperty({ example: 4 })
  released: number;

  @ApiProperty({ example: 1 })
  emergencies: number;

  @ApiProperty({ example: 1 })
  manual: number;

  @ApiProperty({ example: 0 })
  rejected: number;

  @ApiProperty({ example: 0 })
  expired: number;

  @ApiProperty({ example: 7 })
  visitors: number;
}

export class GateCountRowDto {
  @ApiProperty({ example: 'qr' })
  key: string;

  @ApiProperty({ example: 'QR scan' })
  label: string;

  @ApiProperty({ example: 12 })
  count: number;
}

export class GateReportDto {
  @ApiProperty({ example: '2026-11-01' })
  from: string;

  @ApiProperty({ example: '2026-11-19' })
  to: string;

  @ApiProperty({ type: [GateDayRowDto] })
  by_day: GateDayRowDto[];

  @ApiProperty({ type: [GateCountRowDto], description: 'Releases by class' })
  by_class: GateCountRowDto[];

  @ApiProperty({ type: [GateCountRowDto], description: 'Releases by check method' })
  by_method: GateCountRowDto[];

  @ApiProperty({ type: [GateCountRowDto], description: 'Visits by purpose' })
  by_purpose: GateCountRowDto[];

  @ApiProperty({ type: [GateCountRowDto], description: 'Visitors coming in by hour of the day' })
  by_hour: GateCountRowDto[];
}

export class BlockDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Ravi Kumar' })
  name: string;

  @ApiProperty({ example: '9876500044', nullable: true, type: String })
  mobile: string | null;

  @ApiProperty({ example: 'Court order' })
  reason: string;

  @ApiProperty({ example: true })
  is_active: boolean;

  @ApiProperty({ type: RefDto, nullable: true })
  added_by: RefDto | null;

  @ApiProperty({ example: '2026-11-19T09:00:00.000+05:30' })
  created_at: Date;
}

export class StaffOptionDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 'Priya Venkatesh' })
  name: string;

  @ApiProperty({ example: 'Teacher', nullable: true, type: String })
  role: string | null;
}
