import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { money } from '../../payroll/entities/money';

@Entity('library_settings')
@Index('UQ_library_settings_school', ['school_id'], { unique: true })
export class LibrarySettings {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'smallint', default: 14 })
  student_loan_days: number;

  @Column({ type: 'smallint', default: 30 })
  staff_loan_days: number;

  @Column({ type: 'smallint', default: 2 })
  student_max_books: number;

  @Column({ type: 'smallint', default: 5 })
  staff_max_books: number;

  @Column(money({ default: 1 }))
  fine_per_day: number;

  @Column({ type: 'smallint', default: 0 })
  grace_days: number;

  @Column(money({ nullable: true, default: 100 }))
  max_fine_per_book: number | null;

  @Column(money({ default: 50 }))
  lost_processing_fee: number;

  @Column({ type: 'smallint', default: 1 })
  max_renewals: number;

  @Column(money({ default: 50 }))
  block_issue_above_fine: number;

  @Column({ type: 'boolean', default: true })
  skip_holidays: boolean;

  @Column({ type: 'boolean', default: false })
  charge_staff_fines: boolean;

  @Column({ type: 'smallint', default: 2 })
  due_soon_days: number;

  @Column({ type: 'smallint', default: 7 })
  escalate_after_days: number;

  @Column({ type: 'smallint', default: 30 })
  long_overdue_days: number;

  @Column({ type: 'varchar', length: 5, default: '08:00' })
  opening_time: string;

  @Column({ type: 'varchar', length: 5, default: '16:30' })
  closing_time: string;

  @Column({ type: 'boolean', default: true })
  isbn_lookup: boolean;

  @Column({ type: 'int', nullable: true })
  updated_by: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
