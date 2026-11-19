import { SchoolScopedEntity } from '@app/common';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const ANNOUNCEMENT_AUDIENCES = ['everyone', 'parents', 'staff', 'classes', 'individuals'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export const ANNOUNCEMENT_PRIORITIES = ['normal', 'urgent'] as const;
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number];

export const ANNOUNCEMENT_STATUSES = ['draft', 'scheduled', 'published', 'archived'] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

@Entity('announcements')
@Index('IDX_announcements_school_year_status', ['school_id', 'academic_year_id', 'status'])
export class Announcement extends SchoolScopedEntity {
  @Index()
  @Column({ type: 'int' })
  academic_year_id: number;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'varchar', length: 4000 })
  body: string;

  @Column({ type: 'varchar', length: 12 })
  audience: AnnouncementAudience;

  @Column({ type: 'varchar', length: 10, default: 'normal' })
  priority: AnnouncementPriority;

  @Column({ type: 'varchar', length: 10, default: 'draft' })
  status: AnnouncementStatus;

  @Column({ type: 'timestamptz', nullable: true })
  publish_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;

  @Column({ type: 'int', nullable: true })
  published_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  expires_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  archived_at: Date | null;

  @Column({ type: 'int', default: 0 })
  recipient_count: number;

  @Column({ type: 'timestamptz', nullable: true })
  edited_at: Date | null;

  @Column({ type: 'int', nullable: true })
  edited_by: number | null;
}

@Entity('announcement_targets')
export class AnnouncementTarget {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  announcement_id: number;

  @Column({ type: 'int', nullable: true })
  class_id: number | null;

  @Column({ type: 'int', nullable: true })
  section_id: number | null;

  @Column({ type: 'int', nullable: true })
  student_id: number | null;

  @Column({ type: 'int', nullable: true })
  user_id: number | null;
}

@Entity('announcement_recipients')
@Index('UQ_announcement_recipients_user', ['announcement_id', 'user_id'], { unique: true })
export class AnnouncementRecipient {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  announcement_id: number;

  @Index()
  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'varchar', length: 10 })
  segment: 'parent' | 'staff';

  @Column({ type: 'timestamptz', nullable: true })
  read_at: Date | null;

  @Column({ type: 'int', array: true, nullable: true })
  student_ids: number[] | null;
}

@Entity('announcement_attachments')
@Index('UQ_announcement_attachments_file', ['announcement_id', 'file_id'], { unique: true })
export class AnnouncementAttachment {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  announcement_id: number;

  @Column({ type: 'int' })
  file_id: number;

  @Column({ type: 'smallint', default: 0 })
  sort_order: number;
}
