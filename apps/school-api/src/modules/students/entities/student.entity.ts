import { SchoolScopedEntity } from '@app/common';
import { Column, Entity, Index, OneToMany } from 'typeorm';
import { EmergencyContact } from './emergency-contact.entity';
import { StudentEnrollment } from './student-enrollment.entity';
import { StudentGuardian } from './student-guardian.entity';

export const GENDERS = ['male', 'female', 'other'] as const;
export type Gender = (typeof GENDERS)[number];

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export const STUDENT_STATUSES = ['active', 'transferred', 'withdrawn', 'alumni'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

@Entity('students')
@Index('UQ_students_school_admission_no', ['school_id', 'admission_no'], { unique: true, where: 'deleted_at IS NULL' })
export class Student extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 30 })
  admission_no: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  emis_number: string | null;

  @Column({ type: 'varchar', length: 60 })
  first_name: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  last_name: string | null;

  @Column({ type: 'date' })
  dob: string;

  @Column({ type: 'varchar', length: 10 })
  gender: Gender;

  @Column({ type: 'varchar', length: 3, nullable: true })
  blood_group: BloodGroup | null;

  @Column({ type: 'int', nullable: true })
  photo_file_id: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  house: string | null;

  @Column({ type: 'date' })
  admission_date: string;

  @Column({ type: 'varchar', length: 12, default: 'active' })
  status: StudentStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address_line: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  pincode: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  previous_school: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  identification_marks: string | null;

  @Column({ type: 'boolean', default: false })
  is_specially_abled: boolean;

  @Column({ type: 'varchar', length: 80, nullable: true })
  disability_category: string | null;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 1,
    nullable: true,
    transformer: {
      to: (val: number | null | undefined) => (val != null ? String(val) : null),
      from: (val: string | null) => (val != null ? Number(val) : null),
    },
  })
  disability_percentage: number | null;

  @Column({ type: 'boolean', default: false })
  is_adopted: boolean;

  @Column({ type: 'smallint', default: 1 })
  card_version: number;

  @Column({ type: 'date', nullable: true })
  left_on: string | null;

  @OneToMany(() => StudentEnrollment, (enrollment) => enrollment.student)
  enrollments?: StudentEnrollment[];

  @OneToMany(() => StudentGuardian, (link) => link.student)
  guardian_links?: StudentGuardian[];

  @OneToMany(() => EmergencyContact, (contact) => contact.student)
  emergency_contacts?: EmergencyContact[];
}
