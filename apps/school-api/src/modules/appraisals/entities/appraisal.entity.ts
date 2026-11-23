import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

export const STAFF_TYPES = ['teaching', 'non_teaching'] as const;
export type StaffTypeRule = (typeof STAFF_TYPES)[number];

export interface GroupRules {
  staff_types: StaffTypeRule[];
  departments: string[];
  designations: string[];
  roles: string[];
}

export const MEMBER_MODES = ['include', 'exclude'] as const;
export type MemberMode = (typeof MEMBER_MODES)[number];

export const KRA_CATEGORIES = ['academics', 'pedagogy', 'administrative', 'extracurricular', 'general'] as const;
export type KraCategory = (typeof KRA_CATEGORIES)[number];

export const SCORING_MODES = ['manual', 'auto'] as const;
export type ScoringMode = (typeof SCORING_MODES)[number];

export const AUTO_METRICS = [
  'attendance_percent',
  'exam_pass_percent',
  'parent_rating',
  'parent_good_behaviour_percent',
  'homework_count',
  'driver_rating',
] as const;
export type AutoMetric = (typeof AUTO_METRICS)[number];

export const CYCLE_STATUSES = ['draft', 'scheduled', 'open', 'closed'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

export const STAGES = [
  'self_pending',
  'hod_pending',
  'principal_pending',
  'published',
  'appealed',
  'completed',
] as const;
export type AppraisalStage = (typeof STAGES)[number];

export const RATINGS = [
  'outstanding',
  'exceeds_expectations',
  'meets_expectations',
  'needs_improvement',
  'unsatisfactory',
] as const;
export type Rating = (typeof RATINGS)[number];

export const RECOMMENDATIONS = ['increment', 'promotion', 'retention', 'pip'] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export type IncrementBands = Record<Rating, number>;

export const APPEAL_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

@Entity('appraisal_groups')
@Index('IDX_appraisal_groups_school_year', ['school_id', 'academic_year_id'])
export class AppraisalGroup extends SchoolScopedEntity {
  @Column({ type: 'int' })
  academic_year_id: number;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'jsonb' })
  rules: GroupRules;

  @Column({ type: 'boolean', default: false })
  is_default: boolean;

  @Column({ type: 'int', default: 0 })
  sort_order: number;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;
}

@Entity('appraisal_group_members')
@Index('UQ_appraisal_group_members', ['group_id', 'staff_id'], { unique: true, where: 'deleted_at IS NULL' })
export class AppraisalGroupMember extends SchoolScopedEntity {
  @Column({ type: 'int' })
  group_id: number;

  @Column({ type: 'int' })
  staff_id: number;

  @Column({ type: 'varchar', length: 10 })
  mode: MemberMode;
}

@Entity('appraisal_kras')
@Index('UQ_appraisal_kras_group_code', ['group_id', 'code'], { unique: true, where: 'deleted_at IS NULL' })
export class AppraisalKra extends SchoolScopedEntity {
  @Column({ type: 'int' })
  group_id: number;

  @Column({ type: 'varchar', length: 50 })
  code: string;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 20, default: 'general' })
  category: KraCategory;

  @Column({ type: 'numeric', precision: 5, scale: 2 })
  weightage_percent: string;

  @Column({ type: 'smallint', default: 5 })
  max_score: number;

  @Column({ type: 'varchar', length: 10, default: 'manual' })
  scoring_mode: ScoringMode;

  @Column({ type: 'varchar', length: 40, nullable: true })
  auto_metric: AutoMetric | null;

  @Column({ type: 'numeric', precision: 8, scale: 2, nullable: true })
  auto_target: string | null;

  @Column({ type: 'int', default: 0 })
  sort_order: number;
}

@Entity('appraisal_cycles')
@Index('IDX_appraisal_cycles_school_year', ['school_id', 'academic_year_id'])
@Index('IDX_appraisal_cycles_status', ['status', 'self_opens_at'])
export class AppraisalCycle extends SchoolScopedEntity {
  @Column({ type: 'int' })
  academic_year_id: number;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int', array: true, default: '{}' })
  group_ids: number[];

  @Column({ type: 'timestamptz', nullable: true })
  self_opens_at: Date | null;

  @Column({ type: 'timestamptz' })
  self_due_at: Date;

  @Column({ type: 'timestamptz' })
  hod_due_at: Date;

  @Column({ type: 'timestamptz' })
  final_due_at: Date;

  @Column({ type: 'smallint', default: 7 })
  appeal_days: number;

  @Column({ type: 'jsonb' })
  increment_bands: IncrementBands;

  @Column({ type: 'varchar', length: 10, default: 'draft' })
  status: CycleStatus;

  @Column({ type: 'boolean', default: false })
  is_legacy: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  opened_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  closed_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  self_reminder_sent_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  self_moved_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  hod_reminder_sent_at: Date | null;
}

@Entity('appraisals')
@Index('UQ_appraisals_cycle_staff', ['cycle_id', 'staff_id'], { unique: true, where: 'deleted_at IS NULL' })
@Index('IDX_appraisals_user', ['user_id'])
@Index('IDX_appraisals_hod', ['hod_user_id', 'stage'])
@Index('IDX_appraisals_school_year_stage', ['school_id', 'academic_year_id', 'stage'])
export class Appraisal extends SchoolScopedEntity {
  @Column({ type: 'int' })
  cycle_id: number;

  @Column({ type: 'int' })
  academic_year_id: number;

  @Column({ type: 'int' })
  staff_id: number;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'int' })
  group_id: number;

  @Column({ type: 'int', nullable: true })
  hod_user_id: number | null;

  @Column({ type: 'varchar', length: 20, default: 'self_pending' })
  stage: AppraisalStage;

  @Column({ type: 'boolean', default: false })
  self_missed: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  self_submitted_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  hod_submitted_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;

  @Column({ type: 'int', nullable: true })
  published_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  acknowledged_at: Date | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  self_percent: string | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  hod_percent: string | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  final_percent: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  rating: Rating | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  recommendation: Recommendation | null;

  @Column({ type: 'numeric', precision: 4, scale: 1, nullable: true })
  suggested_increment: string | null;

  @Column({ type: 'numeric', precision: 4, scale: 1, nullable: true })
  increment_percent: string | null;

  @Column({ type: 'numeric', precision: 4, scale: 1, nullable: true })
  expected_increment_percent: string | null;

  @Column({ type: 'text', nullable: true })
  hike_justification: string | null;

  @Column({ type: 'text', nullable: true })
  strengths: string | null;

  @Column({ type: 'text', nullable: true })
  improvements: string | null;

  @Column({ type: 'text', nullable: true })
  goals: string | null;

  @Column({ type: 'text', nullable: true })
  hod_remarks: string | null;

  @Column({ type: 'text', nullable: true })
  principal_remarks: string | null;

  @Column({ type: 'text', nullable: true })
  staff_remarks: string | null;
}

@Entity('appraisal_scores')
@Index('UQ_appraisal_scores_kra', ['appraisal_id', 'kra_id'], { unique: true, where: 'deleted_at IS NULL' })
export class AppraisalScore extends SchoolScopedEntity {
  @Column({ type: 'int' })
  appraisal_id: number;

  @Column({ type: 'int', nullable: true })
  kra_id: number | null;

  @Column({ type: 'varchar', length: 50 })
  code: string;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'numeric', precision: 5, scale: 2 })
  weightage_percent: string;

  @Column({ type: 'smallint', default: 5 })
  max_score: number;

  @Column({ type: 'varchar', length: 10, default: 'manual' })
  scoring_mode: ScoringMode;

  @Column({ type: 'varchar', length: 40, nullable: true })
  auto_metric: AutoMetric | null;

  @Column({ type: 'numeric', precision: 8, scale: 2, nullable: true })
  auto_target: string | null;

  @Column({ type: 'int', default: 0 })
  sort_order: number;

  @Column({ type: 'numeric', precision: 8, scale: 2, nullable: true })
  auto_value: string | null;

  @Column({ type: 'numeric', precision: 4, scale: 2, nullable: true })
  auto_score: string | null;

  @Column({ type: 'numeric', precision: 4, scale: 2, nullable: true })
  self_score: string | null;

  @Column({ type: 'text', nullable: true })
  self_comment: string | null;

  @Column({ type: 'numeric', precision: 4, scale: 2, nullable: true })
  hod_score: string | null;

  @Column({ type: 'text', nullable: true })
  hod_comment: string | null;

  @Column({ type: 'numeric', precision: 4, scale: 2, nullable: true })
  final_score: string | null;

  @Column({ type: 'text', nullable: true })
  override_reason: string | null;
}

@Entity('appraisal_evidence')
@Index('IDX_appraisal_evidence_appraisal', ['appraisal_id'])
export class AppraisalEvidence extends SchoolScopedEntity {
  @Column({ type: 'int' })
  appraisal_id: number;

  @Column({ type: 'int', nullable: true })
  score_id: number | null;

  @Column({ type: 'int' })
  file_id: number;
}

@Entity('appraisal_appeals')
@Index('IDX_appraisal_appeals_appraisal', ['appraisal_id'])
@Index('IDX_appraisal_appeals_school_status', ['school_id', 'status'])
export class AppraisalAppeal extends SchoolScopedEntity {
  @Column({ type: 'int' })
  appraisal_id: number;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'numeric', precision: 4, scale: 1, nullable: true })
  requested_increment: string | null;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: AppealStatus;

  @Column({ type: 'int', nullable: true })
  decided_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'text', nullable: true })
  decision_note: string | null;
}
