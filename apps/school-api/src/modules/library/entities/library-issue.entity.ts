import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { CopyCondition } from './book.entity';

export const ISSUE_STATUSES = ['issued', 'returned', 'lost'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_PURPOSES = ['personal', 'class_set'] as const;
export type IssuePurpose = (typeof ISSUE_PURPOSES)[number];

export const FOLLOW_UP_ACTIONS = [
  'called_parent',
  'reminded_student',
  'reminded_staff',
  'told_class_teacher',
  'promised_date',
  'other',
] as const;
export type FollowUpAction = (typeof FOLLOW_UP_ACTIONS)[number];

export const COPY_EVENT_KINDS = [
  'added',
  'edited',
  'issued',
  'returned',
  'renewed',
  'marked_lost',
  'found',
  'damaged',
  'repaired',
  'withdrawn',
  'restored',
  'audited',
] as const;
export type CopyEventKind = (typeof COPY_EVENT_KINDS)[number];

@Entity('library_issues')
@Index('UQ_library_issues_open_copy', ['copy_id'], { unique: true, where: "status = 'issued' AND deleted_at IS NULL" })
@Index('IDX_library_issues_member', ['member_id', 'status'])
@Index('IDX_library_issues_due', ['school_id', 'status', 'due_date'])
export class LibraryIssue extends SchoolScopedEntity {
  @Column({ type: 'int' })
  copy_id: number;

  @Index()
  @Column({ type: 'int' })
  book_id: number;

  @Column({ type: 'int' })
  member_id: number;

  @Column({ type: 'int', nullable: true })
  academic_year_id: number | null;

  @Column({ type: 'int', nullable: true })
  class_id: number | null;

  @Column({ type: 'int', nullable: true })
  section_id: number | null;

  @Column({ type: 'varchar', length: 10, default: 'personal' })
  purpose: IssuePurpose;

  @Column({ type: 'timestamptz' })
  issued_at: Date;

  @Column({ type: 'date' })
  due_date: string;

  @Column({ type: 'timestamptz', nullable: true })
  returned_at: Date | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  return_condition: CopyCondition | null;

  @Column({ type: 'smallint', default: 0 })
  renew_count: number;

  @Column({ type: 'varchar', length: 10, default: 'issued' })
  status: IssueStatus;

  @Column({ type: 'int', nullable: true })
  issued_by: number | null;

  @Column({ type: 'int', nullable: true })
  returned_by: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remarks: string | null;
}

@Entity('library_follow_ups')
@Index('IDX_library_follow_ups_issue', ['issue_id'])
export class LibraryFollowUp extends SchoolScopedEntity {
  @Column({ type: 'int' })
  issue_id: number;

  @Column({ type: 'int' })
  member_id: number;

  @Column({ type: 'varchar', length: 20 })
  action: FollowUpAction;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ type: 'date', nullable: true })
  promised_on: string | null;

  @Column({ type: 'date', nullable: true })
  next_follow_up_on: string | null;
}

@Entity('library_reminders')
@Index('UQ_library_reminders_issue_kind', ['issue_id', 'kind'], { unique: true })
export class LibraryReminder {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  issue_id: number;

  @Column({ type: 'varchar', length: 20 })
  kind: string;

  @Column({ type: 'int', default: 0 })
  recipients: number;

  @CreateDateColumn({ type: 'timestamptz' })
  sent_at: Date;
}

@Entity('library_copy_events')
@Index('IDX_library_copy_events_copy', ['copy_id', 'created_at'])
export class LibraryCopyEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  copy_id: number;

  @Column({ type: 'varchar', length: 12 })
  kind: CopyEventKind;

  @Column({ type: 'int', nullable: true })
  issue_id: number | null;

  @Column({ type: 'int', nullable: true })
  member_id: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @Column({ type: 'int', nullable: true })
  actor_id: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
