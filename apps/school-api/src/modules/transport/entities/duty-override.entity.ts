import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const OVERRIDE_SUBJECTS = ['crew', 'vehicle'] as const;
export type OverrideSubject = (typeof OVERRIDE_SUBJECTS)[number];

@Entity('duty_overrides')
@Index('UQ_duty_overrides_day', ['subject', 'subject_id', 'on_date'], { unique: true })
@Index('IDX_duty_overrides_school', ['school_id'])
export class DutyOverride {
  @PrimaryGeneratedColumn({ primaryKeyConstraintName: 'PK_duty_overrides' })
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'varchar', length: 8 })
  subject: OverrideSubject;

  @Column({ type: 'int' })
  subject_id: number;

  @Column({ type: 'date' })
  on_date: string;

  @Column({ type: 'varchar', length: 255 })
  reason: string;

  @Column({ type: 'int' })
  created_by: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
