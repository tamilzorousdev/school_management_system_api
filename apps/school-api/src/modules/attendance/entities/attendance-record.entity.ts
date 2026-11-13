import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AttendanceSession } from './attendance-session.entity';

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'half_day', 'leave', 'od'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

@Entity('attendance_records')
@Index('UQ_attendance_records_session_student', ['session_id', 'student_id'], { unique: true })
@Index('IDX_attendance_records_student_date', ['student_id', 'date'])
export class AttendanceRecord {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  session_id: number;

  @ManyToOne(() => AttendanceSession, (session) => session.records, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session?: AttendanceSession;

  @Index()
  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'smallint', default: 0 })
  period: number;

  @Column({ type: 'varchar', length: 10 })
  status: AttendanceStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remarks: string | null;

  @Column({ type: 'boolean', default: false })
  alert_sent: boolean;
}
