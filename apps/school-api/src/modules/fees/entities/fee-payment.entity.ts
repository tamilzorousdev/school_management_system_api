import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';

export const PAYMENT_MODES = ['cash', 'upi', 'card', 'bank_transfer', 'cheque'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

@Entity('fee_payments')
@Index('UQ_fee_payments_school_receipt', ['school_id', 'receipt_no'], { unique: true })
export class FeePayment extends SchoolScopedEntity {
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
}
