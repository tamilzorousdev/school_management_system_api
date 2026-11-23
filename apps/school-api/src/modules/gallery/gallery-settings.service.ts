import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { storageConfig, StorageConfig } from '../../config/configuration';
import {
  CategoryDto,
  CategoryInputDto,
  CategoryUpdateDto,
  GallerySettingsDto,
  UpdateGallerySettingsDto,
} from './dto/gallery-config.dto';
import { GalleryCategory, GallerySettings } from './entities/gallery.entity';
import { GalleryAuditService } from './gallery-audit.service';
import { DEFAULT_CATEGORIES, isValidTimeZone, nextRunAfter, retentionDays } from './gallery.logic';

const SETTING_KEYS = [
  'is_enabled',
  'app_gallery_enabled',
  'class_gallery_enabled',
  'section_gallery_enabled',
  'videos_enabled',
  'downloads_enabled',
  'sharing_enabled',
  'slideshow_enabled',
  'download_audit_enabled',
  'default_visibility',
  'upload_roles',
  'teachers_delete_own',
  'storage_quota_mb',
  'storage_warning_percent',
  'max_image_mb',
  'max_video_mb',
  'max_video_seconds',
  'max_files_per_upload',
  'image_formats',
  'video_formats',
  'image_quality',
  'image_max_side',
  'thumbnail_side',
  'cleanup_enabled',
  'retention_value',
  'retention_unit',
  'cleanup_frequency',
  'cleanup_time',
  'cleanup_weekday',
  'cleanup_month_day',
  'time_zone',
  'notice_days',
  'recovery_days',
  'auto_trash_enabled',
  'permanent_delete_enabled',
  'delete_empty_albums',
  'purge_orphans',
  'purge_stale_uploads',
  'notify_in_app',
  'notify_email',
  'notify_roles',
] as const;

type SettingKey = (typeof SETTING_KEYS)[number];

const SCHEDULE_KEYS: SettingKey[] = [
  'cleanup_frequency',
  'cleanup_time',
  'cleanup_weekday',
  'cleanup_month_day',
  'time_zone',
];
const RETENTION_KEYS: SettingKey[] = ['retention_value', 'retention_unit'];

export function destructiveChanges(before: GallerySettings, after: GallerySettings): string[] {
  const changes: string[] = [];
  if (
    retentionDays(after.retention_value, after.retention_unit) <
    retentionDays(before.retention_value, before.retention_unit)
  ) {
    changes.push('shorter default retention');
  }
  if (after.notice_days < before.notice_days) changes.push('shorter deletion notice');
  if (after.recovery_days < before.recovery_days) changes.push('shorter recovery period');
  if (after.permanent_delete_enabled && !before.permanent_delete_enabled)
    changes.push('permanent deletion switched on');
  if (after.auto_trash_enabled && !before.auto_trash_enabled) changes.push('automatic deletion switched on');
  if (after.cleanup_enabled && !before.cleanup_enabled) changes.push('automatic cleanup switched on');
  return changes;
}

@Injectable()
export class GallerySettingsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(GallerySettings) private readonly settings: Repository<GallerySettings>,
    @InjectRepository(GalleryCategory) private readonly categories: Repository<GalleryCategory>,
    @Inject(storageConfig.KEY) private readonly storage: StorageConfig,
    private readonly audit: GalleryAuditService,
  ) {}

  get uploadCeilingMb(): number {
    return this.storage.galleryMaxUploadMb;
  }

  async forSchool(schoolId: number): Promise<GallerySettings> {
    const existing = await this.settings.findOneBy({ school_id: schoolId });
    if (existing) return existing;
    const draft = this.settings.create({ school_id: schoolId });
    await this.settings.createQueryBuilder().insert().values(draft).orIgnore().execute();
    const created = await this.settings.findOneByOrFail({ school_id: schoolId });
    if (!created.next_cleanup_at) {
      created.next_cleanup_at = nextRunAfter(created, new Date());
      await this.settings.update(created.id, { next_cleanup_at: created.next_cleanup_at });
    }
    await this.ensureCategories(schoolId);
    return created;
  }

  async view(schoolId: number): Promise<GallerySettingsDto> {
    return this.present(await this.forSchool(schoolId));
  }

  async update(
    schoolId: number,
    dto: UpdateGallerySettingsDto,
    actor: AuthUser,
  ): Promise<{ settings: GallerySettingsDto; retention_changed: boolean }> {
    const before = await this.forSchool(schoolId);
    const after = this.settings.create({ ...before });
    const changed: Partial<Record<SettingKey, { from: unknown; to: unknown }>> = {};
    for (const key of SETTING_KEYS) {
      const value = dto[key];
      if (value === undefined) continue;
      if (JSON.stringify(value) === JSON.stringify(before[key])) continue;
      changed[key] = { from: before[key], to: value };
      Object.assign(after, { [key]: value });
    }
    this.check(after);
    const risky = destructiveChanges(before, after);
    if (risky.length && !dto.confirm) {
      throw AppException.conflict(
        `This change can delete media sooner (${risky.join(', ')}). Send confirm: true to save it.`,
        'CONFIRMATION_REQUIRED',
      );
    }
    if (!Object.keys(changed).length) return { settings: this.present(before), retention_changed: false };
    if (SCHEDULE_KEYS.some((key) => key in changed) || ('cleanup_enabled' in changed && after.cleanup_enabled)) {
      after.next_cleanup_at = nextRunAfter(after, new Date());
    }
    after.updated_by = actor.id;
    const saved = await this.settings.save(after);
    await this.audit.record({
      school_id: schoolId,
      actor,
      action: 'settings.updated',
      details: { changes: changed, confirmed: risky.length ? risky : undefined },
    });
    return {
      settings: this.present(saved),
      retention_changed: RETENTION_KEYS.some((key) => key in changed),
    };
  }

  async reset(schoolId: number, actor: AuthUser, confirm: boolean): Promise<GallerySettingsDto> {
    if (!confirm) throw AppException.conflict('Send confirm: true to reset the settings', 'CONFIRMATION_REQUIRED');
    const before = await this.forSchool(schoolId);
    const defaults = this.settings.create({ school_id: schoolId });
    const fresh = await this.dataSource.transaction(async (manager) => {
      await manager.delete(GallerySettings, { id: before.id });
      await manager.insert(GallerySettings, defaults);
      return manager.findOneByOrFail(GallerySettings, { school_id: schoolId });
    });
    fresh.next_cleanup_at = nextRunAfter(fresh, new Date());
    fresh.last_cleanup_at = before.last_cleanup_at;
    fresh.updated_by = actor.id;
    await this.settings.save(fresh);
    await this.audit.record({
      school_id: schoolId,
      actor,
      action: 'settings.reset',
      details: { previous: this.snapshot(before) },
    });
    return this.present(fresh);
  }

  async setPaused(schoolId: number, paused: boolean, actor: AuthUser): Promise<GallerySettings> {
    const row = await this.forSchool(schoolId);
    if (row.cleanup_paused !== paused) {
      row.cleanup_paused = paused;
      if (!paused) row.next_cleanup_at = nextRunAfter(row, new Date());
      row.updated_by = actor.id;
      await this.settings.save(row);
      await this.audit.record({ school_id: schoolId, actor, action: paused ? 'cleanup.paused' : 'cleanup.resumed' });
    }
    return row;
  }

  present(row: GallerySettings): GallerySettingsDto {
    return {
      ...this.snapshot(row),
      cleanup_paused: row.cleanup_paused,
      next_cleanup_at: row.next_cleanup_at,
      last_cleanup_at: row.last_cleanup_at,
      storage_driver: this.storage.driver,
      server_upload_limit_mb: this.storage.galleryMaxUploadMb,
      server_video_processing: false,
      updated_at: row.updated_at ?? null,
    } as GallerySettingsDto;
  }

  async listCategories(schoolId: number, all = false): Promise<CategoryDto[]> {
    await this.forSchool(schoolId);
    const rows: (GalleryCategory & { album_count: string })[] = await this.dataSource.query(
      `SELECT c.*, (SELECT COUNT(*) FROM gallery_albums a WHERE a.category_id = c.id AND a.deleted_at IS NULL) AS album_count
       FROM gallery_categories c
       WHERE c.school_id = $1 AND c.deleted_at IS NULL ${all ? '' : 'AND c.is_active'}
       ORDER BY c.sort_order, c.name`,
      [schoolId],
    );
    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      sort_order: row.sort_order,
      is_active: row.is_active,
      album_count: Number(row.album_count),
    }));
  }

  async createCategory(schoolId: number, dto: CategoryInputDto, actor: AuthUser): Promise<CategoryDto> {
    await this.assertNameFree(schoolId, dto.name);
    const saved = await this.categories.save(
      this.categories.create({
        school_id: schoolId,
        name: dto.name.trim(),
        sort_order: dto.sort_order ?? 100,
        is_active: dto.is_active ?? true,
      }),
    );
    await this.audit.record({ school_id: schoolId, actor, action: 'category.created', details: { name: saved.name } });
    return {
      id: saved.id,
      key: null,
      name: saved.name,
      sort_order: saved.sort_order,
      is_active: saved.is_active,
      album_count: 0,
    };
  }

  async updateCategory(schoolId: number, id: number, dto: CategoryUpdateDto, actor: AuthUser): Promise<CategoryDto> {
    const row = await this.category(schoolId, id);
    if (dto.name !== undefined && dto.name.trim().toLowerCase() !== row.name.toLowerCase()) {
      await this.assertNameFree(schoolId, dto.name);
    }
    Object.assign(row, {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.sort_order !== undefined ? { sort_order: dto.sort_order } : {}),
      ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
    });
    await this.categories.save(row);
    await this.audit.record({ school_id: schoolId, actor, action: 'category.updated', details: { ...dto } });
    return (await this.listCategories(schoolId, true)).find((item) => item.id === id)!;
  }

  async removeCategory(schoolId: number, id: number, actor: AuthUser): Promise<void> {
    const row = await this.category(schoolId, id);
    const [usage] = await this.dataSource.query(
      `SELECT COUNT(*) AS albums FROM gallery_albums WHERE category_id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (Number(usage.albums) > 0) {
      throw AppException.conflict(
        `${usage.albums} albums use this category. Switch it off instead, or move the albums first.`,
        'CATEGORY_IN_USE',
      );
    }
    await this.categories.softDelete(row.id);
    await this.audit.record({ school_id: schoolId, actor, action: 'category.removed', details: { name: row.name } });
  }

  async category(schoolId: number, id: number): Promise<GalleryCategory> {
    const row = await this.categories.findOneBy({ id, school_id: schoolId });
    if (!row) throw AppException.notFound('Gallery category not found', 'CATEGORY_NOT_FOUND');
    return row;
  }

  private async ensureCategories(schoolId: number): Promise<void> {
    const [{ count }] = await this.dataSource.query(
      `SELECT COUNT(*) AS count FROM gallery_categories WHERE school_id = $1`,
      [schoolId],
    );
    if (Number(count) > 0) return;
    await this.categories
      .createQueryBuilder()
      .insert()
      .values(
        DEFAULT_CATEGORIES.map((item, index) => ({
          school_id: schoolId,
          key: item.key,
          name: item.name,
          sort_order: index + 1,
        })),
      )
      .orIgnore()
      .execute();
  }

  private async assertNameFree(schoolId: number, name: string): Promise<void> {
    const [taken] = await this.dataSource.query(
      `SELECT 1 FROM gallery_categories WHERE school_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL`,
      [schoolId, name.trim()],
    );
    if (taken) throw AppException.conflict('A category with this name already exists', 'CATEGORY_EXISTS');
  }

  private check(row: GallerySettings): void {
    const errors: { field: string; message: string }[] = [];
    if (!isValidTimeZone(row.time_zone))
      errors.push({ field: 'time_zone', message: 'time_zone is not a known time zone' });
    if (row.max_video_mb > this.storage.galleryMaxUploadMb) {
      errors.push({
        field: 'max_video_mb',
        message: `max_video_mb can be at most ${this.storage.galleryMaxUploadMb} on this server`,
      });
    }
    if (row.max_image_mb > this.storage.galleryMaxUploadMb) {
      errors.push({
        field: 'max_image_mb',
        message: `max_image_mb can be at most ${this.storage.galleryMaxUploadMb} on this server`,
      });
    }
    if (row.videos_enabled && !row.video_formats.length) {
      errors.push({ field: 'video_formats', message: 'Allow at least one video format, or switch videos off' });
    }
    if (errors.length) throw AppException.validation(errors);
  }

  private snapshot(row: GallerySettings): Record<SettingKey, unknown> {
    return Object.fromEntries(SETTING_KEYS.map((key) => [key, row[key]])) as Record<SettingKey, unknown>;
  }
}
