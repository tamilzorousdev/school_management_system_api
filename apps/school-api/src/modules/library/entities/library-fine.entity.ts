import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { PaymentMode } from '../../fees/entities/fee-payment.entity';
import { money } from '../../payroll/entities/money';

export const FINE_KINDS = ['overdue', 'lost', 'damage', 'other'] as const;
export type FineKind = (typeof FINE_KINDS)[number];

export const FINE_STATUSES = ['unpaid', 'partly_paid', 'paid', 'waived'] as const;
export type FineStatus = (typeof FINE_STATUSES)[number];

@Entity('library_fines')
@Index('IDX_library_fines_member', ['member_id', 'status'])
export class LibraryFine extends SchoolScopedEntity {
  @Column({ type: 'int', nullable: true })
  issue_id: number | null;

  @Column({ type: 'int' })
  member_id: number;

  @Column({ type: 'varchar', length: 8 })
  kind: FineKind;

  @Column(money())
  amount: number;

  @Column(money())
  waived: number;

  @Column(money())
  paid: number;

  @Column(money())
  balance: number;

  @Column({ type: 'varchar', length: 12, default: 'unpaid' })
  status: FineStatus;

  @Column({ type: 'smallint', nullable: true })
  days_late: number | null;

  @Column({ type: 'varchar', length: 200 })
  reason: string;

  @Column({ type: 'int', nullable: true })
  waived_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  waived_at: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  waive_reason: string | null;
}

@Entity('library_fine_payments')
@Index('UQ_library_fine_payments_receipt', ['school_id', 'receipt_no'], { unique: true })
export class LibraryFinePayment extends SchoolScopedEntity {
  @Index()
  @Column({ type: 'int' })
  fine_id: number;

  @Column({ type: 'int' })
  member_id: number;

  @Column(money())
  amount: number;

  @Column({ type: 'varchar', length: 15 })
  mode: PaymentMode;

  @Column({ type: 'varchar', length: 60, nullable: true })
  reference: string | null;

  @Column({ type: 'varchar', length: 40 })
  receipt_no: string;

  @Column({ type: 'date' })
  paid_on: string;

  @Column({ type: 'int', nullable: true })
  received_by: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;
}
