import { SchoolScopedEntity } from '@app/common';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AcademicYear } from '../../setup/entities/academic-year.entity';
import { SchoolClass } from '../../setup/entities/school-class.entity';
import { Gender, Student } from './student.entity';
import { Relation } from './student-guardian.entity';

export const ADMISSION_STATUSES = ['applied', 'approved', 'rejected', 'enrolled'] as const;
export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];

@Entity('admissions')
@Index('UQ_admissions_school_application_no', ['school_id', 'application_no'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('IDX_admissions_school_status', ['school_id', 'status'])
export class Admission extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 30 })
  application_no: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  emis_number: string | null;

  @Column({ type: 'int' })
  academic_year_id: number;

  @ManyToOne(() => AcademicYear, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'academic_year_id' })
  academic_year?: AcademicYear;

  @Column({ type: 'int' })
  class_id: number;

  @ManyToOne(() => SchoolClass, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'class_id' })
  school_class?: SchoolClass;

  @Column({ type: 'varchar', length: 60 })
  first_name: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  last_name: string | null;

  @Column({ type: 'date' })
  dob: string;

  @Column({ type: 'varchar', length: 10 })
  gender: Gender;

  @Column({ type: 'varchar', length: 120 })
  guardian_name: string;

  @Column({ type: 'varchar', length: 10 })
  guardian_mobile: string;

  @Column({ type: 'varchar', length: 12 })
  guardian_relation: Relation;

  @Column({ type: 'varchar', length: 150, nullable: true })
  guardian_email: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  previous_school: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  identification_marks: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', length: 10, default: 'applied' })
  status: AdmissionStatus;

  @Column({ type: 'text', nullable: true })
  decision_note: string | null;

  @Column({ type: 'int', nullable: true })
  decided_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'int', nullable: true })
  student_id: number | null;

  @ManyToOne(() => Student, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'student_id' })
  student?: Student | null;
}
