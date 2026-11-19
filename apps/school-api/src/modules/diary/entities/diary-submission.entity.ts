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
import { Student } from '../../students/entities/student.entity';
import { DiaryEntry } from './diary-entry.entity';

export const SUBMISSION_STATUSES = ['submitted', 'graded', 'resubmit_requested'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

const nullableNumber = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

@Entity('diary_submissions')
@Index('UQ_diary_submissions_entry_student', ['entry_id', 'student_id'], { unique: true })
@Index('IDX_diary_submissions_school_entry', ['school_id', 'entry_id'])
export class DiarySubmission {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  school_id: number;

  @Index()
  @Column({ type: 'int' })
  entry_id: number;

  @ManyToOne(() => DiaryEntry, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'entry_id' })
  entry?: DiaryEntry;

  @Index()
  @Column({ type: 'int' })
  student_id: number;

  @ManyToOne(() => Student, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'student_id' })
  student?: Student;

  @Column({ type: 'int', nullable: true })
  submitted_by: number | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  submitted_at: Date;

  @Column({ type: 'boolean', default: false })
  is_late: boolean;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  student_notes: string | null;

  @Column({ type: 'varchar', length: 25, default: 'submitted' })
  status: SubmissionStatus;

  @Column({ type: 'varchar', length: 10, nullable: true })
  grade: string | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: nullableNumber })
  marks: number | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: nullableNumber })
  max_marks: number | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  teacher_feedback: string | null;

  @Column({ type: 'int', nullable: true })
  graded_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  graded_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
