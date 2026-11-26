import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { decimal } from './decimal';

export const CANTEEN_STAFF_ROLES = ['manager', 'cook', 'helper', 'cashier', 'server', 'cleaner'] as const;
export type CanteenStaffRole = (typeof CANTEEN_STAFF_ROLES)[number];

export const CANTEEN_STAFF_STATUSES = ['active', 'inactive', 'left'] as const;
export type CanteenStaffStatus = (typeof CANTEEN_STAFF_STATUSES)[number];

export const CANTEEN_ATTENDANCE_STATUSES = ['present', 'absent', 'half_day', 'leave'] as const;
export type CanteenAttendanceStatus = (typeof CANTEEN_ATTENDANCE_STATUSES)[number];

export const FEEDBACK_KINDS = ['feedback', 'complaint'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_CATEGORIES = ['food_quality', 'hygiene', 'service', 'price', 'quantity', 'other'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

@Entity('canteen_staff')
export class CanteenStaff extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 15, nullable: true })
  mobile: string | null;

  @Column({ type: 'varchar', length: 10 })
  role: CanteenStaffRole;

  @Column({ type: 'int', nullable: true })
  staff_id: number | null;

  @Column({ type: 'date', nullable: true })
  joined_on: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true, transformer: decimal })
  daily_wage: number | null;

  @Column({ type: 'varchar', length: 10, default: 'active' })
  status: CanteenStaffStatus;

  @Column({ type: 'varchar', length: 300, nullable: true })
  address: string | null;
}

@Entity('canteen_staff_attendance')
@Index('UQ_canteen_staff_attendance_day', ['canteen_staff_id', 'attendance_date'], { unique: true })
export class CanteenStaffAttendance extends SchoolScopedEntity {
  @Column({ type: 'int' })
  canteen_staff_id: number;

  @Column({ type: 'date' })
  attendance_date: string;

  @Column({ type: 'varchar', length: 10 })
  status: CanteenAttendanceStatus;

  @Column({ type: 'timestamptz', nullable: true })
  check_in_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  check_out_at: Date | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  note: string | null;
}

@Entity('canteen_feedback')
@Index('IDX_canteen_feedback_status', ['school_id', 'kind', 'status'])
export class CanteenFeedback extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 10 })
  kind: FeedbackKind;

  @Column({ type: 'varchar', length: 14, default: 'other' })
  category: FeedbackCategory;

  @Column({ type: 'smallint', nullable: true })
  rating: number | null;

  @Column({ type: 'varchar', length: 150 })
  subject: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'int', nullable: true })
  diner_id: number | null;

  @Column({ type: 'int', nullable: true })
  order_id: number | null;

  @Column({ type: 'varchar', length: 12, default: 'open' })
  status: FeedbackStatus;

  @Column({ type: 'text', nullable: true })
  resolution: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolved_at: Date | null;

  @Column({ type: 'int', nullable: true })
  resolved_by: number | null;
}
