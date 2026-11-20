import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import type { StaffGroup } from '../../emergency/entities/emergency.entity';
import type { RecipientKind, RecipientStudent } from '../../emergency/entities/emergency.entity';

export const SURVEY_STATUSES = ['draft', 'scheduled', 'open', 'closed'] as const;
export type SurveyStatus = (typeof SURVEY_STATUSES)[number];

export const SURVEY_AUDIENCES = ['everyone', 'parents', 'staff', 'classes', 'sections'] as const;
export type SurveyAudience = (typeof SURVEY_AUDIENCES)[number];

export const QUESTION_TYPES = [
  'single_choice',
  'multi_choice',
  'rating',
  'short_text',
  'long_text',
  'date',
  'number',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export type AnswerValue = string | string[] | number;

export interface TemplateQuestion {
  type: QuestionType;
  text: string;
  options: string[];
  is_required: boolean;
}

@Entity('surveys')
@Index('IDX_surveys_school_year_status', ['school_id', 'academic_year_id', 'status'])
@Index('IDX_surveys_status_due', ['status', 'send_at', 'closes_at'])
export class Survey extends SchoolScopedEntity {
  @Column({ type: 'int' })
  academic_year_id: number;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 10, default: 'parents' })
  audience: SurveyAudience;

  @Column({ type: 'int', array: true, nullable: true })
  class_ids: number[] | null;

  @Column({ type: 'int', array: true, nullable: true })
  section_ids: number[] | null;

  @Column({ type: 'varchar', length: 10, array: true, nullable: true })
  staff_groups: StaffGroup[] | null;

  @Column({ type: 'boolean', default: false })
  is_anonymous: boolean;

  @Column({ type: 'boolean', default: false })
  per_child: boolean;

  @Column({ type: 'varchar', length: 10, default: 'draft' })
  status: SurveyStatus;

  @Column({ type: 'timestamptz', nullable: true })
  send_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  closes_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  sent_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  closed_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  reminder_sent_at: Date | null;
}

@Entity('survey_questions')
@Index('IDX_survey_questions_survey', ['survey_id', 'sort_order'])
export class SurveyQuestion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  survey_id: number;

  @Column({ type: 'varchar', length: 15 })
  type: QuestionType;

  @Column({ type: 'varchar', length: 300 })
  text: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  options: string[];

  @Column({ type: 'boolean', default: true })
  is_required: boolean;

  @Column({ type: 'smallint', default: 0 })
  sort_order: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

@Entity('survey_recipients')
@Index('UQ_survey_recipients_slot', { synchronize: false })
@Index('IDX_survey_recipients_survey', ['survey_id', 'answered_at'])
@Index('IDX_survey_recipients_user', ['user_id'])
export class SurveyRecipient {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  survey_id: number;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'int', nullable: true })
  student_id: number | null;

  @Column({ type: 'varchar', length: 6 })
  kind: RecipientKind;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  students: RecipientStudent[];

  @Column({ type: 'timestamptz', nullable: true })
  notified_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  reminded_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  answered_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

@Entity('survey_responses')
@Index('IDX_survey_responses_survey', ['survey_id', 'submitted_at'])
export class SurveyResponse {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  survey_id: number;

  @Index('UQ_survey_responses_recipient', { unique: true })
  @Column({ type: 'int' })
  recipient_id: number;

  @Column({ type: 'timestamptz' })
  submitted_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

@Entity('survey_answers')
@Index('IDX_survey_answers_response', ['response_id'])
@Index('IDX_survey_answers_question', ['question_id'])
export class SurveyAnswer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  response_id: number;

  @Column({ type: 'int' })
  question_id: number;

  @Column({ type: 'jsonb' })
  value: AnswerValue;
}

@Entity('survey_templates')
@Index('IDX_survey_templates_school', ['school_id', 'sort_order'])
@Index('UQ_survey_templates_school_key', ['school_id', 'key'], { unique: true, where: 'key IS NOT NULL' })
export class SurveyTemplate extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 40, nullable: true })
  key: string | null;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  questions: TemplateQuestion[];

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'int', default: 0 })
  sort_order: number;
}
