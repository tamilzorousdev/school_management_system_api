import { Check, Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

export const PLAN_VERSION_STATUSES = ['draft', 'pending_approval', 'published', 'superseded'] as const;
export type PlanVersionStatus = (typeof PLAN_VERSION_STATUSES)[number];

export interface PlanLineValue {
  fee_head_id: number;
  installment: string;
  amount: number;
  due_date: string;
}

@Entity('fee_plan_versions')
@Check('CHK_fee_plan_versions_status', `"status" IN ('draft', 'pending_approval', 'published', 'superseded')`)
@Index('UQ_fee_plan_versions_number', ['school_id', 'academic_year_id', 'class_id', 'version'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('UQ_fee_plan_versions_open', ['school_id', 'academic_year_id', 'class_id'], {
  unique: true,
  where: `deleted_at IS NULL AND status IN ('draft', 'pending_approval')`,
})
@Index('UQ_fee_plan_versions_published', ['school_id', 'academic_year_id', 'class_id'], {
  unique: true,
  where: `deleted_at IS NULL AND status = 'published'`,
})
export class FeePlanVersion extends SchoolScopedEntity {
  @Column({ type: 'int' })
  academic_year_id: number;

  @Index()
  @Column({ type: 'int' })
  class_id: number;

  @Column({ type: 'int' })
  version: number;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status: PlanVersionStatus;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  lines: PlanLineValue[];

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @Column({ type: 'int', nullable: true })
  submitted_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  submitted_at: Date | null;

  @Column({ type: 'int', nullable: true })
  reviewed_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewed_at: Date | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  review_comment: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;
}
