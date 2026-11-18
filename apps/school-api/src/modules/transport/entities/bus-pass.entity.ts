import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

@Entity('bus_passes')
@Index('UQ_bus_passes_student_year', ['student_id', 'academic_year_id'], { unique: true, where: 'deleted_at IS NULL' })
@Index('UQ_bus_passes_number', ['school_id', 'pass_no'], { unique: true, where: 'deleted_at IS NULL' })
export class BusPass extends SchoolScopedEntity {
  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'int' })
  academic_year_id: number;

  @Column({ type: 'varchar', length: 30 })
  pass_no: string;

  @Column({ type: 'timestamptz', nullable: true })
  issued_at: Date | null;

  @Column({ type: 'date' })
  valid_from: string;

  @Column({ type: 'date' })
  valid_until: string;
}

@Entity('bus_pass_settings')
@Index('UQ_bus_pass_settings_school', ['school_id'], { unique: true })
export class BusPassSettings {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int', default: 7 })
  grace_days: number;

  @Column({ type: 'date', nullable: true })
  valid_until: string | null;

  @Column({ type: 'int', nullable: true })
  updated_by: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

@Entity('bus_fee_reminders')
@Index('UQ_bus_fee_reminders_invoice_kind', ['invoice_id', 'kind'], { unique: true })
export class BusFeeReminder {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  invoice_id: number;

  @Column({ type: 'varchar', length: 16 })
  kind: string;

  @CreateDateColumn({ type: 'timestamptz' })
  sent_at: Date;
}
