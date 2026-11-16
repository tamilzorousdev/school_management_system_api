import { ApiProperty, ApiPropertyOptional, IntersectionType, PartialType, PickType } from '@nestjs/swagger';
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
  Min,
  ValidateIf,
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { StaffDocumentType } from '../../staff/entities/staff-document.entity';
import { STAFF_STATUSES, StaffStatus } from '../../staff/entities/staff.entity';
import { CreateStaffDto, StaffProfileDto, UpdateStaffDto } from '../../staff/dto/staff-input.dto';
import { StaffDocumentDto } from '../../staff/dto/staff-response.dto';
import { RefDto } from '../../students/dto/student-response.dto';
import { ExpiryStateDto } from '../../transport/dto/transport.dto';
import { CREW_EXPIRY_KINDS, CrewExpiryKind } from '../../transport/entities/expiry-alert.entity';
import {
  CREW_ROLES,
  CrewRole,
  DocumentState,
  DUTY_STATUSES,
  DutyStatus,
  EXPIRY_FILTERS,
  ExpiryFilter,
  LICENCE_TYPES,
} from '../crew.logic';

const notNull = (_object: unknown, value: unknown) => value !== null;
const code = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase().replace(/\s+/g, '') || null : value;
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export const PROFILE_KEYS = [
  'name',
  'mobile',
  'email',
  'language',
  'gender',
  'dob',
  'joining_date',
  'prior_experience_years',
  'address',
  'emergency_contact_name',
  'emergency_contact_mobile',
  'photo_file_id',
] as const;

export const CREW_KEYS = [
  'licence_no',
  'licence_type',
  'licence_issued_on',
  'licence_expiry',
  'badge_no',
  'badge_expiry',
  'medical_fitness_expiry',
  'police_verified_on',
  'police_verification_expiry',
] as const;

export const DRIVER_ONLY_KEYS = [
  'licence_no',
  'licence_type',
  'licence_issued_on',
  'licence_expiry',
  'badge_no',
  'badge_expiry',
] as const;

export class CrewFieldsDto {
  @ApiPropertyOptional({ example: 'TN0920190012345', nullable: true, type: String })
  @IsOptional()
  @Transform(code)
  @ValidateIf(notNull)
  @IsString()
  @Length(6, 20)
  licence_no?: string | null;

  @ApiPropertyOptional({ enum: LICENCE_TYPES, nullable: true })
  @IsOptional()
  @ValidateIf(notNull)
  @IsIn(LICENCE_TYPES)
  licence_type?: string | null;

  @ValidateIf(notNull)
  @IsDateOnly('2019-08-15', true)
  licence_issued_on?: string | null;

  @ValidateIf(notNull)
  @IsDateOnly('2029-08-14', true)
  licence_expiry?: string | null;

  @ApiPropertyOptional({ example: 'PSV1234567', nullable: true, type: String })
  @IsOptional()
  @Transform(code)
  @ValidateIf(notNull)
  @IsString()
  @Length(3, 30)
  badge_no?: string | null;

  @ValidateIf(notNull)
  @IsDateOnly('2027-08-14', true)
  badge_expiry?: string | null;

  @ValidateIf(notNull)
  @IsDateOnly('2027-03-31', true)
  medical_fitness_expiry?: string | null;

  @ValidateIf(notNull)
  @IsDateOnly('2026-04-10', true)
  police_verified_on?: string | null;

  @ValidateIf(notNull)
  @IsDateOnly('2028-04-09', true)
  police_verification_expiry?: string | null;

  @ApiPropertyOptional({ example: 'Bus Driver', description: 'Defaults to Bus Driver or Bus Attendant' })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @Length(2, 80)
  designation?: string;
}

export class CreateCrewDto extends IntersectionType(
  PickType(StaffProfileDto, PROFILE_KEYS),
  PickType(CreateStaffDto, ['employee_no', 'send_invite'] as const),
  CrewFieldsDto,
) {
  @ApiProperty({ enum: CREW_ROLES, example: 'driver' })
  @IsIn(CREW_ROLES)
  role: CrewRole;
}

export class UpdateCrewDto extends IntersectionType(
  PartialType(PickType(StaffProfileDto, PROFILE_KEYS)),
  PickType(UpdateStaffDto, ['employee_no', 'status', 'left_on'] as const),
  CrewFieldsDto,
) {}

export class CrewQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: CREW_ROLES })
  @IsOptional()
  @IsIn(CREW_ROLES)
  role?: CrewRole;

  @ApiPropertyOptional({ enum: DUTY_STATUSES })
  @IsOptional()
  @IsIn(DUTY_STATUSES)
  duty_status?: DutyStatus;

  @ApiPropertyOptional({
    enum: EXPIRY_FILTERS,
    description: 'expired: any date passed. due_soon: any date within 30 days. missing: any date not set.',
  })
  @IsOptional()
  @IsIn(EXPIRY_FILTERS)
  expiry_state?: ExpiryFilter;

  @ApiPropertyOptional({ example: 1, description: 'Crew of this bus' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  vehicle_id?: number;

  @ApiPropertyOptional({ description: 'true: not on any bus' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  unassigned?: boolean;

  @ApiPropertyOptional({ enum: STAFF_STATUSES, description: 'Resigned crew are hidden unless asked for' })
  @IsOptional()
  @IsIn(STAFF_STATUSES)
  status?: StaffStatus;
}

export class RemindManyDto {
  @ApiProperty({ example: [12, 14], type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  staff_ids: number[];
}

export class CrewCheckDto {
  @ApiProperty({ enum: CREW_EXPIRY_KINDS })
  kind: CrewExpiryKind;

  @ApiProperty({ example: 'Driving licence' })
  label: string;

  @ApiProperty({ example: 'driving_licence' })
  document_type: StaffDocumentType;

  @ApiProperty({ enum: ['missing', 'pending', 'verified', 'rejected'] })
  document_status: DocumentState;

  @ApiProperty({ nullable: true, type: Number, example: 41 })
  document_id: number | null;

  @ApiProperty({ type: ExpiryStateDto })
  expiry: ExpiryStateDto;

  @ApiProperty({ example: true })
  clear: boolean;

  @ApiProperty({ nullable: true, type: String, example: 'Waiting for verification' })
  problem: string | null;
}

export class CrewListItemDto {
  @ApiProperty({ example: 12, description: 'Staff id' })
  id: number;

  @ApiProperty({ example: 31 })
  user_id: number;

  @ApiProperty({ example: 'TZMS-EMP-0012' })
  employee_no: string;

  @ApiProperty({ example: 'Ganesan Pillai' })
  name: string;

  @ApiProperty({ example: '9000000007' })
  mobile: string;

  @ApiProperty({ nullable: true, type: Number })
  photo_file_id: number | null;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;

  @ApiProperty({ enum: CREW_ROLES })
  role: CrewRole;

  @ApiProperty({ example: 'Bus Driver' })
  designation: string;

  @ApiProperty({ enum: STAFF_STATUSES })
  status: StaffStatus;

  @ApiProperty({ enum: DUTY_STATUSES })
  duty_status: DutyStatus;

  @ApiProperty({ type: RefDto, nullable: true, description: 'Bus they are assigned to' })
  vehicle: RefDto | null;

  @ApiProperty({ type: RefDto, nullable: true, description: 'First route of that bus' })
  route: RefDto | null;

  @ApiProperty({ nullable: true, type: String })
  licence_no: string | null;

  @ApiProperty({ nullable: true, type: String, enum: LICENCE_TYPES })
  licence_type: string | null;

  @ApiProperty({ type: [ExpiryStateDto], description: 'Licence and badge (drivers), medical and police' })
  expiries: ExpiryStateDto[];

  @ApiProperty({ example: true, description: 'Has signed in to the app' })
  on_app: boolean;
}

export class CrewDetailDto extends CrewListItemDto {
  @ApiProperty({ nullable: true, type: String })
  email: string | null;

  @ApiProperty({ example: 'ta' })
  language: string;

  @ApiProperty({ nullable: true, enum: ['male', 'female', 'other'] })
  gender: string | null;

  @ApiProperty({ nullable: true, type: String })
  dob: string | null;

  @ApiProperty({ example: '2021-06-01' })
  joining_date: string;

  @ApiProperty({ example: 9 })
  experience_years: number;

  @ApiProperty({ example: 4 })
  prior_experience_years: number;

  @ApiProperty({ nullable: true, type: String })
  address: string | null;

  @ApiProperty({ nullable: true, type: String })
  emergency_contact_name: string | null;

  @ApiProperty({ nullable: true, type: String })
  emergency_contact_mobile: string | null;

  @ApiProperty({ nullable: true, type: String })
  left_on: string | null;

  @ApiProperty({ nullable: true, type: String })
  licence_issued_on: string | null;

  @ApiProperty({ nullable: true, type: String })
  licence_expiry: string | null;

  @ApiProperty({ nullable: true, type: String })
  badge_no: string | null;

  @ApiProperty({ nullable: true, type: String })
  badge_expiry: string | null;

  @ApiProperty({ nullable: true, type: String })
  medical_fitness_expiry: string | null;

  @ApiProperty({ nullable: true, type: String })
  police_verified_on: string | null;

  @ApiProperty({ nullable: true, type: String })
  police_verification_expiry: string | null;

  @ApiProperty({ type: [CrewCheckDto] })
  checks: CrewCheckDto[];

  @ApiProperty({ example: true, description: 'Every check passes, so they can be approved' })
  clear: boolean;

  @ApiProperty({ nullable: true, type: Date })
  approved_at: Date | null;

  @ApiProperty({ type: RefDto, nullable: true })
  approved_by: RefDto | null;

  @ApiProperty({ nullable: true, type: String, description: 'Earliest expiry at the time of approval' })
  approved_until: string | null;

  @ApiProperty({ nullable: true, type: Date })
  last_reminded_at: Date | null;

  @ApiProperty({ type: RefDto, nullable: true })
  last_reminded_by: RefDto | null;

  @ApiProperty({ type: [StaffDocumentDto] })
  documents: StaffDocumentDto[];
}

export class CrewInsightsDto {
  @ApiProperty({ example: 6 })
  drivers: number;

  @ApiProperty({ example: 6 })
  attendants: number;

  @ApiProperty({ example: 9 })
  approved: number;

  @ApiProperty({ example: 2 })
  pending: number;

  @ApiProperty({ example: 1 })
  blocked: number;

  @ApiProperty({ example: 3, description: 'Any date ending within 30 days' })
  due_soon: number;

  @ApiProperty({ example: 1, description: 'Not on any bus' })
  unassigned: number;
}

export class RemindResultDto {
  @ApiProperty({ example: 3 })
  sent: number;

  @ApiProperty({ example: 1 })
  skipped: number;
}
