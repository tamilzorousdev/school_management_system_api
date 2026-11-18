import { Check, Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';
import { PaymentMode } from './fee-payment.entity';

@Entity('fee_refunds')
@Check('CHK_fee_refunds_amount', `"amount" > 0`)
@Index('UQ_fee_refunds_school_no', ['school_id', 'refund_no'], { unique: true })
export class FeeRefund extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 30 })
  refund_no: string;

  @Index()
  @Column({ type: 'int' })
  invoice_id: number;

  @Index()
  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'int' })
  request_id: number;

  @Column(money())
  amount: number;

  @Column({ type: 'varchar', length: 20 })
  mode: PaymentMode;

  @Column({ type: 'varchar', length: 60, nullable: true })
  reference: string | null;

  @Index()
  @Column({ type: 'date' })
  paid_on: string;

  @Column({ type: 'varchar', length: 300 })
  reason: string;

  @Column({ type: 'int', nullable: true })
  approved_by: number | null;
}
