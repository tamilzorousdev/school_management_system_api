import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

export const SPECIAL_KINDS = ['extra', 'special'] as const;
export type SpecialKind = (typeof SPECIAL_KINDS)[number];

export const SPECIAL_TIMINGS = ['period', 'extra_time'] as const;
export type SpecialTiming = (typeof SPECIAL_TIMINGS)[number];

export const DAY_PARTS = ['custom', 'full', 'morning', 'afternoon'] as const;
export type DayPart = (typeof DAY_PARTS)[number];

export const SPECIAL_ATTENDANCE = ['present', 'absent', 'late'] as const;
export type SpecialAttendanceStatus = (typeof SPECIAL_ATTENDANCE)[number];

@Entity('special_classes')
@Index('IDX_special_classes_section_slot', ['section_id', 'day_of_week', 'period_no'])
export class SpecialClass extends SchoolScopedEntity {
  @Index()
  @Column({ type: 'int' })
  academic_year_id: number;

  @Index()
  @Column({ type: 'int' })
  section_id: number;

  @Column({ type: 'int', nullable: true })
  subject_id: number | null;

  @Index()
  @Column({ type: 'int' })
  teacher_user_id: number;

  @Column({ type: 'varchar', length: 10, default: 'extra' })
  kind: SpecialKind;

  @Column({ type: 'varchar', length: 12, default: 'period' })
  timing: SpecialTiming;

  @Column({ type: 'smallint', nullable: true })
  day_of_week: number | null;

  @Column({ type: 'smallint', nullable: true })
  period_no: number | null;

  @Column({ type: 'smallint', array: true, nullable: true })
  days: number[] | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  start_time: string | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  end_time: string | null;

  @Column({ type: 'date', nullable: true })
  start_date: string | null;

  @Column({ type: 'date', nullable: true })
  end_date: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  day_part: DayPart | null;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  @OneToMany(() => SpecialClassStudent, (student) => student.special_class)
  students?: SpecialClassStudent[];
}

@Entity('special_class_students')
@Index('UQ_special_class_students', ['special_class_id', 'student_id'], { unique: true })
export class SpecialClassStudent {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  special_class_id: number;

  @ManyToOne(() => SpecialClass, (special) => special.students, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'special_class_id' })
  special_class?: SpecialClass;

  @Index()
  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'int' })
  school_id: number;
}

@Entity('special_class_attendance')
@Index('UQ_special_class_attendance', ['special_class_id', 'date', 'student_id'], { unique: true })
export class SpecialClassAttendance {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  school_id: number;

  @Index()
  @Column({ type: 'int' })
  special_class_id: number;

  @Column({ type: 'date' })
  date: string;

  @Index()
  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'varchar', length: 10 })
  status: SpecialAttendanceStatus;

  @Column({ type: 'int', nullable: true })
  marked_by: number | null;

  @Column({ type: 'boolean', default: false })
  alert_sent: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
