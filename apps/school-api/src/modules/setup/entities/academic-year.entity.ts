import { SchoolScopedEntity } from '@app/common';
import { Check, Column, Entity, Index, OneToMany } from 'typeorm';
import { Term } from './term.entity';

export const ACADEMIC_YEAR_STATUSES = ['draft', 'active', 'closed', 'archived'] as const;
export type AcademicYearStatus = (typeof ACADEMIC_YEAR_STATUSES)[number];

@Entity('academic_years')
@Check('CHK_academic_years_status', `"status" IN ('draft', 'active', 'closed', 'archived')`)
@Check('CHK_academic_years_current', `"is_current" = ("status" = 'active')`)
@Index('UQ_academic_years_school_name', ['school_id', 'name'], { unique: true, where: 'deleted_at IS NULL' })
@Index('UQ_academic_years_school_current', ['school_id'], {
  unique: true,
  where: 'is_current = true AND deleted_at IS NULL',
})
export class AcademicYear extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 20 })
  name: string;

  @Column({ type: 'date' })
  start_date: string;

  @Column({ type: 'date' })
  end_date: string;

  @Column({ type: 'boolean', default: false })
  is_current: boolean;

  @Column({ type: 'varchar', length: 10, default: 'draft' })
  status: AcademicYearStatus;

  @Column({ type: 'varchar', length: 300, nullable: true })
  description: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  activated_at: Date | null;

  @Column({ type: 'int', nullable: true })
  activated_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  closed_at: Date | null;

  @Column({ type: 'int', nullable: true })
  closed_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  archived_at: Date | null;

  @Column({ type: 'int', nullable: true })
  archived_by: number | null;

  @OneToMany(() => Term, (term) => term.academic_year)
  terms?: Term[];
}
