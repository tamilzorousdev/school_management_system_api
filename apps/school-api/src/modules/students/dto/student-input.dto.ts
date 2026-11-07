import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
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
import { LANGUAGES, Language } from '../../users/entities/user.entity';
import { ADMISSION_STATUSES, AdmissionStatus } from '../entities/admission.entity';
import { BLOOD_GROUPS, BloodGroup, GENDERS, Gender, STUDENT_STATUSES, StudentStatus } from '../entities/student.entity';
import { RELATIONS, Relation } from '../entities/student-guardian.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : typeof value === 'string' ? value.trim() : value;
const notNull = (_object: unknown, value: unknown) => value !== null;

export class GuardianInputDto {
  @ApiProperty({ example: 'Lakshmi Narayanan' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name: string;

  @IsMobile('Guardian mobile. A guardian with the same mobile in this school is reused, which links siblings.')
  mobile: string;

  @ApiProperty({ enum: RELATIONS, example: 'mother' })
  @IsIn(RELATIONS)
  relation: Relation;

  @ApiPropertyOptional({ example: '9840011122', nullable: true, type: String })
  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : normalizeMobile(value)))
  @ValidateIf(notNull)
  @Matches(MOBILE_PATTERN, { message: 'alt_mobile must be a valid 10-digit Indian mobile number' })
  alt_mobile?: string | null;

  @ApiPropertyOptional({ example: 'lakshmi@gmail.com', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsEmail({}, { message: 'email must be a valid email address' })
  email?: string | null;

  @ApiPropertyOptional({ example: 'Software engineer', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(80)
  occupation?: string | null;

  @ApiPropertyOptional({ example: 'B.E.', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(80)
  qualification?: string | null;

  @ApiPropertyOptional({ description: 'Main contact for this student. Only one per student.' })
  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;

  @ApiPropertyOptional({ default: true, description: 'May collect the student from school or the bus' })
  @IsOptional()
  @IsBoolean()
  can_pickup?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Gets alerts and a Parent app login' })
  @IsOptional()
  @IsBoolean()
  receives_alerts?: boolean;

  @ApiPropertyOptional({ enum: LANGUAGES, description: 'App and message language when a login is created' })
  @IsOptional()
  @IsIn(LANGUAGES)
  language?: Language;
}

export class EmergencyContactInputDto {
  @ApiProperty({ example: 'Saravanan' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiProperty({ example: 'Uncle' })
  @Transform(trim)
  @IsString()
  @Length(2, 40)
  relation: string;

  @IsMobile()
  mobile: string;
}

export class StudentProfileDto {
  @ApiProperty({ example: 'Kavin' })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  first_name: string;

  @ApiPropertyOptional({ example: 'Narayanan', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(60)
  last_name?: string | null;

  @IsDateOnly('2015-04-12')
  dob: string;

  @ApiProperty({ enum: GENDERS })
  @IsIn(GENDERS)
  gender: Gender;

  @ApiPropertyOptional({ enum: BLOOD_GROUPS, nullable: true })
  @IsOptional()
  @IsIn([...BLOOD_GROUPS, null])
  blood_group?: BloodGroup | null;

  @ApiPropertyOptional({ example: 'Red', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(20)
  house?: string | null;

  @ApiPropertyOptional({ example: '14, Gandhi Street, Anna Nagar', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  address_line?: string | null;

  @ApiPropertyOptional({ example: 'Chennai', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(80)
  city?: string | null;

  @ApiPropertyOptional({ example: '600040', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @Matches(/^\d{6}$/, { message: 'pincode must be 6 digits' })
  pincode?: string | null;

  @ApiPropertyOptional({ example: 'St. Mary Matriculation', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(150)
  previous_school?: string | null;

  @ApiPropertyOptional({
    example: 'A mole on the left cheek; a scar on the right thumb',
    nullable: true,
    type: String,
    description: 'Personal marks of identification, printed on the TC',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  identification_marks?: string | null;

  @ApiPropertyOptional({ example: 31, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  photo_file_id?: number | null;

  @ApiPropertyOptional({ default: false, description: 'Specially abled / CWSN child' })
  @IsOptional()
  @IsBoolean()
  is_specially_abled?: boolean;

  @ApiPropertyOptional({ example: 'Locomotor', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(80)
  disability_category?: string | null;

  @ApiPropertyOptional({ example: 40, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @Min(0)
  @Max(100)
  disability_percentage?: number | null;

  @ApiPropertyOptional({ default: false, description: 'Adopted child' })
  @IsOptional()
  @IsBoolean()
  is_adopted?: boolean;
}

export class CreateStudentDto extends StudentProfileDto {
  @ApiPropertyOptional({
    example: 'TZMS-2019-0042',
    description: 'Leave empty to generate. Use it for students who already have a number.',
  })
  @IsOptional()
  @Transform(trim)
  @Matches(/^[A-Za-z0-9/_-]{1,30}$/, { message: 'admission_no may use letters, digits, / _ and -' })
  admission_no?: string;

  @IsDateOnly('2026-06-03', true)
  admission_date?: string;

  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(1)
  class_id: number;

  @ApiPropertyOptional({ example: 11, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  section_id?: number | null;

  @ApiPropertyOptional({ example: 12, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  @Max(999)
  roll_no?: number | null;

  @ApiProperty({ type: [GuardianInputDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one parent or guardian' })
  @ArrayMaxSize(5, { message: 'Maximum 5 parents / contacts allowed' })
  @ValidateNested({ each: true })
  @Type(() => GuardianInputDto)
  guardians: GuardianInputDto[];

  @ApiPropertyOptional({ type: [EmergencyContactInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => EmergencyContactInputDto)
  emergency_contacts?: EmergencyContactInputDto[];
}

export class UpdateStudentDto extends PartialType(StudentProfileDto) {
  @ApiPropertyOptional({ enum: STUDENT_STATUSES })
  @IsOptional()
  @IsIn(STUDENT_STATUSES)
  status?: StudentStatus;

  @IsDateOnly('2026-06-03', true)
  admission_date?: string;
}

export class EnrollmentInputDto {
  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(1)
  class_id: number;

  @ApiPropertyOptional({ example: 11, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  section_id?: number | null;

  @ApiPropertyOptional({ example: 12, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  @Max(999)
  roll_no?: number | null;
}

export class UpdateGuardianLinkDto {
  @ApiPropertyOptional({ enum: RELATIONS })
  @IsOptional()
  @IsIn(RELATIONS)
  relation?: Relation;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  can_pickup?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  receives_alerts?: boolean;
}

export class EmergencyContactsDto {
  @ApiProperty({ type: [EmergencyContactInputDto], description: 'Replaces the whole list' })
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => EmergencyContactInputDto)
  items: EmergencyContactInputDto[];
}

export class RollNumbersDto {
  @ApiPropertyOptional({ enum: ['name', 'admission_no', 'gender_name'], default: 'name' })
  @IsOptional()
  @IsIn(['name', 'admission_no', 'gender_name'])
  order?: 'name' | 'admission_no' | 'gender_name';
}

export class StudentQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  class_id?: number;

  @ApiPropertyOptional({ example: 11 })
  @IsOptional()
  @IsInt()
  @Min(1)
  section_id?: number;

  @ApiPropertyOptional({ enum: GENDERS })
  @IsOptional()
  @IsIn(GENDERS)
  gender?: Gender;

  @ApiPropertyOptional({ enum: STUDENT_STATUSES })
  @IsOptional()
  @IsIn(STUDENT_STATUSES)
  status?: StudentStatus;

  @ApiPropertyOptional({ description: 'true: students not placed in a section this year' })
  @IsOptional()
  @Transform(toBoolean)
  @IsIn([true, false])
  no_section?: boolean;

  @ApiPropertyOptional({ description: 'true: students who have a brother or sister in the school' })
  @IsOptional()
  @Transform(toBoolean)
  @IsIn([true, false])
  has_siblings?: boolean;

  @ApiPropertyOptional({ description: 'true: joined this month' })
  @IsOptional()
  @Transform(toBoolean)
  @IsIn([true, false])
  new_this_month?: boolean;

  @ApiPropertyOptional({ example: 'Red' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  house?: string;
}

export class AdmissionInputDto {
  @ApiProperty({ example: 4, description: 'Class applied for' })
  @IsInt()
  @Min(1)
  class_id: number;

  @ApiPropertyOptional({ example: 1, description: 'Defaults to the current academic year' })
  @IsOptional()
  @IsInt()
  @Min(1)
  academic_year_id?: number;

  @ApiProperty({ example: 'Nila' })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  first_name: string;

  @ApiPropertyOptional({ example: 'Murugan', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(60)
  last_name?: string | null;

  @IsDateOnly('2016-02-20')
  dob: string;

  @ApiProperty({ enum: GENDERS })
  @IsIn(GENDERS)
  gender: Gender;

  @ApiProperty({ example: 'Selvi Murugan' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  guardian_name: string;

  @IsMobile('Guardian mobile')
  guardian_mobile: string;

  @ApiProperty({ enum: RELATIONS, example: 'mother' })
  @IsIn(RELATIONS)
  guardian_relation: Relation;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsEmail({}, { message: 'guardian_email must be a valid email address' })
  guardian_email?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(150)
  previous_school?: string | null;

  @ApiPropertyOptional({
    example: 'A mole on the left cheek; a scar on the right thumb',
    nullable: true,
    type: String,
    description: 'Personal marks of identification, printed on the TC',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  identification_marks?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class UpdateAdmissionDto extends PartialType(OmitType(AdmissionInputDto, ['academic_year_id'] as const)) {}

export class DecisionDto {
  @ApiPropertyOptional({ example: 'Seats full for class 6', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class EnrolAdmissionDto {
  @ApiPropertyOptional({ example: 11, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  section_id?: number | null;

  @IsDateOnly('2026-06-03', true)
  admission_date?: string;

  @ApiPropertyOptional({ enum: LANGUAGES, description: 'Language for the parent login' })
  @IsOptional()
  @IsIn(LANGUAGES)
  language?: Language;
}

export class AdmissionQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: ADMISSION_STATUSES })
  @IsOptional()
  @IsIn(ADMISSION_STATUSES)
  status?: AdmissionStatus;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  class_id?: number;
}

export class GuardianQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ description: 'true: has signed in to the app at least once' })
  @IsOptional()
  @Transform(toBoolean)
  @IsIn([true, false])
  on_app?: boolean;

  @ApiPropertyOptional({ description: 'true: more than one child in the school' })
  @IsOptional()
  @Transform(toBoolean)
  @IsIn([true, false])
  multiple_children?: boolean;

  @ApiPropertyOptional({ enum: LANGUAGES })
  @IsOptional()
  @IsIn(LANGUAGES)
  language?: Language;
}

export class UpdateGuardianDto extends PartialType(
  OmitType(GuardianInputDto, ['relation', 'is_primary', 'can_pickup', 'receives_alerts'] as const),
) {
  @ApiPropertyOptional({ example: '14, Gandhi Street', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  address_line?: string | null;

  @ApiPropertyOptional({ example: 'Chennai', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(80)
  city?: string | null;

  @ApiPropertyOptional({ example: '600040', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @Matches(/^\d{6}$/, { message: 'pincode must be 6 digits' })
  pincode?: string | null;
}
