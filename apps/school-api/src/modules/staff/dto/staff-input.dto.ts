import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
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
import { IsMobile, MOBILE_PATTERN, normalizeMobile } from '../../../shared/mobile';
import { ROLES } from '../../access/access.catalog';
import { LANGUAGES, Language } from '../../users/entities/user.entity';
import { STAFF_DOCUMENT_TYPES, StaffDocumentType } from '../entities/staff-document.entity';
import { STAFF_STATUSES, STAFF_TYPES, StaffStatus, StaffType } from '../entities/staff.entity';

export const STAFF_ROLE_CODES = [
  ROLES.PRINCIPAL,
  ROLES.AO,
  ROLES.HOD,
  ROLES.TEACHER,
  ROLES.TRANSPORT_INCHARGE,
  ROLES.DRIVER,
  ROLES.ATTENDANT,
  ROLES.ADMIN,
] as const;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/\s/g, '').toUpperCase() : value;
const notNull = (_object: unknown, value: unknown) => value !== null;

export class QualificationInputDto {
  @ApiProperty({ example: 'M.Sc.' })
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  degree: string;

  @ApiPropertyOptional({ example: 'Mathematics', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(80)
  specialization?: string | null;

  @ApiPropertyOptional({ example: 'Madras University', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(150)
  institution?: string | null;

  @ApiPropertyOptional({ example: 2012, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1960)
  @Max(2100)
  year_completed?: number | null;
}

export class StaffProfileDto {
  @ApiProperty({ example: 'Priya Venkatesh' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name: string;

  @IsMobile('Login mobile. A parent in this school with the same mobile gets the staff roles added.')
  mobile: string;

  @ApiPropertyOptional({ example: 'priya@school.in', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsEmail({}, { message: 'email must be a valid email address' })
  email?: string | null;

  @ApiPropertyOptional({ enum: LANGUAGES, default: 'en' })
  @IsOptional()
  @IsIn(LANGUAGES)
  language?: Language;

  @ApiProperty({ enum: STAFF_ROLE_CODES, isArray: true, example: ['TEACHER'] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one role' })
  @ArrayMaxSize(4)
  @IsIn(STAFF_ROLE_CODES, { each: true })
  role_codes: string[];

  @ApiProperty({ enum: STAFF_TYPES, example: 'teaching' })
  @IsIn(STAFF_TYPES)
  staff_type: StaffType;

  @ApiProperty({ example: 'PG Assistant' })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  designation: string;

  @ApiPropertyOptional({ example: 'Mathematics', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(60)
  department?: string | null;

  @ApiPropertyOptional({ enum: ['male', 'female', 'other'], nullable: true })
  @IsOptional()
  @ValidateIf(notNull)
  @IsIn(['male', 'female', 'other'])
  gender?: 'male' | 'female' | 'other' | null;

  @ValidateIf(notNull)
  @IsDateOnly('1988-03-14', true)
  dob?: string | null;

  @IsDateOnly('2019-06-03', true)
  joining_date?: string;

  @ApiPropertyOptional({ example: 4, description: 'Years of experience before joining' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  prior_experience_years?: number;

  @ApiPropertyOptional({ example: 30, description: 'Teaching periods a week this teacher can take' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  max_periods_per_week?: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  address?: string | null;

  @ApiPropertyOptional({ example: 'Venkatesh R', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  emergency_contact_name?: string | null;

  @ApiPropertyOptional({ example: '9840012345', nullable: true, type: String })
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null ? null : normalizeMobile(value)))
  @ValidateIf(notNull)
  @Matches(MOBILE_PATTERN, { message: 'emergency_contact_mobile must be a valid 10-digit Indian mobile number' })
  emergency_contact_mobile?: string | null;

  @ApiPropertyOptional({ example: 42, nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  photo_file_id?: number | null;
}

export class CreateStaffDto extends StaffProfileDto {
  @ApiPropertyOptional({ example: 'TZMS-EMP-0007', description: 'Leave empty to generate' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^[A-Za-z0-9/_-]{1,30}$/, { message: 'employee_no may use letters, digits, / _ and -' })
  employee_no?: string;

  @ApiPropertyOptional({ type: [QualificationInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => QualificationInputDto)
  qualifications?: QualificationInputDto[];

  @ApiPropertyOptional({ default: true, description: 'Send the Staff app invite by SMS' })
  @IsOptional()
  @IsBoolean()
  send_invite?: boolean;
}

export class UpdateStaffDto extends PartialType(StaffProfileDto) {
  @ApiPropertyOptional({ example: 'TZMS-EMP-0007' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^[A-Za-z0-9/_-]{1,30}$/, { message: 'employee_no may use letters, digits, / _ and -' })
  employee_no?: string;

  @ApiPropertyOptional({ enum: STAFF_STATUSES })
  @IsOptional()
  @IsIn(STAFF_STATUSES)
  status?: StaffStatus;

  @ValidateIf(notNull)
  @IsDateOnly('2026-11-30', true)
  left_on?: string | null;
}

export class QualificationsDto {
  @ApiProperty({ type: [QualificationInputDto] })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => QualificationInputDto)
  items: QualificationInputDto[];
}

export class StaffDocumentInputDto {
  @ApiProperty({ enum: STAFF_DOCUMENT_TYPES, example: 'degree_certificate' })
  @IsIn(STAFF_DOCUMENT_TYPES)
  type: StaffDocumentType;

  @ApiPropertyOptional({ example: 'M.Sc. degree certificate' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  title?: string;

  @ApiProperty({ example: 31, description: 'Id from POST /files' })
  @Type(() => Number)
  @IsInt()
  file_id: number;
}

export class BankDetailsInputDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  id?: number;

  @ApiProperty({ example: 'Priya Venkatesh' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  account_holder: string;

  @ApiProperty({ example: 'Indian Bank' })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  bank_name: string;

  @ApiProperty({ example: 'IDIB000T012' })
  @Transform(upper)
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'ifsc must be 11 characters like IDIB000T012' })
  ifsc: string;

  @ApiProperty({ example: '6123456789', description: 'Stored encrypted. Responses show only the last 4 digits.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s/g, '') : value))
  @Matches(/^\d{9,18}$/, { message: 'account_no must be 9 to 18 digits' })
  account_no: string;

  @ApiPropertyOptional({ example: 'ABCPV1234K', nullable: true, type: String, description: 'Stored encrypted' })
  @IsOptional()
  @Transform(upper)
  @ValidateIf((_dto, value) => value !== null && value !== '')
  @Matches(/^[A-Z]{5}\d{4}[A-Z]$/, { message: 'pan must look like ABCPV1234K' })
  pan?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;
}

export class SaveStaffBanksDto {
  @ApiProperty({ type: [BankDetailsInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => BankDetailsInputDto)
  accounts: BankDetailsInputDto[];
}

export class StaffQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: STAFF_TYPES })
  @IsOptional()
  @IsIn(STAFF_TYPES)
  staff_type?: StaffType;

  @ApiPropertyOptional({ enum: STAFF_STATUSES })
  @IsOptional()
  @IsIn(STAFF_STATUSES)
  status?: StaffStatus;

  @ApiPropertyOptional({ example: 'Mathematics' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  department?: string;

  @ApiPropertyOptional({ example: 'TEACHER' })
  @IsOptional()
  @IsIn(STAFF_ROLE_CODES)
  role?: string;

  @ApiPropertyOptional({ description: 'Class teachers this year' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  class_teacher?: boolean;

  @ApiPropertyOptional({ description: 'Pending or missing documents, no bank details, or a teacher with no classes' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  needs_attention?: boolean;

  @ApiPropertyOptional({ description: 'More periods a week than the teacher’s limit' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  overloaded?: boolean;
}

export class AssignmentsQueryDto {
  @ApiPropertyOptional({ example: 2, description: 'Defaults to the current year' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  academic_year_id?: number;

  @ApiPropertyOptional({ example: 7, description: 'Only this class' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  class_id?: number;
}

export class AssignmentItemDto {
  @ApiProperty({ example: 12 })
  @IsInt()
  section_id: number;

  @ApiProperty({ example: 3 })
  @IsInt()
  subject_id: number;

  @ApiProperty({ example: 9, nullable: true, type: Number, description: 'null removes the teacher' })
  @ValidateIf(notNull)
  @IsInt()
  teacher_user_id: number | null;

  @ApiPropertyOptional({ example: 6, default: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(15)
  periods_per_week?: number;
}

export class SaveAssignmentsDto {
  @ApiPropertyOptional({ example: 2, description: 'Defaults to the current year' })
  @IsOptional()
  @IsInt()
  academic_year_id?: number;

  @ApiProperty({ type: [AssignmentItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AssignmentItemDto)
  items: AssignmentItemDto[];
}
