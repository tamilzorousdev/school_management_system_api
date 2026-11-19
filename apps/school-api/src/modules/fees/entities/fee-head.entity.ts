import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

export const FEE_FREQUENCIES = [
  'one_time',
  'monthly',
  'quarterly',
  'half_yearly',
  'yearly',
  'per_term',
  'custom',
] as const;
export type FeeFrequency = (typeof FEE_FREQUENCIES)[number];

@Entity('fee_heads')
@Index('UQ_fee_heads_school_code', ['school_id', 'code'], { unique: true, where: 'deleted_at IS NULL' })
export class FeeHead extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  code: string;

  @Column({ type: 'boolean', default: false })
  is_transport: boolean;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'varchar', length: 300, nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  fee_group: string | null;

  @Column({ type: 'boolean', default: true })
  is_mandatory: boolean;

  @Column({ type: 'varchar', length: 12, default: 'custom' })
  frequency: FeeFrequency;

  @Column({ type: 'boolean', default: false })
  is_refundable: boolean;

  @Column({ type: 'int', array: true, default: () => "'{}'" })
  applicable_class_ids: number[];
}
