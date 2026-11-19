import { Check, Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

export const AWARD_STATUSES = ['active', 'revoked'] as const;
export type AwardStatus = (typeof AWARD_STATUSES)[number];

@Entity('student_fee_benefits')
@Check('CHK_student_fee_benefits_status', `"status" IN ('active', 'revoked')`)
@Index('UQ_student_fee_benefits_active', ['benefit_id', 'student_id'], {
  unique: true,
  where: `deleted_at IS NULL AND status = 'active'`,
})
export class StudentFeeBenefit extends SchoolScopedEntity {
  @Index()
  @Column({ type: 'int' })
  student_id: number;

  @Index()
  @Column({ type: 'int' })
  benefit_id: number;

  @Index()
  @Column({ type: 'int' })
  academic_year_id: number;

  @Column({ type: 'varchar', length: 10, default: 'active' })
  status: AwardStatus;

  @Column({ type: 'varchar', length: 300, nullable: true })
  reason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  revoked_at: Date | null;

  @Column({ type: 'int', nullable: true })
  revoked_by: number | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  revoke_reason: string | null;
}
