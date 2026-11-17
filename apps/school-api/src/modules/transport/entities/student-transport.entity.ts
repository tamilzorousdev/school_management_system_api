import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

export const TRANSPORT_MODES = ['both', 'pickup', 'drop'] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const PASS_STATUSES = ['active', 'on_hold'] as const;
export type PassStatus = (typeof PASS_STATUSES)[number];

@Entity('student_transport')
@Index('UQ_student_transport_student', ['student_id'], { unique: true, where: 'deleted_at IS NULL' })
@Index('UQ_student_transport_passenger_ref', ['passenger_ref'], { unique: true })
export class StudentTransport extends SchoolScopedEntity {
  @Column({ type: 'int' })
  student_id: number;

  @Index()
  @Column({ type: 'int' })
  route_id: number;

  @Index()
  @Column({ type: 'int' })
  stop_id: number;

  @Index('IDX_student_transport_drop_stop', { where: 'drop_stop_id IS NOT NULL' })
  @Column({ type: 'int', nullable: true })
  drop_stop_id: number | null;

  @Column({ type: 'varchar', length: 10, default: 'both' })
  mode: TransportMode;

  @Column({ type: 'date' })
  start_date: string;

  @Column({ type: 'varchar', length: 24 })
  passenger_ref: string;

  @Column({ type: 'varchar', length: 10, default: 'active' })
  pass_status: PassStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  pass_note: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  pass_changed_at: Date | null;

  @Column({ type: 'int', nullable: true })
  pass_changed_by: number | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  hold_kind: 'fee' | 'office' | null;
}
