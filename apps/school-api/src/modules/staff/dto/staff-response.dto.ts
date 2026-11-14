import { ApiProperty } from '@nestjs/swagger';
import { VERIFICATION_STATUSES, VerificationStatus } from '../../../shared/verification';
import { FileDto } from '../../files/dto/file.dto';
import { PersonNameDto } from '../../student-records/dto/records.dto';
import { RefDto } from '../../students/dto/student-response.dto';
import { Language, LANGUAGES } from '../../users/entities/user.entity';
import { STAFF_DOCUMENT_TYPES, StaffDocumentType } from '../entities/staff-document.entity';
import { STAFF_STATUSES, STAFF_TYPES, StaffStatus, StaffType } from '../entities/staff.entity';

export const ATTENTION_REASONS = [
  'documents_pending',
  'document_rejected',
  'no_documents',
  'bank_missing',
  'no_classes',
  'overloaded',
] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

export class RoleRefDto {
  @ApiProperty({ example: 'TEACHER' })
  code: string;

  @ApiProperty({ example: 'Teacher' })
  name: string;
}

export class StaffListItemDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 9, description: 'Login id; class teacher and assignments refer to it' })
  user_id: number;

  @ApiProperty({ example: 'TZMS-EMP-0004' })
  employee_no: string;

  @ApiProperty({ example: 'Priya Venkatesh' })
  name: string;

  @ApiProperty({ example: '9000000004' })
  mobile: string;

  @ApiProperty({ nullable: true, type: String })
  email: string | null;

  @ApiProperty({ nullable: true, type: Number })
  photo_file_id: number | null;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;

  @ApiProperty({ type: [RoleRefDto] })
  roles: RoleRefDto[];

  @ApiProperty({ enum: STAFF_TYPES })
  staff_type: StaffType;

  @ApiProperty({ example: 'PG Assistant' })
  designation: string;

  @ApiProperty({ nullable: true, type: String, example: 'Mathematics' })
  department: string | null;

  @ApiProperty({ enum: STAFF_STATUSES })
  status: StaffStatus;

  @ApiProperty({ example: '2019-06-03' })
  joining_date: string;

  @ApiProperty({ example: 7, description: 'Years at this school plus prior experience' })
  experience_years: number;

  @ApiProperty({ example: 26, description: 'Periods a week assigned this year' })
  load_periods: number;

  @ApiProperty({ example: 30 })
  max_periods_per_week: number;

  @ApiProperty({ example: 4, description: 'Sections taught this year' })
  sections_count: number;

  @ApiProperty({ type: [RefDto], description: 'Sections where this person is the class teacher this year' })
  class_teacher_of: RefDto[];

  @ApiProperty({ enum: ATTENTION_REASONS, isArray: true })
  attention: AttentionReason[];

  @ApiProperty({ description: 'Has signed in to an app at least once' })
  on_app: boolean;
}

export class QualificationDto {
  @ApiProperty({ example: 2 })
  id: number;

  @ApiProperty({ example: 'M.Sc.' })
  degree: string;

  @ApiProperty({ nullable: true, type: String })
  specialization: string | null;

  @ApiProperty({ nullable: true, type: String })
  institution: string | null;

  @ApiProperty({ nullable: true, type: Number })
  year_completed: number | null;
}

export class StaffDocumentDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ enum: STAFF_DOCUMENT_TYPES })
  type: StaffDocumentType;

  @ApiProperty({ example: 'Degree certificate' })
  title: string;

  @ApiProperty({ enum: VERIFICATION_STATUSES })
  status: VerificationStatus;

  @ApiProperty({ nullable: true, type: String })
  remarks: string | null;

  @ApiProperty({ type: PersonNameDto, nullable: true })
  verified_by: PersonNameDto | null;

  @ApiProperty({ nullable: true, type: Date })
  verified_at: Date | null;

  @ApiProperty({ type: FileDto, nullable: true })
  file: FileDto | null;

  @ApiProperty()
  created_at: Date;
}

export class BankSummaryDto {
  @ApiProperty({ nullable: true, type: Number })
  id?: number;

  @ApiProperty({ nullable: true, type: String })
  account_holder: string | null;

  @ApiProperty({ nullable: true, type: String })
  bank_name: string | null;

  @ApiProperty({ nullable: true, type: String })
  ifsc: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'XXXX6789' })
  account_masked: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'XXXX234K' })
  pan_masked: string | null;

  @ApiProperty()
  complete: boolean;

  @ApiProperty({ default: false })
  is_primary: boolean;
}

export class BankDetailsDto {
  @ApiProperty({ nullable: true, type: Number })
  id?: number;

  @ApiProperty({ example: 'Priya Venkatesh' })
  account_holder: string | null;

  @ApiProperty({ example: 'Indian Bank' })
  bank_name: string | null;

  @ApiProperty({ example: 'IDIB000T012' })
  ifsc: string | null;

  @ApiProperty({ example: '6123456789', nullable: true, type: String })
  account_no: string | null;

  @ApiProperty({ example: 'ABCPV1234K', nullable: true, type: String })
  pan: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'XXXX6789' })
  account_masked?: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'XXXX234K' })
  pan_masked?: string | null;

  @ApiProperty({ default: false })
  is_primary?: boolean;
}

export class TeachingAssignmentDto {
  @ApiProperty({ example: 21 })
  id: number;

  @ApiProperty({ type: RefDto, description: 'Section with the class name, for example 6 - A' })
  section: RefDto;

  @ApiProperty({ type: RefDto })
  subject: RefDto;

  @ApiProperty({ example: 6 })
  periods_per_week: number;
}

export class StaffDetailDto extends StaffListItemDto {
  @ApiProperty({ enum: LANGUAGES })
  language: Language;

  @ApiProperty({ nullable: true, type: String })
  gender: string | null;

  @ApiProperty({ nullable: true, type: String })
  dob: string | null;

  @ApiProperty({ example: 3 })
  prior_experience_years: number;

  @ApiProperty({ nullable: true, type: String })
  address: string | null;

  @ApiProperty({ nullable: true, type: String })
  emergency_contact_name: string | null;

  @ApiProperty({ nullable: true, type: String })
  emergency_contact_mobile: string | null;

  @ApiProperty({ nullable: true, type: String })
  left_on: string | null;

  @ApiProperty({ type: [QualificationDto] })
  qualifications: QualificationDto[];

  @ApiProperty({ type: [StaffDocumentDto] })
  documents: StaffDocumentDto[];

  @ApiProperty({ type: BankSummaryDto })
  bank: BankSummaryDto;

  @ApiProperty({ type: [BankSummaryDto] })
  banks: BankSummaryDto[];

  @ApiProperty({ type: [TeachingAssignmentDto] })
  assignments: TeachingAssignmentDto[];
}

export class StaffInsightsDto {
  @ApiProperty({ example: 24 })
  total_teachers: number;

  @ApiProperty({ example: 22.5, description: 'Average periods a week per teacher this year' })
  average_load: number;

  @ApiProperty({ example: 14 })
  class_teachers: number;

  @ApiProperty({ example: 3 })
  need_attention: number;

  @ApiProperty({ example: 31 })
  total_staff: number;

  @ApiProperty({ example: 2 })
  overloaded: number;
}

export class MatrixTeacherDto {
  @ApiProperty({ example: 9 })
  user_id: number;

  @ApiProperty({ example: 'Priya Venkatesh' })
  name: string;

  @ApiProperty({ nullable: true, type: String, example: 'Mathematics' })
  department: string | null;

  @ApiProperty({ example: 26 })
  load_periods: number;

  @ApiProperty({ example: 30 })
  max_periods_per_week: number;
}

export class MatrixCellDto {
  @ApiProperty({ example: 3 })
  subject_id: number;

  @ApiProperty({ example: 'Mathematics' })
  subject_name: string;

  @ApiProperty({ example: 'MATH' })
  subject_code: string;

  @ApiProperty({ nullable: true, type: Number })
  assignment_id: number | null;

  @ApiProperty({ nullable: true, type: Number })
  teacher_user_id: number | null;

  @ApiProperty({ nullable: true, type: String })
  teacher_name: string | null;

  @ApiProperty({ nullable: true, type: Number })
  periods_per_week: number | null;
}

export class MatrixRowDto {
  @ApiProperty({ example: 12 })
  section_id: number;

  @ApiProperty({ example: 7 })
  class_id: number;

  @ApiProperty({ example: '6' })
  class_name: string;

  @ApiProperty({ example: 'A' })
  section_name: string;

  @ApiProperty({ nullable: true, type: String })
  class_teacher: string | null;

  @ApiProperty({ type: [MatrixCellDto] })
  cells: MatrixCellDto[];
}

export class AssignmentMatrixDto {
  @ApiProperty({ type: RefDto })
  academic_year: RefDto;

  @ApiProperty({ type: [MatrixTeacherDto] })
  teachers: MatrixTeacherDto[];

  @ApiProperty({ type: [MatrixRowDto] })
  rows: MatrixRowDto[];

  @ApiProperty({ example: 6, description: 'Subject slots with no teacher' })
  unassigned: number;
}

export class TeacherClassDto {
  @ApiProperty({ example: 12 })
  section_id: number;

  @ApiProperty({ example: '6' })
  class_name: string;

  @ApiProperty({ example: 'A' })
  section_name: string;

  @ApiProperty()
  is_class_teacher: boolean;

  @ApiProperty({ type: [RefDto] })
  subjects: RefDto[];

  @ApiProperty({ example: 38 })
  student_count: number;

  @ApiProperty({ nullable: true, type: String })
  room: string | null;
}
