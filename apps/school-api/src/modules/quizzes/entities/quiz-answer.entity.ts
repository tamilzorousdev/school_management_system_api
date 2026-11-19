import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { QuizQuestion } from './quiz-question.entity';
import { QuizSubmission } from './quiz-submission.entity';

@Entity('quiz_answers')
@Index('UQ_quiz_answers_sub_q', ['submission_id', 'question_id'], { unique: true })
export class QuizAnswer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  submission_id: number;

  @ManyToOne(() => QuizSubmission, (sub) => sub.answers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'submission_id' })
  submission?: QuizSubmission;

  @Column({ type: 'int' })
  question_id: number;

  @ManyToOne(() => QuizQuestion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_id' })
  question?: QuizQuestion;

  @Column({ type: 'varchar', length: 10, nullable: true })
  selected_option: string | null;

  @Column({ type: 'boolean', default: false })
  is_correct: boolean;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0 })
  marks_awarded: number;

  @CreateDateColumn({ type: 'timestamptz' })
  answered_at: Date;
}
