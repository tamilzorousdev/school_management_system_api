import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AcademicYear } from '../../setup/entities/academic-year.entity';
import { SchoolClass } from '../../setup/entities/school-class.entity';
import { Section } from '../../setup/entities/section.entity';
import { Student } from './student.entity';

export const ENROLLMENT_STATUSES = ['studying', 'promoted', 'detained', 'left', 'completed'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

@Entity('student_enrollments')
@Index('UQ_student_enrollments_student_year', ['student_id', 'academic_year_id'], { unique: true })
@Index('UQ_student_enrollments_section_roll', ['section_id', 'roll_no'], {
  unique: true,
  where: 'roll_no IS NOT NULL',
})
export class StudentEnrollment {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @ManyToOne(() => Student, (student) => student.enrollments, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'student_id' })
  student?: Student;

  @Index()
  @Column({ type: 'int' })
  academic_year_id: number;

  @ManyToOne(() => AcademicYear, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'academic_year_id' })
  academic_year?: AcademicYear;

  @Index()
  @Column({ type: 'int' })
  class_id: number;

  @ManyToOne(() => SchoolClass, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'class_id' })
  school_class?: SchoolClass;

  @Index()
  @Column({ type: 'int', nullable: true })
  section_id: number | null;

  @ManyToOne(() => Section, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'section_id' })
  section?: Section | null;

  @Column({ type: 'smallint', nullable: true })
  roll_no: number | null;

  @Column({ type: 'varchar', length: 10, default: 'studying' })
  status: EnrollmentStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
