import { Check, Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';

export const INVOICE_LINE_KINDS = ['plan', 'transport', 'transport_adjustment'] as const;
export type InvoiceLineKind = (typeof INVOICE_LINE_KINDS)[number];

@Entity('fee_invoice_lines')
@Check('CHK_fee_invoice_lines_amount', `"amount" >= 0 OR "kind" = 'transport_adjustment'`)
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

  @Column({ type: 'varchar', length: 24, default: 'plan' })
  kind: InvoiceLineKind;

  @Column({ type: 'int', nullable: true })
  route_id: number | null;

  @Column({ type: 'int', nullable: true })
  stop_id: number | null;

  @Column({ type: 'int', nullable: true })
  drop_stop_id: number | null;

  @Column({ ...money(), nullable: true })
  monthly_rate: number | null;

  @Column({ type: 'smallint', nullable: true })
  months: number | null;
}
