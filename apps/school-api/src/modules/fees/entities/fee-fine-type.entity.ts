import { Check, Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';

@Entity('fee_fine_types')
@Check('CHK_fee_fine_types_amount', `"default_amount" > 0`)
@Index('UQ_fee_fine_types_name', ['school_id', 'name'], { unique: true, where: 'deleted_at IS NULL' })
export class FeeFineType extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column(money())
  default_amount: number;

  @Column({ type: 'varchar', length: 300, nullable: true })
  description: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;
}
