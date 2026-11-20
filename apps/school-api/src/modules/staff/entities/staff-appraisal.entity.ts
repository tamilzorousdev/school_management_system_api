import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

export const APPRAISAL_STATUSES = ['draft', 'submitted', 'reviewed', 'appealed', 'finalized'] as const;
export type AppraisalStatus = (typeof APPRAISAL_STATUSES)[number];

export const APPEAL_STATUSES = ['none', 'pending', 'resolved', 'rejected'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

export interface KraScoreItem {
  kra_id?: number;
  code: string;
  title: string;
  weightage: number;
  score: number;
  remarks?: string | null;
}

export const OVERALL_RATINGS = [
  'outstanding',
  'exceeds_expectations',
  'meets_expectations',
  'needs_improvement',
  'unsatisfactory',
] as const;
export type OverallRating = (typeof OVERALL_RATINGS)[number];

export const APPRAISAL_RECOMMENDATIONS = ['increment', 'promotion', 'retention', 'pip'] as const;
export type AppraisalRecommendation = (typeof APPRAISAL_RECOMMENDATIONS)[number];

@Entity('staff_appraisals')
@Index('IDX_staff_appraisals_school_staff', ['school_id', 'staff_id'])
@Index('IDX_staff_appraisals_user', ['user_id'])
@Index('IDX_staff_appraisals_school_year', ['school_id', 'academic_year_id'])
export class StaffAppraisal extends SchoolScopedEntity {
  @Column({ type: 'int' })
  academic_year_id: number;

  @Column({ type: 'int' })
  staff_id: number;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'int' })
  reviewer_user_id: number;

  @Column({ type: 'varchar', length: 50 })
  period: string;

  @Column({ type: 'date' })
  review_date: string;

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status: AppraisalStatus;

  @Column({ type: 'numeric', precision: 3, scale: 1, default: 0.0 })
  teaching_effectiveness: number;

  @Column({ type: 'numeric', precision: 3, scale: 1, default: 0.0 })
  student_outcomes: number;

  @Column({ type: 'numeric', precision: 3, scale: 1, default: 0.0 })
  classroom_management: number;

  @Column({ type: 'numeric', precision: 3, scale: 1, default: 0.0 })
  professional_conduct: number;

  @Column({ type: 'numeric', precision: 3, scale: 1, default: 0.0 })
  extracurricular_contribution: number;

  @Column({ type: 'numeric', precision: 3, scale: 1, default: 0.0 })
  overall_score: number;

  @Column({ type: 'varchar', length: 30, default: 'meets_expectations' })
  overall_rating: OverallRating;

  @Column({ type: 'text', nullable: true })
  strengths: string | null;

  @Column({ type: 'text', nullable: true })
  areas_for_improvement: string | null;

  @Column({ type: 'text', nullable: true })
  goals_next_period: string | null;

  @Column({ type: 'text', nullable: true })
  reviewer_remarks: string | null;

  @Column({ type: 'text', nullable: true })
  staff_remarks: string | null;

  @Column({ type: 'numeric', precision: 4, scale: 1, nullable: true })
  expected_increment_percent: number | null;

  @Column({ type: 'text', nullable: true })
  hike_justification: string | null;

  @Column({ type: 'varchar', length: 30, default: 'increment' })
  recommendation: AppraisalRecommendation;

  @Column({ type: 'numeric', precision: 4, scale: 1, default: 0.0 })
  increment_percent: number;

  @Column({ type: 'jsonb', nullable: true })
  kra_scores: KraScoreItem[] | null;

  @Column({ type: 'varchar', length: 20, default: 'none' })
  appeal_status: AppealStatus;

  @Column({ type: 'text', nullable: true })
  appeal_reason: string | null;

  @Column({ type: 'numeric', precision: 4, scale: 1, nullable: true })
  appeal_requested_hike: number | null;

  @Column({ type: 'text', nullable: true })
  appeal_feedback: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  appealed_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  appeal_resolved_at: Date | null;

  @Column({ type: 'int', nullable: true })
  appeal_resolved_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  finalized_at: Date | null;

  @Column({ type: 'int', nullable: true })
  finalized_by: number | null;
}
