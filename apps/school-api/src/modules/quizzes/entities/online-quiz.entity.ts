import { SchoolScopedEntity } from '@app/common';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { AcademicYear } from '../../setup/entities/academic-year.entity';
import { Section } from '../../setup/entities/section.entity';
import { Subject } from '../../setup/entities/subject.entity';
import { User } from '../../users/entities/user.entity';
import { QuizQuestion } from './quiz-question.entity';

export const QUIZ_STATUSES = ['draft', 'pending_approval', 'approved', 'rejected'] as const;
export type QuizStatus = (typeof QUIZ_STATUSES)[number];

@Entity('online_quizzes')
@Index('IDX_online_quizzes_school', ['school_id'])
@Index('IDX_online_quizzes_section', ['school_id', 'section_id'])
@Index('IDX_online_quizzes_teacher', ['school_id', 'teacher_user_id'])
@Index('IDX_online_quizzes_status', ['school_id', 'status'])
export class OnlineQuiz extends SchoolScopedEntity {
  @Column({ type: 'int' })
  academic_year_id: number;

  @ManyToOne(() => AcademicYear, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'academic_year_id' })
  academic_year?: AcademicYear;

  @Column({ type: 'int' })
  subject_id: number;

  @ManyToOne(() => Subject, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'subject_id' })
  subject?: Subject;

  @Column({ type: 'int' })
  section_id: number;

  @ManyToOne(() => Section, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'section_id' })
  section?: Section;

  @Column({ type: 'int' })
  teacher_user_id: number;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'teacher_user_id' })
  teacher?: User;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', nullable: true })
  instructions: string | null;

  @Column({ type: 'numeric', precision: 6, scale: 2, default: 0 })
  total_marks: number;

  @Column({ type: 'numeric', precision: 6, scale: 2, default: 0 })
  pass_marks: number;

  @Column({ type: 'int', default: 30 })
  duration_minutes: number;

  @Column({ type: 'timestamptz' })
  start_at: Date;

  @Column({ type: 'timestamptz' })
  end_at: Date;

  @Column({ type: 'boolean', default: false })
  expire_on_exit: boolean;

  @Column({ type: 'boolean', default: false })
  require_camera: boolean;

  @Column({ type: 'boolean', default: false })
  require_microphone: boolean;

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status: QuizStatus;

  @Column({ type: 'int', nullable: true })
  approved_by_user_id: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approved_by_user_id' })
  approved_by?: User | null;

  @Column({ type: 'timestamptz', nullable: true })
  approved_at: Date | null;

  @Column({ type: 'text', nullable: true })
  rejection_reason: string | null;

  @OneToMany(() => QuizQuestion, (q) => q.quiz)
  questions?: QuizQuestion[];
}
