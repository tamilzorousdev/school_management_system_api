import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { Gender } from '../../students/entities/student.entity';

export const ALUMNI_SOURCES = ['pass_out', 'converted', 'registered', 'self'] as const;
export type AlumniSource = (typeof ALUMNI_SOURCES)[number];

export const ALUMNI_STATUSES = ['active', 'inactive'] as const;
export type AlumniStatus = (typeof ALUMNI_STATUSES)[number];

export const ALUMNI_EXIT_TYPES = ['graduated', 'transferred', 'withdrawn'] as const;
export type AlumniExitType = (typeof ALUMNI_EXIT_TYPES)[number];

export const OCCUPATION_STATUSES = [
  'higher_studies',
  'employed',
  'self_employed',
  'seeking',
  'other',
  'unknown',
] as const;
export type OccupationStatus = (typeof OCCUPATION_STATUSES)[number];

export const FINAL_RESULTS = ['pass', 'fail'] as const;
export type FinalResult = (typeof FINAL_RESULTS)[number];

@Entity('alumni')
@Index('UQ_alumni_school_no', ['school_id', 'alumni_no'], { unique: true, where: 'deleted_at IS NULL' })
@Index('UQ_alumni_school_student', ['school_id', 'student_id'], {
  unique: true,
  where: 'student_id IS NOT NULL AND deleted_at IS NULL',
})
@Index('IDX_alumni_school_batch', ['school_id', 'batch_year'])
@Index('IDX_alumni_school_mobile', ['school_id', 'mobile'])
export class Alumni extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 40 })
  alumni_no: string;

  @Column({ type: 'int', nullable: true })
  student_id: number | null;

  @Column({ type: 'varchar', length: 12 })
  source: AlumniSource;

  @Column({ type: 'varchar', length: 10, default: 'active' })
  status: AlumniStatus;

  @Column({ type: 'varchar', length: 60 })
  first_name: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  last_name: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  gender: Gender | null;

  @Column({ type: 'date', nullable: true })
  dob: string | null;

  @Column({ type: 'int', nullable: true })
  photo_file_id: number | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  admission_no: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  emis_number: string | null;

  @Column({ type: 'date', nullable: true })
  admission_date: string | null;

  @Column({ type: 'smallint' })
  batch_year: number;

  @Column({ type: 'date', nullable: true })
  left_on: string | null;

  @Column({ type: 'varchar', length: 12, default: 'graduated' })
  exit_type: AlumniExitType;

  @Column({ type: 'int', nullable: true })
  final_academic_year_id: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  final_academic_year_name: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  final_class_name: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  final_section_name: string | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  final_percent: string | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  final_grade: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  final_result: FinalResult | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  tc_no: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  mobile: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  alt_mobile: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address_line: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  state: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  pincode: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  country: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  linkedin_url: string | null;

  @Column({ type: 'boolean', default: false })
  contact_consent: boolean;

  @Column({ type: 'varchar', length: 20, default: 'unknown' })
  occupation_status: OccupationStatus;

  @Column({ type: 'varchar', length: 150, nullable: true })
  institution: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  course: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  organization: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  designation: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  profile_updated_at: Date | null;
}
