import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';

export const APPLICATION_STATUSES = ['pending', 'waitlisted', 'approved', 'rejected', 'cancelled', 'admitted'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_SOURCES = ['office', 'parent'] as const;
export type ApplicationSource = (typeof APPLICATION_SOURCES)[number];

export const ADMISSION_STATUSES = ['active', 'on_leave', 'checking_out', 'checked_out'] as const;
export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];

export const DIETS = ['veg', 'non_veg', 'eggetarian'] as const;
export type Diet = (typeof DIETS)[number];

export const ALLOCATION_END_REASONS = ['transfer', 'swap', 'vacated', 'checkout'] as const;
export type AllocationEndReason = (typeof ALLOCATION_END_REASONS)[number];

export const TRANSFER_KINDS = ['transfer', 'swap'] as const;
export type TransferKind = (typeof TRANSFER_KINDS)[number];

export const CHECKOUT_STATUSES = ['open', 'completed', 'cancelled'] as const;
export type CheckoutStatus = (typeof CHECKOUT_STATUSES)[number];

export const CHECKOUT_REASONS = [
  'year_end',
  'withdrawn',
  'day_scholar',
  'school_transfer',
  'disciplinary',
  'other',
] as const;
export type CheckoutReason = (typeof CHECKOUT_REASONS)[number];

export const CLEARANCE_STATUSES = ['pending', 'cleared', 'waived'] as const;
export type ClearanceStatus = (typeof CLEARANCE_STATUSES)[number];

@Entity('hostel_applications')
@Index('UQ_hostel_applications_no', ['school_id', 'application_no'], { unique: true, where: 'deleted_at IS NULL' })
@Index('IDX_hostel_applications_status', ['school_id', 'status'])
@Index('UQ_hostel_applications_open_student', ['school_id', 'student_id', 'academic_year_id'], {
  unique: true,
  where: `status IN ('pending', 'waitlisted', 'approved') AND deleted_at IS NULL`,
})
export class HostelApplication extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 40 })
  application_no: string;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'int' })
  academic_year_id: number;

  @Column({ type: 'int', nullable: true })
  hostel_id: number | null;

  @Column({ type: 'int', nullable: true })
  room_type_id: number | null;

  @Column({ type: 'varchar', length: 10, default: 'office' })
  source: ApplicationSource;

  @Column({ type: 'varchar', length: 12, default: 'pending' })
  status: ApplicationStatus;

  @Column({ type: 'smallint', default: 0 })
  priority: number;

  @Column({ type: 'date', nullable: true })
  wanted_from: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null;

  @Column({ type: 'int', nullable: true })
  decided_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  decision_note: string | null;

  @Column({ type: 'int', nullable: true })
  admission_id: number | null;
}

@Entity('hostel_admissions')
@Index('UQ_hostel_admissions_no', ['school_id', 'admission_no'], { unique: true, where: 'deleted_at IS NULL' })
@Index('IDX_hostel_admissions_hostel_status', ['school_id', 'hostel_id', 'status'])
@Index('UQ_hostel_admissions_live_student', ['school_id', 'student_id'], {
  unique: true,
  where: `status <> 'checked_out' AND deleted_at IS NULL`,
})
export class HostelAdmission extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 40 })
  admission_no: string;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'int' })
  academic_year_id: number;

  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'int', nullable: true })
  application_id: number | null;

  @Column({ type: 'varchar', length: 14, default: 'active' })
  status: AdmissionStatus;

  @Column({ type: 'date' })
  admitted_on: string;

  @Column({ type: 'date', nullable: true })
  checked_out_on: string | null;

  @Column({ type: 'varchar', length: 12, default: 'veg' })
  diet: Diet;

  @Column({ type: 'varchar', length: 120, nullable: true })
  local_guardian_name: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  local_guardian_mobile: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  local_guardian_relation: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  local_guardian_address: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  medical_notes: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;
}

@Entity('hostel_allocations')
@Index('UQ_hostel_allocations_live_bed', ['school_id', 'bed_id'], { unique: true, where: 'to_date IS NULL' })
@Index('UQ_hostel_allocations_live_admission', ['school_id', 'admission_id'], {
  unique: true,
  where: 'to_date IS NULL',
})
@Index('IDX_hostel_allocations_student', ['school_id', 'student_id'])
export class HostelAllocation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  admission_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'int' })
  room_id: number;

  @Column({ type: 'int' })
  bed_id: number;

  @Column({ type: 'date' })
  from_date: string;

  @Column({ type: 'date', nullable: true })
  to_date: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  end_reason: AllocationEndReason | null;

  @Column({ type: 'int', nullable: true })
  created_by: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

@Entity('hostel_transfers')
@Index('IDX_hostel_transfers_admission', ['school_id', 'admission_id'])
export class HostelTransfer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  admission_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'varchar', length: 10 })
  kind: TransferKind;

  @Column({ type: 'int', nullable: true })
  from_bed_id: number | null;

  @Column({ type: 'int' })
  to_bed_id: number;

  @Column({ type: 'int', nullable: true })
  swap_admission_id: number | null;

  @Column({ type: 'date' })
  transfer_date: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @Column({ type: 'int', nullable: true })
  created_by: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

@Entity('hostel_checkouts')
@Index('UQ_hostel_checkouts_open', ['school_id', 'admission_id'], { unique: true, where: `status = 'open'` })
export class HostelCheckout extends SchoolScopedEntity {
  @Column({ type: 'int' })
  admission_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'varchar', length: 10, default: 'open' })
  status: CheckoutStatus;

  @Column({ type: 'varchar', length: 16 })
  reason: CheckoutReason;

  @Column({ type: 'date' })
  checkout_date: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  forwarding_address: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  remarks: string | null;

  @Column({ type: 'int', nullable: true })
  completed_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date | null;
}

@Entity('hostel_checkout_items')
@Index('UQ_hostel_checkout_items_code', ['checkout_id', 'code'], { unique: true })
export class HostelCheckoutItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  checkout_id: number;

  @Column({ type: 'varchar', length: 30 })
  code: string;

  @Column({ type: 'varchar', length: 80 })
  label: string;

  @Column({ type: 'smallint', default: 0 })
  sort_order: number;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: ClearanceStatus;

  @Column(money({ nullable: true, default: null }))
  amount: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @Column({ type: 'int', nullable: true })
  cleared_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  cleared_at: Date | null;
}

@Entity('hostel_audit_log')
@Index('IDX_hostel_audit_log_school_created', ['school_id', 'created_at'])
@Index('IDX_hostel_audit_log_student', ['school_id', 'student_id'])
export class HostelAuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'varchar', length: 30 })
  entity: string;

  @Column({ type: 'int' })
  entity_id: number;

  @Column({ type: 'varchar', length: 30 })
  action: string;

  @Column({ type: 'int', nullable: true })
  student_id: number | null;

  @Column({ type: 'int', nullable: true })
  actor_user_id: number | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  actor_name: string | null;

  @Column({ type: 'jsonb', nullable: true })
  changes: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
