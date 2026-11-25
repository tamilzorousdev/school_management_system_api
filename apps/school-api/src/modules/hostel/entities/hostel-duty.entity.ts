import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

export const ROSTER_STATUSES = ['scheduled', 'checked_in', 'completed', 'absent', 'swapped'] as const;
export type RosterStatus = (typeof ROSTER_STATUSES)[number];

export const SWAP_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type SwapStatus = (typeof SWAP_STATUSES)[number];

export const STUDY_MARKS = ['present', 'absent', 'late', 'excused'] as const;
export type StudyMark = (typeof STUDY_MARKS)[number];

@Entity('hostel_duty_shifts')
export class HostelDutyShift extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 40 })
  name: string;

  @Column({ type: 'varchar', length: 5 })
  start_time: string;

  @Column({ type: 'varchar', length: 5 })
  end_time: string;

  @Column({ type: 'boolean', default: false })
  is_night: boolean;

  @Column({ type: 'boolean', default: true })
  active: boolean;
}

@Entity('hostel_duty_roster')
@Index('UQ_hostel_duty_roster_slot', ['user_id', 'duty_date', 'shift_id'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('IDX_hostel_duty_roster_day', ['school_id', 'hostel_id', 'duty_date'])
export class HostelDutyRoster extends SchoolScopedEntity {
  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'int', nullable: true })
  block_id: number | null;

  @Column({ type: 'date' })
  duty_date: string;

  @Column({ type: 'int' })
  shift_id: number;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 12, default: 'scheduled' })
  status: RosterStatus;

  @Column({ type: 'timestamptz', nullable: true })
  check_in_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  check_out_at: Date | null;

  @Column({ type: 'int', nullable: true })
  late_minutes: number | null;
}

@Entity('hostel_duty_swaps')
@Index('IDX_hostel_duty_swaps_status', ['school_id', 'status'])
export class HostelDutySwap extends SchoolScopedEntity {
  @Column({ type: 'int' })
  roster_id: number;

  @Column({ type: 'int' })
  from_user_id: number;

  @Column({ type: 'int' })
  to_user_id: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: SwapStatus;

  @Column({ type: 'int', nullable: true })
  decided_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;
}

@Entity('hostel_night_rounds')
@Index('IDX_hostel_night_rounds_hostel', ['school_id', 'hostel_id', 'round_at'])
export class HostelNightRound {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'int', nullable: true })
  block_id: number | null;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'timestamptz' })
  round_at: Date;

  @Column({ type: 'boolean', default: true })
  all_ok: boolean;

  @Column({ type: 'varchar', length: 500, nullable: true })
  issues: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

@Entity('hostel_study_halls')
export class HostelStudyHall extends SchoolScopedEntity {
  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  location: string | null;

  @Column({ type: 'smallint' })
  capacity: number;

  @Column({ type: 'int', nullable: true })
  supervisor_user_id: number | null;

  @Column({ type: 'varchar', length: 8, default: 'open' })
  status: 'open' | 'closed';

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;
}

@Entity('hostel_study_seats')
@Index('UQ_hostel_study_seats_no', ['hall_id', 'seat_no'], { unique: true })
export class HostelStudySeat {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  hall_id: number;

  @Column({ type: 'varchar', length: 10 })
  seat_no: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;
}

@Entity('hostel_seat_allocations')
@Index('UQ_hostel_seat_allocations_live_seat', ['seat_id'], { unique: true, where: 'to_date IS NULL' })
@Index('UQ_hostel_seat_allocations_live_student', ['hall_id', 'admission_id'], {
  unique: true,
  where: 'to_date IS NULL',
})
export class HostelSeatAllocation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  hall_id: number;

  @Column({ type: 'int' })
  seat_id: number;

  @Column({ type: 'int' })
  admission_id: number;

  @Column({ type: 'date' })
  from_date: string;

  @Column({ type: 'date', nullable: true })
  to_date: string | null;

  @Column({ type: 'int', nullable: true })
  created_by: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

@Entity('hostel_study_schedules')
@Index('IDX_hostel_study_schedules_hostel', ['school_id', 'hostel_id'])
export class HostelStudySchedule extends SchoolScopedEntity {
  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'int', nullable: true })
  block_id: number | null;

  @Column({ type: 'int', nullable: true })
  hall_id: number | null;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'smallint', array: true })
  days: number[];

  @Column({ type: 'varchar', length: 5 })
  start_time: string;

  @Column({ type: 'varchar', length: 5 })
  end_time: string;

  @Column({ type: 'int', nullable: true })
  supervisor_user_id: number | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;
}

@Entity('hostel_study_attendance')
@Index('UQ_hostel_study_attendance_slot', ['schedule_id', 'study_date', 'admission_id'], { unique: true })
@Index('IDX_hostel_study_attendance_admission', ['school_id', 'admission_id'])
export class HostelStudyAttendance {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  schedule_id: number;

  @Column({ type: 'date' })
  study_date: string;

  @Column({ type: 'int' })
  admission_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'varchar', length: 8 })
  status: StudyMark;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @Column({ type: 'int', nullable: true })
  marked_by: number | null;

  @Column({ type: 'timestamptz' })
  marked_at: Date;
}
