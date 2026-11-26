import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

export const HISTORY_RESULTS = ['promoted', 'detained', 'completed', 'left', 'studying'] as const;
export type HistoryResult = (typeof HISTORY_RESULTS)[number];

export const HISTORY_SOURCES = ['system', 'manual'] as const;
export type HistorySource = (typeof HISTORY_SOURCES)[number];

export const SUBMISSION_TYPES = ['registration', 'update'] as const;
export type SubmissionType = (typeof SUBMISSION_TYPES)[number];

export const SUBMISSION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const TIMELINE_ACTIONS = [
  'created',
  'passed_out',
  'converted',
  'updated',
  'history_updated',
  'self_registered',
  'self_update_approved',
  'status_changed',
  'link_issued',
] as const;
export type TimelineAction = (typeof TIMELINE_ACTIONS)[number];

export type FieldChanges = Record<string, [unknown, unknown]>;

@Entity('alumni_academic_history')
@Index('IDX_alumni_history_alumni', ['alumni_id', 'sort_order'])
export class AlumniAcademicHistory extends BaseEntity {
  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  alumni_id: number;

  @Column({ type: 'varchar', length: 20 })
  academic_year_name: string;

  @Column({ type: 'varchar', length: 30 })
  class_name: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  section_name: string | null;

  @Column({ type: 'smallint', nullable: true })
  roll_no: number | null;

  @Column({ type: 'varchar', length: 12, nullable: true })
  result: HistoryResult | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  percent: string | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  grade: string | null;

  @Column({ type: 'varchar', length: 8 })
  source: HistorySource;

  @Column({ type: 'smallint', default: 0 })
  sort_order: number;
}

@Entity('alumni_submissions')
@Index('IDX_alumni_submissions_school_status', ['school_id', 'status'])
@Index('IDX_alumni_submissions_school_mobile', ['school_id', 'mobile'])
export class AlumniSubmission extends BaseEntity {
  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'varchar', length: 12 })
  type: SubmissionType;

  @Column({ type: 'int', nullable: true })
  alumni_id: number | null;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: SubmissionStatus;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'varchar', length: 130 })
  name: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  mobile: string | null;

  @Column({ type: 'int', nullable: true })
  reviewed_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewed_at: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  review_note: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  client_ip: string | null;
}

@Entity('alumni_update_links')
@Index('UQ_alumni_update_links_hash', ['token_hash'], { unique: true })
@Index('IDX_alumni_update_links_alumni', ['alumni_id'])
export class AlumniUpdateLink extends BaseEntity {
  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  alumni_id: number;

  @Column({ type: 'varchar', length: 64 })
  token_hash: string;

  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  used_at: Date | null;

  @Column({ type: 'int', nullable: true })
  created_by: number | null;
}

@Entity('alumni_timeline')
@Index('IDX_alumni_timeline_alumni', ['alumni_id', 'created_at'])
export class AlumniTimeline extends BaseEntity {
  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  alumni_id: number;

  @Column({ type: 'int', nullable: true })
  actor_user_id: number | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  actor_name: string | null;

  @Column({ type: 'varchar', length: 30 })
  action: TimelineAction;

  @Column({ type: 'jsonb', nullable: true })
  changes: FieldChanges | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;
}
