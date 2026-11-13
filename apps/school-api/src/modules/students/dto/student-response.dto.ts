import { ApiProperty } from '@nestjs/swagger';
import { ADMISSION_STATUSES, AdmissionStatus } from '../entities/admission.entity';
import { BLOOD_GROUPS, BloodGroup, GENDERS, Gender, STUDENT_STATUSES, StudentStatus } from '../entities/student.entity';
import { ENROLLMENT_STATUSES, EnrollmentStatus } from '../entities/student-enrollment.entity';
import { RELATIONS, Relation } from '../entities/student-guardian.entity';

export class RefDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: '6' })
  name: string;
}

export class StudentGuardianSummaryDto {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({ example: 'Lakshmi Narayanan' })
  name: string;

  @ApiProperty({ example: '9000000005' })
  mobile: string;

  @ApiProperty({ enum: RELATIONS })
  relation: Relation;

  @ApiProperty()
  is_primary: boolean;
}

export class StudentListItemDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'TZMS-2026-0012' })
  admission_no: string;

  @ApiProperty({ example: 'Kavin' })
  first_name: string;

  @ApiProperty({ example: 'Narayanan', nullable: true, type: String })
  last_name: string | null;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ enum: GENDERS })
  gender: Gender;

  @ApiProperty({ example: '2015-04-12' })
  dob: string;

  @ApiProperty({ example: 11 })
  age: number;

  @ApiProperty({ enum: STUDENT_STATUSES })
  status: StudentStatus;

  @ApiProperty({ example: 'Red', nullable: true, type: String })
  house: string | null;

  @ApiProperty({ example: '2021-06-03' })
  admission_date: string;

  @ApiProperty({ example: 5, description: 'Full years since admission' })
  years_in_school: number;

  @ApiProperty({ type: RefDto, nullable: true, description: 'Class this academic year' })
  class: RefDto | null;

  @ApiProperty({ type: RefDto, nullable: true, description: 'Section this academic year' })
  section: RefDto | null;

  @ApiProperty({ example: 12, nullable: true, type: Number })
  roll_no: number | null;

  @ApiProperty({ example: null, nullable: true, type: Number })
  photo_file_id: number | null;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;

  @ApiProperty({ type: [StudentGuardianSummaryDto] })
  guardians: StudentGuardianSummaryDto[];

  @ApiProperty({ example: 1, description: 'Brothers and sisters in the school (shared guardian)' })
  sibling_count: number;
}

export class StudentGuardianDetailDto extends StudentGuardianSummaryDto {
  @ApiProperty({ nullable: true, type: String })
  email: string | null;

  @ApiProperty({ nullable: true, type: String })
  occupation: string | null;

  @ApiProperty({ nullable: true, type: String })
  qualification: string | null;

  @ApiProperty()
  can_pickup: boolean;

  @ApiProperty()
  receives_alerts: boolean;

  @ApiProperty({ description: 'Has signed in to the Parent app' })
  on_app: boolean;
}

export class SiblingDto {
  @ApiProperty({ example: 14 })
  id: number;

  @ApiProperty({ example: 'Nila Narayanan' })
  full_name: string;

  @ApiProperty({ example: '3 - B', nullable: true, type: String })
  class_section: string | null;
}

export class EnrollmentHistoryDto {
  @ApiProperty({ example: '2025-26' })
  academic_year: string;

  @ApiProperty({ example: '5' })
  class_name: string;

  @ApiProperty({ example: 'A', nullable: true, type: String })
  section_name: string | null;

  @ApiProperty({ example: 9, nullable: true, type: Number })
  roll_no: number | null;

  @ApiProperty({ enum: ENROLLMENT_STATUSES })
  status: EnrollmentStatus;

  @ApiProperty()
  is_current: boolean;
}

export class EmergencyContactDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'Saravanan' })
  name: string;

  @ApiProperty({ example: 'Uncle' })
  relation: string;

  @ApiProperty({ example: '9840011122' })
  mobile: string;
}

export class StudentDetailDto extends StudentListItemDto {
  @ApiProperty({ enum: BLOOD_GROUPS, nullable: true })
  blood_group: BloodGroup | null;

  @ApiProperty({ nullable: true, type: String })
  address_line: string | null;

  @ApiProperty({ nullable: true, type: String })
  city: string | null;

  @ApiProperty({ nullable: true, type: String })
  pincode: string | null;

  @ApiProperty({ nullable: true, type: String })
  previous_school: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'A mole on the left cheek' })
  identification_marks: string | null;

  @ApiProperty({ example: false })
  is_specially_abled: boolean;

  @ApiProperty({ nullable: true, type: String, example: 'Locomotor' })
  disability_category: string | null;

  @ApiProperty({ nullable: true, type: Number, example: 40 })
  disability_percentage: number | null;

  @ApiProperty({ example: false })
  is_adopted: boolean;

  @ApiProperty({ type: [StudentGuardianDetailDto] })
  guardian_details: StudentGuardianDetailDto[];

  @ApiProperty({ type: [SiblingDto] })
  siblings: SiblingDto[];

  @ApiProperty({ type: [EnrollmentHistoryDto] })
  history: EnrollmentHistoryDto[];

  @ApiProperty({ type: [EmergencyContactDto] })
  emergency_contacts: EmergencyContactDto[];
}

export class StudentInsightsDto {
  @ApiProperty({ example: 312, description: 'Active students' })
  total: number;

  @ApiProperty({ example: 6 })
  new_this_month: number;

  @ApiProperty({ example: 4, description: 'Active students not placed in a section this year' })
  without_section: number;

  @ApiProperty({ example: 38 })
  with_siblings: number;

  @ApiProperty({ example: 160 })
  boys: number;

  @ApiProperty({ example: 152 })
  girls: number;
}

export class GuardianChildDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ example: '6 - A', nullable: true, type: String })
  class_section: string | null;

  @ApiProperty({ enum: RELATIONS })
  relation: Relation;

  @ApiProperty({ example: '2021-06-03' })
  admission_date: string;

  @ApiProperty({ example: 5 })
  years_in_school: number;
}

export class GuardianListItemDto {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({ example: 'Lakshmi Narayanan' })
  name: string;

  @ApiProperty({ example: '9000000005' })
  mobile: string;

  @ApiProperty({ nullable: true, type: String })
  email: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Teacher' })
  occupation: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'M.A., B.Ed.' })
  qualification: string | null;

  @ApiProperty({ example: 'ta', nullable: true, type: String })
  language: string | null;

  @ApiProperty({ description: 'Has signed in to the Parent app' })
  on_app: boolean;

  @ApiProperty({ example: '2026-11-02T09:15:00.000+05:30', nullable: true, type: String })
  last_login_at: Date | null;

  @ApiProperty({ example: 2 })
  children_count: number;

  @ApiProperty({ type: [GuardianChildDto] })
  children: GuardianChildDto[];
}

export class CoGuardianDto {
  @ApiProperty({ example: 8 })
  id: number;

  @ApiProperty({ example: 'Ramesh Narayanan' })
  name: string;

  @ApiProperty({ example: '9000000015' })
  mobile: string;

  @ApiProperty({ enum: RELATIONS, description: 'Their relation to the shared children' })
  relation: Relation;
}

export class GuardianDetailDto extends GuardianListItemDto {
  @ApiProperty({ nullable: true, type: String })
  alt_mobile: string | null;

  @ApiProperty({ nullable: true, type: String })
  address_line: string | null;

  @ApiProperty({ nullable: true, type: String })
  city: string | null;

  @ApiProperty({ nullable: true, type: String })
  pincode: string | null;

  @ApiProperty({ type: [CoGuardianDto], description: 'Spouse or other guardians of the same children' })
  co_guardians: CoGuardianDto[];

  @ApiProperty({ nullable: true, type: Number })
  signature_file_id: number | null;

  @ApiProperty({ nullable: true, type: String })
  signature_url: string | null;
}

export class GuardianInsightsDto {
  @ApiProperty({ example: 240 })
  total: number;

  @ApiProperty({ example: 180 })
  on_app: number;

  @ApiProperty({ example: 32 })
  multiple_children: number;

  @ApiProperty({ example: 75 })
  tamil: number;
}

export class AdmissionDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'APP-2026-0003' })
  application_no: string;

  @ApiProperty({ enum: ADMISSION_STATUSES })
  status: AdmissionStatus;

  @ApiProperty({ type: RefDto })
  class: RefDto;

  @ApiProperty({ type: RefDto })
  academic_year: RefDto;

  @ApiProperty({ example: 'Nila' })
  first_name: string;

  @ApiProperty({ nullable: true, type: String })
  last_name: string | null;

  @ApiProperty({ example: 'Nila Murugan' })
  full_name: string;

  @ApiProperty({ example: '2016-02-20' })
  dob: string;

  @ApiProperty({ enum: GENDERS })
  gender: Gender;

  @ApiProperty({ example: 'Selvi Murugan' })
  guardian_name: string;

  @ApiProperty({ example: '9840055566' })
  guardian_mobile: string;

  @ApiProperty({ enum: RELATIONS })
  guardian_relation: Relation;

  @ApiProperty({ nullable: true, type: String })
  guardian_email: string | null;

  @ApiProperty({ nullable: true, type: String })
  previous_school: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'A mole on the left cheek' })
  identification_marks: string | null;

  @ApiProperty({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty({ nullable: true, type: String })
  decision_note: string | null;

  @ApiProperty({ nullable: true, type: String })
  decided_at: Date | null;

  @ApiProperty({ nullable: true, type: Number })
  student_id: number | null;

  @ApiProperty({ nullable: true, type: String, example: 'TZMS-2026-0031' })
  admission_no: string | null;

  @ApiProperty()
  created_at: Date;
}

export class AdmissionInsightsDto {
  @ApiProperty({ example: 12, description: 'Waiting for a decision' })
  applied: number;

  @ApiProperty({ example: 5, description: 'Approved, not enrolled yet' })
  approved: number;

  @ApiProperty({ example: 2 })
  rejected: number;

  @ApiProperty({ example: 30, description: 'Enrolled this academic year' })
  enrolled: number;
}

export class ParentChildDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ example: 'TZMS-2026-0012' })
  admission_no: string;

  @ApiProperty({ enum: GENDERS })
  gender: Gender;

  @ApiProperty({ example: '2015-04-12' })
  dob: string;

  @ApiProperty({ nullable: true, type: Number })
  photo_file_id: number | null;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;

  @ApiProperty({ example: '6', nullable: true, type: String })
  class_name: string | null;

  @ApiProperty({ example: 'A', nullable: true, type: String })
  section_name: string | null;

  @ApiProperty({ example: 12, nullable: true, type: Number })
  roll_no: number | null;

  @ApiProperty({ example: 'Priya Venkatesh', nullable: true, type: String })
  class_teacher: string | null;

  @ApiProperty({ enum: RELATIONS })
  relation: Relation;

  @ApiProperty({ type: RefDto })
  school: RefDto;
}
