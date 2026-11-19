import { Check, Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';

export const LATE_FEE_TYPES = ['none', 'flat', 'percent'] as const;
export type LateFeeType = (typeof LATE_FEE_TYPES)[number];

@Entity('fee_settings')
@Index('UQ_fee_settings_school', ['school_id'], { unique: true, where: 'deleted_at IS NULL' })
@Check(
  'CHK_fee_settings_values',
  `"grace_days" >= 0 AND "grace_days" <= 90 AND "late_fee_type" IN ('none', 'flat', 'percent') AND "late_fee_value" >= 0 AND ("late_fee_type" <> 'percent' OR "late_fee_value" <= 100) AND "reminder_days" >= 0 AND "reminder_days" <= 30`,
)
export class FeeSettings extends SchoolScopedEntity {
  @Column({ type: 'smallint', default: 0 })
  grace_days: number;

  @Column({ type: 'varchar', length: 8, default: 'none' })
  late_fee_type: LateFeeType;

  @Column(money())
  late_fee_value: number;

  @Column({ type: 'smallint', default: 3 })
  reminder_days: number;

  @Column({ type: 'int', nullable: true })
  updated_by: number | null;
}
