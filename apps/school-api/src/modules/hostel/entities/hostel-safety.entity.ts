import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

export const SOS_KINDS = [
  'fire',
  'medical',
  'security',
  'missing_student',
  'natural_disaster',
  'drill',
  'other',
] as const;
export type SosKind = (typeof SOS_KINDS)[number];

export const SOS_STATUSES = ['open', 'resolved', 'cancelled'] as const;
export type SosStatus = (typeof SOS_STATUSES)[number];

export const SOS_MARKS = ['safe', 'missing', 'injured', 'away'] as const;
export type SosMark = (typeof SOS_MARKS)[number];

@Entity('hostel_sos_events')
@Index('UQ_hostel_sos_events_no', ['school_id', 'sos_no'], { unique: true, where: 'deleted_at IS NULL' })
@Index('IDX_hostel_sos_events_status', ['school_id', 'hostel_id', 'status'])
export class HostelSosEvent extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 40 })
  sos_no: string;

  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'varchar', length: 20 })
  kind: SosKind;

  @Column({ type: 'varchar', length: 500 })
  message: string;

  @Column({ type: 'int', nullable: true })
  admission_id: number | null;

  @Column({ type: 'boolean', default: false })
  is_drill: boolean;

  @Column({ type: 'boolean', default: false })
  notify_parents: boolean;

  @Column({ type: 'varchar', length: 10, default: 'open' })
  status: SosStatus;

  @Column({ type: 'int', nullable: true })
  resolved_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolved_at: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  resolution: string | null;
}

@Entity('hostel_sos_marks')
@Index('UQ_hostel_sos_marks_admission', ['sos_id', 'admission_id'], { unique: true })
export class HostelSosMark {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  sos_id: number;

  @Column({ type: 'int' })
  admission_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'varchar', length: 8 })
  status: SosMark;

  @Column({ type: 'int', nullable: true })
  marked_by: number | null;

  @Column({ type: 'timestamptz' })
  marked_at: Date;
}

@Entity('hostel_rule_acks')
@Index('UQ_hostel_rule_acks_version', ['admission_id', 'user_id', 'rules_hash'], { unique: true })
export class HostelRuleAck {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  admission_id: number;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'varchar', length: 64 })
  rules_hash: string;

  @Column({ type: 'timestamptz' })
  acknowledged_at: Date;
}
