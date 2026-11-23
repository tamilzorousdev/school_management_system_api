import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { IsDateOnly, IsNullableDate } from '../../../shared/dates';
import {
  ALBUM_SCOPES,
  ALBUM_STATUSES,
  AlbumScope,
  AlbumStatus,
  DELETE_REASONS,
  DeleteReason,
  MEDIA_STATUSES,
  MEDIA_TYPES,
  MediaStatus,
  MediaType,
  VISIBILITIES,
  Visibility,
} from '../entities/gallery.entity';

const toArray = ({ value }: { value: unknown }) =>
  value === undefined || value === null || Array.isArray(value) ? value : [value];

export class AlbumQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: ALBUM_SCOPES, description: 'school = App Media Gallery' })
  @IsOptional()
  @IsIn(ALBUM_SCOPES)
  scope?: AlbumScope;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  class_id?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  section_id?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  category_id?: number;

  @ApiPropertyOptional({ enum: ALBUM_STATUSES })
  @IsOptional()
  @IsIn(ALBUM_STATUSES)
  status?: AlbumStatus;

  @ApiPropertyOptional({ enum: VISIBILITIES })
  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: Visibility;

  @ApiPropertyOptional({ enum: MEDIA_TYPES, description: 'Only albums that hold this kind of media' })
  @IsOptional()
  @IsIn(MEDIA_TYPES)
  media_type?: MediaType;

  @ApiPropertyOptional({ example: 41, description: 'Albums created by this user' })
  @IsOptional()
  @IsInt()
  uploader_id?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional({ example: 'sports day' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  tag?: string;

  @IsDateOnly('2026-08-01', true)
  from?: string;

  @IsDateOnly('2026-08-31', true)
  to?: string;
}

export class CreateAlbumDto {
  @ApiProperty({ enum: ALBUM_SCOPES, example: 'section', description: 'school = App Media Gallery' })
  @IsIn(ALBUM_SCOPES, { message: 'scope must be school, class or section' })
  scope: AlbumScope;

  @ApiPropertyOptional({ example: 3, description: 'Required for class albums' })
  @ValidateIf((dto: CreateAlbumDto) => dto.scope === 'class')
  @IsInt()
  class_id?: number;

  @ApiPropertyOptional({ example: 12, description: 'Required for section albums' })
  @ValidateIf((dto: CreateAlbumDto) => dto.scope === 'section')
  @IsInt()
  section_id?: number;

  @ApiPropertyOptional({
    example: 5,
    description: 'Defaults to the current year (section albums use the section year)',
  })
  @IsOptional()
  @IsInt()
  academic_year_id?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  category_id?: number;

  @ApiProperty({ example: 'Sports Day 2026' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  title: string;

  @ApiPropertyOptional({ example: 'Races, relays and the prize ceremony' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsDateOnly('2026-08-14', true)
  event_date?: string;

  @ApiPropertyOptional({ type: [String], example: ['sports', 'relay'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @ApiPropertyOptional({
    enum: VISIBILITIES,
    description:
      'School albums: everyone, staff, parents or classes (with class_ids/section_ids). Class and section albums: everyone (that class or section and its teachers) or staff. Defaults to the school setting.',
  })
  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: Visibility;

  @ApiPropertyOptional({ type: [Number], example: [3, 4] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  class_ids?: number[];

  @ApiPropertyOptional({ type: [Number], example: [12] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsInt({ each: true })
  section_ids?: number[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  allow_download?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Admins only' })
  @IsOptional()
  @IsBoolean()
  is_featured?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Publish straight away instead of saving a draft' })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

export class UpdateAlbumDto {
  @ApiPropertyOptional({ example: 'Sports Day 2026' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  title?: string;

  @ApiPropertyOptional({ example: 'Races and relays', nullable: true, type: String })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsNullableDate('2026-08-14')
  event_date?: string | null;

  @ApiPropertyOptional({ example: 2, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  category_id?: number | null;

  @ApiPropertyOptional({ type: [String], example: ['sports'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ enum: VISIBILITIES })
  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: Visibility;

  @ApiPropertyOptional({ type: [Number], example: [3] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  class_ids?: number[];

  @ApiPropertyOptional({ type: [Number], example: [12] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsInt({ each: true })
  section_ids?: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allow_download?: boolean;

  @ApiPropertyOptional({ example: 88, nullable: true, type: Number, description: 'A photo or video of this album' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  cover_media_id?: number | null;
}

export class PublishAlbumDto {
  @ApiPropertyOptional({ default: true, description: 'Tell the album audience in the app' })
  @IsOptional()
  @IsBoolean()
  notify?: boolean;
}

export class FeatureAlbumDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  is_featured: boolean;
}

export class DeleteDto {
  @ApiPropertyOptional({ example: 'Wrong class', description: 'Shown in Trash' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class MediaQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: MEDIA_TYPES })
  @IsOptional()
  @IsIn(MEDIA_TYPES)
  media_type?: MediaType;

  @ApiPropertyOptional({ example: 41 })
  @IsOptional()
  @IsInt()
  uploader_id?: number;

  @ApiPropertyOptional({ enum: MEDIA_STATUSES, description: 'pending_deletion = scheduled to go to Trash' })
  @IsOptional()
  @IsIn(MEDIA_STATUSES)
  status?: MediaStatus;

  @IsDateOnly('2026-08-01', true)
  from?: string;

  @IsDateOnly('2026-08-31', true)
  to?: string;
}

export class GalleryMediaQueryDto extends MediaQueryDto {
  @ApiPropertyOptional({ example: 9 })
  @IsOptional()
  @IsInt()
  album_id?: number;

  @ApiPropertyOptional({ enum: ALBUM_SCOPES })
  @IsOptional()
  @IsIn(ALBUM_SCOPES)
  scope?: AlbumScope;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  class_id?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  section_id?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  category_id?: number;

  @ApiPropertyOptional({ example: true, description: 'Only media whose retention ends within the notice period' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  expiring?: boolean;
}

export const UPLOAD_MEDIA_SCHEMA = {
  type: 'object',
  required: ['files'],
  properties: {
    files: {
      type: 'array',
      items: { type: 'string', format: 'binary' },
      description: 'Photos (JPEG, PNG, WebP) and videos (MP4, MOV, WebM, 3GP), as allowed by the gallery settings',
    },
    checksums: {
      type: 'array',
      items: { type: 'string', example: 'e3b0c442...' },
      description: 'Optional SHA-256 of each file, in the same order, to verify the upload arrived intact',
    },
  },
};

export class UploadMediaDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @ArrayMaxSize(50)
  @Matches(/^([a-f0-9]{64})?$/i, { each: true, message: 'each checksum must be a SHA-256 hex string' })
  checksums?: string[];
}

export const POSTER_SCHEMA = {
  type: 'object',
  required: ['file'],
  properties: { file: { type: 'string', format: 'binary', description: 'A JPEG, PNG or WebP still for the video' } },
};

export class UpdateMediaDto {
  @ApiPropertyOptional({ example: 'Relay final', nullable: true, type: String })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(150)
  title?: string | null;

  @ApiPropertyOptional({ example: 'Class 5A wins the relay', nullable: true, type: String })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;
}

export class BulkMediaDto {
  @ApiProperty({ type: [Number], example: [88, 89] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsInt({ each: true })
  media_ids: number[];

  @ApiPropertyOptional({ example: 'Blurry photos' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class TrashQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: ['media', 'album'], default: 'media' })
  @IsOptional()
  @IsIn(['media', 'album'])
  kind: 'media' | 'album' = 'media';

  @ApiPropertyOptional({ enum: DELETE_REASONS })
  @IsOptional()
  @IsIn(DELETE_REASONS)
  reason?: DeleteReason;

  @ApiPropertyOptional({ enum: MEDIA_TYPES })
  @IsOptional()
  @IsIn(MEDIA_TYPES)
  media_type?: MediaType;

  @ApiPropertyOptional({ enum: ALBUM_SCOPES })
  @IsOptional()
  @IsIn(ALBUM_SCOPES)
  scope?: AlbumScope;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  class_id?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  section_id?: number;

  @ApiPropertyOptional({ example: 9 })
  @IsOptional()
  @IsInt()
  album_id?: number;
}

export class RestoreDto {
  @ApiPropertyOptional({ type: [Number], example: [88] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsInt({ each: true })
  media_ids?: number[];

  @ApiPropertyOptional({ type: [Number], example: [9] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  album_ids?: number[];

  @ApiPropertyOptional({
    example: 14,
    description: 'Put media whose album is gone (or all chosen media) into this album instead',
  })
  @IsOptional()
  @IsInt()
  target_album_id?: number;
}

export class PurgeDto {
  @ApiPropertyOptional({ type: [Number], example: [88] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsInt({ each: true })
  media_ids?: number[];

  @ApiPropertyOptional({ type: [Number], example: [9] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  album_ids?: number[];

  @ApiProperty({ example: true, description: 'Must be true: this cannot be undone' })
  @Equals(true, { message: 'confirm must be true to delete permanently' })
  confirm: boolean;
}

export class ConfirmDto {
  @ApiProperty({ example: true, description: 'Must be true' })
  @Equals(true, { message: 'confirm must be true' })
  confirm: boolean;
}

export class MediaDto {
  @ApiProperty({ example: 88 })
  id: number;

  @ApiProperty({ example: 9 })
  album_id: number;

  @ApiProperty({ enum: MEDIA_TYPES, example: 'image' })
  media_type: MediaType;

  @ApiProperty({ example: 'Relay final', nullable: true, type: String })
  title: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  description: string | null;

  @ApiProperty({ example: 'IMG_2041.jpg' })
  original_name: string;

  @ApiProperty({ example: 'image/jpeg' })
  mime_type: string;

  @ApiProperty({ example: 482113 })
  size_bytes: number;

  @ApiProperty({ example: 2048, nullable: true, type: Number })
  width: number | null;

  @ApiProperty({ example: 1365, nullable: true, type: Number })
  height: number | null;

  @ApiProperty({ example: null, nullable: true, type: Number })
  duration_seconds: number | null;

  @ApiProperty({
    example: 'http://localhost:3000/api/v1/files/gallery/88/content?variant=view&expires=...&signature=...',
  })
  url: string;

  @ApiProperty({ nullable: true, type: String, description: 'Small preview. For videos, the still set with a poster.' })
  thumbnail_url: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'null when downloads are off for the school or album' })
  download_url: string | null;

  @ApiProperty({ example: '2026-11-20T11:00:00.000+05:30' })
  url_expires_at: Date;

  @ApiProperty({ example: 41, nullable: true, type: Number })
  uploaded_by: number | null;

  @ApiProperty({ example: 'Priya R', nullable: true, type: String })
  uploaded_by_name: string | null;

  @ApiProperty({ example: '2026-08-14T16:20:00.000+05:30' })
  created_at: Date;

  @ApiProperty({ enum: MEDIA_STATUSES, example: 'active' })
  status: MediaStatus;

  @ApiProperty({ nullable: true, type: Date, description: 'When retention ends; null = kept forever' })
  expires_at: Date | null;

  @ApiProperty({ nullable: true, type: Date, description: 'When the cleanup moves it to Trash' })
  trash_at: Date | null;

  @ApiProperty({ example: false })
  on_hold: boolean;

  @ApiProperty({ example: true })
  can_delete: boolean;
}

export class AlbumDto {
  @ApiProperty({ example: 9 })
  id: number;

  @ApiProperty({ enum: ALBUM_SCOPES, example: 'section' })
  scope: AlbumScope;

  @ApiProperty({ example: 5 })
  academic_year_id: number;

  @ApiProperty({ example: '2026-27', nullable: true, type: String })
  academic_year: string | null;

  @ApiProperty({ example: 3, nullable: true, type: Number })
  class_id: number | null;

  @ApiProperty({ example: 'Class 5', nullable: true, type: String })
  class_name: string | null;

  @ApiProperty({ example: 12, nullable: true, type: Number })
  section_id: number | null;

  @ApiProperty({ example: 'A', nullable: true, type: String })
  section_name: string | null;

  @ApiProperty({ example: 2, nullable: true, type: Number })
  category_id: number | null;

  @ApiProperty({ example: 'Sports', nullable: true, type: String })
  category: string | null;

  @ApiProperty({ example: 'Sports Day 2026' })
  title: string;

  @ApiProperty({ example: 'Races and relays', nullable: true, type: String })
  description: string | null;

  @ApiProperty({ example: '2026-08-14', nullable: true, type: String })
  event_date: string | null;

  @ApiProperty({ type: [String], example: ['sports'] })
  tags: string[];

  @ApiProperty({ enum: VISIBILITIES, example: 'everyone' })
  visibility: Visibility;

  @ApiProperty({ type: [Number], example: [] })
  class_ids: number[];

  @ApiProperty({ type: [Number], example: [] })
  section_ids: number[];

  @ApiProperty({ enum: ALBUM_STATUSES, example: 'published' })
  status: AlbumStatus;

  @ApiProperty({ example: false })
  is_featured: boolean;

  @ApiProperty({ example: true, description: 'Album setting; downloads also need the school switch on' })
  allow_download: boolean;

  @ApiProperty({ example: 88, nullable: true, type: Number })
  cover_media_id: number | null;

  @ApiProperty({ nullable: true, type: String })
  cover_url: string | null;

  @ApiProperty({ example: 42 })
  photo_count: number;

  @ApiProperty({ example: 3 })
  video_count: number;

  @ApiProperty({ example: 73400320 })
  size_bytes: number;

  @ApiProperty({ example: 41, nullable: true, type: Number })
  created_by: number | null;

  @ApiProperty({ example: 'Priya R', nullable: true, type: String })
  created_by_name: string | null;

  @ApiProperty({ example: '2026-08-14T16:00:00.000+05:30' })
  created_at: Date;

  @ApiProperty({ nullable: true, type: Date })
  published_at: Date | null;

  @ApiProperty({ example: false })
  on_hold: boolean;

  @ApiProperty({ example: true })
  can_manage: boolean;
}

export class ViewerOptionsDto {
  @ApiProperty({ example: true })
  slideshow_enabled: boolean;

  @ApiProperty({ example: true })
  downloads_enabled: boolean;

  @ApiProperty({ example: true })
  sharing_enabled: boolean;

  @ApiProperty({ example: true })
  videos_enabled: boolean;
}

export class AlbumDetailDto extends AlbumDto {
  @ApiProperty({ type: ViewerOptionsDto })
  viewer: ViewerOptionsDto;
}

export class UploadItemDto {
  @ApiProperty({ example: 0 })
  index: number;

  @ApiProperty({ example: 'IMG_2041.jpg' })
  name: string;

  @ApiProperty({ enum: ['accepted', 'duplicate', 'failed'], example: 'accepted' })
  status: 'accepted' | 'duplicate' | 'failed';

  @ApiProperty({ example: 88, nullable: true, type: Number })
  media_id: number | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description:
      'FILE_TYPE_NOT_ALLOWED, FILE_TOO_LARGE, VIDEO_TOO_LONG, VIDEOS_DISABLED, IMAGE_INVALID, CHECKSUM_MISMATCH, STORAGE_FULL, DUPLICATE_MEDIA, UPLOAD_FAILED',
  })
  error: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  message: string | null;
}

export class UploadResultDto {
  @ApiProperty({ example: 31 })
  session_id: number;

  @ApiProperty({ example: 3 })
  total: number;

  @ApiProperty({ example: 2 })
  accepted: number;

  @ApiProperty({ example: 1 })
  duplicates: number;

  @ApiProperty({ example: 0 })
  failed: number;

  @ApiProperty({ type: [UploadItemDto], description: 'Per file, in upload order. Retry only the failed ones.' })
  items: UploadItemDto[];

  @ApiProperty({ type: [MediaDto] })
  media: MediaDto[];
}

export class TrashItemDto {
  @ApiProperty({ enum: ['media', 'album'], example: 'media' })
  kind: 'media' | 'album';

  @ApiProperty({ example: 88 })
  id: number;

  @ApiProperty({ example: 'IMG_2041.jpg' })
  name: string;

  @ApiProperty({ enum: MEDIA_TYPES, nullable: true, example: 'image' })
  media_type: MediaType | null;

  @ApiProperty({ example: 9, nullable: true, type: Number })
  album_id: number | null;

  @ApiProperty({ example: 'Sports Day 2026', nullable: true, type: String })
  album_title: string | null;

  @ApiProperty({
    example: true,
    description: 'false when the album is in Trash or gone: restore needs target_album_id',
  })
  album_available: boolean;

  @ApiProperty({ enum: ALBUM_SCOPES, nullable: true, example: 'section' })
  scope: AlbumScope | null;

  @ApiProperty({ example: 'Class 5', nullable: true, type: String })
  class_name: string | null;

  @ApiProperty({ example: 'A', nullable: true, type: String })
  section_name: string | null;

  @ApiProperty({ example: 482113 })
  size_bytes: number;

  @ApiProperty({ example: 12, description: 'Albums: how many items are in Trash with it' })
  item_count: number;

  @ApiProperty({ nullable: true, type: String })
  thumbnail_url: string | null;

  @ApiProperty({ example: '2026-11-01T02:00:00.000+05:30' })
  deleted_at: Date;

  @ApiProperty({ enum: DELETE_REASONS, nullable: true, example: 'retention' })
  deleted_reason: DeleteReason | null;

  @ApiProperty({ example: 'System', nullable: true, type: String })
  deleted_by_name: string | null;

  @ApiProperty({ nullable: true, type: Date, description: 'When it is deleted for good' })
  purge_after: Date | null;
}

export class RestoreResultDto {
  @ApiProperty({ example: 3 })
  media_restored: number;

  @ApiProperty({ example: 1 })
  albums_restored: number;

  @ApiProperty({ type: [Number], example: [], description: 'Media whose album is gone; send target_album_id' })
  needs_album: number[];

  @ApiProperty({ type: [Number], example: [], description: 'Left in Trash: the same file is already in that album' })
  duplicates: number[];
}

export class PurgeResultDto {
  @ApiProperty({ example: 3 })
  media_purged: number;

  @ApiProperty({ example: 1 })
  albums_purged: number;

  @ApiProperty({ example: 0 })
  failed: number;

  @ApiProperty({ example: 1468006 })
  bytes_reclaimed: number;
}

export class CountByDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Class 5 - A' })
  name: string;

  @ApiProperty({ example: 120 })
  photos: number;

  @ApiProperty({ example: 4 })
  videos: number;

  @ApiProperty({ example: 104857600 })
  size_bytes: number;
}

export class DashboardQueryDto {
  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  academic_year_id?: number;

  @IsDateOnly('2026-06-01', true)
  from?: string;

  @IsDateOnly('2026-11-30', true)
  to?: string;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  class_id?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  section_id?: number;

  @ApiPropertyOptional({ example: 9 })
  @IsOptional()
  @IsInt()
  album_id?: number;

  @ApiPropertyOptional({ enum: MEDIA_TYPES })
  @IsOptional()
  @IsIn(MEDIA_TYPES)
  media_type?: MediaType;

  @ApiPropertyOptional({ example: 41 })
  @IsOptional()
  @IsInt()
  uploader_id?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  category_id?: number;
}

export class StorageDto {
  @ApiProperty({ example: 'local' })
  driver: string;

  @ApiProperty({ example: 734003200 })
  used_bytes: number;

  @ApiProperty({ example: 24117248, description: 'Part of used_bytes that sits in Trash' })
  trash_bytes: number;

  @ApiProperty({ example: 21474836480 })
  quota_bytes: number;

  @ApiProperty({ example: 20740833280 })
  remaining_bytes: number;

  @ApiProperty({ example: 3.4 })
  used_percent: number;

  @ApiProperty({ enum: ['ok', 'warning', 'full'], example: 'ok' })
  level: 'ok' | 'warning' | 'full';
}

export class GalleryDashboardDto {
  @ApiProperty({ example: 48 })
  albums: number;

  @ApiProperty({ example: 2140 })
  photos: number;

  @ApiProperty({ example: 37 })
  videos: number;

  @ApiProperty({ type: StorageDto })
  storage: StorageDto;

  @ApiProperty({ example: 212 })
  uploaded_this_month: number;

  @ApiProperty({ example: 18, description: 'Retention ends within the notice period, not yet marked' })
  expiring_soon: number;

  @ApiProperty({ example: 6, description: 'Marked by the cleanup; goes to Trash on trash_at' })
  scheduled_for_deletion: number;

  @ApiProperty({ example: 11, description: 'In Trash, waiting for permanent deletion' })
  pending_deletion: number;

  @ApiProperty({ example: 40, description: 'Media protected by an active retention hold' })
  on_hold: number;

  @ApiProperty({ type: [CountByDto] })
  by_class: CountByDto[];

  @ApiProperty({ type: [CountByDto] })
  by_section: CountByDto[];

  @ApiProperty({ type: [MediaDto] })
  recent: MediaDto[];
}

export const REPORTS = [
  'class_usage',
  'section_usage',
  'album_counts',
  'category_usage',
  'upload_activity',
  'user_uploads',
  'storage',
  'expiring',
  'deleted',
  'restored',
  'purged',
  'cleanup_activity',
  'cleanup_failures',
] as const;
export type ReportName = (typeof REPORTS)[number];

export class ReportQueryDto {
  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  academic_year_id?: number;

  @IsDateOnly('2026-06-01', true)
  from?: string;

  @IsDateOnly('2026-11-30', true)
  to?: string;
}

export class ExportQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({ enum: ['xlsx', 'csv'], default: 'xlsx' })
  @IsOptional()
  @IsIn(['xlsx', 'csv'])
  format: 'xlsx' | 'csv' = 'xlsx';
}

export class ReportColumnDto {
  @ApiProperty({ example: 'photos' })
  key: string;

  @ApiProperty({ example: 'Photos' })
  label: string;
}

export class GalleryReportDto {
  @ApiProperty({ enum: REPORTS, example: 'class_usage' })
  report: ReportName;

  @ApiProperty({ example: 'Class-wise gallery usage' })
  title: string;

  @ApiProperty({ type: [ReportColumnDto] })
  columns: ReportColumnDto[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    example: [{ class_name: 'Class 5', albums: 4, photos: 120, videos: 3, size_bytes: 104857600 }],
  })
  rows: Record<string, string | number | null>[];
}

export class AuditQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: 'media.deleted' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  action?: string;

  @ApiPropertyOptional({ example: 41 })
  @IsOptional()
  @IsInt()
  user_id?: number;

  @ApiPropertyOptional({ example: 9 })
  @IsOptional()
  @IsInt()
  album_id?: number;

  @ApiPropertyOptional({ example: 88 })
  @IsOptional()
  @IsInt()
  media_id?: number;

  @ApiPropertyOptional({ enum: ['success', 'failure'] })
  @IsOptional()
  @IsIn(['success', 'failure'])
  result?: 'success' | 'failure';

  @IsDateOnly('2026-11-01', true)
  from?: string;

  @IsDateOnly('2026-11-30', true)
  to?: string;
}

export class AuditLogDto {
  @ApiProperty({ example: 501 })
  id: number;

  @ApiProperty({ example: 41, nullable: true, type: Number })
  user_id: number | null;

  @ApiProperty({ example: 'Priya R', nullable: true, type: String })
  user_name: string | null;

  @ApiProperty({ example: 'TEACHER', nullable: true, type: String })
  user_role: string | null;

  @ApiProperty({ example: 'media.uploaded' })
  action: string;

  @ApiProperty({ example: 9, nullable: true, type: Number })
  album_id: number | null;

  @ApiProperty({ example: 88, nullable: true, type: Number })
  media_id: number | null;

  @ApiProperty({ example: 3, nullable: true, type: Number })
  class_id: number | null;

  @ApiProperty({ example: 12, nullable: true, type: Number })
  section_id: number | null;

  @ApiProperty({ enum: ['success', 'failure'], example: 'success' })
  result: 'success' | 'failure';

  @ApiProperty({ type: 'object', additionalProperties: true, example: { files: 3 } })
  details: Record<string, unknown>;

  @ApiProperty({ example: '203.0.113.7', nullable: true, type: String })
  ip: string | null;

  @ApiProperty({ example: '2026-11-20T10:00:00.000+05:30' })
  created_at: Date;
}

export class MobileAlbumQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: ALBUM_SCOPES })
  @IsOptional()
  @IsIn(ALBUM_SCOPES)
  scope?: AlbumScope;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  section_id?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  class_id?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  category_id?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Teacher app: only albums I created' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  mine?: boolean;
}

export class ParentAlbumQueryDto extends MobileAlbumQueryDto {
  @ApiPropertyOptional({ example: 210, description: 'Only albums this child can see' })
  @IsOptional()
  @IsInt()
  student_id?: number;
}

export class ParentCategoryQueryDto {
  @ApiPropertyOptional({ example: 210, description: 'The child whose school to use' })
  @IsOptional()
  @IsInt()
  student_id?: number;
}

export class UploadTargetDto {
  @ApiProperty({ example: 12 })
  section_id: number;

  @ApiProperty({ example: 'A' })
  section_name: string;

  @ApiProperty({ example: 3 })
  class_id: number;

  @ApiProperty({ example: 'Class 5' })
  class_name: string;

  @ApiProperty({ example: 5 })
  academic_year_id: number;

  @ApiProperty({ example: true })
  is_class_teacher: boolean;
}

export class GalleryCategoryOptionDto {
  @ApiProperty({ example: 2 })
  id: number;

  @ApiProperty({ example: 'Sports' })
  name: string;
}

export class UploadOptionsDto {
  @ApiProperty({
    example: true,
    description: 'false when the school switched teacher uploads off or the role may not upload',
  })
  can_upload: boolean;

  @ApiProperty({ type: [UploadTargetDto] })
  targets: UploadTargetDto[];

  @ApiProperty({ type: [GalleryCategoryOptionDto] })
  categories: GalleryCategoryOptionDto[];

  @ApiProperty({ type: [String], example: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'] })
  accepted_types: string[];

  @ApiProperty({ example: 10 })
  max_image_mb: number;

  @ApiProperty({ example: 100, nullable: true, type: Number, description: 'null when videos are off' })
  max_video_mb: number | null;

  @ApiProperty({ example: 300 })
  max_video_seconds: number;

  @ApiProperty({ example: 20 })
  max_files_per_upload: number;

  @ApiProperty({ example: true })
  class_gallery_enabled: boolean;

  @ApiProperty({ example: true })
  section_gallery_enabled: boolean;
}

export class SignedMediaQueryDto {
  @ApiProperty({ enum: ['view', 'thumb', 'download'] })
  @IsIn(['view', 'thumb', 'download'])
  variant: 'view' | 'thumb' | 'download';

  @ApiProperty({ example: 1793611200 })
  @IsInt()
  expires: number;

  @ApiProperty({ example: 41, description: 'Who the link was made for (download audit)' })
  @IsInt()
  user: number;

  @ApiProperty({ example: 'a3f1...' })
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  signature: string;
}
