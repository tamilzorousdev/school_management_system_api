import { SchoolScopedEntity } from '@app/common';
import { Column, Entity, Index } from 'typeorm';

export interface GradingTier {
  grade: string;
  min_percentage: number;
  max_percentage: number;
  grade_point?: number;
  description?: string;
}

@Entity('grading_scales')
@Index('UQ_grading_scales_school_name', ['school_id', 'name'], { unique: true, where: 'deleted_at IS NULL' })
export class GradingScale extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 50, default: 'CBSE' })
  board: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'boolean', default: false })
  is_default: boolean;

  @Column({ type: 'jsonb' })
  tiers: GradingTier[];
}

