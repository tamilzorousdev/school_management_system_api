import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

export const FEE_AUDIT_ENTITIES = [
  'fee_head',
  'fee_plan',
  'fee_invoice',
  'fee_payment',
  'invoice_run',
  'fee_benefit',
  'benefit_award',
  'fee_request',
  'fee_refund',
  'fee_settings',
  'fee_fine',
  'fine_type',
] as const;
export type FeeAuditEntity = (typeof FEE_AUDIT_ENTITIES)[number];

export const FEE_AUDIT_ACTIONS = [
  'created',
  'updated',
  'deleted',
  'replaced',
  'generated',
  'discounted',
  'cancelled',
  'paid',
  'reversed',
  'submitted',
  'approved',
  'rejected',
  'discarded',
  'awarded',
  'revoked',
  'requested',
  'withdrawn',
  'refunded',
  'late_fee',
  'rescheduled',
  'written_off',
] as const;
export type FeeAuditAction = (typeof FEE_AUDIT_ACTIONS)[number];

@Entity('fee_audit_logs')
@Index('IDX_fee_audit_logs_subject', ['school_id', 'entity', 'entity_id'])
@Index('IDX_fee_audit_logs_created', ['school_id', 'created_at'])
export class FeeAuditLog extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 20 })
  entity: FeeAuditEntity;

  @Column({ type: 'int', nullable: true })
  entity_id: number | null;

  @Column({ type: 'varchar', length: 20 })
  action: FeeAuditAction;

  @Column({ type: 'jsonb', nullable: true })
  before: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  reason: string | null;
}
