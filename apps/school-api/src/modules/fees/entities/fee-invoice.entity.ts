import { Check, Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';

export const INVOICE_STATUSES = ['unpaid', 'partly_paid', 'paid', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_KINDS = ['fee', 'fine'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

@Entity('fee_invoices')
@Check(
  'CHK_fee_invoices_amounts',
  `"gross" >= 0 AND "benefit" >= 0 AND "discount" >= 0 AND "paid" >= 0 AND "balance" >= 0 AND "total" = "gross" - "benefit" - "discount" AND "paid" <= "total"`,
)
@Check('CHK_fee_invoices_balance', `"status" = 'cancelled' OR "balance" = "total" - "paid"`)
@Check('CHK_fee_invoices_refunded', `"refunded" >= 0 AND "refunded" <= "paid" AND "late_fee" >= 0`)
@Check('CHK_fee_invoices_status', `"status" IN ('unpaid', 'partly_paid', 'paid', 'cancelled')`)
@Index('UQ_fee_invoices_school_no', ['school_id', 'invoice_no'], { unique: true })
@Index('UQ_fee_invoices_student_installment', ['academic_year_id', 'student_id', 'installment'], {
  unique: true,
  where: "deleted_at IS NULL AND status <> 'cancelled'",
})
export class FeeInvoice extends SchoolScopedEntity {
  @Index()
  @Column({ type: 'int' })
  academic_year_id: number;

  @Index()
  @Column({ type: 'int' })
  student_id: number;

  @Index()
  @Column({ type: 'int' })
  class_id: number;

  @Index()
  @Column({ type: 'int', nullable: true })
  section_id: number | null;

  @Column({ type: 'varchar', length: 30 })
  invoice_no: string;

  @Column({ type: 'varchar', length: 40 })
  installment: string;

  @Index()
  @Column({ type: 'date' })
  due_date: string;

  @Column({ type: 'date', nullable: true })
  original_due_date: string | null;

  @Column(money())
  gross: number;

  @Column(money())
  benefit: number;

  @Column(money())
  discount: number;

  @Column({ type: 'varchar', length: 200, nullable: true })
  discount_reason: string | null;

  @Column(money())
  total: number;

  @Column(money())
  paid: number;

  @Column(money())
  balance: number;

  @Index()
  @Column({ type: 'varchar', length: 12, default: 'unpaid' })
  status: InvoiceStatus;

  @Column({ type: 'timestamptz', nullable: true })
  cancelled_at: Date | null;

  @Column({ type: 'int', nullable: true })
  cancelled_by: number | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  cancel_reason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  overdue_alerted_at: Date | null;

  @Column(money())
  late_fee: number;

  @Column({ type: 'timestamptz', nullable: true })
  late_fee_applied_at: Date | null;

  @Column(money())
  refunded: number;

  @Column({ type: 'varchar', length: 6, default: 'fee' })
  kind: InvoiceKind;
}
