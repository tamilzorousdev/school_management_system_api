import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

export const MEALS = ['breakfast', 'lunch', 'snacks', 'dinner'] as const;
export type Meal = (typeof MEALS)[number];

export const MEAL_MARKS = ['ate', 'skipped'] as const;
export type MealMark = (typeof MEAL_MARKS)[number];

export const SKIP_SOURCES = ['parent', 'warden'] as const;
export type SkipSource = (typeof SKIP_SOURCES)[number];

export const HEALTH_KINDS = ['illness', 'injury', 'checkup', 'sick_bay', 'other'] as const;
export type HealthKind = (typeof HEALTH_KINDS)[number];

export const DOSE_STATUSES = ['given', 'missed', 'refused'] as const;
export type DoseStatus = (typeof DOSE_STATUSES)[number];

export const LAUNDRY_STATUSES = ['collected', 'sent', 'returned', 'closed'] as const;
export type LaundryStatus = (typeof LAUNDRY_STATUSES)[number];

const decimal = {
  from: (value: string | null) => (value === null ? null : Number(value)),
  to: (value: unknown) => value,
};

@Entity('hostel_mess_menus')
@Index('IDX_hostel_mess_menus_day', ['school_id', 'day_of_week', 'meal'])
export class HostelMessMenu extends SchoolScopedEntity {
  @Column({ type: 'int', nullable: true })
  hostel_id: number | null;

  @Column({ type: 'smallint' })
  day_of_week: number;

  @Column({ type: 'varchar', length: 10 })
  meal: Meal;

  @Column({ type: 'varchar', length: 500 })
  items: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  non_veg_items: string | null;
}

@Entity('hostel_menu_overrides')
@Index('IDX_hostel_menu_overrides_date', ['school_id', 'menu_date'])
export class HostelMenuOverride extends SchoolScopedEntity {
  @Column({ type: 'int', nullable: true })
  hostel_id: number | null;

  @Column({ type: 'date' })
  menu_date: string;

  @Column({ type: 'varchar', length: 10 })
  meal: Meal;

  @Column({ type: 'varchar', length: 500 })
  items: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  non_veg_items: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;
}

@Entity('hostel_meal_attendance')
@Index('UQ_hostel_meal_attendance_admission', ['admission_id', 'meal_date', 'meal'], { unique: true })
@Index('IDX_hostel_meal_attendance_day', ['school_id', 'hostel_id', 'meal_date', 'meal'])
export class HostelMealAttendance {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'date' })
  meal_date: string;

  @Column({ type: 'varchar', length: 10 })
  meal: Meal;

  @Column({ type: 'int' })
  admission_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'varchar', length: 8 })
  status: MealMark;

  @Column({ type: 'varchar', length: 8, default: 'manual' })
  method: 'manual' | 'qr';

  @Column({ type: 'int', nullable: true })
  marked_by: number | null;

  @Column({ type: 'timestamptz' })
  marked_at: Date;
}

@Entity('hostel_meal_skips')
@Index('IDX_hostel_meal_skips_admission', ['school_id', 'admission_id'])
export class HostelMealSkip extends SchoolScopedEntity {
  @Column({ type: 'int' })
  admission_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'date' })
  from_date: string;

  @Column({ type: 'date' })
  to_date: string;

  @Column({ type: 'varchar', length: 10, array: true })
  meals: Meal[];

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', length: 8 })
  source: SkipSource;

  @Column({ type: 'varchar', length: 10, default: 'active' })
  status: 'active' | 'cancelled';
}

@Entity('hostel_mess_feedback')
@Index('UQ_hostel_mess_feedback_admission', ['admission_id', 'meal_date', 'meal'], {
  unique: true,
  where: 'admission_id IS NOT NULL',
})
@Index('IDX_hostel_mess_feedback_day', ['school_id', 'meal_date'])
export class HostelMessFeedback {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'int', nullable: true })
  admission_id: number | null;

  @Column({ type: 'date' })
  meal_date: string;

  @Column({ type: 'varchar', length: 10 })
  meal: Meal;

  @Column({ type: 'smallint' })
  rating: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  comment: string | null;

  @Column({ type: 'varchar', length: 8 })
  by_role: 'parent' | 'staff';

  @Column({ type: 'int', nullable: true })
  created_by: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

@Entity('hostel_health_logs')
@Index('IDX_hostel_health_logs_admission', ['school_id', 'admission_id'])
@Index('IDX_hostel_health_logs_open', ['school_id', 'hostel_id', 'status'])
export class HostelHealthLog extends SchoolScopedEntity {
  @Column({ type: 'int' })
  admission_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'varchar', length: 10 })
  kind: HealthKind;

  @Column({ type: 'timestamptz' })
  logged_at: Date;

  @Column({ type: 'varchar', length: 500 })
  symptoms: string;

  @Column({ type: 'numeric', precision: 4, scale: 1, nullable: true, transformer: decimal })
  temperature: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  action_taken: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  doctor_name: string | null;

  @Column({ type: 'boolean', default: false })
  hospital_visit: boolean;

  @Column({ type: 'boolean', default: false })
  parent_informed: boolean;

  @Column({ type: 'varchar', length: 8, default: 'open' })
  status: 'open' | 'closed';

  @Column({ type: 'timestamptz', nullable: true })
  sick_bay_from: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  sick_bay_to: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  closed_at: Date | null;
}

@Entity('hostel_medications')
@Index('IDX_hostel_medications_admission', ['school_id', 'admission_id'])
export class HostelMedication extends SchoolScopedEntity {
  @Column({ type: 'int' })
  admission_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'varchar', length: 120 })
  medicine: string;

  @Column({ type: 'varchar', length: 60 })
  dose: string;

  @Column({ type: 'varchar', length: 5, array: true })
  times: string[];

  @Column({ type: 'date' })
  from_date: string;

  @Column({ type: 'date', nullable: true })
  to_date: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  instructions: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  prescribed_by: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;
}

@Entity('hostel_medication_doses')
@Index('UQ_hostel_medication_doses_slot', ['medication_id', 'dose_date', 'dose_time'], { unique: true })
export class HostelMedicationDose {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  medication_id: number;

  @Column({ type: 'int' })
  admission_id: number;

  @Column({ type: 'date' })
  dose_date: string;

  @Column({ type: 'varchar', length: 5 })
  dose_time: string;

  @Column({ type: 'varchar', length: 8 })
  status: DoseStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @Column({ type: 'int', nullable: true })
  given_by: number | null;

  @Column({ type: 'timestamptz' })
  given_at: Date;
}

@Entity('hostel_laundry_batches')
@Index('UQ_hostel_laundry_batches_no', ['school_id', 'batch_no'], { unique: true, where: 'deleted_at IS NULL' })
export class HostelLaundryBatch extends SchoolScopedEntity {
  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'varchar', length: 40 })
  batch_no: string;

  @Column({ type: 'date' })
  collected_on: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  vendor_name: string | null;

  @Column({ type: 'varchar', length: 10, default: 'collected' })
  status: LaundryStatus;

  @Column({ type: 'date', nullable: true })
  sent_on: string | null;

  @Column({ type: 'date', nullable: true })
  returned_on: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;
}

@Entity('hostel_laundry_items')
@Index('UQ_hostel_laundry_items_admission', ['batch_id', 'admission_id'], { unique: true })
export class HostelLaundryItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  batch_id: number;

  @Column({ type: 'int' })
  admission_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'smallint' })
  items_given: number;

  @Column({ type: 'smallint', nullable: true })
  items_returned: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  missing_note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
