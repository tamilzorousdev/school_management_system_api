import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { IsNullableDate } from '../../../shared/dates';
import { MOBILE_PATTERN, normalizeMobile } from '../../../shared/mobile';
import { GENDERS, Gender } from '../../students/entities/student.entity';
import {
  ALUMNI_EXIT_TYPES,
  ALUMNI_SOURCES,
  ALUMNI_STATUSES,
  AlumniExitType,
  AlumniSource,
  AlumniStatus,
  FINAL_RESULTS,
  FinalResult,
  OCCUPATION_STATUSES,
  OccupationStatus,
} from '../entities/alumni.entity';
import {
  FieldChanges,
  HISTORY_RESULTS,
  HistoryResult,
  HistorySource,
  SUBMISSION_STATUSES,
  SUBMISSION_TYPES,
  SubmissionStatus,
  SubmissionType,
  TimelineAction,
} from '../entities/alumni-records.entity';

const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : typeof value === 'string' ? value.trim() : value;
const mobileOrNull = ({ value }: { value: unknown }) =>
  value === '' || value === null ? null : normalizeMobile(value);
const notNull = (_object: unknown, value: unknown) => value !== null;
const currentYear = () => new Date().getFullYear();

export class AlumniQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  batch_year?: number;

  @ApiPropertyOptional({ enum: ALUMNI_SOURCES })
  @IsOptional()
  @IsIn(ALUMNI_SOURCES)
  source?: AlumniSource;

  @ApiPropertyOptional({ enum: ALUMNI_EXIT_TYPES })
  @IsOptional()
  @IsIn(ALUMNI_EXIT_TYPES)
  exit_type?: AlumniExitType;

  @ApiPropertyOptional({ enum: OCCUPATION_STATUSES })
  @IsOptional()
  @IsIn(OCCUPATION_STATUSES)
  occupation_status?: OccupationStatus;

  @ApiPropertyOptional({ enum: ALUMNI_STATUSES })
  @IsOptional()
  @IsIn(ALUMNI_STATUSES)
  status?: AlumniStatus;

  @ApiPropertyOptional({ description: 'Only alumni who agreed to be contacted and have a mobile or email' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  reachable?: boolean;

  @ApiPropertyOptional({ example: 'Chennai' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(80)
  city?: string;
}

export class AlumniContactInputDto {
  @ApiPropertyOptional({ example: '9876543210', nullable: true, type: String })
  @IsOptional()
  @Transform(mobileOrNull)
  @ValidateIf(notNull)
  @Matches(MOBILE_PATTERN, { message: 'mobile must be a valid 10-digit Indian mobile number' })
  mobile?: string | null;

  @ApiPropertyOptional({ example: '9840011122', nullable: true, type: String })
  @IsOptional()
  @Transform(mobileOrNull)
  @ValidateIf(notNull)
  @Matches(MOBILE_PATTERN, { message: 'alt_mobile must be a valid 10-digit Indian mobile number' })
  alt_mobile?: string | null;

  @ApiPropertyOptional({ example: 'priya@example.com', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(120)
  email?: string | null;

  @ApiPropertyOptional({ example: '12, Gandhi Street', nullable: true, type: String })
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

  @ApiPropertyOptional({ example: 'Tamil Nadu', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(80)
  state?: string | null;

  @ApiPropertyOptional({ example: '600001', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @Matches(/^\d{6}$/, { message: 'pincode must be 6 digits' })
  pincode?: string | null;

  @ApiPropertyOptional({ example: 'India', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(60)
  country?: string | null;

  @ApiPropertyOptional({ example: 'https://www.linkedin.com/in/priya', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsUrl({ require_protocol: true }, { message: 'linkedin_url must be a full link starting with https://' })
  @MaxLength(255)
  linkedin_url?: string | null;

  @ApiPropertyOptional({ example: true, description: 'The alumnus agrees to be contacted by the school' })
  @IsOptional()
  @IsBoolean()
  contact_consent?: boolean;

  @ApiPropertyOptional({ enum: OCCUPATION_STATUSES })
  @IsOptional()
  @IsIn(OCCUPATION_STATUSES)
  occupation_status?: OccupationStatus;

  @ApiPropertyOptional({ example: 'Anna University', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(150)
  institution?: string | null;

  @ApiPropertyOptional({ example: 'B.E. Computer Science', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  course?: string | null;

  @ApiPropertyOptional({ example: 'Tamilzorous', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(150)
  organization?: string | null;

  @ApiPropertyOptional({ example: 'Software Engineer', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  designation?: string | null;
}

export class AlumniDetailsInputDto extends AlumniContactInputDto {
  @ApiPropertyOptional({ example: 'Narayanan', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(60)
  last_name?: string | null;

  @ApiPropertyOptional({ enum: GENDERS, nullable: true })
  @IsOptional()
  @ValidateIf(notNull)
  @IsIn(GENDERS)
  gender?: Gender | null;

  @IsNullableDate('2008-05-14')
  dob?: string | null;

  @ApiPropertyOptional({ example: 'ADM-2014-0042', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(30)
  admission_no?: string | null;

  @ApiPropertyOptional({ example: '3302040120100123', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(50)
  emis_number?: string | null;

  @ApiPropertyOptional({ example: 'Class 12', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(30)
  final_class_name?: string | null;
}

export class AlumniProfileInputDto extends AlumniDetailsInputDto {
  @ApiPropertyOptional({ example: 51, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @Type(() => Number)
  @IsInt()
  photo_file_id?: number | null;

  @IsNullableDate('2014-06-02')
  admission_date?: string | null;

  @IsNullableDate('2026-03-31')
  left_on?: string | null;

  @ApiPropertyOptional({ enum: ALUMNI_EXIT_TYPES })
  @IsOptional()
  @IsIn(ALUMNI_EXIT_TYPES)
  exit_type?: AlumniExitType;

  @ApiPropertyOptional({ example: '2025-26', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(20)
  final_academic_year_name?: string | null;

  @ApiPropertyOptional({ example: 'A', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(10)
  final_section_name?: string | null;

  @ApiPropertyOptional({ example: 86.4, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  final_percent?: number | null;

  @ApiPropertyOptional({ example: 'A1', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(5)
  final_grade?: string | null;

  @ApiPropertyOptional({ enum: FINAL_RESULTS, nullable: true })
  @IsOptional()
  @ValidateIf(notNull)
  @IsIn(FINAL_RESULTS)
  final_result?: FinalResult | null;

  @ApiPropertyOptional({ example: 'TZS-TC-2025-0012', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(40)
  tc_no?: string | null;

  @ApiPropertyOptional({ example: 'Head girl 2025-26.', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class HistoryRowInputDto {
  @ApiProperty({ example: '2024-25' })
  @Transform(emptyToNull)
  @IsString()
  @Length(2, 20)
  academic_year_name: string;

  @ApiProperty({ example: 'Class 11' })
  @Transform(emptyToNull)
  @IsString()
  @Length(1, 30)
  class_name: string;

  @ApiPropertyOptional({ example: 'A', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(10)
  section_name?: string | null;

  @ApiPropertyOptional({ example: 12, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  roll_no?: number | null;

  @ApiPropertyOptional({ enum: HISTORY_RESULTS, nullable: true })
  @IsOptional()
  @ValidateIf(notNull)
  @IsIn(HISTORY_RESULTS)
  result?: HistoryResult | null;

  @ApiPropertyOptional({ example: 78.5, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  percent?: number | null;

  @ApiPropertyOptional({ example: 'B1', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(5)
  grade?: string | null;
}

export class UpdateAlumniDto extends AlumniProfileInputDto {
  @ApiPropertyOptional({ example: 'Priya' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @Length(1, 60)
  first_name?: string;

  @ApiPropertyOptional({ example: 2019 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  batch_year?: number;
}

export class ReplaceHistoryDto {
  @ApiProperty({
    type: [HistoryRowInputDto],
    description: 'Replaces the manual rows. Rows copied from the system stay.',
  })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => HistoryRowInputDto)
  rows: HistoryRowInputDto[];
}

export class AlumniStatusInputDto {
  @ApiProperty({ enum: ALUMNI_STATUSES })
  @IsIn(ALUMNI_STATUSES)
  status: AlumniStatus;

  @ApiPropertyOptional({ example: 'Asked not to be contacted', nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  note?: string | null;
}

export class PassOutPreviewQueryDto {
  @ApiPropertyOptional({ example: 3, description: 'Defaults to the current academic year' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  academic_year_id?: number;
}

export class SubmissionQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: SUBMISSION_STATUSES })
  @IsOptional()
  @IsIn(SUBMISSION_STATUSES)
  status?: SubmissionStatus;

  @ApiPropertyOptional({ enum: SUBMISSION_TYPES })
  @IsOptional()
  @IsIn(SUBMISSION_TYPES)
  type?: SubmissionType;
}

export class ApproveSubmissionDto {
  @ApiPropertyOptional({
    example: 18,
    nullable: true,
    type: Number,
    description: 'Registration only: merge into this existing alumni record instead of creating a new one',
  })
  @IsOptional()
  @ValidateIf(notNull)
  @Type(() => Number)
  @IsInt()
  alumni_id?: number | null;
}

export class RejectSubmissionDto {
  @ApiProperty({ example: 'Could not verify this person studied here' })
  @Transform(emptyToNull)
  @IsString()
  @Length(3, 255)
  note: string;
}

export class PublicRegisterDto extends AlumniDetailsInputDto {
  @ApiProperty({ example: 'Priya' })
  @Transform(emptyToNull)
  @IsString()
  @Length(1, 60)
  first_name: string;

  @ApiProperty({ example: 2019 })
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  batch_year: number;

  @ApiPropertyOptional({ description: 'Leave empty. Filled only by bots.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

export class PublicUpdateDto extends AlumniContactInputDto {
  @ApiPropertyOptional({ description: 'Leave empty. Filled only by bots.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

export function assertBatchYear(year: number | undefined): string | null {
  if (year === undefined) return null;
  return year > currentYear() ? `batch_year cannot be after ${currentYear()}` : null;
}

export class RefDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Lakshmi' })
  name: string;
}

export class AlumniItemDto {
  @ApiProperty({ example: 18 })
  id: number;

  @ApiProperty({ example: 'TZS-AL-2026-0004' })
  alumni_no: string;

  @ApiProperty({ example: 412, nullable: true, type: Number })
  student_id: number | null;

  @ApiProperty({ enum: ALUMNI_SOURCES })
  source: AlumniSource;

  @ApiProperty({ enum: ALUMNI_STATUSES })
  status: AlumniStatus;

  @ApiProperty({ example: 'Priya' })
  first_name: string;

  @ApiProperty({ example: 'Narayanan', nullable: true, type: String })
  last_name: string | null;

  @ApiProperty({ example: 'Priya Narayanan' })
  full_name: string;

  @ApiProperty({ enum: GENDERS, nullable: true })
  gender: Gender | null;

  @ApiProperty({ example: null, nullable: true, type: Number })
  photo_file_id: number | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  photo_url: string | null;

  @ApiProperty({ example: 'ADM-2014-0042', nullable: true, type: String })
  admission_no: string | null;

  @ApiProperty({ example: '3302040120100123', nullable: true, type: String })
  emis_number: string | null;

  @ApiProperty({ example: 2026 })
  batch_year: number;

  @ApiProperty({ example: '2026-03-31', nullable: true, type: String })
  left_on: string | null;

  @ApiProperty({ enum: ALUMNI_EXIT_TYPES })
  exit_type: AlumniExitType;

  @ApiProperty({ example: 'Class 12', nullable: true, type: String })
  final_class_name: string | null;

  @ApiProperty({ example: 'A', nullable: true, type: String })
  final_section_name: string | null;

  @ApiProperty({ example: 86.4, nullable: true, type: Number })
  final_percent: number | null;

  @ApiProperty({ example: 'A1', nullable: true, type: String })
  final_grade: string | null;

  @ApiProperty({ example: '9876543210', nullable: true, type: String })
  mobile: string | null;

  @ApiProperty({ example: 'priya@example.com', nullable: true, type: String })
  email: string | null;

  @ApiProperty({ example: 'Chennai', nullable: true, type: String })
  city: string | null;

  @ApiProperty({ enum: OCCUPATION_STATUSES })
  occupation_status: OccupationStatus;

  @ApiProperty({ example: 'Anna University', nullable: true, type: String })
  institution: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  organization: string | null;

  @ApiProperty({ example: true })
  contact_consent: boolean;

  @ApiProperty({ example: true, description: 'Agreed to be contacted and has a mobile or email' })
  reachable: boolean;
}

export class AlumniHistoryDto {
  @ApiProperty({ example: 5 })
  id: number;

  @ApiProperty({ example: '2025-26' })
  academic_year_name: string;

  @ApiProperty({ example: 'Class 12' })
  class_name: string;

  @ApiProperty({ example: 'A', nullable: true, type: String })
  section_name: string | null;

  @ApiProperty({ example: 14, nullable: true, type: Number })
  roll_no: number | null;

  @ApiProperty({ enum: HISTORY_RESULTS, nullable: true })
  result: HistoryResult | null;

  @ApiProperty({ example: 86.4, nullable: true, type: Number })
  percent: number | null;

  @ApiProperty({ example: 'A1', nullable: true, type: String })
  grade: string | null;

  @ApiProperty({ enum: ['system', 'manual'] })
  source: HistorySource;
}

export class AlumniTimelineDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'updated' })
  action: TimelineAction;

  @ApiProperty({ example: 'Lakshmi', nullable: true, type: String })
  actor_name: string | null;

  @ApiProperty({
    example: { city: ['Madurai', 'Chennai'] },
    nullable: true,
    description: 'Changed fields as [before, after]',
  })
  changes: FieldChanges | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  note: string | null;

  @ApiProperty({ example: '2026-11-23T10:00:00.000Z' })
  created_at: Date;
}

export class AlumniDetailDto extends AlumniItemDto {
  @ApiProperty({ example: '2008-05-14', nullable: true, type: String })
  dob: string | null;

  @ApiProperty({ example: '2014-06-02', nullable: true, type: String })
  admission_date: string | null;

  @ApiProperty({ example: 3, nullable: true, type: Number })
  final_academic_year_id: number | null;

  @ApiProperty({ example: '2025-26', nullable: true, type: String })
  final_academic_year_name: string | null;

  @ApiProperty({ enum: FINAL_RESULTS, nullable: true })
  final_result: FinalResult | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  tc_no: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  alt_mobile: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  address_line: string | null;

  @ApiProperty({ example: 'Tamil Nadu', nullable: true, type: String })
  state: string | null;

  @ApiProperty({ example: '600001', nullable: true, type: String })
  pincode: string | null;

  @ApiProperty({ example: 'India', nullable: true, type: String })
  country: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  linkedin_url: string | null;

  @ApiProperty({ example: 'B.E. Computer Science', nullable: true, type: String })
  course: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  designation: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  notes: string | null;

  @ApiProperty({ example: 1, description: 'Pending self-service submissions for this alumnus' })
  pending_submissions: number;

  @ApiProperty({ example: null, nullable: true, type: Date })
  profile_updated_at: Date | null;

  @ApiProperty({ example: '2026-11-23T10:00:00.000Z' })
  created_at: Date;

  @ApiProperty({ type: [AlumniHistoryDto] })
  academic_history: AlumniHistoryDto[];

  @ApiProperty({ type: [AlumniTimelineDto] })
  timeline: AlumniTimelineDto[];
}

export class BatchCountDto {
  @ApiProperty({ example: 2026 })
  batch_year: number;

  @ApiProperty({ example: 84 })
  count: number;
}

export class AlumniInsightsDto {
  @ApiProperty({ example: 412 })
  total: number;

  @ApiProperty({ example: 380 })
  active: number;

  @ApiProperty({ example: 210 })
  reachable: number;

  @ApiProperty({ type: BatchCountDto, nullable: true })
  latest_batch: BatchCountDto | null;

  @ApiProperty({ example: 3 })
  pending_submissions: number;

  @ApiProperty({ example: { higher_studies: 120, employed: 90 } })
  by_occupation: Record<OccupationStatus, number>;

  @ApiProperty({ type: [BatchCountDto], description: 'Last six batches, newest first' })
  by_batch: BatchCountDto[];
}

export class PassOutStudentDto {
  @ApiProperty({ example: 412 })
  student_id: number;

  @ApiProperty({ example: 'Priya Narayanan' })
  full_name: string;

  @ApiProperty({ example: 'ADM-2014-0042' })
  admission_no: string;

  @ApiProperty({ example: 'A', nullable: true, type: String })
  section_name: string | null;

  @ApiProperty({ example: 86.4, nullable: true, type: Number })
  percent: number | null;

  @ApiProperty({ example: 1500, description: 'Unpaid fees. Dues do not block pass-out.' })
  fee_due: number;
}

export class PassOutPreviewDto {
  @ApiProperty({ type: RefDto })
  academic_year: RefDto;

  @ApiProperty({ type: RefDto, nullable: true, description: 'The class with the highest grade level' })
  final_class: RefDto | null;

  @ApiProperty({ example: 84 })
  will_convert: number;

  @ApiProperty({ example: 2, description: 'Final-class students marked detained in promotion' })
  detained: number;

  @ApiProperty({ example: 0, description: 'Already have an alumni record' })
  already_alumni: number;

  @ApiProperty({ type: [PassOutStudentDto] })
  students: PassOutStudentDto[];
}

export class PassOutResultDto {
  @ApiProperty({ example: 84 })
  created: number;

  @ApiProperty({ example: 2026 })
  batch_year: number;
}

export class MatchDto {
  @ApiProperty({ example: 18 })
  id: number;

  @ApiProperty({ example: 'TZS-AL-2019-0004' })
  alumni_no: string;

  @ApiProperty({ example: 'Priya Narayanan' })
  full_name: string;

  @ApiProperty({ example: 2019 })
  batch_year: number;

  @ApiProperty({ example: '9876543210', nullable: true, type: String })
  mobile: string | null;
}

export class SubmissionDto {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({ enum: SUBMISSION_TYPES })
  type: SubmissionType;

  @ApiProperty({ enum: SUBMISSION_STATUSES })
  status: SubmissionStatus;

  @ApiProperty({ example: 18, nullable: true, type: Number })
  alumni_id: number | null;

  @ApiProperty({ example: 'TZS-AL-2019-0004', nullable: true, type: String })
  alumni_no: string | null;

  @ApiProperty({ example: 'Priya Narayanan' })
  name: string;

  @ApiProperty({ example: '9876543210', nullable: true, type: String })
  mobile: string | null;

  @ApiProperty({ example: { city: 'Chennai', occupation_status: 'employed' } })
  payload: Record<string, unknown>;

  @ApiProperty({
    example: { city: ['Madurai', 'Chennai'] },
    nullable: true,
    description: 'Update only: what would change, as [current, submitted]',
  })
  changes: FieldChanges | null;

  @ApiProperty({
    type: [MatchDto],
    description: 'Registration only: existing alumni with the same mobile or name and batch',
  })
  possible_matches: MatchDto[];

  @ApiProperty({ example: null, nullable: true, type: String })
  reviewed_by_name: string | null;

  @ApiProperty({ example: null, nullable: true, type: Date })
  reviewed_at: Date | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  review_note: string | null;

  @ApiProperty({ example: '2026-11-23T10:00:00.000Z' })
  created_at: Date;
}

export class UpdateLinkDto {
  @ApiProperty({
    example: 'alumni-update/8f1c...',
    description: 'Path on the admin web app; prefix it with the site address',
  })
  path: string;

  @ApiProperty({ example: '2026-12-07T10:00:00.000Z' })
  expires_at: Date;
}

export class PublicSchoolDto {
  @ApiProperty({ example: 'TZS' })
  code: string;

  @ApiProperty({ example: 'Tamilzorous Model School' })
  name: string;

  @ApiProperty({ example: null, nullable: true, type: String })
  logo_url: string | null;
}

export class PublicProfileDto extends AlumniContactInputDto {
  @ApiProperty({ type: PublicSchoolDto })
  school: PublicSchoolDto;

  @ApiProperty({ example: 'Priya Narayanan' })
  full_name: string;

  @ApiProperty({ example: 2019 })
  batch_year: number;

  @ApiProperty({ example: '2026-12-07T10:00:00.000Z' })
  expires_at: Date;
}

export class SubmissionReceivedDto {
  @ApiProperty({ example: 7 })
  id: number;
}
