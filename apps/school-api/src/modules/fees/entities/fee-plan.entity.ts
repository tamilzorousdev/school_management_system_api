import { Check, Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';

@Entity('fee_plans')
@Check('CHK_fee_plans_amount', `"amount" >= 0`)
@Index('UQ_fee_plans_line', ['academic_year_id', 'class_id', 'fee_head_id', 'installment'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
export class FeePlan extends SchoolScopedEntity {
  @Index()
  @Column({ type: 'int' })
  academic_year_id: number;

  @Index()
  @Column({ type: 'int' })
  class_id: number;

  @Index()
  @Column({ type: 'int' })
  fee_head_id: number;

  @Column({ type: 'varchar', length: 40 })
  installment: string;

  @Column(money())
  amount: number;

  @Column({ type: 'date' })
  due_date: string;
}
