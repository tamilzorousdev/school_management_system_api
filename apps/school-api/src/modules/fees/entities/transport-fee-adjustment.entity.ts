import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';

@Entity('transport_fee_adjustments')
@Index('IDX_transport_fee_adjustments_pending', ['school_id', 'student_id'], {
  where: 'applied_invoice_id IS NULL AND deleted_at IS NULL',
})
export class TransportFeeAdjustment extends SchoolScopedEntity {
  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'int' })
  invoice_id: number;

  @Column(money())
  amount: number;

  @Column({ type: 'varchar', length: 160 })
  reason: string;

  @Column({ type: 'int', nullable: true })
  applied_invoice_id: number | null;
}
