import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

export const PASS_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'released', 'expired'] as const;
export type PassStatus = (typeof PASS_STATUSES)[number];

export const PASS_SOURCES = ['parent', 'staff', 'office', 'gate'] as const;
export type PassSource = (typeof PASS_SOURCES)[number];

export const PICKUP_KINDS = ['guardian', 'authorised', 'other'] as const;
export type PickupKind = (typeof PICKUP_KINDS)[number];

export const PASS_TYPES = ['visit', 'pickup'] as const;
export type PassType = (typeof PASS_TYPES)[number];

export const CHECK_METHODS = ['qr', 'code', 'manual'] as const;
export type CheckMethod = (typeof CHECK_METHODS)[number];

export const CONSENT_STATUSES = ['waiting', 'approved', 'rejected'] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const ID_PROOFS = ['aadhaar', 'driving_licence', 'voter_id', 'pan', 'passport', 'other'] as const;
export type IdProof = (typeof ID_PROOFS)[number];

export const VISIT_STATUSES = ['expected', 'waiting', 'allowed', 'declined', 'inside', 'left', 'cancelled'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const VISIT_PURPOSES = [
  'meet_staff',
  'parent_meeting',
  'fee_payment',
  'admission_enquiry',
  'delivery',
  'vendor',
  'interview',
  'event',
  'other',
] as const;
export type VisitPurpose = (typeof VISIT_PURPOSES)[number];

export const GATE_EVENT_KINDS = [
  'pass_requested',
  'pass_approved',
  'pass_rejected',
  'pass_cancelled',
  'pass_expired',
  'emergency_raised',
  'emergency_escalated',
  'consent_asked',
  'consent_approved',
  'consent_rejected',
  'consent_verified',
  'pass_checked',
  'check_failed',
  'released',
  'visitor_registered',
  'visitor_invited',
  'visitor_allowed',
  'visitor_declined',
  'visitor_in',
  'visitor_out',
  'visitor_overstay',
  'blocked_person',
] as const;
export type GateEventKind = (typeof GATE_EVENT_KINDS)[number];

@Entity('gate_settings')
@Index('UQ_gate_settings_school', ['school_id'], { unique: true })
export class GateSettings {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int', default: 30 })
  grace_minutes: number;

  @Column({ type: 'int', default: 10 })
  emergency_wait_minutes: number;

  @Column({ type: 'boolean', default: true })
  visitor_photo_required: boolean;

  @Column({ type: 'boolean', default: false })
  visitor_id_required: boolean;

  @Column({ type: 'varchar', length: 5, default: '18:00' })
  visitor_checkout_time: string;

  @Column({ type: 'boolean', default: true })
  notify_office_on_manual: boolean;

  @Column({ type: 'int', nullable: true })
  updated_by: number | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  updated_at: Date;
}

@Entity('gate_passes')
@Index('IDX_gate_passes_school_date', ['school_id', 'pass_date'])
@Index('IDX_gate_passes_student', ['student_id'])
@Index('UQ_gate_passes_number', ['school_id', 'pass_no'], { unique: true })
export class GatePass extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 20 })
  pass_no: string;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'date' })
  pass_date: string;

  @Column({ type: 'varchar', length: 5 })
  from_time: string;

  @Column({ type: 'varchar', length: 5 })
  until_time: string;

  @Column({ type: 'varchar', length: 300 })
  reason: string;

  @Column({ type: 'varchar', length: 10, default: 'pickup' })
  pass_type: PassType;

  @Column({ type: 'varchar', length: 10, nullable: true })
  pickup_kind: PickupKind | null;

  @Column({ type: 'int', nullable: true })
  guardian_id: number | null;

  @Column({ type: 'int', nullable: true })
  authorised_id: number | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  pickup_name: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  pickup_relation: string | null;

  @Column({ type: 'varchar', length: 15, nullable: true })
  pickup_mobile: string | null;

  @Column({ type: 'int', nullable: true })
  pickup_photo_file_id: number | null;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: PassStatus;

  @Column({ type: 'varchar', length: 8 })
  source: PassSource;

  @Column({ type: 'boolean', default: false })
  is_emergency: boolean;

  @Column({ type: 'boolean', default: false })
  needs_consent: boolean;

  @Column({ type: 'varchar', length: 10, nullable: true })
  consent_status: ConsentStatus | null;

  @Column({ type: 'int', nullable: true })
  consent_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  consent_at: Date | null;

  @Column({ type: 'varchar', length: 4, nullable: true })
  consent_code: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  consent_verified_at: Date | null;

  @Column({ type: 'int', nullable: true })
  requested_by: number | null;

  @Column({ type: 'int', nullable: true })
  decided_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  decision_note: string | null;

  @Column({ type: 'varchar', length: 4 })
  code: string;

  @Column({ type: 'smallint', default: 1 })
  qr_version: number;

  @Column({ type: 'timestamptz', nullable: true })
  released_at: Date | null;

  @Column({ type: 'int', nullable: true })
  released_by: number | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  release_method: CheckMethod | null;

  @Column({ type: 'int', nullable: true })
  release_photo_file_id: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  id_proof_kind: IdProof | null;

  @Column({ type: 'varchar', length: 4, nullable: true })
  id_proof_last4: string | null;

  @Column({ type: 'int', nullable: true })
  leave_id: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  escalated_at: Date | null;
}

@Entity('authorised_pickups')
@Index('IDX_authorised_pickups_student', ['school_id', 'student_id'])
export class AuthorisedPickup extends SchoolScopedEntity {
  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 40 })
  relation: string;

  @Column({ type: 'varchar', length: 15 })
  mobile: string;

  @Column({ type: 'int', nullable: true })
  photo_file_id: number | null;

  @Column({ type: 'date', nullable: true })
  valid_until: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;
}

@Entity('gate_visits')
@Index('IDX_gate_visits_school_date', ['school_id', 'visit_date'])
@Index('UQ_gate_visits_number', ['school_id', 'visit_no'], { unique: true })
export class GateVisit extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 20 })
  visit_no: string;

  @Column({ type: 'date' })
  visit_date: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 15 })
  mobile: string;

  @Column({ type: 'int', nullable: true })
  photo_file_id: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  id_proof_kind: IdProof | null;

  @Column({ type: 'varchar', length: 4, nullable: true })
  id_proof_last4: string | null;

  @Column({ type: 'varchar', length: 20 })
  purpose: VisitPurpose;

  @Column({ type: 'varchar', length: 300, nullable: true })
  purpose_note: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  company: string | null;

  @Column({ type: 'smallint', default: 1 })
  people_count: number;

  @Column({ type: 'varchar', length: 15, nullable: true })
  vehicle_no: string | null;

  @Column({ type: 'int', nullable: true })
  host_user_id: number | null;

  @Column({ type: 'int', nullable: true })
  student_id: number | null;

  @Column({ type: 'varchar', length: 10 })
  status: VisitStatus;

  @Column({ type: 'varchar', length: 5, nullable: true })
  expected_from: string | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  expected_until: string | null;

  @Column({ type: 'varchar', length: 4 })
  code: string;

  @Column({ type: 'smallint', default: 1 })
  qr_version: number;

  @Column({ type: 'int', nullable: true })
  invited_by: number | null;

  @Column({ type: 'int', nullable: true })
  decided_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  decision_note: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  checked_in_at: Date | null;

  @Column({ type: 'int', nullable: true })
  checked_in_by: number | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  check_in_method: CheckMethod | null;

  @Column({ type: 'timestamptz', nullable: true })
  checked_out_at: Date | null;

  @Column({ type: 'int', nullable: true })
  checked_out_by: number | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  check_out_method: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  overstay_alerted_at: Date | null;

  @Column({ type: 'boolean', default: false })
  blocked_hit: boolean;
}

@Entity('gate_blocklist')
export class GateBlock extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 15, nullable: true })
  mobile: string | null;

  @Column({ type: 'varchar', length: 300 })
  reason: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;
}

@Entity('gate_events')
@Index('IDX_gate_events_school_at', ['school_id', 'created_at'])
export class GateEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'varchar', length: 24 })
  kind: GateEventKind;

  @Column({ type: 'int', nullable: true })
  pass_id: number | null;

  @Column({ type: 'int', nullable: true })
  visit_id: number | null;

  @Column({ type: 'int', nullable: true })
  student_id: number | null;

  @Column({ type: 'int', nullable: true })
  actor_id: number | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  method: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
