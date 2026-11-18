import { Check, Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';
import { BenefitKind } from './fee-benefit.entity';

@Entity('fee_invoice_benefits')
@Check('CHK_fee_invoice_benefits_amount', `"amount" > 0`)
export class FeeInvoiceBenefit extends SchoolScopedEntity {
  @Index()
  @Column({ type: 'int' })
  invoice_id: number;

  @Index()
  @Column({ type: 'int' })
  award_id: number;

  @Index()
  @Column({ type: 'int' })
  benefit_id: number;

  @Column({ type: 'varchar', length: 12 })
  kind: BenefitKind;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'int', nullable: true })
  fee_head_id: number | null;

  @Column(money())
  amount: number;
}
