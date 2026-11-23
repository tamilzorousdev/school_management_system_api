import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { IsNullableDate } from '../../../shared/dates';
import { ROLES } from '../../access/access.catalog';
import {
  ALBUM_SCOPES,
  AlbumScope,
  CLEANUP_FREQUENCIES,
  CleanupFrequency,
  IMAGE_FORMATS,
  ImageFormat,
  JOB_ACTIONS,
  JOB_STATUSES,
  JOB_TRIGGERS,
  JobAction,
  JobStatus,
  JobTrigger,
  MEDIA_TYPES,
  MediaType,
  POLICY_TARGETS,
  PolicyTarget,
  RETENTION_UNITS,
  RetentionUnit,
  VIDEO_FORMATS,
  VideoFormat,
  VISIBILITIES,
  Visibility,
} from '../entities/gallery.entity';

const UPLOAD_ROLES = [ROLES.TEACHER, ROLES.HOD];
const NOTIFY_ROLES = [ROLES.ADMIN, ROLES.PRINCIPAL, ROLES.AO];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdateGallerySettingsDto {
  @ApiPropertyOptional({ description: 'Switches the whole Gallery on or off for staff and parents' })
  @IsOptional()
  @IsBoolean()
  is_enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  app_gallery_enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  class_gallery_enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  section_gallery_enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  videos_enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  downloads_enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sharing_enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  slideshow_enabled?: boolean;

  @ApiPropertyOptional({ description: 'Write an audit row every time a download link is opened' })
  @IsOptional()
  @IsBoolean()
  download_audit_enabled?: boolean;

  @ApiPropertyOptional({ enum: VISIBILITIES })
  @IsOptional()
  @IsIn(VISIBILITIES)
  default_visibility?: Visibility;

  @ApiPropertyOptional({
    type: [String],
    enum: UPLOAD_ROLES,
    example: ['TEACHER', 'HOD'],
    description: 'Staff app roles that may upload to their classes and sections. Empty = only admins upload.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(UPLOAD_ROLES, { each: true })
  upload_roles?: string[];

  @ApiPropertyOptional({ description: 'Teachers may delete their own uploads' })
  @IsOptional()
  @IsBoolean()
  teachers_delete_own?: boolean;

  @ApiPropertyOptional({ example: 20480, minimum: 100 })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(10_000_000)
  storage_quota_mb?: number;

  @ApiPropertyOptional({ example: 80, minimum: 50, maximum: 99 })
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(99)
  storage_warning_percent?: number;

  @ApiPropertyOptional({ example: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  max_image_mb?: number;

  @ApiPropertyOptional({ example: 100, minimum: 1, description: 'Up to GALLERY_MAX_UPLOAD_MB on the server' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4096)
  max_video_mb?: number;

  @ApiPropertyOptional({ example: 300, minimum: 5, maximum: 7200 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(7200)
  max_video_seconds?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  max_files_per_upload?: number;

  @ApiPropertyOptional({ type: [String], enum: IMAGE_FORMATS, example: ['jpeg', 'png', 'webp'] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Allow at least one image format' })
  @ArrayUnique()
  @IsIn(IMAGE_FORMATS, { each: true })
  image_formats?: ImageFormat[];

  @ApiPropertyOptional({ type: [String], enum: VIDEO_FORMATS, example: ['mp4', 'mov'] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(VIDEO_FORMATS, { each: true })
  video_formats?: VideoFormat[];

  @ApiPropertyOptional({ example: 82, minimum: 40, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(40)
  @Max(100)
  image_quality?: number;

  @ApiPropertyOptional({ example: 2048, minimum: 800, maximum: 8000, description: 'Longest side of stored photos' })
  @IsOptional()
  @IsInt()
  @Min(800)
  @Max(8000)
  image_max_side?: number;

  @ApiPropertyOptional({ example: 400, minimum: 120, maximum: 800 })
  @IsOptional()
  @IsInt()
  @Min(120)
  @Max(800)
  thumbnail_side?: number;

  @ApiPropertyOptional({ description: 'Automatic media cleanup' })
  @IsOptional()
  @IsBoolean()
  cleanup_enabled?: boolean;

  @ApiPropertyOptional({ example: 1, minimum: 1, maximum: 3650 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  retention_value?: number;

  @ApiPropertyOptional({ enum: RETENTION_UNITS, example: 'years' })
  @IsOptional()
  @IsIn(RETENTION_UNITS)
  retention_unit?: RetentionUnit;

  @ApiPropertyOptional({ enum: CLEANUP_FREQUENCIES, example: 'daily' })
  @IsOptional()
  @IsIn(CLEANUP_FREQUENCIES)
  cleanup_frequency?: CleanupFrequency;

  @ApiPropertyOptional({ example: '02:00', description: 'HH:mm in time_zone' })
  @IsOptional()
  @Matches(TIME, { message: 'cleanup_time must be HH:mm' })
  cleanup_time?: string;

  @ApiPropertyOptional({ example: 1, minimum: 1, maximum: 7, description: 'Weekly: 1 = Monday ... 7 = Sunday' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  cleanup_weekday?: number;

  @ApiPropertyOptional({ example: 1, minimum: 1, maximum: 28, description: 'Monthly: day of the month' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  cleanup_month_day?: number;

  @ApiPropertyOptional({ example: 'Asia/Kolkata' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  time_zone?: string;

  @ApiPropertyOptional({
    example: 30,
    minimum: 0,
    maximum: 365,
    description: 'Days of notice before media goes to Trash',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  notice_days?: number;

  @ApiPropertyOptional({ example: 30, minimum: 1, maximum: 365, description: 'Days media stays restorable in Trash' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  recovery_days?: number;

  @ApiPropertyOptional({ description: 'Move expired media to Trash automatically' })
  @IsOptional()
  @IsBoolean()
  auto_trash_enabled?: boolean;

  @ApiPropertyOptional({ description: 'Delete Trash items for good when the recovery period ends' })
  @IsOptional()
  @IsBoolean()
  permanent_delete_enabled?: boolean;

  @ApiPropertyOptional({ description: 'Move albums left empty by the cleanup to Trash' })
  @IsOptional()
  @IsBoolean()
  delete_empty_albums?: boolean;

  @ApiPropertyOptional({ description: 'Remove stored files left behind by failed uploads or deletions' })
  @IsOptional()
  @IsBoolean()
  purge_orphans?: boolean;

  @ApiPropertyOptional({ description: 'Clear upload records older than 30 days' })
  @IsOptional()
  @IsBoolean()
  purge_stale_uploads?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notify_in_app?: boolean;

  @ApiPropertyOptional({ description: 'Also email admins through the notification service, when it is configured' })
  @IsOptional()
  @IsBoolean()
  notify_email?: boolean;

  @ApiPropertyOptional({ type: [String], enum: NOTIFY_ROLES, example: ['ADMIN', 'PRINCIPAL'] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(NOTIFY_ROLES, { each: true })
  notify_roles?: string[];

  @ApiPropertyOptional({
    description: 'Needed when the change shortens retention, notice or recovery, or turns permanent deletion on',
  })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

export class GallerySettingsDto {
  @ApiProperty() is_enabled: boolean;
  @ApiProperty() app_gallery_enabled: boolean;
  @ApiProperty() class_gallery_enabled: boolean;
  @ApiProperty() section_gallery_enabled: boolean;
  @ApiProperty() videos_enabled: boolean;
  @ApiProperty() downloads_enabled: boolean;
  @ApiProperty() sharing_enabled: boolean;
  @ApiProperty() slideshow_enabled: boolean;
  @ApiProperty() download_audit_enabled: boolean;
  @ApiProperty({ enum: VISIBILITIES }) default_visibility: Visibility;
  @ApiProperty({ type: [String], example: ['TEACHER', 'HOD'] }) upload_roles: string[];
  @ApiProperty() teachers_delete_own: boolean;
  @ApiProperty({ example: 20480 }) storage_quota_mb: number;
  @ApiProperty({ example: 80 }) storage_warning_percent: number;
  @ApiProperty({ example: 10 }) max_image_mb: number;
  @ApiProperty({ example: 100 }) max_video_mb: number;
  @ApiProperty({ example: 300 }) max_video_seconds: number;
  @ApiProperty({ example: 20 }) max_files_per_upload: number;
  @ApiProperty({ type: [String], example: ['jpeg', 'png', 'webp'] }) image_formats: ImageFormat[];
  @ApiProperty({ type: [String], example: ['mp4', 'mov', 'webm', '3gp'] }) video_formats: VideoFormat[];
  @ApiProperty({ example: 82 }) image_quality: number;
  @ApiProperty({ example: 2048 }) image_max_side: number;
  @ApiProperty({ example: 400 }) thumbnail_side: number;
  @ApiProperty() cleanup_enabled: boolean;
  @ApiProperty() cleanup_paused: boolean;
  @ApiProperty({ example: 1 }) retention_value: number;
  @ApiProperty({ enum: RETENTION_UNITS, example: 'years' }) retention_unit: RetentionUnit;
  @ApiProperty({ enum: CLEANUP_FREQUENCIES, example: 'daily' }) cleanup_frequency: CleanupFrequency;
  @ApiProperty({ example: '02:00' }) cleanup_time: string;
  @ApiProperty({ example: 1 }) cleanup_weekday: number;
  @ApiProperty({ example: 1 }) cleanup_month_day: number;
  @ApiProperty({ example: 'Asia/Kolkata' }) time_zone: string;
  @ApiProperty({ example: 30 }) notice_days: number;
  @ApiProperty({ example: 30 }) recovery_days: number;
  @ApiProperty() auto_trash_enabled: boolean;
  @ApiProperty() permanent_delete_enabled: boolean;
  @ApiProperty() delete_empty_albums: boolean;
  @ApiProperty() purge_orphans: boolean;
  @ApiProperty() purge_stale_uploads: boolean;
  @ApiProperty() notify_in_app: boolean;
  @ApiProperty() notify_email: boolean;
  @ApiProperty({ type: [String], example: ['ADMIN', 'PRINCIPAL'] }) notify_roles: string[];
  @ApiProperty({ nullable: true, type: Date }) next_cleanup_at: Date | null;
  @ApiProperty({ nullable: true, type: Date }) last_cleanup_at: Date | null;
  @ApiProperty({ example: 'local', description: 'Storage provider (STORAGE_DRIVER on the server)' })
  storage_driver: string;
  @ApiProperty({ example: 200, description: 'Largest single upload the server accepts (GALLERY_MAX_UPLOAD_MB)' })
  server_upload_limit_mb: number;
  @ApiProperty({
    example: false,
    description: 'false: video stills are uploaded by the app (poster) and duration is read from MP4/MOV headers',
  })
  server_video_processing: boolean;
  @ApiProperty({ nullable: true, type: Date }) updated_at: Date | null;
}

export class CategoryInputDto {
  @ApiProperty({ example: 'Science fair' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CategoryUpdateDto {
  @ApiPropertyOptional({ example: 'Science fair' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CategoryQueryDto {
  @ApiPropertyOptional({ example: false, description: 'true also lists switched-off categories' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  all?: boolean;
}

export class CategoryDto {
  @ApiProperty({ example: 2 }) id: number;
  @ApiProperty({ example: 'sports', nullable: true, type: String }) key: string | null;
  @ApiProperty({ example: 'Sports' }) name: string;
  @ApiProperty({ example: 2 }) sort_order: number;
  @ApiProperty({ example: true }) is_active: boolean;
  @ApiProperty({ example: 14 }) album_count: number;
}

export class PolicyInputDto {
  @ApiProperty({ example: 'Keep annual day for 5 years' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @ApiProperty({
    enum: POLICY_TARGETS,
    example: 'category',
    description:
      'What the policy covers. The most specific wins: album, archived albums, category, academic year, gallery (scope), media type, then the default.',
  })
  @IsIn(POLICY_TARGETS)
  target: PolicyTarget;

  @ApiPropertyOptional({ example: 9 })
  @ValidateIf((dto: PolicyInputDto) => dto.target === 'album')
  @IsInt()
  album_id?: number;

  @ApiPropertyOptional({ example: 4 })
  @ValidateIf((dto: PolicyInputDto) => dto.target === 'category')
  @IsInt()
  category_id?: number;

  @ApiPropertyOptional({ example: 5 })
  @ValidateIf((dto: PolicyInputDto) => dto.target === 'academic_year')
  @IsInt()
  academic_year_id?: number;

  @ApiPropertyOptional({ enum: ALBUM_SCOPES, description: 'school = App Media Gallery' })
  @ValidateIf((dto: PolicyInputDto) => dto.target === 'scope')
  @IsIn(ALBUM_SCOPES)
  scope?: AlbumScope;

  @ApiPropertyOptional({ enum: MEDIA_TYPES })
  @ValidateIf((dto: PolicyInputDto) => dto.target === 'media_type')
  @IsIn(MEDIA_TYPES)
  media_type?: MediaType;

  @ApiPropertyOptional({ example: 5, minimum: 1, maximum: 3650 })
  @ValidateIf((dto: PolicyInputDto) => !dto.keep_forever)
  @IsInt()
  @Min(1)
  @Max(3650)
  retention_value?: number;

  @ApiPropertyOptional({ enum: RETENTION_UNITS, example: 'years' })
  @ValidateIf((dto: PolicyInputDto) => !dto.keep_forever)
  @IsIn(RETENTION_UNITS)
  retention_unit?: RetentionUnit;

  @ApiPropertyOptional({ default: false, description: 'Never delete automatically' })
  @IsOptional()
  @IsBoolean()
  keep_forever?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ description: 'Needed when the policy shortens retention' })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

export class PolicyUpdateDto {
  @ApiPropertyOptional({ example: 'Keep annual day for 5 years' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ example: 5, minimum: 1, maximum: 3650 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  retention_value?: number;

  @ApiPropertyOptional({ enum: RETENTION_UNITS })
  @IsOptional()
  @IsIn(RETENTION_UNITS)
  retention_unit?: RetentionUnit;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  keep_forever?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ description: 'Needed when the change shortens retention' })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

export class PolicyDto {
  @ApiProperty({ example: 3 }) id: number;
  @ApiProperty({ example: 'Keep annual day for 5 years' }) name: string;
  @ApiProperty({ enum: POLICY_TARGETS, example: 'category' }) target: PolicyTarget;
  @ApiProperty({ example: null, nullable: true, type: Number }) album_id: number | null;
  @ApiProperty({ example: 4, nullable: true, type: Number }) category_id: number | null;
  @ApiProperty({ example: null, nullable: true, type: Number }) academic_year_id: number | null;
  @ApiProperty({ enum: ALBUM_SCOPES, nullable: true, example: null }) scope: AlbumScope | null;
  @ApiProperty({ enum: MEDIA_TYPES, nullable: true, example: null }) media_type: MediaType | null;
  @ApiProperty({ example: 'Category: Annual day' }) applies_to: string;
  @ApiProperty({ example: 5, nullable: true, type: Number }) retention_value: number | null;
  @ApiProperty({ enum: RETENTION_UNITS, nullable: true, example: 'years' }) retention_unit: RetentionUnit | null;
  @ApiProperty({ example: false }) keep_forever: boolean;
  @ApiProperty({ example: true }) is_active: boolean;
  @ApiProperty({ example: 120, description: 'Media whose retention comes from this policy now' }) media_count: number;
  @ApiProperty({ example: '2026-11-20T10:00:00.000+05:30' }) updated_at: Date;
}

export class RetentionOverviewDto {
  @ApiProperty({ example: 1 }) default_value: number;
  @ApiProperty({ enum: RETENTION_UNITS, example: 'years' }) default_unit: RetentionUnit;
  @ApiProperty({ type: [PolicyDto] }) policies: PolicyDto[];
  @ApiProperty({ example: 1800, description: 'Media on the default retention' }) default_media_count: number;
  @ApiProperty({ example: 40, description: 'Media kept forever by a policy' }) kept_forever: number;
}

export class HoldInputDto {
  @ApiPropertyOptional({ example: 9, description: 'Protect a whole album (send album_id or media_id)' })
  @ValidateIf((dto: HoldInputDto) => dto.media_id === undefined)
  @IsInt()
  album_id?: number;

  @ApiPropertyOptional({ example: 88 })
  @ValidateIf((dto: HoldInputDto) => dto.album_id === undefined)
  @IsInt()
  media_id?: number;

  @ApiProperty({ example: 'School 50th anniversary: keep for the archive' })
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason: string;

  @IsNullableDate('2030-03-31')
  keep_until?: string | null;
}

export class ReleaseHoldDto {
  @ApiProperty({ example: 'Archive copy made' })
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason: string;

  @ApiPropertyOptional({
    description: 'Needed when the protected media is already past its retention: it will be scheduled for Trash',
  })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

export class HoldQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ example: 9 })
  @IsOptional()
  @IsInt()
  album_id?: number;

  @ApiPropertyOptional({ example: 88 })
  @IsOptional()
  @IsInt()
  media_id?: number;
}

export class HoldDto {
  @ApiProperty({ example: 4 }) id: number;
  @ApiProperty({ enum: ['hold', 'extension', 'permanent'], example: 'extension' })
  kind: 'hold' | 'extension' | 'permanent';
  @ApiProperty({ example: 9, nullable: true, type: Number }) album_id: number | null;
  @ApiProperty({ example: 'Annual Day 2026', nullable: true, type: String }) album_title: string | null;
  @ApiProperty({ example: null, nullable: true, type: Number }) media_id: number | null;
  @ApiProperty({ example: null, nullable: true, type: String }) media_name: string | null;
  @ApiProperty({ example: 'School 50th anniversary' }) reason: string;
  @ApiProperty({ example: '2030-03-31', nullable: true, type: String, description: 'null = kept until released' })
  keep_until: string | null;
  @ApiProperty({ example: true }) is_active: boolean;
  @ApiProperty({ example: 'Admin', nullable: true, type: String }) applied_by_name: string | null;
  @ApiProperty({ example: '2026-11-20T10:00:00.000+05:30' }) applied_at: Date;
  @ApiProperty({ nullable: true, type: String }) released_by_name: string | null;
  @ApiProperty({ nullable: true, type: Date }) released_at: Date | null;
  @ApiProperty({ nullable: true, type: String }) release_reason: string | null;
}

export class CleanupPreviewItemDto {
  @ApiProperty({ enum: ['mark', 'trash', 'purge', 'album_trash', 'album_purge'], example: 'trash' })
  action: 'mark' | 'trash' | 'purge' | 'album_trash' | 'album_purge';
  @ApiProperty({ example: 88 }) id: number;
  @ApiProperty({ example: 'IMG_2041.jpg' }) name: string;
  @ApiProperty({ example: 'Sports Day 2025', nullable: true, type: String }) album_title: string | null;
  @ApiProperty({ example: 482113 }) size_bytes: number;
  @ApiProperty({ nullable: true, type: Date }) due_at: Date | null;
}

export class CleanupPreviewDto {
  @ApiProperty({ example: 2140 }) scanned: number;
  @ApiProperty({ example: 14, description: 'Will be marked and get the deletion notice' }) to_mark: number;
  @ApiProperty({ example: 3, description: 'Marked earlier, notice period over: moved to Trash' }) to_trash: number;
  @ApiProperty({ example: 6, description: 'Recovery period over: deleted for good' }) to_purge: number;
  @ApiProperty({ example: 1 }) albums_to_trash: number;
  @ApiProperty({ example: 0 }) albums_to_purge: number;
  @ApiProperty({ example: 40, description: 'Past retention but protected by a hold' }) held: number;
  @ApiProperty({ example: 2936012 }) bytes_to_reclaim: number;
  @ApiProperty({ example: true }) permanent_delete_enabled: boolean;
  @ApiProperty({ example: true }) auto_trash_enabled: boolean;
  @ApiProperty({ type: [CleanupPreviewItemDto], description: 'Up to 100 items' }) items: CleanupPreviewItemDto[];
}

export class CleanupJobDto {
  @ApiProperty({ example: 17 }) id: number;
  @ApiProperty({ enum: JOB_TRIGGERS, example: 'schedule' }) trigger: JobTrigger;
  @ApiProperty({ enum: JOB_STATUSES, example: 'completed' }) status: JobStatus;
  @ApiProperty({ example: '2026-11-20T02:00:00.000+05:30' }) started_at: Date;
  @ApiProperty({ nullable: true, type: Date }) finished_at: Date | null;
  @ApiProperty({ example: 820, nullable: true, type: Number }) duration_ms: number | null;
  @ApiProperty({ example: 2140 }) scanned: number;
  @ApiProperty({ example: 14 }) marked: number;
  @ApiProperty({ example: 1, description: 'Marked earlier but no longer due (hold or longer policy)' })
  unmarked: number;
  @ApiProperty({ example: 3 }) trashed: number;
  @ApiProperty({ example: 6 }) purged: number;
  @ApiProperty({ example: 0 }) failed: number;
  @ApiProperty({ example: 40 }) held: number;
  @ApiProperty({ example: 1 }) albums_trashed: number;
  @ApiProperty({ example: 0 }) albums_purged: number;
  @ApiProperty({ example: 0 }) orphans_removed: number;
  @ApiProperty({ example: 2 }) uploads_cleared: number;
  @ApiProperty({ example: 2936012 }) bytes_reclaimed: number;
  @ApiProperty({ example: 734003200, nullable: true, type: Number }) storage_bytes_after: number | null;
  @ApiProperty({ nullable: true, type: String }) error: string | null;
  @ApiProperty({ example: null, nullable: true, type: String }) triggered_by_name: string | null;
  @ApiProperty({ example: null, nullable: true, type: Number }) retry_of_job_id: number | null;
  @ApiProperty({ example: 0, description: 'Failed items not retried yet' }) retryable: number;
}

export class CleanupJobItemDto {
  @ApiProperty({ example: 301 }) id: number;
  @ApiProperty({ enum: JOB_ACTIONS, example: 'purged' }) action: JobAction;
  @ApiProperty({ example: 88, nullable: true, type: Number }) media_id: number | null;
  @ApiProperty({ example: 9, nullable: true, type: Number }) album_id: number | null;
  @ApiProperty({ example: 'IMG_2041.jpg', nullable: true, type: String }) name: string | null;
  @ApiProperty({ example: 482113 }) size_bytes: number;
  @ApiProperty({ nullable: true, type: String }) error: string | null;
  @ApiProperty({ nullable: true, type: Number }) retried_job_id: number | null;
  @ApiProperty({ example: '2026-11-20T02:00:01.000+05:30' }) created_at: Date;
}

export class CleanupStatusDto {
  @ApiProperty({ example: true }) cleanup_enabled: boolean;
  @ApiProperty({ example: false }) paused: boolean;
  @ApiProperty({ example: false }) running: boolean;
  @ApiProperty({ nullable: true, type: Date }) next_cleanup_at: Date | null;
  @ApiProperty({ nullable: true, type: CleanupJobDto }) last_job: CleanupJobDto | null;
  @ApiProperty({ example: 0, description: 'Failed items across jobs that can be retried' }) retryable: number;
}

export class JobQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: JOB_STATUSES })
  @IsOptional()
  @IsIn(JOB_STATUSES)
  status?: JobStatus;
}

export class JobItemQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: JOB_ACTIONS })
  @IsOptional()
  @IsIn(JOB_ACTIONS)
  action?: JobAction;
}

export class RunCleanupDto {
  @ApiProperty({ example: true, description: 'Must be true. Call GET .../cleanup/preview first and show it.' })
  @IsBoolean()
  confirm: boolean;
}

export class ConfirmQueryDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  confirm?: boolean;
}

export class FormatQueryDto {
  @ApiPropertyOptional({ enum: ['xlsx', 'csv'], default: 'xlsx' })
  @IsOptional()
  @IsIn(['xlsx', 'csv'])
  format: 'xlsx' | 'csv' = 'xlsx';
}
