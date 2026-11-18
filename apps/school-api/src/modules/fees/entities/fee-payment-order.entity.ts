import { Check, Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';

export const ORDER_STATUSES = ['created', 'paid', 'failed'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

@Entity('fee_payment_orders')
@Check('CHK_fee_payment_orders', `"amount" > 0 AND "status" IN ('created', 'paid', 'failed')`)
@Index('UQ_fee_payment_orders_gateway', ['gateway_order_id'], { unique: true })
export class FeePaymentOrder extends SchoolScopedEntity {
  @Index()
  @Column({ type: 'int' })
  invoice_id: number;

  @Index()
  @Column({ type: 'int' })
  student_id: number;

  @Column(money())
  amount: number;

  @Column({ type: 'varchar', length: 12, default: 'razorpay' })
  gateway: string;

  @Column({ type: 'varchar', length: 40 })
  gateway_order_id: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  gateway_payment_id: string | null;

  @Index()
  @Column({ type: 'varchar', length: 10, default: 'created' })
  status: OrderStatus;

  @Column({ type: 'int', nullable: true })
  collection_id: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  paid_at: Date | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  failure_reason: string | null;
}
