import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import type { LeaveState, RollSlot, RollStatus } from '../hostel.logic';

export const LEAVE_KINDS = ['home', 'outing', 'medical', 'festival', 'other'] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];

export const LEAVE_STATES = [
  'awaiting_parent',
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'out',
  'returned',
] as const;

export const LEAVE_SOURCES = ['parent', 'warden', 'office'] as const;
export type LeaveSource = (typeof LEAVE_SOURCES)[number];

export const CONSENT_STATES = ['not_needed', 'waiting', 'given', 'refused'] as const;
export type ConsentState = (typeof CONSENT_STATES)[number];

export const MARK_METHODS = ['manual', 'qr', 'auto'] as const;
export type MarkMethod = (typeof MARK_METHODS)[number];

export const VISIT_STATUSES = ['inside', 'left', 'denied'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const ID_PROOF_TYPES = ['aadhaar', 'driving_licence', 'voter_id', 'pan', 'passport', 'other'] as const;
export type IdProofType = (typeof ID_PROOF_TYPES)[number];

@Entity('hostel_roll_calls')
@Index('UQ_hostel_roll_calls_slot', ['school_id', 'hostel_id', 'roll_date', 'slot'], { unique: true })
export class HostelRollCall {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'date' })
  roll_date: string;

  @Column({ type: 'varchar', length: 10 })
  slot: RollSlot;

  @Column({ type: 'int', nullable: true })
  started_by: number | null;

  @Column({ type: 'int', nullable: true })
  finished_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  finished_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

@Entity('hostel_roll_call_records')
@Index('UQ_hostel_roll_call_records_admission', ['roll_call_id', 'admission_id'], { unique: true })
@Index('IDX_hostel_roll_call_records_student', ['school_id', 'student_id'])
export class HostelRollCallRecord {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  roll_call_id: number;

  @Column({ type: 'int' })
  admission_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'varchar', length: 10 })
  status: RollStatus;

  @Column({ type: 'varchar', length: 8, default: 'manual' })
  method: MarkMethod;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @Column({ type: 'int', nullable: true })
  marked_by: number | null;

  @Column({ type: 'timestamptz' })
  marked_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  parent_notified_at: Date | null;
}

@Entity('hostel_leaves')
@Index('UQ_hostel_leaves_no', ['school_id', 'leave_no'], { unique: true, where: 'deleted_at IS NULL' })
@Index('IDX_hostel_leaves_status', ['school_id', 'status'])
@Index('IDX_hostel_leaves_admission', ['school_id', 'admission_id'])
export class HostelLeave extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 40 })
  leave_no: string;

  @Column({ type: 'int' })
  admission_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'varchar', length: 10 })
  kind: LeaveKind;

  @Column({ type: 'date' })
  from_date: string;

  @Column({ type: 'date' })
  to_date: string;

  @Column({ type: 'varchar', length: 5, nullable: true })
  depart_time: string | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  return_time: string | null;

  @Column({ type: 'timestamptz' })
  expected_return_at: Date;

  @Column({ type: 'varchar', length: 500 })
  reason: string;

  @Column({ type: 'varchar', length: 10 })
  source: LeaveSource;

  @Column({ type: 'varchar', length: 16 })
  status: LeaveState;

  @Column({ type: 'varchar', length: 10, default: 'not_needed' })
  consent_status: ConsentState;

  @Column({ type: 'int', nullable: true })
  consent_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  consent_at: Date | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  escort_name: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  escort_relation: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  escort_mobile: string | null;

  @Column({ type: 'int', nullable: true })
  decided_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  decision_note: string | null;

  @Column({ type: 'smallint', default: 1 })
  qr_version: number;

  @Column({ type: 'timestamptz', nullable: true })
  departed_at: Date | null;

  @Column({ type: 'int', nullable: true })
  departed_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  returned_at: Date | null;

  @Column({ type: 'int', nullable: true })
  returned_by: number | null;

  @Column({ type: 'int', nullable: true })
  late_minutes: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  overdue_alerted_at: Date | null;

  @Column({ type: 'int', nullable: true })
  school_leave_id: number | null;
}

@Entity('hostel_visits')
@Index('UQ_hostel_visits_no', ['school_id', 'visit_no'], { unique: true })
@Index('IDX_hostel_visits_status', ['school_id', 'hostel_id', 'status'])
export class HostelVisit {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'varchar', length: 40 })
  visit_no: string;

  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'int' })
  admission_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'varchar', length: 120 })
  visitor_name: string;

  @Column({ type: 'varchar', length: 40 })
  relation: string;

  @Column({ type: 'varchar', length: 10 })
  mobile: string;

  @Column({ type: 'smallint', default: 1 })
  people_count: number;

  @Column({ type: 'varchar', length: 16, nullable: true })
  id_proof_type: IdProofType | null;

  @Column({ type: 'varchar', length: 4, nullable: true })
  id_proof_last4: string | null;

  @Column({ type: 'int', nullable: true })
  photo_file_id: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  purpose: string | null;

  @Column({ type: 'boolean', default: false })
  is_known: boolean;

  @Column({ type: 'varchar', length: 8 })
  status: VisitStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  in_at: Date | null;

  @Column({ type: 'int', nullable: true })
  in_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  out_at: Date | null;

  @Column({ type: 'int', nullable: true })
  out_by: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

@Entity('hostel_approved_visitors')
@Index('IDX_hostel_approved_visitors_student', ['school_id', 'student_id'])
export class HostelApprovedVisitor extends SchoolScopedEntity {
  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 40 })
  relation: string;

  @Column({ type: 'varchar', length: 10 })
  mobile: string;

  @Column({ type: 'int', nullable: true })
  photo_file_id: number | null;

  @Column({ type: 'varchar', length: 10 })
  added_by_role: 'parent' | 'staff';
}

@Entity('hostel_blocklist')
@Index('UQ_hostel_blocklist_mobile', ['school_id', 'mobile'], { unique: true, where: 'deleted_at IS NULL' })
export class HostelBlocklist extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 10 })
  mobile: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  name: string | null;

  @Column({ type: 'varchar', length: 255 })
  reason: string;
}
