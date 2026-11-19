import { Check, Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';

export const MANUAL_PAYMENT_MODES = ['cash', 'upi', 'card', 'bank_transfer', 'cheque'] as const;
export const PAYMENT_MODES = [...MANUAL_PAYMENT_MODES, 'online', 'credit'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export type ManualPaymentMode = (typeof MANUAL_PAYMENT_MODES)[number];

export const PAYMENT_STATUSES = ['success', 'reversed'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

@Entity('fee_payments')
@Check('CHK_fee_payments_amount', `"amount" > 0`)
@Check('CHK_fee_payments_status', `"status" IN ('success', 'reversed')`)
@Index('UQ_fee_payments_school_receipt', ['school_id', 'receipt_no'], { unique: true })
@Index('UQ_fee_payments_school_idempotency', ['school_id', 'idempotency_key'], {
  unique: true,
  where: 'idempotency_key IS NOT NULL',
})
export class FeePayment extends SchoolScopedEntity {
  @Index()
  @Column({ type: 'int', nullable: true })
  collection_id: number | null;

  @Index()
  @Column({ type: 'int' })
  invoice_id: number;

  @Index()
  @Column({ type: 'int' })
  student_id: number;

  @Column(money())
  amount: number;

  @Column({ type: 'varchar', length: 16 })
  mode: PaymentMode;

  @Column({ type: 'varchar', length: 200, nullable: true })
  reference: string | null;

  @Index()
  @Column({ type: 'date' })
  paid_on: string;

  @Column({ type: 'int', nullable: true })
  received_by: number | null;

  @Column({ type: 'varchar', length: 30 })
  receipt_no: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', length: 12, default: 'success' })
  status: PaymentStatus;

  @Column({ type: 'varchar', length: 80, nullable: true })
  idempotency_key: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reversed_at: Date | null;

  @Column({ type: 'int', nullable: true })
  reversed_by: number | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  reversal_reason: string | null;
}
