import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository, SelectQueryBuilder } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { yearClause } from '../../shared/year-context';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AlbumDetailDto,
  AlbumDto,
  AlbumQueryDto,
  CreateAlbumDto,
  GalleryCategoryOptionDto,
  GalleryMediaQueryDto,
  MediaDto,
  MediaQueryDto,
  ParentAlbumQueryDto,
  PurgeDto,
  PurgeResultDto,
  RestoreDto,
  RestoreResultDto,
  TrashItemDto,
  TrashQueryDto,
  UpdateAlbumDto,
  UpdateMediaDto,
  UploadOptionsDto,
  UploadResultDto,
} from './dto/gallery.dto';
import { GalleryAlbum, GalleryMedia, GallerySettings, Visibility } from './entities/gallery.entity';
import { GalleryAccessService, ViewerApp } from './gallery-access.service';
import { GalleryAlertsService } from './gallery-alerts.service';
import { AuditEntry, GalleryAuditService } from './gallery-audit.service';
import { GalleryMediaService, IncomingFile, MediaFlags, PurgeOutcome } from './gallery-media.service';
import { GalleryRetentionService } from './gallery-retention.service';
import { GallerySettingsService } from './gallery-settings.service';
import {
  canDeleteMedia,
  canManageAlbum,
  canUploadTo,
  canViewAlbum,
  DAY_MS,
  normalizeTags,
  Viewer,
  visibilityProblem,
} from './gallery.logic';

interface Context {
  settings: GallerySettings;
  viewer: Viewer;
  user: AuthUser;
  schoolId: number;
}

interface AlbumExtras {
  id: number;
  class_name: string | null;
  section_name: string | null;
  year_name: string | null;
  category: string | null;
  creator: string | null;
}

interface AlbumCounts {
  album_id: number;
  photos: string;
  videos: string;
  size: string;
}

const NOT_STAFF_ROLES = ['PARENT', 'DRIVER', 'ATTENDANT'];
const PURGE_BATCH = 5000;

const rowsOf = <T>(result: unknown): T[] =>
  (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as T[];

@Injectable()
export class GalleryService {
  private readonly logger = new Logger('Gallery');

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(GalleryAlbum) private readonly albums: Repository<GalleryAlbum>,
    @InjectRepository(GalleryMedia) private readonly media: Repository<GalleryMedia>,
    private readonly access: GalleryAccessService,
    private readonly settingsService: GallerySettingsService,
    private readonly retention: GalleryRetentionService,
    private readonly mediaService: GalleryMediaService,
    private readonly audit: GalleryAuditService,
    private readonly alerts: GalleryAlertsService,
    private readonly notifications: NotificationsService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async context(user: AuthUser, schoolId: number, app: ViewerApp, studentId?: number): Promise<Context> {
    const settings = await this.settingsService.forSchool(schoolId);
    const viewer = await this.access.viewer(user, schoolId, app, studentId);
    if (!settings.is_enabled && !viewer.can_view_all) {
      throw AppException.forbidden('The gallery is switched off for this school', 'GALLERY_DISABLED');
    }
    return { settings, viewer, user, schoolId };
  }

  async listAlbums(
    ctx: Context,
    query: AlbumQueryDto | ParentAlbumQueryDto,
    options: { yearScoped: boolean; mine?: boolean } = { yearScoped: false },
  ): Promise<Paginated<AlbumDto>> {
    const qb = this.albums.createQueryBuilder('a').where('a.school_id = :schoolId', { schoolId: ctx.schoolId });
    this.applyAccess(qb, ctx);
    if (options.yearScoped) {
      qb.andWhere(
        `a.academic_year_id = (SELECT y.id FROM academic_years y WHERE y.school_id = a.school_id AND ${yearClause('y')} AND y.deleted_at IS NULL LIMIT 1)`,
      );
    }
    if (options.mine) qb.andWhere('a.created_by = :me', { me: ctx.user.id });
    if (query.scope) qb.andWhere('a.scope = :scope', { scope: query.scope });
    if (query.class_id) qb.andWhere('a.class_id = :classId', { classId: query.class_id });
    if (query.section_id) qb.andWhere('a.section_id = :sectionId', { sectionId: query.section_id });
    if (query.category_id) qb.andWhere('a.category_id = :categoryId', { categoryId: query.category_id });
    if (query.featured !== undefined) qb.andWhere('a.is_featured = :featured', { featured: query.featured });
    if ('status' in query && query.status) qb.andWhere('a.status = :status', { status: query.status });
    if ('visibility' in query && query.visibility) {
      qb.andWhere('a.visibility = :visibility', { visibility: query.visibility });
    }
    if ('uploader_id' in query && query.uploader_id)
      qb.andWhere('a.created_by = :uploader', { uploader: query.uploader_id });
    if ('tag' in query && query.tag) qb.andWhere(':tag = ANY(a.tags)', { tag: query.tag.trim().toLowerCase() });
    if ('from' in query && query.from) {
      qb.andWhere('COALESCE(a.event_date, a.created_at::date) >= :from', { from: query.from });
    }
    if ('to' in query && query.to) qb.andWhere('COALESCE(a.event_date, a.created_at::date) <= :to', { to: query.to });
    if ('media_type' in query && query.media_type) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM gallery_media mt WHERE mt.album_id = a.id AND mt.deleted_at IS NULL AND mt.media_type = :mediaType)',
        { mediaType: query.media_type },
      );
    }
    const page = await listQuery(qb, query, {
      searchable: ['a.title', 'a.description'],
      sortable: {
        created_at: 'a.created_at',
        event_date: 'a.event_date',
        title: 'a.title',
        published_at: 'a.published_at',
      },
      defaultSort: 'created_at',
    });
    return { ...page, items: await this.presentAlbums(page.items, ctx) };
  }

  async getAlbum(ctx: Context, id: number): Promise<AlbumDetailDto> {
    const album = await this.viewable(ctx, id);
    const [dto] = await this.presentAlbums([album], ctx);
    return {
      ...dto!,
      viewer: {
        slideshow_enabled: ctx.settings.slideshow_enabled,
        downloads_enabled: this.downloadsOn(ctx) && album.allow_download,
        sharing_enabled: ctx.settings.sharing_enabled,
        videos_enabled: ctx.settings.videos_enabled,
      },
    };
  }

  async createAlbum(ctx: Context, dto: CreateAlbumDto): Promise<AlbumDetailDto> {
    const { settings, viewer, schoolId, user } = ctx;
    this.assertScopeOn(settings, dto.scope);
    const place = await this.placeFor(schoolId, dto);
    if (!viewer.can_manage_all) {
      if (!this.access.canUploadByRole(user, settings)) {
        throw AppException.forbidden(
          'Your role cannot add albums. Ask the school admin.',
          'GALLERY_UPLOAD_NOT_ALLOWED',
        );
      }
      if (!place.is_current_year) {
        throw AppException.forbidden('Albums can only be added to the current academic year', 'YEAR_READ_ONLY');
      }
      if (!canUploadTo({ scope: dto.scope, ...place }, viewer)) {
        throw AppException.forbidden(
          'You can only add albums for classes and sections you teach',
          'CLASS_NOT_ASSIGNED',
        );
      }
      if (dto.is_featured) throw AppException.forbidden('Only admins can feature albums', 'FEATURE_NOT_ALLOWED');
    }
    const categoryId = await this.checkedCategory(schoolId, dto.category_id);
    const visibility = this.defaultVisibility(dto.scope, dto.visibility ?? settings.default_visibility);
    const audience = await this.checkedAudience(schoolId, dto.scope, visibility, dto.class_ids, dto.section_ids);
    const publish = dto.publish ?? false;
    const album = await this.albums.save(
      this.albums.create({
        school_id: schoolId,
        academic_year_id: place.academic_year_id,
        scope: dto.scope,
        class_id: place.class_id,
        section_id: place.section_id,
        category_id: categoryId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        event_date: dto.event_date ?? null,
        tags: normalizeTags(dto.tags),
        visibility,
        class_ids: audience.class_ids,
        section_ids: audience.section_ids,
        status: publish ? 'published' : 'draft',
        published_at: publish ? new Date() : null,
        is_featured: dto.is_featured ?? false,
        allow_download: dto.allow_download ?? true,
        created_by: user.id,
      }),
    );
    await this.audit.record({
      ...this.auditPlace(ctx, album),
      action: 'album.created',
      details: { title: album.title, scope: album.scope, visibility, status: album.status },
    });
    return this.getAlbum(ctx, album.id);
  }

  async updateAlbum(ctx: Context, id: number, dto: UpdateAlbumDto): Promise<AlbumDetailDto> {
    const album = await this.manageable(ctx, id);
    const changes: Record<string, unknown> = {};
    const set = <K extends keyof GalleryAlbum>(key: K, value: GalleryAlbum[K]) => {
      if (JSON.stringify(album[key]) === JSON.stringify(value)) return;
      changes[key] = { from: album[key], to: value };
      album[key] = value;
    };
    if (dto.title !== undefined) set('title', dto.title.trim());
    if (dto.description !== undefined) set('description', dto.description?.trim() || null);
    if (dto.event_date !== undefined) set('event_date', dto.event_date);
    if (dto.tags !== undefined) set('tags', normalizeTags(dto.tags));
    if (dto.allow_download !== undefined) set('allow_download', dto.allow_download);
    if (dto.category_id !== undefined) {
      set('category_id', dto.category_id === null ? null : await this.checkedCategory(ctx.schoolId, dto.category_id));
    }
    if (dto.visibility !== undefined || dto.class_ids !== undefined || dto.section_ids !== undefined) {
      const visibility = dto.visibility ?? album.visibility;
      const audience = await this.checkedAudience(
        ctx.schoolId,
        album.scope,
        visibility,
        dto.class_ids ?? album.class_ids,
        dto.section_ids ?? album.section_ids,
      );
      set('visibility', visibility);
      set('class_ids', audience.class_ids);
      set('section_ids', audience.section_ids);
    }
    if (dto.cover_media_id !== undefined) {
      if (dto.cover_media_id !== null) {
        const cover = await this.media.findOneBy({ id: dto.cover_media_id, album_id: album.id });
        if (!cover) {
          throw AppException.validation([
            { field: 'cover_media_id', message: 'Choose a photo or video of this album' },
          ]);
        }
      }
      set('cover_media_id', dto.cover_media_id);
    }
    if (!Object.keys(changes).length) return this.getAlbum(ctx, id);
    album.updated_by = ctx.user.id;
    await this.albums.save(album);
    if ('category_id' in changes) await this.retention.refresh(ctx.schoolId, { album_id: album.id });
    await this.audit.record({ ...this.auditPlace(ctx, album), action: 'album.updated', details: { changes } });
    return this.getAlbum(ctx, id);
  }

  async publish(ctx: Context, id: number, notify: boolean): Promise<AlbumDetailDto> {
    const album = await this.manageable(ctx, id);
    if (album.status === 'published') throw AppException.conflict('This album is already published', 'ALBUM_PUBLISHED');
    const wasArchived = album.status === 'archived';
    album.status = 'published';
    album.published_at ??= new Date();
    album.archived_at = null;
    album.updated_by = ctx.user.id;
    await this.albums.save(album);
    if (wasArchived) await this.retention.refresh(ctx.schoolId, { album_id: album.id });
    await this.audit.record({ ...this.auditPlace(ctx, album), action: 'album.published', details: { notify } });
    if (notify && ctx.settings.sharing_enabled) this.shareInBackground(ctx, album);
    return this.getAlbum(ctx, id);
  }

  async unpublish(ctx: Context, id: number): Promise<AlbumDetailDto> {
    const album = await this.manageable(ctx, id);
    if (album.status === 'draft') throw AppException.conflict('This album is already a draft', 'ALBUM_DRAFT');
    const wasArchived = album.status === 'archived';
    album.status = 'draft';
    album.archived_at = null;
    album.updated_by = ctx.user.id;
    await this.albums.save(album);
    if (wasArchived) await this.retention.refresh(ctx.schoolId, { album_id: album.id });
    await this.audit.record({ ...this.auditPlace(ctx, album), action: 'album.unpublished' });
    return this.getAlbum(ctx, id);
  }

  async archive(ctx: Context, id: number): Promise<AlbumDetailDto> {
    const album = await this.manageable(ctx, id);
    if (album.status === 'archived') throw AppException.conflict('This album is already archived', 'ALBUM_ARCHIVED');
    album.status = 'archived';
    album.archived_at = new Date();
    album.updated_by = ctx.user.id;
    await this.albums.save(album);
    await this.retention.refresh(ctx.schoolId, { album_id: album.id });
    await this.audit.record({ ...this.auditPlace(ctx, album), action: 'album.archived' });
    return this.getAlbum(ctx, id);
  }

  async feature(ctx: Context, id: number, featured: boolean): Promise<AlbumDetailDto> {
    const album = await this.manageable(ctx, id);
    if (album.is_featured !== featured) {
      album.is_featured = featured;
      album.updated_by = ctx.user.id;
      await this.albums.save(album);
      await this.audit.record({
        ...this.auditPlace(ctx, album),
        action: featured ? 'album.featured' : 'album.unfeatured',
      });
    }
    return this.getAlbum(ctx, id);
  }

  async share(ctx: Context, id: number): Promise<{ recipients: number }> {
    if (!ctx.settings.sharing_enabled) {
      throw AppException.forbidden('Album sharing is switched off for this school', 'SHARING_DISABLED');
    }
    const album = await this.viewable(ctx, id);
    if (album.status !== 'published')
      throw AppException.conflict('Publish the album before sharing it', 'ALBUM_NOT_PUBLISHED');
    const recipients = await this.notifyAudience(ctx, album);
    await this.audit.record({ ...this.auditPlace(ctx, album), action: 'album.shared', details: { recipients } });
    return { recipients };
  }

  async deleteAlbum(ctx: Context, id: number, note?: string): Promise<void> {
    const album = await this.manageable(ctx, id);
    const now = new Date();
    const purgeAfter = new Date(now.getTime() + ctx.settings.recovery_days * DAY_MS);
    const moved = await this.dataSource.transaction(async (manager) => {
      const media = rowsOf<{ id: number }>(
        await manager.query(
          `UPDATE gallery_media SET deleted_at = $2, deleted_reason = 'album_deleted', deleted_by = $3, purge_after = $4,
                  status = 'active', trash_at = NULL, notice_sent_at = NULL, updated_at = now()
           WHERE album_id = $1 AND deleted_at IS NULL RETURNING id`,
          [album.id, now, ctx.user.id, purgeAfter],
        ),
      );
      await manager.query(
        `UPDATE gallery_albums SET deleted_at = $2, deleted_reason = 'manual', deleted_by = $3, purge_after = $4,
                updated_by = $3, updated_at = now() WHERE id = $1`,
        [album.id, now, ctx.user.id, purgeAfter],
      );
      await this.audit.record(
        {
          ...this.auditPlace(ctx, album),
          action: 'album.deleted',
          details: { title: album.title, media_count: media.length, note: note ?? null, purge_after: purgeAfter },
        },
        manager,
      );
      return media.length;
    });
    this.logger.log(`Album ${album.id} moved to Trash with ${moved} items by user ${ctx.user.id}`);
  }

  async listAlbumMedia(ctx: Context, albumId: number, query: MediaQueryDto): Promise<Paginated<MediaDto>> {
    const album = await this.viewable(ctx, albumId);
    const qb = this.media.createQueryBuilder('m').where('m.album_id = :albumId', { albumId: album.id });
    this.mediaFilters(qb, query);
    const ordered = query.sort
      ? query
      : Object.assign(new MediaQueryDto(), query, { sort: 'sort_order', order: 'asc' });
    const page = await listQuery(qb, ordered, {
      searchable: ['m.title', 'm.original_name', 'm.description'],
      sortable: { sort_order: 'm.sort_order', created_at: 'm.created_at', size_bytes: 'm.size_bytes' },
      defaultSort: 'sort_order',
    });
    return { ...page, items: await this.presentMedia(ctx, page.items, new Map([[album.id, album]])) };
  }

  async listAllMedia(ctx: Context, query: GalleryMediaQueryDto): Promise<Paginated<MediaDto>> {
    const qb = this.media
      .createQueryBuilder('m')
      .innerJoin(GalleryAlbum, 'a', 'a.id = m.album_id AND a.deleted_at IS NULL')
      .where('m.school_id = :schoolId', { schoolId: ctx.schoolId });
    this.applyAccess(qb, ctx);
    this.mediaFilters(qb, query);
    if (query.album_id) qb.andWhere('m.album_id = :albumId', { albumId: query.album_id });
    if (query.scope) qb.andWhere('a.scope = :scope', { scope: query.scope });
    if (query.class_id) qb.andWhere('a.class_id = :classId', { classId: query.class_id });
    if (query.section_id) qb.andWhere('a.section_id = :sectionId', { sectionId: query.section_id });
    if (query.category_id) qb.andWhere('a.category_id = :categoryId', { categoryId: query.category_id });
    if (query.expiring) {
      qb.andWhere(`m.expires_at IS NOT NULL AND m.expires_at <= now() + make_interval(days => :notice)`, {
        notice: ctx.settings.notice_days,
      });
    }
    const page = await listQuery(qb, query, {
      searchable: ['m.title', 'm.original_name', 'a.title'],
      sortable: {
        created_at: 'm.created_at',
        size_bytes: 'm.size_bytes',
        expires_at: 'm.expires_at',
        trash_at: 'm.trash_at',
      },
      defaultSort: 'created_at',
    });
    const albums = await this.albums.findBy({ id: In([...new Set(page.items.map((row) => row.album_id))]) });
    return { ...page, items: await this.presentMedia(ctx, page.items, new Map(albums.map((row) => [row.id, row]))) };
  }

  async getMedia(ctx: Context, id: number): Promise<MediaDto> {
    const row = await this.media.findOneBy({ id, school_id: ctx.schoolId });
    if (!row) throw AppException.notFound('Photo or video not found', 'MEDIA_NOT_FOUND');
    const album = await this.viewable(ctx, row.album_id);
    return (await this.presentMedia(ctx, [row], new Map([[album.id, album]])))[0]!;
  }

  async categoryOptions(ctx: Context): Promise<GalleryCategoryOptionDto[]> {
    const categories = await this.settingsService.listCategories(ctx.schoolId);
    return categories.map((item) => ({ id: item.id, name: item.name }));
  }

  async uploadOptions(ctx: Context): Promise<UploadOptionsDto> {
    const { settings, user } = ctx;
    const allowed = this.access.canUploadByRole(user, settings);
    const targets = allowed ? await this.access.uploadTargets(ctx.schoolId, user) : [];
    const categories = await this.settingsService.listCategories(ctx.schoolId);
    return {
      can_upload:
        allowed && settings.is_enabled && (settings.class_gallery_enabled || settings.section_gallery_enabled),
      targets,
      categories: categories.map((item) => ({ id: item.id, name: item.name })),
      accepted_types: this.mediaService.acceptedTypes(settings),
      max_image_mb: settings.max_image_mb,
      max_video_mb: settings.videos_enabled ? settings.max_video_mb : null,
      max_video_seconds: settings.max_video_seconds,
      max_files_per_upload: settings.max_files_per_upload,
      class_gallery_enabled: settings.class_gallery_enabled,
      section_gallery_enabled: settings.section_gallery_enabled,
    };
  }

  async upload(
    ctx: Context,
    albumId: number,
    files: IncomingFile[],
    checksums: string[] | undefined,
  ): Promise<UploadResultDto> {
    const album = await this.albums.findOneBy({ id: albumId, school_id: ctx.schoolId });
    if (!album || !canViewAlbum(album, ctx.viewer)) throw AppException.notFound('Album not found', 'ALBUM_NOT_FOUND');
    this.assertScopeOn(ctx.settings, album.scope);
    if (album.status === 'archived') {
      throw AppException.conflict('This album is archived. Publish it again to add media.', 'ALBUM_ARCHIVED');
    }
    if (!ctx.viewer.can_manage_all) {
      const current = await this.isCurrentYear(ctx.schoolId, album.academic_year_id);
      const allowed =
        this.access.canUploadByRole(ctx.user, ctx.settings) &&
        current &&
        (canManageAlbum(album, ctx.viewer) || canUploadTo(album, ctx.viewer));
      if (!allowed) throw AppException.forbidden('You cannot add media to this album', 'GALLERY_UPLOAD_NOT_ALLOWED');
    }
    const held = await this.retention.heldIds(ctx.schoolId, todayIn(ctx.settings.time_zone));
    const result = await this.mediaService.upload(album, files, checksums, ctx.settings, ctx.user, {
      downloads: this.downloadsOn(ctx),
      held: held.media,
      heldAlbums: held.albums,
      canDelete: (row) => canDeleteMedia(album, row, ctx.viewer, ctx.settings.teachers_delete_own),
    });
    if (result.accepted) this.alerts.checkStorageQuietly(ctx.schoolId);
    return result;
  }

  async updateMedia(ctx: Context, id: number, dto: UpdateMediaDto): Promise<MediaDto> {
    const { row, album } = await this.editableMedia(ctx, id);
    const changes: Record<string, unknown> = {};
    if (dto.title !== undefined && dto.title !== row.title)
      changes.title = { from: row.title, to: (row.title = dto.title?.trim() || null) };
    if (dto.description !== undefined && dto.description !== row.description) {
      changes.description = { from: row.description, to: (row.description = dto.description?.trim() || null) };
    }
    if (dto.sort_order !== undefined && dto.sort_order !== row.sort_order) {
      changes.sort_order = { from: row.sort_order, to: (row.sort_order = dto.sort_order) };
    }
    if (Object.keys(changes).length) {
      await this.media.save(row);
      await this.audit.record({
        ...this.auditPlace(ctx, album),
        media_id: row.id,
        action: 'media.updated',
        details: { changes },
      });
    }
    return (await this.presentMedia(ctx, [row], new Map([[album.id, album]])))[0]!;
  }

  async setPoster(ctx: Context, id: number, file: IncomingFile | undefined): Promise<MediaDto> {
    const { row, album } = await this.editableMedia(ctx, id);
    const saved = await this.mediaService.setPoster(row, file, ctx.settings);
    await this.audit.record({ ...this.auditPlace(ctx, album), media_id: row.id, action: 'media.poster_set' });
    return (await this.presentMedia(ctx, [saved], new Map([[album.id, album]])))[0]!;
  }

  async deleteMedia(ctx: Context, ids: number[], note?: string): Promise<{ deleted: number }> {
    const rows = await this.media.findBy({ id: In(ids), school_id: ctx.schoolId });
    if (rows.length !== ids.length) throw AppException.notFound('Photo or video not found', 'MEDIA_NOT_FOUND');
    const albums = new Map(
      (await this.albums.findBy({ id: In([...new Set(rows.map((row) => row.album_id))]) })).map((a) => [a.id, a]),
    );
    for (const row of rows) {
      const album = albums.get(row.album_id);
      if (!album || !canViewAlbum(album, ctx.viewer))
        throw AppException.notFound('Photo or video not found', 'MEDIA_NOT_FOUND');
      if (!canDeleteMedia(album, row, ctx.viewer, ctx.settings.teachers_delete_own)) {
        throw AppException.forbidden(`You cannot delete "${row.original_name}"`, 'MEDIA_DELETE_NOT_ALLOWED');
      }
    }
    const now = new Date();
    const purgeAfter = new Date(now.getTime() + ctx.settings.recovery_days * DAY_MS);
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE gallery_media SET deleted_at = $2, deleted_reason = 'manual', deleted_by = $3, purge_after = $4,
                status = 'active', trash_at = NULL, notice_sent_at = NULL, updated_at = now()
         WHERE id = ANY($1::int[]) AND deleted_at IS NULL`,
        [ids, now, ctx.user.id, purgeAfter],
      );
      await manager.query(`UPDATE gallery_albums SET cover_media_id = NULL WHERE cover_media_id = ANY($1::int[])`, [
        ids,
      ]);
      await this.audit.recordMany(
        rows.map((row) => ({
          ...this.auditPlace(ctx, albums.get(row.album_id)!),
          media_id: row.id,
          action: 'media.deleted',
          details: { name: row.original_name, note: note ?? null, purge_after: purgeAfter },
        })),
        manager,
      );
    });
    return { deleted: rows.length };
  }

  async listTrash(ctx: Context, query: TrashQueryDto): Promise<Paginated<TrashItemDto>> {
    return query.kind === 'album' ? this.trashedAlbums(ctx, query) : this.trashedMedia(ctx, query);
  }

  async restore(ctx: Context, dto: RestoreDto): Promise<RestoreResultDto> {
    const result: RestoreResultDto = { media_restored: 0, albums_restored: 0, needs_album: [], duplicates: [] };
    const albumIds = dto.album_ids ?? [];
    const mediaIds = dto.media_ids ?? [];
    if (!albumIds.length && !mediaIds.length) {
      throw AppException.validation([{ field: 'media_ids', message: 'Choose media or albums to restore' }]);
    }
    const target = dto.target_album_id ? await this.restoreTarget(ctx, dto.target_album_id) : null;
    const audits: AuditEntry[] = [];
    const restoredMedia: number[] = [];
    await this.dataSource.transaction(async (manager) => {
      if (albumIds.length) {
        const trashed = await manager.find(GalleryAlbum, {
          where: { id: In(albumIds), school_id: ctx.schoolId, deleted_at: Not(IsNull()) },
          withDeleted: true,
        });
        if (trashed.length !== albumIds.length)
          throw AppException.notFound('Album not found in Trash', 'ALBUM_NOT_IN_TRASH');
        for (const album of trashed) {
          const media = rowsOf<{ id: number }>(
            await manager.query(
              `UPDATE gallery_media SET deleted_at = NULL, deleted_reason = NULL, deleted_by = NULL, purge_after = NULL,
                      status = 'active', trash_at = NULL, notice_sent_at = NULL, updated_at = now()
               WHERE album_id = $1 AND deleted_reason = 'album_deleted' AND deleted_at = $2
                 AND NOT EXISTS (SELECT 1 FROM gallery_media d WHERE d.album_id = $1 AND d.deleted_at IS NULL
                                   AND d.content_hash = gallery_media.content_hash)
               RETURNING id`,
              [album.id, album.deleted_at],
            ),
          );
          await manager.query(
            `UPDATE gallery_albums SET deleted_at = NULL, deleted_reason = NULL, deleted_by = NULL, purge_after = NULL,
                    updated_by = $2, updated_at = now() WHERE id = $1`,
            [album.id, ctx.user.id],
          );
          restoredMedia.push(...media.map((row) => Number(row.id)));
          result.albums_restored += 1;
          result.media_restored += media.length;
          audits.push({
            ...this.auditPlace(ctx, album),
            action: 'album.restored',
            details: { title: album.title, media_count: media.length },
          });
        }
      }
      if (mediaIds.length) {
        const rows = await manager.find(GalleryMedia, {
          where: { id: In(mediaIds), school_id: ctx.schoolId, deleted_at: Not(IsNull()) },
          withDeleted: true,
        });
        if (rows.length !== mediaIds.length)
          throw AppException.notFound('Item not found in Trash', 'MEDIA_NOT_IN_TRASH');
        const parents = await manager.find(GalleryAlbum, {
          where: { id: In([...new Set(rows.map((row) => row.album_id))]) },
          withDeleted: true,
        });
        const parentById = new Map(parents.map((row) => [row.id, row]));
        for (const row of rows) {
          const parent = parentById.get(row.album_id);
          const home = target ?? (parent && !parent.deleted_at ? parent : null);
          if (!home) {
            result.needs_album.push(row.id);
            continue;
          }
          const clash = await manager.query(
            `SELECT 1 FROM gallery_media WHERE album_id = $1 AND content_hash = $2 AND deleted_at IS NULL LIMIT 1`,
            [home.id, row.content_hash],
          );
          if (clash.length) {
            result.duplicates.push(row.id);
            continue;
          }
          await manager.query(
            `UPDATE gallery_media SET album_id = $2, deleted_at = NULL, deleted_reason = NULL, deleted_by = NULL,
                    purge_after = NULL, status = 'active', trash_at = NULL, notice_sent_at = NULL, updated_at = now()
             WHERE id = $1`,
            [row.id, home.id],
          );
          restoredMedia.push(row.id);
          result.media_restored += 1;
          audits.push({
            ...this.auditPlace(ctx, home),
            media_id: row.id,
            action: 'media.restored',
            details: { name: row.original_name, from_album_id: row.album_id, to_album_id: home.id },
          });
        }
      }
      await this.audit.recordMany(audits, manager);
    });
    if (restoredMedia.length) await this.retention.refresh(ctx.schoolId, { media_ids: restoredMedia });
    return result;
  }

  async purgeSelected(ctx: Context, dto: PurgeDto): Promise<PurgeResultDto> {
    const mediaIds = dto.media_ids ?? [];
    const albumIds = dto.album_ids ?? [];
    if (!mediaIds.length && !albumIds.length) {
      throw AppException.validation([{ field: 'media_ids', message: 'Choose media or albums to delete for good' }]);
    }
    const rows = await this.media.find({
      where: [
        ...(mediaIds.length ? [{ id: In(mediaIds), school_id: ctx.schoolId, deleted_at: Not(IsNull()) }] : []),
        ...(albumIds.length ? [{ album_id: In(albumIds), school_id: ctx.schoolId, deleted_at: Not(IsNull()) }] : []),
      ],
      withDeleted: true,
    });
    if (mediaIds.some((id) => !rows.some((row) => row.id === id))) {
      throw AppException.notFound('Item not found in Trash', 'MEDIA_NOT_IN_TRASH');
    }
    return this.summary(await this.purgeAndAudit(ctx.schoolId, rows, ctx.user, albumIds));
  }

  async emptyTrash(ctx: Context, confirm: boolean): Promise<PurgeResultDto> {
    if (!confirm) throw AppException.conflict('Send confirm: true to empty the Trash', 'CONFIRMATION_REQUIRED');
    const rows = await this.media.find({
      where: { school_id: ctx.schoolId, deleted_at: Not(IsNull()) },
      withDeleted: true,
      order: { id: 'ASC' },
      take: PURGE_BATCH,
    });
    const albums: { id: number }[] = await this.dataSource.query(
      `SELECT id FROM gallery_albums WHERE school_id = $1 AND deleted_at IS NOT NULL`,
      [ctx.schoolId],
    );
    return this.summary(
      await this.purgeAndAudit(
        ctx.schoolId,
        rows,
        ctx.user,
        albums.map((row) => Number(row.id)),
      ),
    );
  }

  async purgeAndAudit(
    schoolId: number,
    rows: GalleryMedia[],
    actor: AuthUser | null,
    albumIds: number[],
  ): Promise<PurgeResultDto & { outcomes: PurgeOutcome[]; purged_album_ids: number[] }> {
    const places = await this.places(rows.map((row) => row.album_id).concat(albumIds));
    const outcomes = await this.mediaService.purge(rows);
    const purgedAlbums = albumIds.length ? await this.purgeEmptyAlbums(schoolId, albumIds) : [];
    const ok = outcomes.filter((item) => !item.error);
    await this.audit.recordMany([
      ...outcomes.map((item) => ({
        school_id: schoolId,
        actor,
        ...(places.get(item.album_id) ?? {}),
        album_id: item.album_id,
        media_id: item.media_id,
        action: 'media.purged',
        result: (item.error ? 'failure' : 'success') as 'success' | 'failure',
        details: { name: item.name, size_bytes: item.size_bytes, by: actor ? 'manual' : 'cleanup', error: item.error },
      })),
      ...purgedAlbums.map((album) => ({
        school_id: schoolId,
        actor,
        ...(places.get(album.id) ?? {}),
        album_id: album.id,
        action: 'album.purged',
        details: { title: album.title, by: actor ? 'manual' : 'cleanup' },
      })),
    ]);
    this.alerts.checkStorageQuietly(schoolId);
    return {
      media_purged: ok.length,
      albums_purged: purgedAlbums.length,
      failed: outcomes.length - ok.length,
      bytes_reclaimed: ok.reduce((sum, item) => sum + item.size_bytes, 0),
      outcomes,
      purged_album_ids: purgedAlbums.map((album) => album.id),
    };
  }

  private summary(result: PurgeResultDto): PurgeResultDto {
    return {
      media_purged: result.media_purged,
      albums_purged: result.albums_purged,
      failed: result.failed,
      bytes_reclaimed: result.bytes_reclaimed,
    };
  }

  async purgeEmptyAlbums(
    schoolId: number,
    albumIds: number[] | null,
    dueOnly = false,
  ): Promise<{ id: number; title: string }[]> {
    const params: unknown[] = [schoolId];
    let filter = '';
    if (albumIds) {
      params.push(albumIds);
      filter += ` AND a.id = ANY($${params.length}::int[])`;
    }
    if (dueOnly) filter += ' AND a.purge_after <= now()';
    return rowsOf<{ id: number; title: string }>(
      await this.dataSource.query(
        `DELETE FROM gallery_albums a
         WHERE a.school_id = $1 AND a.deleted_at IS NOT NULL ${filter}
           AND NOT EXISTS (SELECT 1 FROM gallery_media m WHERE m.album_id = a.id)
           AND NOT EXISTS (SELECT 1 FROM gallery_retention_holds h WHERE h.album_id = a.id AND h.released_at IS NULL)
         RETURNING a.id, a.title`,
        params,
      ),
    );
  }

  private async trashedMedia(ctx: Context, query: TrashQueryDto): Promise<Paginated<TrashItemDto>> {
    const qb = this.media
      .createQueryBuilder('m')
      .withDeleted()
      .innerJoin(GalleryAlbum, 'a', 'a.id = m.album_id')
      .where('m.school_id = :schoolId AND m.deleted_at IS NOT NULL', { schoolId: ctx.schoolId });
    if (query.reason) qb.andWhere('m.deleted_reason = :reason', { reason: query.reason });
    if (query.media_type) qb.andWhere('m.media_type = :mediaType', { mediaType: query.media_type });
    if (query.scope) qb.andWhere('a.scope = :scope', { scope: query.scope });
    if (query.class_id) qb.andWhere('a.class_id = :classId', { classId: query.class_id });
    if (query.section_id) qb.andWhere('a.section_id = :sectionId', { sectionId: query.section_id });
    if (query.album_id) qb.andWhere('m.album_id = :albumId', { albumId: query.album_id });
    const page = await listQuery(qb, query, {
      searchable: ['m.original_name', 'm.title', 'a.title'],
      sortable: { deleted_at: 'm.deleted_at', purge_after: 'm.purge_after', size_bytes: 'm.size_bytes' },
      defaultSort: 'deleted_at',
    });
    const albums = await this.albums.find({
      where: { id: In([...new Set(page.items.map((row) => row.album_id))]) },
      withDeleted: true,
    });
    const albumById = new Map(albums.map((row) => [row.id, row]));
    const extras = await this.albumExtras(albums.map((row) => row.id));
    const names = await this.userNames(page.items.map((row) => row.deleted_by));
    return {
      ...page,
      items: page.items.map((row) => {
        const album = albumById.get(row.album_id);
        const extra = extras.get(row.album_id);
        return {
          kind: 'media',
          id: row.id,
          name: row.title ?? row.original_name,
          media_type: row.media_type,
          album_id: row.album_id,
          album_title: album?.title ?? null,
          album_available: Boolean(album && !album.deleted_at),
          scope: album?.scope ?? null,
          class_name: extra?.class_name ?? null,
          section_name: extra?.section_name ?? null,
          size_bytes: row.size_bytes + row.thumbnail_bytes,
          item_count: 1,
          thumbnail_url: row.thumbnail_key ? this.mediaService.thumbUrl(row.id, ctx.user.id) : null,
          deleted_at: row.deleted_at!,
          deleted_reason: row.deleted_reason,
          deleted_by_name: row.deleted_by ? (names.get(row.deleted_by) ?? null) : 'System',
          purge_after: row.purge_after,
        };
      }),
    };
  }

  private async trashedAlbums(ctx: Context, query: TrashQueryDto): Promise<Paginated<TrashItemDto>> {
    const qb = this.albums
      .createQueryBuilder('a')
      .withDeleted()
      .where('a.school_id = :schoolId AND a.deleted_at IS NOT NULL', { schoolId: ctx.schoolId });
    if (query.reason) qb.andWhere('a.deleted_reason = :reason', { reason: query.reason });
    if (query.scope) qb.andWhere('a.scope = :scope', { scope: query.scope });
    if (query.class_id) qb.andWhere('a.class_id = :classId', { classId: query.class_id });
    if (query.section_id) qb.andWhere('a.section_id = :sectionId', { sectionId: query.section_id });
    const page = await listQuery(qb, query, {
      searchable: ['a.title', 'a.description'],
      sortable: { deleted_at: 'a.deleted_at', purge_after: 'a.purge_after', title: 'a.title' },
      defaultSort: 'deleted_at',
    });
    const ids = page.items.map((row) => row.id);
    const extras = await this.albumExtras(ids);
    const names = await this.userNames(page.items.map((row) => row.deleted_by));
    const counts: { album_id: number; items: string; size: string; thumb: number | null }[] = ids.length
      ? await this.dataSource.query(
          `SELECT album_id, COUNT(*) AS items, COALESCE(SUM(size_bytes + thumbnail_bytes), 0) AS size,
                  MIN(id) FILTER (WHERE thumbnail_key IS NOT NULL) AS thumb
           FROM gallery_media WHERE album_id = ANY($1::int[]) AND deleted_at IS NOT NULL GROUP BY album_id`,
          [ids],
        )
      : [];
    const countById = new Map(counts.map((row) => [Number(row.album_id), row]));
    return {
      ...page,
      items: page.items.map((album) => {
        const extra = extras.get(album.id);
        const count = countById.get(album.id);
        return {
          kind: 'album',
          id: album.id,
          name: album.title,
          media_type: null,
          album_id: album.id,
          album_title: album.title,
          album_available: false,
          scope: album.scope,
          class_name: extra?.class_name ?? null,
          section_name: extra?.section_name ?? null,
          size_bytes: Number(count?.size ?? 0),
          item_count: Number(count?.items ?? 0),
          thumbnail_url: count?.thumb ? this.mediaService.thumbUrl(Number(count.thumb), ctx.user.id) : null,
          deleted_at: album.deleted_at!,
          deleted_reason: album.deleted_reason,
          deleted_by_name: album.deleted_by ? (names.get(album.deleted_by) ?? null) : 'System',
          purge_after: album.purge_after,
        };
      }),
    };
  }

  private applyAccess(qb: SelectQueryBuilder<GalleryAlbum> | SelectQueryBuilder<GalleryMedia>, ctx: Context): void {
    const filter = this.access.albumFilter(ctx.viewer, 'a');
    if (filter) qb.andWhere(filter.sql, filter.params);
    const scopes = this.access.scopeFilter(ctx.settings, ctx.viewer, 'a');
    if (scopes) qb.andWhere(scopes);
  }

  private mediaFilters(qb: SelectQueryBuilder<GalleryMedia>, query: MediaQueryDto): void {
    if (query.media_type) qb.andWhere('m.media_type = :mediaType', { mediaType: query.media_type });
    if (query.uploader_id) qb.andWhere('m.created_by = :uploader', { uploader: query.uploader_id });
    if (query.status) qb.andWhere('m.status = :status', { status: query.status });
    if (query.from) {
      qb.andWhere('m.created_at >= (:from::date)::timestamp AT TIME ZONE :zone', {
        from: query.from,
        zone: this.app.timeZone,
      });
    }
    if (query.to) {
      qb.andWhere('m.created_at < ((:to::date) + 1)::timestamp AT TIME ZONE :zone', {
        to: query.to,
        zone: this.app.timeZone,
      });
    }
  }

  private async viewable(ctx: Context, id: number): Promise<GalleryAlbum> {
    const album = await this.albums.findOneBy({ id, school_id: ctx.schoolId });
    if (!album || !canViewAlbum(album, ctx.viewer)) throw AppException.notFound('Album not found', 'ALBUM_NOT_FOUND');
    const scopes = this.access.scopeFilter(ctx.settings, ctx.viewer);
    if (scopes) this.assertScopeOn(ctx.settings, album.scope);
    return album;
  }

  private async manageable(ctx: Context, id: number): Promise<GalleryAlbum> {
    const album = await this.viewable(ctx, id);
    if (!canManageAlbum(album, ctx.viewer)) {
      throw AppException.forbidden('You cannot change this album', 'ALBUM_MANAGE_NOT_ALLOWED');
    }
    if (!ctx.viewer.can_manage_all && !(await this.isCurrentYear(ctx.schoolId, album.academic_year_id))) {
      throw AppException.forbidden('Albums of past academic years are read-only', 'YEAR_READ_ONLY');
    }
    return album;
  }

  private async editableMedia(ctx: Context, id: number): Promise<{ row: GalleryMedia; album: GalleryAlbum }> {
    const row = await this.media.findOneBy({ id, school_id: ctx.schoolId });
    if (!row) throw AppException.notFound('Photo or video not found', 'MEDIA_NOT_FOUND');
    const album = await this.viewable(ctx, row.album_id);
    const own = row.created_by === ctx.user.id && canUploadTo(album, ctx.viewer);
    if (!canManageAlbum(album, ctx.viewer) && !own) {
      throw AppException.forbidden('You cannot change this photo or video', 'MEDIA_EDIT_NOT_ALLOWED');
    }
    return { row, album };
  }

  private downloadsOn(ctx: Context): boolean {
    return ctx.viewer.can_view_all || ctx.settings.downloads_enabled;
  }

  private assertScopeOn(settings: GallerySettings, scope: GalleryAlbum['scope']): void {
    const on =
      scope === 'school'
        ? settings.app_gallery_enabled
        : scope === 'class'
          ? settings.class_gallery_enabled
          : settings.section_gallery_enabled;
    if (!on) {
      const name =
        scope === 'school' ? 'App Media Gallery' : scope === 'class' ? 'Class-wise Gallery' : 'Section-wise Gallery';
      throw AppException.forbidden(`The ${name} is switched off for this school`, 'GALLERY_SCOPE_DISABLED');
    }
  }

  private defaultVisibility(scope: GalleryAlbum['scope'], wanted: Visibility): Visibility {
    if (scope === 'school') return wanted;
    return wanted === 'staff' ? 'staff' : 'everyone';
  }

  private async placeFor(
    schoolId: number,
    dto: CreateAlbumDto,
  ): Promise<{
    academic_year_id: number;
    class_id: number | null;
    section_id: number | null;
    is_current_year: boolean;
  }> {
    if (dto.scope === 'section') {
      const [section] = await this.dataSource.query(
        `SELECT sec.id, sec.class_id, sec.academic_year_id, y.is_current FROM sections sec
         JOIN academic_years y ON y.id = sec.academic_year_id
         WHERE sec.id = $1 AND sec.school_id = $2 AND sec.deleted_at IS NULL`,
        [dto.section_id, schoolId],
      );
      if (!section) throw AppException.validation([{ field: 'section_id', message: 'Section not found' }]);
      return {
        academic_year_id: Number(section.academic_year_id),
        class_id: Number(section.class_id),
        section_id: Number(section.id),
        is_current_year: Boolean(section.is_current),
      };
    }
    const year = await this.yearFor(schoolId, dto.academic_year_id);
    if (dto.scope === 'class') {
      const [found] = await this.dataSource.query(
        `SELECT id FROM classes WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [dto.class_id, schoolId],
      );
      if (!found) throw AppException.validation([{ field: 'class_id', message: 'Class not found' }]);
      return {
        academic_year_id: year.id,
        class_id: Number(found.id),
        section_id: null,
        is_current_year: year.is_current,
      };
    }
    return { academic_year_id: year.id, class_id: null, section_id: null, is_current_year: year.is_current };
  }

  private async yearFor(schoolId: number, yearId?: number): Promise<{ id: number; is_current: boolean }> {
    const [year] = await this.dataSource.query(
      yearId
        ? `SELECT id, is_current FROM academic_years WHERE id = $2 AND school_id = $1 AND deleted_at IS NULL`
        : `SELECT id, is_current FROM academic_years WHERE school_id = $1 AND is_current AND deleted_at IS NULL LIMIT 1`,
      yearId ? [schoolId, yearId] : [schoolId],
    );
    if (!year) {
      throw yearId
        ? AppException.validation([{ field: 'academic_year_id', message: 'Academic year not found' }])
        : AppException.badRequest('Set the current academic year first', 'NO_CURRENT_YEAR');
    }
    return { id: Number(year.id), is_current: Boolean(year.is_current) };
  }

  private async isCurrentYear(schoolId: number, yearId: number): Promise<boolean> {
    const [row] = await this.dataSource.query(
      `SELECT is_current FROM academic_years WHERE id = $1 AND school_id = $2`,
      [yearId, schoolId],
    );
    return Boolean(row?.is_current);
  }

  private async checkedCategory(schoolId: number, categoryId?: number): Promise<number | null> {
    if (categoryId === undefined) return null;
    const [row] = await this.dataSource.query(
      `SELECT id FROM gallery_categories WHERE id = $1 AND school_id = $2 AND is_active AND deleted_at IS NULL`,
      [categoryId, schoolId],
    );
    if (!row) throw AppException.validation([{ field: 'category_id', message: 'Category not found' }]);
    return Number(row.id);
  }

  private async checkedAudience(
    schoolId: number,
    scope: GalleryAlbum['scope'],
    visibility: Visibility,
    classIds: number[] | null | undefined,
    sectionIds: number[] | null | undefined,
  ): Promise<{ class_ids: number[] | null; section_ids: number[] | null }> {
    const problem = visibilityProblem(scope, visibility, classIds, sectionIds);
    if (problem) throw AppException.validation([{ field: 'visibility', message: problem }]);
    if (scope !== 'school' || visibility !== 'classes') return { class_ids: null, section_ids: null };
    const classes = classIds?.length ? classIds : [];
    const sections = sectionIds?.length ? sectionIds : [];
    if (classes.length) {
      const [{ count }] = await this.dataSource.query(
        `SELECT COUNT(*) AS count FROM classes WHERE id = ANY($1::int[]) AND school_id = $2 AND deleted_at IS NULL`,
        [classes, schoolId],
      );
      if (Number(count) !== classes.length) {
        throw AppException.validation([{ field: 'class_ids', message: 'Some classes were not found' }]);
      }
    }
    if (sections.length) {
      const [{ count }] = await this.dataSource.query(
        `SELECT COUNT(*) AS count FROM sections WHERE id = ANY($1::int[]) AND school_id = $2 AND deleted_at IS NULL`,
        [sections, schoolId],
      );
      if (Number(count) !== sections.length) {
        throw AppException.validation([{ field: 'section_ids', message: 'Some sections were not found' }]);
      }
    }
    return { class_ids: classes.length ? classes : null, section_ids: sections.length ? sections : null };
  }

  private async restoreTarget(ctx: Context, albumId: number): Promise<GalleryAlbum> {
    const album = await this.albums.findOneBy({ id: albumId, school_id: ctx.schoolId });
    if (!album) throw AppException.validation([{ field: 'target_album_id', message: 'Album not found' }]);
    return album;
  }

  private async presentAlbums(rows: GalleryAlbum[], ctx: Context): Promise<AlbumDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const [extras, counts, covers, held] = await Promise.all([
      this.albumExtras(ids),
      this.dataSource.query(
        `SELECT album_id, COUNT(*) FILTER (WHERE media_type = 'image') AS photos,
                COUNT(*) FILTER (WHERE media_type = 'video') AS videos,
                COALESCE(SUM(size_bytes + thumbnail_bytes), 0) AS size
         FROM gallery_media WHERE album_id = ANY($1::int[]) AND deleted_at IS NULL GROUP BY album_id`,
        [ids],
      ) as Promise<AlbumCounts[]>,
      this.dataSource.query(
        `SELECT DISTINCT ON (m.album_id) m.album_id, m.id FROM gallery_media m JOIN gallery_albums a ON a.id = m.album_id
         WHERE m.album_id = ANY($1::int[]) AND m.deleted_at IS NULL AND m.thumbnail_key IS NOT NULL
         ORDER BY m.album_id, (m.id = a.cover_media_id) DESC, m.sort_order, m.id`,
        [ids],
      ) as Promise<{ album_id: number; id: number }[]>,
      this.retention.heldIds(ctx.schoolId, todayIn(ctx.settings.time_zone)),
    ]);
    const countById = new Map(counts.map((row) => [Number(row.album_id), row]));
    const coverById = new Map(covers.map((row) => [Number(row.album_id), Number(row.id)]));
    return rows.map((album) => {
      const extra = extras.get(album.id);
      const count = countById.get(album.id);
      const cover = coverById.get(album.id) ?? null;
      return {
        id: album.id,
        scope: album.scope,
        academic_year_id: album.academic_year_id,
        academic_year: extra?.year_name ?? null,
        class_id: album.class_id,
        class_name: extra?.class_name ?? null,
        section_id: album.section_id,
        section_name: extra?.section_name ?? null,
        category_id: album.category_id,
        category: extra?.category ?? null,
        title: album.title,
        description: album.description,
        event_date: album.event_date,
        tags: album.tags,
        visibility: album.visibility,
        class_ids: album.class_ids ?? [],
        section_ids: album.section_ids ?? [],
        status: album.status,
        is_featured: album.is_featured,
        allow_download: album.allow_download,
        cover_media_id: cover,
        cover_url: cover ? this.mediaService.thumbUrl(cover, ctx.user.id) : null,
        photo_count: Number(count?.photos ?? 0),
        video_count: Number(count?.videos ?? 0),
        size_bytes: Number(count?.size ?? 0),
        created_by: album.created_by,
        created_by_name: extra?.creator ?? null,
        created_at: album.created_at,
        published_at: album.published_at,
        on_hold: held.albums.has(album.id),
        can_manage: canManageAlbum(album, ctx.viewer),
      };
    });
  }

  private async presentMedia(
    ctx: Context,
    rows: GalleryMedia[],
    albums: Map<number, GalleryAlbum>,
  ): Promise<MediaDto[]> {
    if (!rows.length) return [];
    const held = await this.retention.heldIds(ctx.schoolId, todayIn(ctx.settings.time_zone));
    const names = await this.userNames(rows.map((row) => row.created_by));
    const flags: MediaFlags = {
      downloads: this.downloadsOn(ctx),
      held: held.media,
      heldAlbums: held.albums,
      names,
      canDelete: (row) => {
        const album = albums.get(row.album_id);
        return Boolean(album && canDeleteMedia(album, row, ctx.viewer, ctx.settings.teachers_delete_own));
      },
    };
    return rows.map((row) =>
      this.mediaService.present(row, albums.get(row.album_id) ?? { allow_download: false }, ctx.user.id, flags),
    );
  }

  private async albumExtras(ids: number[]): Promise<Map<number, AlbumExtras>> {
    if (!ids.length) return new Map();
    const rows: AlbumExtras[] = await this.dataSource.query(
      `SELECT a.id, c.name AS class_name, sec.name AS section_name, y.name AS year_name, cat.name AS category, u.name AS creator
       FROM gallery_albums a
       LEFT JOIN classes c ON c.id = a.class_id
       LEFT JOIN sections sec ON sec.id = a.section_id
       LEFT JOIN academic_years y ON y.id = a.academic_year_id
       LEFT JOIN gallery_categories cat ON cat.id = a.category_id
       LEFT JOIN users u ON u.id = a.created_by
       WHERE a.id = ANY($1::int[])`,
      [ids],
    );
    return new Map(rows.map((row) => [Number(row.id), row]));
  }

  private async places(
    albumIds: number[],
  ): Promise<Map<number, { class_id: number | null; section_id: number | null }>> {
    const ids = [...new Set(albumIds)];
    if (!ids.length) return new Map();
    const rows: { id: number; class_id: number | null; section_id: number | null }[] = await this.dataSource.query(
      `SELECT id, class_id, section_id FROM gallery_albums WHERE id = ANY($1::int[])`,
      [ids],
    );
    return new Map(rows.map((row) => [Number(row.id), { class_id: row.class_id, section_id: row.section_id }]));
  }

  private async userNames(ids: (number | null)[]): Promise<Map<number, string>> {
    const wanted = [...new Set(ids.filter((id): id is number => typeof id === 'number'))];
    if (!wanted.length) return new Map();
    const rows: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT id, name FROM users WHERE id = ANY($1::int[])`,
      [wanted],
    );
    return new Map(rows.map((row) => [Number(row.id), row.name]));
  }

  private auditPlace(ctx: Context, album: GalleryAlbum): AuditEntry {
    return {
      school_id: ctx.schoolId,
      actor: ctx.user,
      action: '',
      album_id: album.id,
      class_id: album.class_id,
      section_id: album.section_id,
    };
  }

  private shareInBackground(ctx: Context, album: GalleryAlbum): void {
    void this.notifyAudience(ctx, album)
      .then((recipients) =>
        this.audit.record({ ...this.auditPlace(ctx, album), action: 'album.shared', details: { recipients } }),
      )
      .catch((error: Error) => this.logger.warn(`Album ${album.id}: share notice not sent: ${error.message}`));
  }

  private async notifyAudience(ctx: Context, album: GalleryAlbum): Promise<number> {
    const users = (await this.audienceUsers(album)).filter((id) => id !== ctx.user.id);
    if (!users.length) return 0;
    const [count] = await this.dataSource.query(
      `SELECT COUNT(*) AS items FROM gallery_media WHERE album_id = $1 AND deleted_at IS NULL`,
      [album.id],
    );
    const extra = (await this.albumExtras([album.id])).get(album.id);
    const place =
      album.scope === 'section'
        ? `${extra?.class_name ?? 'Class'} - ${extra?.section_name ?? ''}`.trim()
        : album.scope === 'class'
          ? (extra?.class_name ?? 'the class')
          : 'the school';
    for (let index = 0; index < users.length; index += 1000) {
      await this.notifications.dispatch({
        template: TEMPLATES.GALLERY_ALBUM_SHARED,
        audience: { user_ids: users.slice(index, index + 1000) },
        data: { title: album.title, count: Number(count.items), place, album_id: album.id },
      });
    }
    return users.length;
  }

  private async audienceUsers(album: GalleryAlbum): Promise<number[]> {
    const schoolId = album.school_id;
    const year = album.academic_year_id;
    const ids = new Set<number>();
    const add = (rows: { id: number }[]) => rows.forEach((row) => row.id && ids.add(Number(row.id)));
    const staff = () =>
      this.dataSource.query(
        `SELECT u.id FROM users u WHERE u.school_id = $1 AND u.status = 'active' AND u.deleted_at IS NULL
           AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                       WHERE ur.user_id = u.id AND r.code <> ALL($2::text[]))`,
        [schoolId, NOT_STAFF_ROLES],
      );
    const teachers = (sectionIds: number[]) =>
      this.dataSource.query(
        `SELECT teacher_user_id AS id FROM teacher_assignments WHERE section_id = ANY($1::int[]) AND deleted_at IS NULL
         UNION SELECT class_teacher_user_id AS id FROM sections WHERE id = ANY($1::int[]) AND class_teacher_user_id IS NOT NULL`,
        [sectionIds],
      );
    const parents = (where: string, params: unknown[]) =>
      this.dataSource.query(
        `SELECT DISTINCT g.user_id AS id FROM student_enrollments e
         JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
         JOIN student_guardians sg ON sg.student_id = s.id
         JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL AND g.user_id IS NOT NULL
         WHERE e.school_id = $1 AND e.academic_year_id = $2 ${where}`,
        [schoolId, year, ...params],
      );
    const sectionsOfClass = async (classIds: number[]) =>
      (
        (await this.dataSource.query(
          `SELECT id FROM sections WHERE class_id = ANY($1::int[]) AND academic_year_id = $2 AND deleted_at IS NULL`,
          [classIds, year],
        )) as { id: number }[]
      ).map((row) => Number(row.id));

    if (album.scope === 'school') {
      if (album.visibility === 'everyone' || album.visibility === 'staff') add(await staff());
      if (album.visibility === 'everyone' || album.visibility === 'parents') add(await parents('', []));
      if (album.visibility === 'classes') {
        const classIds = album.class_ids ?? [];
        const sectionIds = album.section_ids ?? [];
        add(
          await parents('AND (e.class_id = ANY($3::int[]) OR e.section_id = ANY($4::int[]))', [classIds, sectionIds]),
        );
        add(await teachers([...sectionIds, ...(classIds.length ? await sectionsOfClass(classIds) : [])]));
      }
      return [...ids];
    }
    const sectionIds = album.scope === 'section' ? [album.section_id!] : await sectionsOfClass([album.class_id!]);
    add(await teachers(sectionIds));
    if (album.visibility === 'everyone') {
      add(
        album.scope === 'section'
          ? await parents('AND e.section_id = $3', [album.section_id])
          : await parents('AND e.class_id = $3', [album.class_id]),
      );
    }
    return [...ids];
  }
}

export type { Context as GalleryContext };
