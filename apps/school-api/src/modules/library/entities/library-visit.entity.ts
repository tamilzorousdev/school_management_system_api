import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { MemberType } from './library-member.entity';

export const VISIT_KINDS = ['walk_in', 'period'] as const;
export type VisitKind = (typeof VISIT_KINDS)[number];

export const VISIT_PURPOSES = ['read', 'borrow', 'return', 'study', 'period', 'other'] as const;
export type VisitPurpose = (typeof VISIT_PURPOSES)[number];

export const AUDIT_STATUSES = ['open', 'closed'] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export const AUDIT_FINDINGS = ['found', 'misplaced', 'was_issued', 'was_lost', 'unknown'] as const;
export type AuditFinding = (typeof AUDIT_FINDINGS)[number];

@Entity('library_visits')
@Index('IDX_library_visits_school_date', ['school_id', 'visit_date'])
@Index('UQ_library_visits_period_student', ['school_id', 'slot_id', 'visit_date', 'student_id'], {
  unique: true,
  where: "kind = 'period' AND deleted_at IS NULL",
})
export class LibraryVisit extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 8 })
  kind: VisitKind;

  @Column({ type: 'varchar', length: 8 })
  member_type: MemberType;

  @Column({ type: 'int', nullable: true })
  student_id: number | null;

  @Column({ type: 'int', nullable: true })
  user_id: number | null;

  @Column({ type: 'int', nullable: true })
  class_id: number | null;

  @Column({ type: 'int', nullable: true })
  section_id: number | null;

  @Column({ type: 'date' })
  visit_date: string;

  @Column({ type: 'timestamptz', nullable: true })
  in_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  out_at: Date | null;

  @Column({ type: 'varchar', length: 8, default: 'read' })
  purpose: VisitPurpose;

  @Column({ type: 'boolean', default: true })
  present: boolean;

  @Column({ type: 'int', nullable: true })
  slot_id: number | null;

  @Column({ type: 'smallint', nullable: true })
  period_no: number | null;

  @Column({ type: 'int', nullable: true })
  marked_by: number | null;
}

@Entity('library_stock_audits')
export class LibraryStockAudit extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 8, default: 'open' })
  status: AuditStatus;

  @Column({ type: 'int', nullable: true })
  category_id: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  rack: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  closed_at: Date | null;

  @Column({ type: 'int', nullable: true })
  closed_by: number | null;

  @Column({ type: 'int', default: 0 })
  expected_count: number;

  @Column({ type: 'int', default: 0 })
  found_count: number;

  @Column({ type: 'int', default: 0 })
  missing_count: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;
}

@Entity('library_stock_audit_items')
@Index('UQ_library_stock_audit_items_code', ['audit_id', 'code'], { unique: true })
export class LibraryStockAuditItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  audit_id: number;

  @Column({ type: 'int', nullable: true })
  copy_id: number | null;

  @Column({ type: 'varchar', length: 60 })
  code: string;

  @Column({ type: 'varchar', length: 12 })
  finding: AuditFinding;

  @Column({ type: 'int', nullable: true })
  scanned_by: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  scanned_at: Date;
}
