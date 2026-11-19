import { SchoolScopedEntity } from '@app/common';
import { Column, Entity, Index } from 'typeorm';
import { money } from '../../payroll/entities/money';

export const EXIT_TYPES = ['transferred', 'withdrawn'] as const;
export type ExitType = (typeof EXIT_TYPES)[number];

@Entity('transfer_certificates')
@Index('UQ_transfer_certificates_school_no', ['school_id', 'tc_no'], { unique: true })
export class TransferCertificate extends SchoolScopedEntity {
  @Index()
  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'varchar', length: 30 })
  tc_no: string;

  @Column({ type: 'varchar', length: 12 })
  exit_type: ExitType;

  @Column({ type: 'date' })
  leaving_date: string;

  @Column({ type: 'date' })
  issued_on: string;

  @Column({ type: 'varchar', length: 255 })
  reason: string;

  @Column({ type: 'varchar', length: 40, default: 'Good' })
  conduct: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  academic_year_name: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  class_name: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  section_name: string | null;

  @Column({ type: 'boolean', default: true })
  promotion_eligible: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remarks: string | null;

  @Column(money())
  fee_balance: number;
}
