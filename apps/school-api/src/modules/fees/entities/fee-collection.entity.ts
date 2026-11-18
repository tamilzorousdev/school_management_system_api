import { Check, Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';
import { PaymentMode } from './fee-payment.entity';

@Entity('fee_collections')
@Check('CHK_fee_collections_amounts', `"amount" > 0 AND "applied_amount" >= 0 AND "advance_amount" >= 0`)
@Index('UQ_fee_collections_idempotency', ['school_id', 'idempotency_key'], {
  unique: true,
  where: 'idempotency_key IS NOT NULL',
})
export class FeeCollection extends SchoolScopedEntity {
  @Index()
  @Column({ type: 'int' })
  student_id: number;

  @Column(money())
  amount: number;

  @Column(money())
  applied_amount: number;

  @Column(money())
  advance_amount: number;

  @Column({ type: 'varchar', length: 30, nullable: true })
  advance_receipt_no: string | null;

  @Column({ type: 'varchar', length: 16 })
  mode: PaymentMode;

  @Column({ type: 'varchar', length: 200, nullable: true })
  reference: string | null;

  @Index()
  @Column({ type: 'date' })
  paid_on: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  idempotency_key: string | null;
}
