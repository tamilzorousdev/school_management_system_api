import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

export const MEMBER_TYPES = ['student', 'staff'] as const;
export type MemberType = (typeof MEMBER_TYPES)[number];

export const MEMBER_STATUSES = ['active', 'suspended', 'left'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

@Entity('library_members')
@Index('UQ_library_members_card', ['school_id', 'card_no'], { unique: true, where: 'deleted_at IS NULL' })
@Index('UQ_library_members_student', ['school_id', 'student_id'], {
  unique: true,
  where: 'deleted_at IS NULL AND student_id IS NOT NULL',
})
@Index('UQ_library_members_user', ['school_id', 'user_id'], {
  unique: true,
  where: 'deleted_at IS NULL AND user_id IS NOT NULL',
})
export class LibraryMember extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 8 })
  member_type: MemberType;

  @Column({ type: 'int', nullable: true })
  student_id: number | null;

  @Column({ type: 'int', nullable: true })
  user_id: number | null;

  @Column({ type: 'varchar', length: 30 })
  card_no: string;

  @Column({ type: 'smallint', nullable: true })
  max_books: number | null;

  @Column({ type: 'smallint', nullable: true })
  loan_days: number | null;

  @Column({ type: 'varchar', length: 10, default: 'active' })
  status: MemberStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  status_reason: string | null;

  @Column({ type: 'date' })
  joined_on: string;
}
