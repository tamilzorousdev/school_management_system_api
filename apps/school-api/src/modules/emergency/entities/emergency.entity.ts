import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

export const EMERGENCY_CATEGORIES = [
  'weather',
  'school_closed',
  'security',
  'health',
  'transport',
  'all_clear',
  'other',
] as const;
export type EmergencyCategory = (typeof EMERGENCY_CATEGORIES)[number];

export const EMERGENCY_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type EmergencySeverity = (typeof EMERGENCY_SEVERITIES)[number];

export const EMERGENCY_AUDIENCES = ['everyone', 'parents', 'staff', 'classes', 'sections', 'students'] as const;
export type EmergencyAudience = (typeof EMERGENCY_AUDIENCES)[number];

export const EMERGENCY_CHANNELS = ['push', 'sms'] as const;
export type EmergencyChannel = (typeof EMERGENCY_CHANNELS)[number];

export const BROADCAST_STATUSES = ['sending', 'sent', 'partly_failed'] as const;
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

export const DELIVERY_STATUSES = ['pending', 'sending', 'sent', 'failed', 'skipped', 'none'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const RECIPIENT_KINDS = ['parent', 'staff', 'both'] as const;
export type RecipientKind = (typeof RECIPIENT_KINDS)[number];

export interface RecipientStudent {
  id: number;
  name: string;
  section: string | null;
}

@Entity('emergency_broadcasts')
@Index('UQ_emergency_broadcasts_client', ['school_id', 'client_id'], {
  unique: true,
  where: 'client_id IS NOT NULL AND deleted_at IS NULL',
})
export class EmergencyBroadcast extends SchoolScopedEntity {
  @Column({ type: 'uuid' })
  batch_id: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  title_ta: string | null;

  @Column({ type: 'text', nullable: true })
  message_ta: string | null;

  @Column({ type: 'varchar', length: 20 })
  category: EmergencyCategory;

  @Column({ type: 'varchar', length: 10 })
  severity: EmergencySeverity;

  @Column({ type: 'varchar', length: 10 })
  audience: EmergencyAudience;

  @Column({ type: 'int', array: true, nullable: true })
  class_ids: number[] | null;

  @Column({ type: 'int', array: true, nullable: true })
  section_ids: number[] | null;

  @Column({ type: 'int', array: true, nullable: true })
  student_ids: number[] | null;

  @Column({ type: 'boolean', default: false })
  include_teachers: boolean;

  @Column({ type: 'varchar', length: 10, array: true })
  channels: EmergencyChannel[];

  @Column({ type: 'varchar', length: 16 })
  status: BroadcastStatus;

  @Column({ type: 'int', default: 0 })
  total: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  client_id: string | null;

  @Column({ type: 'int', nullable: true })
  follow_up_of: number | null;

  @Column({ type: 'timestamptz' })
  sent_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date | null;
}

@Entity('emergency_recipients')
@Index('IDX_emergency_recipients_broadcast', ['broadcast_id'])
@Index('IDX_emergency_recipients_user', ['user_id'])
@Index('IDX_emergency_recipients_push_due', ['push_status', 'push_next_at'])
@Index('IDX_emergency_recipients_sms_due', ['sms_status', 'sms_next_at'])
export class EmergencyRecipient {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  broadcast_id: number;

  @Column({ type: 'varchar', length: 6 })
  kind: RecipientKind;

  @Column({ type: 'int', nullable: true })
  user_id: number | null;

  @Column({ type: 'int', nullable: true })
  guardian_id: number | null;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 15, nullable: true })
  mobile: string | null;

  @Column({ type: 'varchar', length: 2, default: 'en' })
  language: 'en' | 'ta';

  @Column({ type: 'jsonb', default: () => "'[]'" })
  students: RecipientStudent[];

  @Column({ type: 'varchar', length: 8 })
  push_status: DeliveryStatus;

  @Column({ type: 'smallint', default: 0 })
  push_attempts: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  push_error: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  push_next_at: Date | null;

  @Column({ type: 'varchar', length: 8 })
  sms_status: DeliveryStatus;

  @Column({ type: 'smallint', default: 0 })
  sms_attempts: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sms_error: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  sms_next_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  read_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  acknowledged_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
