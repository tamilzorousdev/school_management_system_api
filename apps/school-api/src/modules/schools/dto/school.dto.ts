import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { MOBILE_PATTERN, normalizeMobile } from '../../../shared/mobile';
import { ID_CARD_DESIGNS } from '../../../shared/id-card-design';
import type { IdCardLayout } from '../../../shared/id-card-layout';
import { DIARY_REVIEW_MODES, DiaryReviewMode, SCHOOL_BOARDS, SchoolBoard } from '../entities/school.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

export class SchoolProfileDto {
  @ApiProperty({ example: 'Tamilzorous Model School' })
  @Transform(trim)
  @IsString()
  @Length(3, 150)
  name: string;

  @ApiPropertyOptional({ enum: SCHOOL_BOARDS, nullable: true })
  @IsOptional()
  @IsIn([...SCHOOL_BOARDS, null])
  board?: SchoolBoard | null;

  @ApiPropertyOptional({ example: '12, 2nd Avenue, Anna Nagar', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional({ example: 'Chennai', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(80)
  city?: string | null;

  @ApiPropertyOptional({ example: 'Tamil Nadu', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(80)
  state?: string | null;

  @ApiPropertyOptional({ example: '600040', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_object, value) => value !== null)
  @Matches(/^\d{6}$/, { message: 'pincode must be 6 digits' })
  pincode?: string | null;

  @ApiPropertyOptional({ example: '04426201234', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_object, value) => value !== null)
  @Matches(/^\+?\d[\d\s-]{6,18}$/, { message: 'phone must be a valid phone number' })
  phone?: string | null;

  @ApiPropertyOptional({
    example: '04426201235',
    nullable: true,
    type: String,
    description: 'Shown to parents in SOS and emergency messages',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_object, value) => value !== null)
  @Matches(/^\+?\d[\d\s-]{6,18}$/, { message: 'emergency_phone must be a valid phone number' })
  emergency_phone?: string | null;

  @ApiPropertyOptional({ example: 'office@school.in', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_object, value) => value !== null)
  @IsEmail({}, { message: 'email must be a valid email address' })
  email?: string | null;

  @ApiPropertyOptional({ example: 13.0878, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsLatitude()
  latitude?: number | null;

  @ApiPropertyOptional({ example: 80.2101, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsLongitude()
  longitude?: number | null;

  @ApiPropertyOptional({
    example: 200,
    description: 'School gate geofence in metres, used for bus arrival and staff check-in',
  })
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(2000)
  geofence_radius_m?: number;

  @ApiPropertyOptional({ example: '08:45', description: 'Staff checking in more than 10 minutes after this are late' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'staff_reporting_time must be HH:MM, for example 08:45' })
  staff_reporting_time?: string;

  @ApiPropertyOptional({
    enum: DIARY_REVIEW_MODES,
    example: 'remarks',
    description:
      'all: the office reviews every diary post before parents see it. remarks: only remarks and feedback are reviewed; homework and notes go out at once. none: no review; all posts go out at once.',
  })
  @IsOptional()
  @IsIn(DIARY_REVIEW_MODES)
  diary_review_mode?: DiaryReviewMode;

  @ApiPropertyOptional({
    example: 15,
    minimum: 0,
    maximum: 30,
    description:
      'Extra minutes teachers get to take attendance after the 1st period (morning) and the 5th period (afternoon) end. After that the session shows as missed.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  attendance_grace_minutes?: number;

  @ApiPropertyOptional({
    example: '08:00',
    description: 'Chat office hours start (Monday to Saturday, not on holidays)',
  })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'chat_office_start must be HH:MM, for example 08:00' })
  chat_office_start?: string;

  @ApiPropertyOptional({
    example: '17:00',
    description: 'Chat office hours end. Parent messages after this reach the teacher when office hours start again.',
  })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'chat_office_end must be HH:MM, for example 17:00' })
  chat_office_end?: string;

  @ApiPropertyOptional({
    example: 41,
    nullable: true,
    type: Number,
    description:
      'Uploaded image (POST /files, purpose school_logo). Shown in the apps, ID cards, receipts and payslips. null removes it.',
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(1)
  logo_file_id?: number | null;

  @ApiPropertyOptional({
    example: 42,
    nullable: true,
    type: Number,
    description: 'Uploaded image (POST /files, purpose school_signature). Shown on payslips. null removes it.',
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(1)
  signature_file_id?: number | null;

  @ApiPropertyOptional({
    example: 43,
    nullable: true,
    type: Number,
    description:
      'Uploaded image (POST /files, purpose school_seal). Shown on receipts, payslips and certificates. null removes it.',
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(1)
  seal_file_id?: number | null;

  @ApiPropertyOptional({
    example: 'design3',
    enum: ID_CARD_DESIGNS,
    description: 'Active student ID card design template',
  })
  @IsOptional()
  @IsIn(ID_CARD_DESIGNS)
  id_card_design?: string | null;

  @ApiPropertyOptional({
    example: 51,
    nullable: true,
    type: Number,
    description:
      'Front side of the full ID card design from the design team (image from POST /files, purpose id_card_design). Printed when id_card_design is custom. null removes it.',
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(1)
  id_card_front_file_id?: number | null;

  @ApiPropertyOptional({
    example: 52,
    nullable: true,
    type: Number,
    description: 'Back side of the uploaded ID card design (image, purpose id_card_design). null removes it.',
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(1)
  id_card_back_file_id?: number | null;

  @ApiPropertyOptional({
    type: Object,
    nullable: true,
    description:
      'Where student details are printed on the uploaded design: { front: [...], back: [...] }, each { key, x, y, w, h, font_size, color, bold, align } with x, y, w, h as fractions (0 to 1) of the card.',
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsObject()
  id_card_layout?: Record<string, unknown> | null;
}

export class CreateSchoolDto extends SchoolProfileDto {
  @ApiProperty({ example: 'TZMS', description: 'Short unique code, 2 to 20 letters or digits' })
  @Transform(upper)
  @Matches(/^[A-Z0-9]{2,20}$/, { message: 'code must be 2 to 20 letters or digits' })
  code: string;

  @ApiPropertyOptional({ example: 'Meena Raghavan', description: 'Creates the first school admin with this name' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  admin_name?: string;

  @ApiPropertyOptional({ example: '9876500001', description: 'Mobile of the first school admin' })
  @IsOptional()
  @Transform(({ value }) => normalizeMobile(value))
  @Matches(MOBILE_PATTERN, { message: 'admin_mobile must be a valid 10-digit Indian mobile number' })
  admin_mobile?: string;
}

export class UpdateSchoolDto extends PartialType(OmitType(CreateSchoolDto, ['admin_name', 'admin_mobile'] as const)) {
  @ApiPropertyOptional({ description: 'Switch a school off without deleting its data' })
  @IsOptional()
  @Transform(toBoolean)
  @IsIn([true, false])
  is_active?: boolean;
}

export class UpdateCurrentSchoolDto extends PartialType(SchoolProfileDto) {}

export class SchoolQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ description: 'Filter by active flag' })
  @IsOptional()
  @Transform(toBoolean)
  @IsIn([true, false])
  is_active?: boolean;
}

export class SchoolDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Tamilzorous Model School' })
  name: string;

  @ApiProperty({ example: 'TZMS' })
  code: string;

  @ApiProperty({ enum: SCHOOL_BOARDS, nullable: true })
  board: SchoolBoard | null;

  @ApiProperty({ nullable: true, type: String })
  address: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Chennai' })
  city: string | null;

  @ApiProperty({ nullable: true, type: String })
  state: string | null;

  @ApiProperty({ nullable: true, type: String })
  pincode: string | null;

  @ApiProperty({ nullable: true, type: String })
  phone: string | null;

  @ApiProperty({ nullable: true, type: String })
  emergency_phone: string | null;

  @ApiProperty({ nullable: true, type: String })
  email: string | null;

  @ApiProperty({ nullable: true, type: Number })
  latitude: number | null;

  @ApiProperty({ nullable: true, type: Number })
  longitude: number | null;

  @ApiProperty({ example: 200 })
  geofence_radius_m: number;

  @ApiProperty({ example: '08:45' })
  staff_reporting_time: string;

  @ApiProperty({ enum: DIARY_REVIEW_MODES, example: 'remarks' })
  diary_review_mode: DiaryReviewMode;

  @ApiProperty({ example: 15, description: 'Extra minutes after the 1st and 5th period to take attendance' })
  attendance_grace_minutes: number;

  @ApiProperty({ example: '08:00' })
  chat_office_start: string;

  @ApiProperty({ example: '17:00' })
  chat_office_end: string;

  @ApiProperty({ example: 'Asia/Kolkata' })
  timezone: string;

  @ApiProperty({ nullable: true, type: Number, example: 41 })
  logo_file_id: number | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Signed link to the logo, valid for FILE_URL_TTL_SECONDS',
  })
  logo_url: string | null;

  @ApiProperty({ nullable: true, type: Number, example: 42 })
  signature_file_id: number | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Signed link to the signature, valid for FILE_URL_TTL_SECONDS',
  })
  signature_url: string | null;

  @ApiProperty({ nullable: true, type: Number, example: 43 })
  seal_file_id: number | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Signed link to the seal, valid for FILE_URL_TTL_SECONDS',
  })
  seal_url: string | null;

  @ApiPropertyOptional({ example: 'design3', enum: ID_CARD_DESIGNS, nullable: true })
  id_card_design: string | null;

  @ApiPropertyOptional({ example: 51, nullable: true, type: Number })
  id_card_front_file_id: number | null;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Signed link to the uploaded front design' })
  id_card_front_url: string | null;

  @ApiPropertyOptional({ example: 52, nullable: true, type: Number })
  id_card_back_file_id: number | null;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Signed link to the uploaded back design' })
  id_card_back_url: string | null;

  @ApiPropertyOptional({
    type: Object,
    nullable: true,
    description: 'Where student details are printed on the uploaded design',
  })
  id_card_layout: IdCardLayout | null;

  @ApiProperty()
  is_active: boolean;

  @ApiProperty({ example: 312 })
  student_count: number;

  @ApiProperty({ example: 48 })
  user_count: number;

  @ApiProperty()
  created_at: Date;
}
