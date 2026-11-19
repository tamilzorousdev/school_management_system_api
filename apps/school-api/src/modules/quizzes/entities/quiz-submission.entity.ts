import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Student } from '../../students/entities/student.entity';
import { OnlineQuiz } from './online-quiz.entity';
import { QuizAnswer } from './quiz-answer.entity';

export const SUBMISSION_STATUSES = ['in_progress', 'completed', 'expired'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

@Entity('quiz_submissions')
@Index('UQ_quiz_submissions_quiz_student', ['quiz_id', 'student_id'], { unique: true })
@Index('IDX_quiz_submissions_student', ['school_id', 'student_id'])
export class QuizSubmission {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  quiz_id: number;

  @ManyToOne(() => OnlineQuiz, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quiz_id' })
  quiz?: OnlineQuiz;

  @Column({ type: 'int' })
  student_id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student?: Student;

  @Column({ type: 'varchar', length: 20, default: 'in_progress' })
  status: SubmissionStatus;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  started_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  submitted_at: Date | null;

  @Column({ type: 'boolean', default: false })
  auto_submitted: boolean;

  @Column({ type: 'numeric', precision: 6, scale: 2, default: 0 })
  score: number;

  @Column({ type: 'numeric', precision: 6, scale: 2, default: 0 })
  total_marks: number;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0 })
  percentage: number;

  @Column({ type: 'boolean', default: false })
  passed: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToMany(() => QuizAnswer, (ans) => ans.submission)
  answers?: QuizAnswer[];
}

