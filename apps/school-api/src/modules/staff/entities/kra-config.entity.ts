import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

export const KRA_CATEGORIES = ['academics', 'pedagogy', 'administrative', 'extracurricular', 'general'] as const;
export type KraCategory = (typeof KRA_CATEGORIES)[number];

export const KRA_APPLICABILITY = ['all', 'teaching', 'non_teaching', 'leadership'] as const;
export type KraApplicability = (typeof KRA_APPLICABILITY)[number];

@Entity('kra_configs')
@Index('IDX_kra_configs_school', ['school_id'])
@Index('IDX_kra_configs_school_active', ['school_id', 'is_active'])
export class KraConfig extends SchoolScopedEntity {
  @Column({ type: 'int', nullable: true })
  academic_year_id: number | null;

  @Column({ type: 'varchar', length: 50 })
  code: string;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 50, default: 'academics' })
  category: KraCategory;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 20.0 })
  weightage_percent: number;

  @Column({ type: 'numeric', precision: 3, scale: 1, default: 1.0 })
  min_score: number;

  @Column({ type: 'numeric', precision: 3, scale: 1, default: 5.0 })
  max_score: number;

  @Column({ type: 'varchar', length: 50, default: 'all' })
  applicable_to: KraApplicability;

  @Column({ type: 'int', default: 0 })
  sort_order: number;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;
}
