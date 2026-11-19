import { Check, Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';

export const BENEFIT_KINDS = ['concession', 'scholarship'] as const;
export type BenefitKind = (typeof BENEFIT_KINDS)[number];

export const CONCESSION_TYPES = [
  'sibling',
  'staff_child',
  'merit',
  'sports',
  'financial',
  'management',
  'other',
] as const;
export const SCHOLARSHIP_TYPES = ['government', 'institution', 'trust', 'private', 'other'] as const;
export const BENEFIT_TYPES = [...new Set([...CONCESSION_TYPES, ...SCHOLARSHIP_TYPES])] as const;
export type BenefitType = (typeof BENEFIT_TYPES)[number];

export const BENEFIT_CALC_TYPES = ['percent', 'fixed'] as const;
export type BenefitCalcType = (typeof BENEFIT_CALC_TYPES)[number];

@Entity('fee_benefits')
@Check('CHK_fee_benefits_kind', `"kind" IN ('concession', 'scholarship')`)
@Check(
  'CHK_fee_benefits_value',
  `"value" > 0 AND "calc_type" IN ('percent', 'fixed') AND ("calc_type" = 'fixed' OR "value" <= 100)`,
)
@Index('UQ_fee_benefits_name', ['school_id', 'academic_year_id', 'kind', 'name'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
export class FeeBenefit extends SchoolScopedEntity {
  @Index()
  @Column({ type: 'int' })
  academic_year_id: number;

  @Column({ type: 'varchar', length: 12 })
  kind: BenefitKind;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  type: BenefitType;

  @Column({ type: 'varchar', length: 8 })
  calc_type: BenefitCalcType;

  @Column(money())
  value: number;

  @Column({ type: 'int', array: true, default: () => "'{}'" })
  fee_head_ids: number[];

  @Column({ type: 'int', array: true, default: () => "'{}'" })
  class_ids: number[];

  @Column({ type: 'varchar', length: 300, nullable: true })
  description: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;
}
