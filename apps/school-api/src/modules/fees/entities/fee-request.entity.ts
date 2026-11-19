import { Check, Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';

export const FEE_REQUEST_KINDS = ['discount', 'cancel', 'reversal', 'refund', 'reschedule', 'write_off'] as const;
export type FeeRequestKind = (typeof FEE_REQUEST_KINDS)[number];

export const FEE_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type FeeRequestStatus = (typeof FEE_REQUEST_STATUSES)[number];

export interface FeeRequestDetails {
  discount?: number;
  mode?: string;
  reference?: string | null;
  paid_on?: string;
  due_date?: string;
  old_due_date?: string;
}

@Entity('fee_requests')
@Check('CHK_fee_requests_kind', `"kind" IN ('discount', 'cancel', 'reversal', 'refund', 'reschedule', 'write_off')`)
@Check('CHK_fee_requests_status', `"status" IN ('pending', 'approved', 'rejected', 'withdrawn')`)
@Index('UQ_fee_requests_pending', ['school_id', 'kind', 'invoice_id', 'payment_id'], {
  unique: true,
  where: `deleted_at IS NULL AND status = 'pending'`,
})
export class FeeRequest extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 10 })
  kind: FeeRequestKind;

  @Index()
  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: FeeRequestStatus;

  @Index()
  @Column({ type: 'int' })
  invoice_id: number;

  @Column({ type: 'int', default: 0 })
  payment_id: number;

  @Index()
  @Column({ type: 'int' })
  student_id: number;

  @Column(money({ nullable: true, default: null }))
  amount: number | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  details: FeeRequestDetails;

  @Column({ type: 'varchar', length: 300 })
  reason: string;

  @Column({ type: 'int', nullable: true })
  decided_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  decision_comment: string | null;
}
