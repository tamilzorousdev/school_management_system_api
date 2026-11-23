import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { AcademicYear } from '../../setup/entities/academic-year.entity';
import { SchoolClass } from '../../setup/entities/school-class.entity';
import { Section } from '../../setup/entities/section.entity';

export const ALBUM_SCOPES = ['school', 'class', 'section'] as const;
export type AlbumScope = (typeof ALBUM_SCOPES)[number];

export const ALBUM_STATUSES = ['draft', 'published', 'archived'] as const;
export type AlbumStatus = (typeof ALBUM_STATUSES)[number];

export const VISIBILITIES = ['everyone', 'staff', 'parents', 'classes'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const MEDIA_TYPES = ['image', 'video'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const MEDIA_STATUSES = ['active', 'pending_deletion'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const DELETE_REASONS = ['manual', 'retention', 'album_deleted', 'empty_album'] as const;
export type DeleteReason = (typeof DELETE_REASONS)[number];

export const RETENTION_UNITS = ['days', 'months', 'years'] as const;
export type RetentionUnit = (typeof RETENTION_UNITS)[number];

export const CLEANUP_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export type CleanupFrequency = (typeof CLEANUP_FREQUENCIES)[number];

export const POLICY_TARGETS = ['album', 'archived', 'category', 'academic_year', 'scope', 'media_type'] as const;
export type PolicyTarget = (typeof POLICY_TARGETS)[number];

export const IMAGE_FORMATS = ['jpeg', 'png', 'webp'] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export const VIDEO_FORMATS = ['mp4', 'mov', 'webm', '3gp'] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];

export const JOB_TRIGGERS = ['schedule', 'manual', 'retry'] as const;
export type JobTrigger = (typeof JOB_TRIGGERS)[number];

export const JOB_STATUSES = ['running', 'completed', 'partial', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_ACTIONS = [
  'marked',
  'unmarked',
  'trashed',
  'purged',
  'failed',
  'album_trashed',
  'album_purged',
  'orphan_removed',
] as const;
export type JobAction = (typeof JOB_ACTIONS)[number];

export const UPLOAD_STATUSES = ['completed', 'partial', 'failed'] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

export interface UploadResult {
  index: number;
  name: string;
  status: 'accepted' | 'duplicate' | 'failed';
  media_id: number | null;
  error: string | null;
  message: string | null;
}

@Entity('gallery_settings')
export class GallerySettings {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('UQ_gallery_settings_school', { unique: true })
  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'boolean', default: true })
  is_enabled: boolean;

  @Column({ type: 'boolean', default: true })
  app_gallery_enabled: boolean;

  @Column({ type: 'boolean', default: true })
  class_gallery_enabled: boolean;

  @Column({ type: 'boolean', default: true })
  section_gallery_enabled: boolean;

  @Column({ type: 'boolean', default: true })
  videos_enabled: boolean;

  @Column({ type: 'boolean', default: true })
  downloads_enabled: boolean;

  @Column({ type: 'boolean', default: true })
  sharing_enabled: boolean;

  @Column({ type: 'boolean', default: true })
  slideshow_enabled: boolean;

  @Column({ type: 'boolean', default: false })
  download_audit_enabled: boolean;

  @Column({ type: 'varchar', length: 10, default: 'everyone' })
  default_visibility: Visibility;

  @Column({ type: 'varchar', length: 20, array: true, default: () => "'{TEACHER,HOD}'" })
  upload_roles: string[];

  @Column({ type: 'boolean', default: true })
  teachers_delete_own: boolean;

  @Column({ type: 'int', default: 20480 })
  storage_quota_mb: number;

  @Column({ type: 'smallint', default: 80 })
  storage_warning_percent: number;

  @Column({ type: 'smallint', default: 10 })
  max_image_mb: number;

  @Column({ type: 'smallint', default: 100 })
  max_video_mb: number;

  @Column({ type: 'int', default: 300 })
  max_video_seconds: number;

  @Column({ type: 'smallint', default: 20 })
  max_files_per_upload: number;

  @Column({ type: 'varchar', length: 10, array: true, default: () => "'{jpeg,png,webp}'" })
  image_formats: ImageFormat[];

  @Column({ type: 'varchar', length: 10, array: true, default: () => "'{mp4,mov,webm,3gp}'" })
  video_formats: VideoFormat[];

  @Column({ type: 'smallint', default: 82 })
  image_quality: number;

  @Column({ type: 'smallint', default: 2048 })
  image_max_side: number;

  @Column({ type: 'smallint', default: 400 })
  thumbnail_side: number;

  @Column({ type: 'boolean', default: true })
  cleanup_enabled: boolean;

  @Column({ type: 'boolean', default: false })
  cleanup_paused: boolean;

  @Column({ type: 'smallint', default: 1 })
  retention_value: number;

  @Column({ type: 'varchar', length: 6, default: 'years' })
  retention_unit: RetentionUnit;

  @Column({ type: 'varchar', length: 7, default: 'daily' })
  cleanup_frequency: CleanupFrequency;

  @Column({ type: 'varchar', length: 5, default: '02:00' })
  cleanup_time: string;

  @Column({ type: 'smallint', default: 1 })
  cleanup_weekday: number;

  @Column({ type: 'smallint', default: 1 })
  cleanup_month_day: number;

  @Column({ type: 'varchar', length: 40, default: 'Asia/Kolkata' })
  time_zone: string;

  @Column({ type: 'smallint', default: 30 })
  notice_days: number;

  @Column({ type: 'smallint', default: 30 })
  recovery_days: number;

  @Column({ type: 'boolean', default: true })
  auto_trash_enabled: boolean;

  @Column({ type: 'boolean', default: true })
  permanent_delete_enabled: boolean;

  @Column({ type: 'boolean', default: true })
  delete_empty_albums: boolean;

  @Column({ type: 'boolean', default: true })
  purge_orphans: boolean;

  @Column({ type: 'boolean', default: true })
  purge_stale_uploads: boolean;

  @Column({ type: 'boolean', default: true })
  notify_in_app: boolean;

  @Column({ type: 'boolean', default: false })
  notify_email: boolean;

  @Column({ type: 'varchar', length: 20, array: true, default: () => "'{ADMIN,PRINCIPAL}'" })
  notify_roles: string[];

  @Column({ type: 'timestamptz', nullable: true })
  next_cleanup_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_cleanup_at: Date | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  storage_alert_level: 'warning' | 'full' | null;

  @Column({ type: 'int', nullable: true })
  updated_by: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

@Entity('gallery_categories')
@Index('UQ_gallery_categories_school_name', ['school_id', 'name'], { unique: true, where: 'deleted_at IS NULL' })
export class GalleryCategory extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 30, nullable: true })
  key: string | null;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'smallint', default: 0 })
  sort_order: number;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;
}

@Entity('gallery_albums')
@Index('IDX_gallery_albums_school_year_scope', ['school_id', 'academic_year_id', 'scope', 'status'])
@Index('IDX_gallery_albums_class', ['class_id'])
@Index('IDX_gallery_albums_section', ['section_id'])
export class GalleryAlbum extends SchoolScopedEntity {
  @Column({ type: 'int' })
  academic_year_id: number;

  @ManyToOne(() => AcademicYear, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'academic_year_id' })
  academic_year?: AcademicYear;

  @Column({ type: 'varchar', length: 7 })
  scope: AlbumScope;

  @Column({ type: 'int', nullable: true })
  class_id: number | null;

  @Column({ type: 'int', nullable: true })
  section_id: number | null;

  @Column({ type: 'int', nullable: true })
  category_id: number | null;

  @ManyToOne(() => SchoolClass, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'class_id' })
  school_class?: SchoolClass | null;

  @ManyToOne(() => Section, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'section_id' })
  section?: Section | null;

  @ManyToOne(() => GalleryCategory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'category_id' })
  category?: GalleryCategory | null;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'date', nullable: true })
  event_date: string | null;

  @Column({ type: 'varchar', length: 40, array: true, default: () => "'{}'" })
  tags: string[];

  @Column({ type: 'varchar', length: 10, default: 'everyone' })
  visibility: Visibility;

  @Column({ type: 'int', array: true, nullable: true })
  class_ids: number[] | null;

  @Column({ type: 'int', array: true, nullable: true })
  section_ids: number[] | null;

  @Column({ type: 'varchar', length: 10, default: 'draft' })
  status: AlbumStatus;

  @Column({ type: 'boolean', default: false })
  is_featured: boolean;

  @Column({ type: 'boolean', default: true })
  allow_download: boolean;

  @Column({ type: 'int', nullable: true })
  cover_media_id: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  archived_at: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  deleted_reason: DeleteReason | null;

  @Column({ type: 'int', nullable: true })
  deleted_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  purge_after: Date | null;

  @Column({ type: 'int', nullable: true })
  updated_by: number | null;
}

@Entity('gallery_media')
@Index('IDX_gallery_media_album', ['album_id', 'status'])
@Index('IDX_gallery_media_school_trash_at', ['school_id', 'status', 'trash_at'])
@Index('IDX_gallery_media_school_expires', ['school_id', 'expires_at'])
@Index('IDX_gallery_media_school_purge', ['school_id', 'purge_after'])
@Index('UQ_gallery_media_album_hash', ['album_id', 'content_hash'], { unique: true, where: 'deleted_at IS NULL' })
export class GalleryMedia extends SchoolScopedEntity {
  @Column({ type: 'int' })
  album_id: number;

  @ManyToOne(() => GalleryAlbum, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'album_id' })
  album?: GalleryAlbum;

  @Column({ type: 'varchar', length: 5 })
  media_type: MediaType;

  @Column({ type: 'varchar', length: 150, nullable: true })
  title: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 255 })
  original_name: string;

  @Column({ type: 'varchar', length: 255 })
  storage_key: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  thumbnail_key: string | null;

  @Column({ type: 'varchar', length: 60 })
  mime_type: string;

  @Column({ type: 'int' })
  size_bytes: number;

  @Column({ type: 'int', default: 0 })
  thumbnail_bytes: number;

  @Column({ type: 'int', nullable: true })
  width: number | null;

  @Column({ type: 'int', nullable: true })
  height: number | null;

  @Column({ type: 'int', nullable: true })
  duration_seconds: number | null;

  @Column({ type: 'char', length: 64 })
  content_hash: string;

  @Column({ type: 'int', nullable: true })
  upload_session_id: number | null;

  @Column({ type: 'int', default: 0 })
  sort_order: number;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: MediaStatus;

  @Column({ type: 'timestamptz', nullable: true })
  expires_at: Date | null;

  @Column({ type: 'varchar', length: 40, default: 'default' })
  retention_source: string;

  @Column({ type: 'timestamptz', nullable: true })
  trash_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  notice_sent_at: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  deleted_reason: DeleteReason | null;

  @Column({ type: 'int', nullable: true })
  deleted_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  purge_after: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, unknown>;
}

@Entity('gallery_retention_policies')
@Index('UQ_gallery_retention_policies_target', { synchronize: false })
export class GalleryRetentionPolicy extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 14 })
  target: PolicyTarget;

  @Column({ type: 'int', nullable: true })
  album_id: number | null;

  @ManyToOne(() => GalleryAlbum, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'album_id' })
  album?: GalleryAlbum | null;

  @Column({ type: 'int', nullable: true })
  category_id: number | null;

  @Column({ type: 'int', nullable: true })
  academic_year_id: number | null;

  @Column({ type: 'varchar', length: 7, nullable: true })
  scope: AlbumScope | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  media_type: MediaType | null;

  @Column({ type: 'smallint', nullable: true })
  retention_value: number | null;

  @Column({ type: 'varchar', length: 6, nullable: true })
  retention_unit: RetentionUnit | null;

  @Column({ type: 'boolean', default: false })
  keep_forever: boolean;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;
}

@Entity('gallery_retention_holds')
@Index('IDX_gallery_retention_holds_album', ['album_id'])
@Index('IDX_gallery_retention_holds_media', ['media_id'])
@Index('IDX_gallery_retention_holds_school', ['school_id', 'released_at'])
export class GalleryRetentionHold {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int', nullable: true })
  album_id: number | null;

  @Column({ type: 'int', nullable: true })
  media_id: number | null;

  @ManyToOne(() => GalleryAlbum, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'album_id' })
  album?: GalleryAlbum | null;

  @ManyToOne(() => GalleryMedia, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'media_id' })
  media?: GalleryMedia | null;

  @Column({ type: 'varchar', length: 300 })
  reason: string;

  @Column({ type: 'date', nullable: true })
  keep_until: string | null;

  @Column({ type: 'int' })
  applied_by: number;

  @Column({ type: 'timestamptz' })
  applied_at: Date;

  @Column({ type: 'int', nullable: true })
  released_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  released_at: Date | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  release_reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

@Entity('gallery_cleanup_jobs')
@Index('IDX_gallery_cleanup_jobs_school_started', ['school_id', 'started_at'])
@Index('UQ_gallery_cleanup_jobs_running', ['school_id'], { unique: true, where: "status = 'running'" })
export class GalleryCleanupJob {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'varchar', length: 8 })
  trigger: JobTrigger;

  @Column({ type: 'varchar', length: 10, default: 'running' })
  status: JobStatus;

  @Column({ type: 'timestamptz' })
  started_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finished_at: Date | null;

  @Column({ type: 'int', nullable: true })
  duration_ms: number | null;

  @Column({ type: 'int', default: 0 })
  scanned: number;

  @Column({ type: 'int', default: 0 })
  marked: number;

  @Column({ type: 'int', default: 0 })
  unmarked: number;

  @Column({ type: 'int', default: 0 })
  trashed: number;

  @Column({ type: 'int', default: 0 })
  purged: number;

  @Column({ type: 'int', default: 0 })
  failed: number;

  @Column({ type: 'int', default: 0 })
  held: number;

  @Column({ type: 'int', default: 0 })
  albums_trashed: number;

  @Column({ type: 'int', default: 0 })
  albums_purged: number;

  @Column({ type: 'int', default: 0 })
  orphans_removed: number;

  @Column({ type: 'int', default: 0 })
  uploads_cleared: number;

  @Column({ type: 'bigint', default: 0 })
  bytes_reclaimed: string;

  @Column({ type: 'bigint', nullable: true })
  storage_bytes_after: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'int', nullable: true })
  triggered_by: number | null;

  @Column({ type: 'int', nullable: true })
  retry_of_job_id: number | null;
}

@Entity('gallery_cleanup_job_items')
@Index('IDX_gallery_cleanup_job_items_job', ['job_id', 'action'])
@Index('IDX_gallery_cleanup_job_items_school', ['school_id', 'action', 'created_at'])
export class GalleryCleanupJobItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  job_id: number;

  @Column({ type: 'int', nullable: true })
  media_id: number | null;

  @Column({ type: 'int', nullable: true })
  album_id: number | null;

  @Column({ type: 'varchar', length: 14 })
  action: JobAction;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string | null;

  @Column({ type: 'int', default: 0 })
  size_bytes: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  error: string | null;

  @Column({ type: 'int', nullable: true })
  retried_job_id: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

@Entity('gallery_upload_sessions')
@Index('IDX_gallery_upload_sessions_school', ['school_id', 'created_at'])
export class GalleryUploadSession extends SchoolScopedEntity {
  @Column({ type: 'int' })
  album_id: number;

  @ManyToOne(() => GalleryAlbum, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'album_id' })
  album?: GalleryAlbum;

  @Column({ type: 'smallint', default: 0 })
  total: number;

  @Column({ type: 'smallint', default: 0 })
  accepted: number;

  @Column({ type: 'smallint', default: 0 })
  duplicates: number;

  @Column({ type: 'smallint', default: 0 })
  failed: number;

  @Column({ type: 'bigint', default: 0 })
  bytes: string;

  @Column({ type: 'varchar', length: 10, default: 'completed' })
  status: UploadStatus;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  results: UploadResult[];

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  orphan_keys: string[];
}

@Entity('gallery_audit_logs')
@Index('IDX_gallery_audit_logs_school_created', ['school_id', 'created_at'])
@Index('IDX_gallery_audit_logs_school_action', ['school_id', 'action'])
export class GalleryAuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int', nullable: true })
  user_id: number | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  user_name: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  user_role: string | null;

  @Column({ type: 'varchar', length: 40 })
  action: string;

  @Column({ type: 'int', nullable: true })
  album_id: number | null;

  @Column({ type: 'int', nullable: true })
  media_id: number | null;

  @Column({ type: 'int', nullable: true })
  class_id: number | null;

  @Column({ type: 'int', nullable: true })
  section_id: number | null;

  @Column({ type: 'varchar', length: 8, default: 'success' })
  result: 'success' | 'failure';

  @Column({ type: 'jsonb', default: () => "'{}'" })
  details: Record<string, unknown>;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
