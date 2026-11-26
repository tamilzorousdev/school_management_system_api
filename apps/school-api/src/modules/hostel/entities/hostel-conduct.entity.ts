import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';
import type { ComplaintState, TicketPriority, TicketState } from '../hostel.logic';

export const CHARGE_KINDS = ['rent', 'deposit'] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];

export const REFUND_MODES = ['cash', 'bank_transfer', 'upi', 'cheque', 'adjusted_to_fees'] as const;
export type RefundMode = (typeof REFUND_MODES)[number];

export const DISCIPLINE_CATEGORIES = [
  'late_return',
  'curfew',
  'misconduct',
  'ragging',
  'fighting',
  'damage',
  'contraband',
  'absent_without_leave',
  'other',
] as const;
export type DisciplineCategory = (typeof DISCIPLINE_CATEGORIES)[number];

export const SEVERITIES = ['minor', 'major', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const DISCIPLINE_ACTIONS = [
  'warning',
  'counselling',
  'parent_meeting',
  'fine',
  'hostel_suspension',
  'expulsion',
  'no_action',
] as const;
export type DisciplineAction = (typeof DISCIPLINE_ACTIONS)[number];

export const CASE_STATUSES = ['open', 'action_taken', 'closed', 'withdrawn'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const COMPLAINT_CATEGORIES = [
  'room',
  'electrical',
  'plumbing',
  'cleanliness',
  'food',
  'water',
  'internet',
  'security',
  'roommate',
  'staff',
  'other',
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

export const COMPLAINT_STATES = ['open', 'in_progress', 'resolved', 'closed', 'rejected'] as const;

export const MAINTENANCE_CATEGORIES = [
  'electrical',
  'plumbing',
  'carpentry',
  'painting',
  'cleaning',
  'pest_control',
  'appliance',
  'civil',
  'other',
] as const;
export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number];

export const TICKET_STATES = ['open', 'assigned', 'in_progress', 'on_hold', 'done', 'cancelled'] as const;

export const UPDATE_TARGETS = ['complaint', 'maintenance'] as const;
export type UpdateTarget = (typeof UPDATE_TARGETS)[number];

@Entity('hostel_fee_schedules')
@Index('IDX_hostel_fee_schedules_year', ['school_id', 'academic_year_id'])
export class HostelFeeSchedule extends SchoolScopedEntity {
  @Column({ type: 'int' })
  academic_year_id: number;

  @Column({ type: 'varchar', length: 40 })
  label: string;

  @Column({ type: 'date' })
  due_date: string;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    transformer: { to: (v: number) => v, from: (v: string) => Number(v) },
  })
  share_percent: number;

  @Column({ type: 'smallint', default: 0 })
  sort_order: number;
}

@Entity('hostel_charges')
@Index('UQ_hostel_charges_rent', ['admission_id', 'schedule_id'], { unique: true, where: `kind = 'rent'` })
@Index('UQ_hostel_charges_deposit', ['admission_id'], { unique: true, where: `kind = 'deposit'` })
@Index('IDX_hostel_charges_student', ['school_id', 'student_id'])
export class HostelCharge {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  admission_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'int' })
  academic_year_id: number;

  @Column({ type: 'varchar', length: 10 })
  kind: ChargeKind;

  @Column({ type: 'int', nullable: true })
  schedule_id: number | null;

  @Column({ type: 'int' })
  invoice_id: number;

  @Column({ type: 'varchar', length: 80 })
  label: string;

  @Column(money())
  amount: number;

  @Column({ type: 'timestamptz', nullable: true })
  settled_at: Date | null;

  @Column({ type: 'int', nullable: true })
  settled_by: number | null;

  @Column(money({ nullable: true, default: null }))
  deduction_amount: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  deduction_reason: string | null;

  @Column(money({ nullable: true, default: null }))
  refund_amount: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  refund_mode: RefundMode | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  refund_reference: string | null;

  @Column({ type: 'int', nullable: true })
  created_by: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

@Entity('hostel_discipline_cases')
@Index('UQ_hostel_discipline_cases_no', ['school_id', 'case_no'], { unique: true, where: 'deleted_at IS NULL' })
@Index('IDX_hostel_discipline_cases_admission', ['school_id', 'admission_id'])
export class HostelDisciplineCase extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 40 })
  case_no: string;

  @Column({ type: 'int' })
  admission_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'int', nullable: true })
  leave_id: number | null;

  @Column({ type: 'varchar', length: 24 })
  category: DisciplineCategory;

  @Column({ type: 'varchar', length: 10 })
  severity: Severity;

  @Column({ type: 'timestamptz' })
  incident_at: Date;

  @Column({ type: 'varchar', length: 120, nullable: true })
  location: string | null;

  @Column({ type: 'varchar', length: 1000 })
  description: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  witnesses: string | null;

  @Column({ type: 'varchar', length: 14, default: 'open' })
  status: CaseStatus;

  @Column({ type: 'varchar', length: 20, nullable: true })
  action: DisciplineAction | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  action_note: string | null;

  @Column({ type: 'date', nullable: true })
  suspended_from: string | null;

  @Column({ type: 'date', nullable: true })
  suspended_to: string | null;

  @Column(money({ nullable: true, default: null }))
  fine_amount: number | null;

  @Column({ type: 'int', nullable: true })
  fee_fine_id: number | null;

  @Column({ type: 'boolean', default: true })
  visible_to_parent: boolean;

  @Column({ type: 'int', nullable: true })
  decided_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  closed_at: Date | null;
}

@Entity('hostel_complaints')
@Index('UQ_hostel_complaints_no', ['school_id', 'complaint_no'], { unique: true, where: 'deleted_at IS NULL' })
@Index('IDX_hostel_complaints_status', ['school_id', 'hostel_id', 'status'])
export class HostelComplaint extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 40 })
  complaint_no: string;

  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'int', nullable: true })
  admission_id: number | null;

  @Column({ type: 'int', nullable: true })
  student_id: number | null;

  @Column({ type: 'int', nullable: true })
  room_id: number | null;

  @Column({ type: 'varchar', length: 14 })
  category: ComplaintCategory;

  @Column({ type: 'varchar', length: 8, default: 'normal' })
  priority: TicketPriority;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 1000 })
  description: string;

  @Column({ type: 'int', nullable: true })
  photo_file_id: number | null;

  @Column({ type: 'varchar', length: 10 })
  raised_by_role: 'parent' | 'staff';

  @Column({ type: 'varchar', length: 12, default: 'open' })
  status: ComplaintState;

  @Column({ type: 'int', nullable: true })
  assigned_to: number | null;

  @Column({ type: 'timestamptz' })
  due_at: Date;

  @Column({ type: 'varchar', length: 500, nullable: true })
  resolution: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolved_at: Date | null;

  @Column({ type: 'smallint', nullable: true })
  rating: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  rating_comment: string | null;

  @Column({ type: 'int', nullable: true })
  maintenance_ticket_id: number | null;
}

@Entity('hostel_maintenance_tickets')
@Index('UQ_hostel_maintenance_tickets_no', ['school_id', 'ticket_no'], { unique: true, where: 'deleted_at IS NULL' })
@Index('IDX_hostel_maintenance_tickets_status', ['school_id', 'hostel_id', 'status'])
export class HostelMaintenanceTicket extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 40 })
  ticket_no: string;

  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'int', nullable: true })
  room_id: number | null;

  @Column({ type: 'int', nullable: true })
  bed_id: number | null;

  @Column({ type: 'varchar', length: 14 })
  category: MaintenanceCategory;

  @Column({ type: 'varchar', length: 8, default: 'normal' })
  priority: TicketPriority;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description: string | null;

  @Column({ type: 'int', nullable: true })
  photo_file_id: number | null;

  @Column({ type: 'varchar', length: 12, default: 'open' })
  status: TicketState;

  @Column({ type: 'int', nullable: true })
  assigned_to: number | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  vendor_name: string | null;

  @Column({ type: 'date', nullable: true })
  scheduled_on: string | null;

  @Column({ type: 'boolean', default: false })
  blocks_room: boolean;

  @Column(money({ nullable: true, default: null }))
  cost: number | null;

  @Column({ type: 'timestamptz' })
  due_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date | null;

  @Column({ type: 'int', nullable: true })
  complaint_id: number | null;

  @Column({ type: 'int', nullable: true })
  charged_admission_id: number | null;

  @Column({ type: 'int', nullable: true })
  charged_fine_id: number | null;
}

@Entity('hostel_ticket_updates')
@Index('IDX_hostel_ticket_updates_target', ['target', 'target_id'])
export class HostelTicketUpdate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'varchar', length: 12 })
  target: UpdateTarget;

  @Column({ type: 'int' })
  target_id: number;

  @Column({ type: 'varchar', length: 12, nullable: true })
  status: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ type: 'int', nullable: true })
  actor_user_id: number | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  actor_name: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
