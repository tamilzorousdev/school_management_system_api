import { Check, Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';

export const CREDIT_KINDS = ['advance', 'applied', 'returned'] as const;
export type CreditKind = (typeof CREDIT_KINDS)[number];

@Entity('fee_credits')
@Check('CHK_fee_credits_kind', `"kind" IN ('advance', 'applied', 'returned')`)
@Check('CHK_fee_credits_sign', `("kind" = 'applied' AND "amount" < 0) OR ("kind" <> 'applied' AND "amount" > 0)`)
export class FeeCredit extends SchoolScopedEntity {
  @Index()
  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'varchar', length: 10 })
  kind: CreditKind;

  @Column(money({ default: undefined }))
  amount: number;

  @Column({ type: 'int', nullable: true })
  collection_id: number | null;

  @Index()
  @Column({ type: 'int', nullable: true })
  payment_id: number | null;

  @Column({ type: 'int', nullable: true })
  invoice_id: number | null;
}
