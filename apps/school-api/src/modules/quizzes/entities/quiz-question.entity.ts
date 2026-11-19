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
import { OnlineQuiz } from './online-quiz.entity';

export interface QuizOption {
  key: string;
  text: string;
}

@Entity('quiz_questions')
@Index('IDX_quiz_questions_quiz', ['quiz_id'])
export class QuizQuestion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  quiz_id: number;

  @ManyToOne(() => OnlineQuiz, (quiz) => quiz.questions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quiz_id' })
  quiz?: OnlineQuiz;

  @Column({ type: 'int', default: 1 })
  sequence: number;

  @Column({ type: 'text' })
  question_text: string;

  @Column({ type: 'jsonb' })
  options: QuizOption[];

  @Column({ type: 'varchar', length: 10 })
  correct_option: string;

  @Column({ type: 'text', nullable: true })
  explanation: string | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 1 })
  marks: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

