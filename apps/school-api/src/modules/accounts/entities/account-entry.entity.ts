import { Check, Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { decimal } from '../../fleet-ops/entities/decimal';
import { AccountKind } from './account-category.entity';

export const ACCOUNT_PAYMENT_MODES = ['cash', 'upi', 'card', 'bank_transfer', 'cheque'] as const;
export type AccountPaymentMode = (typeof ACCOUNT_PAYMENT_MODES)[number];

export const ENTRY_STATUSES = ['pending', 'approved', 'rejected', 'void'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

@Entity('account_entries')
@Check('CHK_account_entries_amount', `"amount" > 0`)
@Check('CHK_account_entries_kind', `"kind" IN ('expense', 'income')`)
@Check('CHK_account_entries_status', `"status" IN ('pending', 'approved', 'rejected', 'void')`)
@Index('IDX_account_entries_school_kind_date', ['school_id', 'kind', 'entry_date'])
@Index('UQ_account_entries_school_no', ['school_id', 'entry_no'], { unique: true })
export class AccountEntry extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 10 })
  kind: AccountKind;

  @Column({ type: 'varchar', length: 40 })
  entry_no: string;

  @Column({ type: 'int' })
  category_id: number;

  @Column({ type: 'date' })
  entry_date: string;

  @Column(decimal(12, 2, false))
  amount: number;

  @Column({ type: 'varchar', length: 15, default: 'cash' })
  payment_mode: AccountPaymentMode;

  @Column({ type: 'varchar', length: 120, nullable: true })
  party: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  reference: string | null;

  @Column({ type: 'int', nullable: true })
  file_id: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: EntryStatus;

  @Column({ type: 'int', nullable: true })
  decided_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  decision_note: string | null;
}
