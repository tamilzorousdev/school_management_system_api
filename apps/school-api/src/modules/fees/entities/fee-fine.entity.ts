import { Check, Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';

export const FINE_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type FineStatus = (typeof FINE_STATUSES)[number];

@Entity('fee_fines')
@Check('CHK_fee_fines_amount', `"amount" > 0`)
@Check('CHK_fee_fines_status', `"status" IN ('pending', 'approved', 'rejected', 'withdrawn')`)
@Index('UQ_fee_fines_school_no', ['school_id', 'fine_no'], { unique: true })
export class FeeFine extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 30 })
  fine_no: string;

  @Index()
  @Column({ type: 'int' })
  academic_year_id: number;

  @Index()
  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'int', nullable: true })
  fine_type_id: number | null;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column(money())
  amount: number;

  @Column({ type: 'date' })
  incident_on: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  details: string | null;

  @Index()
  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: FineStatus;

  @Column({ type: 'int', nullable: true })
  behaviour_note_id: number | null;

  @Index()
  @Column({ type: 'int', nullable: true })
  invoice_id: number | null;

  @Column({ type: 'int', nullable: true })
  decided_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  decision_comment: string | null;
}
