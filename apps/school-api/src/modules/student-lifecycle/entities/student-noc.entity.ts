import { SchoolScopedEntity } from '@app/common';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ExitType } from './transfer-certificate.entity';

export const NOC_STATUSES = ['open', 'cleared', 'cancelled', 'issued'] as const;
export type NocStatus = (typeof NOC_STATUSES)[number];

export const NOC_DEPARTMENTS = ['fees', 'library', 'transport', 'inventory', 'class_teacher'] as const;
export type NocDepartment = (typeof NOC_DEPARTMENTS)[number];

export const NOC_ITEM_STATUSES = ['pending', 'cleared'] as const;
export type NocItemStatus = (typeof NOC_ITEM_STATUSES)[number];

@Entity('student_nocs')
@Index('UQ_student_nocs_live', ['school_id', 'student_id'], {
  unique: true,
  where: `"status" IN ('open', 'cleared') AND "deleted_at" IS NULL`,
})
export class StudentNoc extends SchoolScopedEntity {
  @Index('IDX_student_nocs_student')
  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'varchar', length: 10, default: 'open' })
  status: NocStatus;

  @Column({ type: 'varchar', length: 12 })
  exit_type: ExitType;

  @Column({ type: 'date' })
  leaving_date: string;

  @Column({ type: 'varchar', length: 255 })
  reason: string;

  @Column({ type: 'int', nullable: true })
  requested_by: number | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  requested_by_name: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  cleared_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelled_at: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cancel_note: string | null;

  @Column({ type: 'int', nullable: true })
  tc_id: number | null;

  @OneToMany(() => StudentNocItem, (item) => item.noc)
  items?: StudentNocItem[];
}

@Entity('student_noc_items')
@Index('UQ_student_noc_items_department', ['noc_id', 'department'], { unique: true })
export class StudentNocItem {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @Column({ type: 'int' })
  noc_id: number;

  @ManyToOne(() => StudentNoc, (noc) => noc.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'noc_id', foreignKeyConstraintName: 'FK_student_noc_items_noc' })
  noc?: StudentNoc;

  @Column({ type: 'varchar', length: 16 })
  department: NocDepartment;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: NocItemStatus;

  @Column({ type: 'int', nullable: true })
  cleared_by: number | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  cleared_by_name: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  cleared_at: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remarks: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  blocker_snapshot: string | null;
}
