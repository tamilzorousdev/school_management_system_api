import { Check, Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';

@Entity('fee_invoice_lines')
@Check('CHK_fee_invoice_lines_amount', `"amount" >= 0`)
export class FeeInvoiceLine extends SchoolScopedEntity {
  @Index()
  @Column({ type: 'int' })
  invoice_id: number;

  @Column({ type: 'int', nullable: true })
  fee_head_id: number | null;

  @Column({ type: 'varchar', length: 60 })
  head_name: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  description: string | null;

  @Column(money())
  amount: number;

  @Column({ type: 'smallint', default: 0 })
  sort_order: number;
}
