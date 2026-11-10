import { SchoolScopedEntity } from '@app/common';
import { Column, Entity, Index } from 'typeorm';
import type { AttendanceSessionName } from '../attendance-sessions';

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

@Entity('student_leave_requests')
export class StudentLeave extends SchoolScopedEntity {
  @Index()
  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'date' })
  from_date: string;

  @Column({ type: 'date' })
  to_date: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  half_day: AttendanceSessionName | null;

  @Column({ type: 'varchar', length: 500 })
  reason: string;

  @Column({ type: 'int', nullable: true })
  file_id: number | null;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: LeaveStatus;

  @Column({ type: 'int', nullable: true })
  decided_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  decision_note: string | null;
}
