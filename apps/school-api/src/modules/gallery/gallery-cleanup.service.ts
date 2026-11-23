import { Injectable, Logger, StreamableFile } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { todayIn } from '../../shared/dates';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import {
  CleanupJobDto,
  CleanupJobItemDto,
  CleanupPreviewDto,
  CleanupPreviewItemDto,
  CleanupStatusDto,
  JobItemQueryDto,
  JobQueryDto,
} from './dto/gallery-config.dto';
import {
  GalleryCleanupJob,
  GalleryCleanupJobItem,
  GalleryMedia,
  GallerySettings,
  JobAction,
  JobTrigger,
} from './entities/gallery.entity';
import { GalleryAlertsService, readableSize } from './gallery-alerts.service';
import { AuditEntry, GalleryAuditService } from './gallery-audit.service';
import { tableFile } from './gallery-export';
import { GalleryMediaService } from './gallery-media.service';
import { GalleryRetentionService, heldSql } from './gallery-retention.service';
import { GallerySettingsService } from './gallery-settings.service';
import { GalleryService } from './gallery.service';
import { nextRunAfter } from './gallery.logic';

const PURGE_BATCH = 5000;
const STALE_UPLOAD_DAYS = 30;

interface Touched {
  id: number;
  album_id: number;
  name: string;
  size: string;
  class_id: number | null;
  section_id: number | null;
  trash_at?: Date | null;
}

interface ItemDraft {
  action: JobAction;
  media_id?: number | null;
  album_id?: number | null;
  name?: string | null;
  size_bytes?: number;
  error?: string | null;
}

const rowsOf = <T>(result: unknown): T[] =>
  (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as T[];

@Injectable()
export class GalleryCleanupService {
  private readonly logger = new Logger('GalleryCleanup');
  private ticking = false;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(GalleryCleanupJob) private readonly jobs: Repository<GalleryCleanupJob>,
    @InjectRepository(GalleryCleanupJobItem) private readonly items: Repository<GalleryCleanupJobItem>,
    @InjectRepository(GalleryMedia) private readonly media: Repository<GalleryMedia>,
    private readonly settings: GallerySettingsService,
    private readonly retention: GalleryRetentionService,
    private readonly mediaService: GalleryMediaService,
    private readonly gallery: GalleryService,
    private readonly audit: GalleryAuditService,
    private readonly alerts: GalleryAlertsService,
  ) {}

  @Interval('gallery-cleanup', 60_000)
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.recoverStale();
      const due: { school_id: number }[] = await this.dataSource.query(
        `SELECT school_id FROM gallery_settings
         WHERE cleanup_enabled AND NOT cleanup_paused AND next_cleanup_at IS NOT NULL AND next_cleanup_at <= now()
         ORDER BY next_cleanup_at LIMIT 20`,
      );
      for (const row of due) {
        await this.run(Number(row.school_id), 'schedule', null).catch((error: Error) =>
          this.logger.error(`School ${row.school_id}: scheduled gallery cleanup failed: ${error.message}`),
        );
      }
    } catch (error) {
      this.logger.error(`Gallery cleanup round failed: ${(error as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  async status(schoolId: number): Promise<CleanupStatusDto> {
    const settings = await this.settings.forSchool(schoolId);
    const last = await this.jobs.findOne({ where: { school_id: schoolId }, order: { started_at: 'DESC' } });
    const [retryable] = await this.dataSource.query(
      `SELECT COUNT(*) AS count FROM gallery_cleanup_job_items WHERE school_id = $1 AND action = 'failed' AND retried_job_id IS NULL`,
      [schoolId],
    );
    return {
      cleanup_enabled: settings.cleanup_enabled,
      paused: settings.cleanup_paused,
      running: last?.status === 'running',
      next_cleanup_at: settings.cleanup_enabled && !settings.cleanup_paused ? settings.next_cleanup_at : null,
      last_job: last ? (await this.presentJobs([last]))[0]! : null,
      retryable: Number(retryable.count),
    };
  }

  async preview(schoolId: number): Promise<CleanupPreviewDto> {
    const settings = await this.settings.forSchool(schoolId);
    await this.retention.refresh(schoolId);
    const today = todayIn(settings.time_zone);
    const params = [schoolId, settings.notice_days, today];
    const held = heldSql('m', '$3');
    const [counts] = await this.dataSource.query(
      `SELECT
         COUNT(*) FILTER (WHERE m.deleted_at IS NULL) AS scanned,
         COUNT(*) FILTER (WHERE m.deleted_at IS NULL AND m.status = 'active' AND m.expires_at IS NOT NULL
                            AND m.expires_at <= now() + make_interval(days => $2) AND NOT ${held}) AS to_mark,
         COUNT(*) FILTER (WHERE m.deleted_at IS NULL AND m.status = 'pending_deletion' AND m.trash_at <= now()
                            AND NOT ${held}) AS to_trash,
         COUNT(*) FILTER (WHERE m.deleted_at IS NOT NULL AND m.purge_after <= now() AND NOT ${held}) AS to_purge,
         COALESCE(SUM(m.size_bytes + m.thumbnail_bytes) FILTER (WHERE m.deleted_at IS NOT NULL AND m.purge_after <= now()
                            AND NOT ${held}), 0) AS bytes,
         COUNT(*) FILTER (WHERE m.deleted_at IS NULL AND m.expires_at IS NOT NULL
                            AND m.expires_at <= now() + make_interval(days => $2) AND ${held}) AS held
       FROM gallery_media m WHERE m.school_id = $1`,
      params,
    );
    const [albums] = await this.dataSource.query(
      `SELECT
         COUNT(*) FILTER (WHERE a.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM gallery_media m WHERE m.album_id = a.id AND m.deleted_at IS NULL)
           AND EXISTS (SELECT 1 FROM gallery_media m WHERE m.album_id = a.id AND m.deleted_reason = 'retention')
           AND NOT EXISTS (SELECT 1 FROM gallery_retention_holds h WHERE h.album_id = a.id AND h.released_at IS NULL
                             AND (h.keep_until IS NULL OR h.keep_until >= $2::date))) AS to_trash,
         COUNT(*) FILTER (WHERE a.deleted_at IS NOT NULL AND a.purge_after <= now()
           AND NOT EXISTS (SELECT 1 FROM gallery_media m WHERE m.album_id = a.id
                             AND NOT (m.deleted_at IS NOT NULL AND m.purge_after <= now()))) AS to_purge
       FROM gallery_albums a WHERE a.school_id = $1`,
      [schoolId, today],
    );
    const items: CleanupPreviewItemDto[] = (
      await this.dataSource.query(
        `SELECT * FROM (
           SELECT 'mark' AS action, m.id, m.original_name AS name, a.title AS album_title,
                  m.size_bytes + m.thumbnail_bytes AS size_bytes, GREATEST(m.expires_at, now() + make_interval(days => $2)) AS due_at
           FROM gallery_media m JOIN gallery_albums a ON a.id = m.album_id
           WHERE m.school_id = $1 AND m.deleted_at IS NULL AND m.status = 'active' AND m.expires_at IS NOT NULL
             AND m.expires_at <= now() + make_interval(days => $2) AND NOT ${held}
           UNION ALL
           SELECT 'trash', m.id, m.original_name, a.title, m.size_bytes + m.thumbnail_bytes, m.trash_at
           FROM gallery_media m JOIN gallery_albums a ON a.id = m.album_id
           WHERE m.school_id = $1 AND m.deleted_at IS NULL AND m.status = 'pending_deletion' AND m.trash_at <= now()
             AND NOT ${held}
           UNION ALL
           SELECT 'purge', m.id, m.original_name, a.title, m.size_bytes + m.thumbnail_bytes, m.purge_after
           FROM gallery_media m JOIN gallery_albums a ON a.id = m.album_id
           WHERE m.school_id = $1 AND m.deleted_at IS NOT NULL AND m.purge_after <= now() AND NOT ${held}
         ) x ORDER BY due_at NULLS LAST, id LIMIT 100`,
        params,
      )
    ).map((row: CleanupPreviewItemDto) => ({ ...row, id: Number(row.id), size_bytes: Number(row.size_bytes) }));
    return {
      scanned: Number(counts.scanned),
      to_mark: settings.auto_trash_enabled ? Number(counts.to_mark) : 0,
      to_trash: settings.auto_trash_enabled ? Number(counts.to_trash) : 0,
      to_purge: settings.permanent_delete_enabled ? Number(counts.to_purge) : 0,
      albums_to_trash: settings.auto_trash_enabled && settings.delete_empty_albums ? Number(albums.to_trash) : 0,
      albums_to_purge: settings.permanent_delete_enabled ? Number(albums.to_purge) : 0,
      held: Number(counts.held),
      bytes_to_reclaim: settings.permanent_delete_enabled ? Number(counts.bytes) : 0,
      permanent_delete_enabled: settings.permanent_delete_enabled,
      auto_trash_enabled: settings.auto_trash_enabled,
      items: items.filter((item) =>
        item.action === 'purge' ? settings.permanent_delete_enabled : settings.auto_trash_enabled,
      ),
    };
  }

  async runNow(schoolId: number, actor: AuthUser, confirm: boolean): Promise<CleanupJobDto> {
    if (!confirm) {
      throw AppException.conflict(
        'Check the preview first, then send confirm: true to run the cleanup',
        'CONFIRMATION_REQUIRED',
      );
    }
    const job = await this.run(schoolId, 'manual', actor);
    return (await this.presentJobs([job]))[0]!;
  }

  async retry(schoolId: number, jobId: number, actor: AuthUser): Promise<CleanupJobDto> {
    await this.job(schoolId, jobId);
    const failed = await this.items.findBy({
      school_id: schoolId,
      job_id: jobId,
      action: 'failed',
      retried_job_id: IsNull(),
    });
    if (!failed.length) throw AppException.conflict('Nothing to retry in this job', 'NOTHING_TO_RETRY');
    const job = await this.start(schoolId, 'retry', actor, jobId);
    const started = Date.now();
    try {
      const mediaIds = failed.map((item) => item.media_id).filter((id): id is number => id !== null);
      const rows = mediaIds.length
        ? await this.media.find({
            where: { id: In(mediaIds), school_id: schoolId, deleted_at: Not(IsNull()) },
            withDeleted: true,
          })
        : [];
      const result = await this.gallery.purgeAndAudit(schoolId, rows, actor, []);
      const drafts: ItemDraft[] = result.outcomes.map((item) => ({
        action: item.error ? 'failed' : 'purged',
        media_id: item.media_id,
        album_id: item.album_id,
        name: item.name,
        size_bytes: item.size_bytes,
        error: item.error,
      }));
      await this.saveItems(job, drafts);
      await this.items.update({ id: In(failed.map((item) => item.id)) }, { retried_job_id: job.id });
      Object.assign(job, {
        scanned: failed.length,
        purged: result.media_purged,
        failed: result.failed,
        bytes_reclaimed: String(result.bytes_reclaimed),
      });
      await this.finish(job, started, null, actor);
    } catch (error) {
      await this.finish(job, started, error as Error, actor);
    }
    return (await this.presentJobs([job]))[0]!;
  }

  async listJobs(schoolId: number, query: JobQueryDto): Promise<Paginated<CleanupJobDto>> {
    const qb = this.jobs.createQueryBuilder('j').where('j.school_id = :schoolId', { schoolId });
    if (query.status) qb.andWhere('j.status = :status', { status: query.status });
    const page = await listQuery(qb, query, {
      searchable: ['j.error'],
      sortable: { started_at: 'j.started_at', duration_ms: 'j.duration_ms' },
      defaultSort: 'started_at',
    });
    return { ...page, items: await this.presentJobs(page.items) };
  }

  async getJob(schoolId: number, id: number): Promise<CleanupJobDto> {
    return (await this.presentJobs([await this.job(schoolId, id)]))[0]!;
  }

  async listItems(schoolId: number, jobId: number, query: JobItemQueryDto): Promise<Paginated<CleanupJobItemDto>> {
    await this.job(schoolId, jobId);
    const qb = this.items.createQueryBuilder('i').where('i.job_id = :jobId', { jobId });
    if (query.action) qb.andWhere('i.action = :action', { action: query.action });
    const page = await listQuery(qb, query, {
      searchable: ['i.name', 'i.error'],
      sortable: { created_at: 'i.created_at', size_bytes: 'i.size_bytes' },
      defaultSort: 'created_at',
    });
    return { ...page, items: page.items.map((row) => this.presentItem(row)) };
  }

  async exportJob(schoolId: number, id: number, format: 'xlsx' | 'csv'): Promise<StreamableFile> {
    const job = (await this.presentJobs([await this.job(schoolId, id)]))[0]!;
    const rows = await this.items.find({ where: { job_id: id }, order: { id: 'ASC' } });
    return tableFile(
      {
        name: `gallery-cleanup-${id}`,
        title: `Gallery cleanup #${id}`,
        subtitle: `${job.status} · started ${job.started_at.toISOString()} · scanned ${job.scanned} · marked ${job.marked} · trashed ${job.trashed} · purged ${job.purged} · failed ${job.failed} · freed ${readableSize(job.bytes_reclaimed)}`,
        columns: [
          { key: 'created_at', label: 'Time' },
          { key: 'action', label: 'Action' },
          { key: 'media_id', label: 'Media ID' },
          { key: 'album_id', label: 'Album ID' },
          { key: 'name', label: 'Name' },
          { key: 'size_bytes', label: 'Size (bytes)' },
          { key: 'error', label: 'Error' },
        ],
        rows: rows.map((row) => ({ ...row })),
      },
      format,
    );
  }

  async run(schoolId: number, trigger: JobTrigger, actor: AuthUser | null): Promise<GalleryCleanupJob> {
    const settings = await this.settings.forSchool(schoolId);
    await this.recoverStale();
    const job = await this.start(schoolId, trigger, actor, null);
    const started = Date.now();
    try {
      await this.cycle(job, settings);
      await this.finish(job, started, null, actor, settings);
    } catch (error) {
      await this.finish(job, started, error as Error, actor, settings);
    }
    return job;
  }

  private async cycle(job: GalleryCleanupJob, settings: GallerySettings): Promise<void> {
    const schoolId = settings.school_id;
    const today = todayIn(settings.time_zone);
    const held = heldSql('m', '$3');
    const base = [schoolId, settings.notice_days, today];
    const drafts: ItemDraft[] = [];
    const audits: AuditEntry[] = [];
    const touched = (action: JobAction, rows: Touched[]) =>
      rows.forEach((row) =>
        drafts.push({ action, media_id: row.id, album_id: row.album_id, name: row.name, size_bytes: Number(row.size) }),
      );
    const returning = `RETURNING m.id, m.album_id, m.original_name AS name, m.size_bytes + m.thumbnail_bytes AS size, m.trash_at,
      (SELECT a.class_id FROM gallery_albums a WHERE a.id = m.album_id) AS class_id,
      (SELECT a.section_id FROM gallery_albums a WHERE a.id = m.album_id) AS section_id`;

    await this.retention.refresh(schoolId);
    const [scan] = await this.dataSource.query(
      `SELECT COUNT(*) AS count FROM gallery_media WHERE school_id = $1 AND deleted_at IS NULL`,
      [schoolId],
    );
    job.scanned = Number(scan.count);

    const unmarked = rowsOf<Touched>(
      await this.dataSource.query(
        `UPDATE gallery_media m SET status = 'active', trash_at = NULL, notice_sent_at = NULL, updated_at = now()
         WHERE m.school_id = $1 AND m.deleted_at IS NULL AND m.status = 'pending_deletion'
           AND ($4::boolean = false OR ${held} OR m.expires_at IS NULL OR m.expires_at > now() + make_interval(days => $2))
         ${returning}`,
        [...base, settings.auto_trash_enabled],
      ),
    );
    job.unmarked = unmarked.length;
    touched('unmarked', unmarked);

    const [heldCount] = await this.dataSource.query(
      `SELECT COUNT(*) AS count FROM gallery_media m WHERE m.school_id = $1 AND m.deleted_at IS NULL
         AND m.expires_at IS NOT NULL AND m.expires_at <= now() + make_interval(days => $2) AND ${held}`,
      base,
    );
    job.held = Number(heldCount.count);

    if (settings.auto_trash_enabled) {
      const marked = rowsOf<Touched>(
        await this.dataSource.query(
          `UPDATE gallery_media m SET status = 'pending_deletion', notice_sent_at = now(), updated_at = now(),
                  trash_at = GREATEST(m.expires_at, now() + make_interval(days => $2))
           WHERE m.school_id = $1 AND m.deleted_at IS NULL AND m.status = 'active' AND m.expires_at IS NOT NULL
             AND m.expires_at <= now() + make_interval(days => $2) AND NOT ${held}
           ${returning}`,
          base,
        ),
      );
      job.marked = marked.length;
      touched('marked', marked);
      if (marked.length) {
        const first = marked.reduce((min, row) => Math.min(min, new Date(row.trash_at!).getTime()), Infinity);
        this.notifyQuietly(settings, TEMPLATES.GALLERY_DELETION_SCHEDULED, {
          count: marked.length,
          date: this.day(new Date(first), settings.time_zone),
        });
      }

      const trashed = rowsOf<Touched>(
        await this.dataSource.query(
          `UPDATE gallery_media m SET deleted_at = now(), deleted_reason = 'retention', deleted_by = NULL,
                  purge_after = now() + make_interval(days => $2), status = 'active', trash_at = NULL, updated_at = now()
           WHERE m.school_id = $1 AND m.deleted_at IS NULL AND m.status = 'pending_deletion' AND m.trash_at <= now()
             AND NOT ${held}
           ${returning}`,
          [schoolId, settings.recovery_days, today],
        ),
      );
      job.trashed = trashed.length;
      touched('trashed', trashed);
      if (trashed.length) {
        await this.dataSource.query(
          `UPDATE gallery_albums SET cover_media_id = NULL WHERE cover_media_id = ANY($1::int[])`,
          [trashed.map((row) => row.id)],
        );
      }
      trashed.forEach((row) =>
        audits.push({
          school_id: schoolId,
          actor: null,
          action: 'media.trashed',
          album_id: row.album_id,
          media_id: row.id,
          class_id: row.class_id,
          section_id: row.section_id,
          details: { name: row.name, reason: 'retention', job_id: job.id },
        }),
      );

      if (settings.delete_empty_albums) {
        const emptied = rowsOf<{ id: number; title: string; class_id: number | null; section_id: number | null }>(
          await this.dataSource.query(
            `UPDATE gallery_albums a SET deleted_at = now(), deleted_reason = 'empty_album',
                    purge_after = now() + make_interval(days => $3), updated_at = now()
             WHERE a.school_id = $1 AND a.deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM gallery_media m WHERE m.album_id = a.id AND m.deleted_at IS NULL)
               AND EXISTS (SELECT 1 FROM gallery_media m WHERE m.album_id = a.id AND m.deleted_reason = 'retention')
               AND NOT EXISTS (SELECT 1 FROM gallery_retention_holds h WHERE h.album_id = a.id AND h.released_at IS NULL
                                 AND (h.keep_until IS NULL OR h.keep_until >= $2::date))
             RETURNING a.id, a.title, a.class_id, a.section_id`,
            [schoolId, today, settings.recovery_days],
          ),
        );
        job.albums_trashed = emptied.length;
        emptied.forEach((album) => {
          drafts.push({ action: 'album_trashed', album_id: album.id, name: album.title });
          audits.push({
            school_id: schoolId,
            actor: null,
            action: 'album.trashed',
            album_id: album.id,
            class_id: album.class_id,
            section_id: album.section_id,
            details: { title: album.title, reason: 'empty_album', job_id: job.id },
          });
        });
      }
    }
    await this.audit.recordMany(audits);

    if (settings.permanent_delete_enabled) {
      const due = await this.media
        .createQueryBuilder('m')
        .withDeleted()
        .where('m.school_id = :schoolId AND m.deleted_at IS NOT NULL AND m.purge_after <= now()', { schoolId })
        .andWhere(`NOT ${heldSql('m', ':today')}`, { today })
        .orderBy('m.purge_after', 'ASC')
        .take(PURGE_BATCH)
        .getMany();
      const dueAlbums: { id: number }[] = await this.dataSource.query(
        `SELECT id FROM gallery_albums WHERE school_id = $1 AND deleted_at IS NOT NULL AND purge_after <= now()`,
        [schoolId],
      );
      const result = await this.gallery.purgeAndAudit(
        schoolId,
        due,
        null,
        dueAlbums.map((row) => Number(row.id)),
      );
      result.outcomes.forEach((item) =>
        drafts.push({
          action: item.error ? 'failed' : 'purged',
          media_id: item.media_id,
          album_id: item.album_id,
          name: item.name,
          size_bytes: item.size_bytes,
          error: item.error,
        }),
      );
      result.purged_album_ids.forEach((id) => drafts.push({ action: 'album_purged', album_id: id }));
      job.purged = result.media_purged;
      job.failed = result.failed;
      job.albums_purged = result.albums_purged;
      job.bytes_reclaimed = String(result.bytes_reclaimed);
    }

    if (settings.purge_orphans) {
      const sessions: { id: number; orphan_keys: string[] }[] = await this.dataSource.query(
        `SELECT id, orphan_keys FROM gallery_upload_sessions WHERE school_id = $1 AND cardinality(orphan_keys) > 0`,
        [schoolId],
      );
      for (const session of sessions) {
        const left = await this.mediaService.removeKeys(session.orphan_keys);
        const removed = session.orphan_keys.filter((key) => !left.includes(key));
        await this.dataSource.query(`UPDATE gallery_upload_sessions SET orphan_keys = $1 WHERE id = $2`, [
          left,
          session.id,
        ]);
        job.orphans_removed += removed.length;
        removed.forEach((key) => drafts.push({ action: 'orphan_removed', name: key.slice(0, 255) }));
      }
    }

    if (settings.purge_stale_uploads) {
      const cleared = rowsOf<{ id: number }>(
        await this.dataSource.query(
          `DELETE FROM gallery_upload_sessions
           WHERE school_id = $1 AND created_at < now() - make_interval(days => $2) AND cardinality(orphan_keys) = 0
           RETURNING id`,
          [schoolId, STALE_UPLOAD_DAYS],
        ),
      );
      job.uploads_cleared = cleared.length;
    }

    await this.saveItems(job, drafts);
  }

  private async start(
    schoolId: number,
    trigger: JobTrigger,
    actor: AuthUser | null,
    retryOf: number | null,
  ): Promise<GalleryCleanupJob> {
    try {
      return await this.jobs.save(
        this.jobs.create({
          school_id: schoolId,
          trigger,
          status: 'running',
          started_at: new Date(),
          triggered_by: actor?.id ?? null,
          retry_of_job_id: retryOf,
        }),
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw AppException.conflict('A gallery cleanup is already running for this school', 'CLEANUP_RUNNING');
      }
      throw error;
    }
  }

  private async finish(
    job: GalleryCleanupJob,
    started: number,
    error: Error | null,
    actor: AuthUser | null,
    settings?: GallerySettings,
  ): Promise<void> {
    const schoolId = job.school_id;
    job.finished_at = new Date();
    job.duration_ms = Date.now() - started;
    job.status = error ? 'failed' : job.failed > 0 ? 'partial' : 'completed';
    job.error = error ? error.message.slice(0, 2000) : null;
    job.storage_bytes_after = String(await this.mediaService.usedBytes(schoolId).catch(() => 0));
    await this.jobs.save(job);
    if (error) this.logger.error(`School ${schoolId}: gallery cleanup ${job.id} failed: ${error.message}`);
    if (settings) {
      const now = new Date();
      await this.dataSource.query(
        `UPDATE gallery_settings SET last_cleanup_at = $1, next_cleanup_at = $2 WHERE id = $3`,
        [now, nextRunAfter(settings, now), settings.id],
      );
    }
    await this.audit.record({
      school_id: schoolId,
      actor,
      action: error ? 'cleanup.failed' : 'cleanup.completed',
      result: error || job.failed ? 'failure' : 'success',
      details: {
        job_id: job.id,
        trigger: job.trigger,
        scanned: job.scanned,
        marked: job.marked,
        unmarked: job.unmarked,
        trashed: job.trashed,
        purged: job.purged,
        failed: job.failed,
        held: job.held,
        bytes_reclaimed: Number(job.bytes_reclaimed),
        error: job.error,
      },
    });
    const current = settings ?? (await this.settings.forSchool(schoolId));
    if (error) {
      this.notifyQuietly(current, TEMPLATES.GALLERY_CLEANUP_FAILED, { error: job.error ?? 'unknown error' });
    } else if (job.trashed + job.purged + job.failed + job.albums_trashed + job.albums_purged > 0) {
      this.notifyQuietly(current, TEMPLATES.GALLERY_CLEANUP_DONE, {
        trashed: job.trashed,
        purged: job.purged,
        freed: readableSize(Number(job.bytes_reclaimed)),
        held: job.held,
        failed: job.failed,
      });
    }
    this.alerts.checkStorageQuietly(schoolId);
    this.logger.log(
      `School ${schoolId}: gallery cleanup ${job.id} ${job.status} in ${job.duration_ms} ms (marked ${job.marked}, trashed ${job.trashed}, purged ${job.purged}, failed ${job.failed})`,
    );
  }

  private async saveItems(job: GalleryCleanupJob, drafts: ItemDraft[]): Promise<void> {
    const rows = drafts.map((draft) =>
      this.items.create({
        school_id: job.school_id,
        job_id: job.id,
        action: draft.action,
        media_id: draft.media_id ?? null,
        album_id: draft.album_id ?? null,
        name: draft.name?.slice(0, 255) ?? null,
        size_bytes: draft.size_bytes ?? 0,
        error: draft.error?.slice(0, 500) ?? null,
      }),
    );
    for (let index = 0; index < rows.length; index += 500) await this.items.insert(rows.slice(index, index + 500));
  }

  private async recoverStale(): Promise<void> {
    await this.dataSource.query(
      `UPDATE gallery_cleanup_jobs SET status = 'failed', finished_at = now(),
              error = 'Stopped before finishing (the server restarted). Run the cleanup again.'
       WHERE status = 'running' AND started_at < now() - interval '2 hours'`,
    );
  }

  private notifyQuietly(settings: GallerySettings, template: string, data: Record<string, string | number>): void {
    void this.alerts
      .notifyAdmins(settings, template, data)
      .catch((error: Error) =>
        this.logger.warn(`School ${settings.school_id}: ${template} not sent: ${error.message}`),
      );
  }

  private day(date: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('en-IN', { timeZone, day: '2-digit', month: 'short', year: 'numeric' }).format(date);
  }

  private async job(schoolId: number, id: number): Promise<GalleryCleanupJob> {
    const row = await this.jobs.findOneBy({ id, school_id: schoolId });
    if (!row) throw AppException.notFound('Cleanup job not found', 'CLEANUP_JOB_NOT_FOUND');
    return row;
  }

  private async presentJobs(rows: GalleryCleanupJob[]): Promise<CleanupJobDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const userIds = [...new Set(rows.map((row) => row.triggered_by).filter((id): id is number => id !== null))];
    const [names, retryable] = await Promise.all([
      userIds.length
        ? (this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1::int[])`, [userIds]) as Promise<
            { id: number; name: string }[]
          >)
        : Promise.resolve([]),
      this.dataSource.query(
        `SELECT job_id, COUNT(*) AS count FROM gallery_cleanup_job_items
         WHERE job_id = ANY($1::int[]) AND action = 'failed' AND retried_job_id IS NULL GROUP BY job_id`,
        [ids],
      ) as Promise<{ job_id: number; count: string }[]>,
    ]);
    const nameById = new Map(names.map((row) => [Number(row.id), row.name]));
    const retryById = new Map(retryable.map((row) => [Number(row.job_id), Number(row.count)]));
    return rows.map((row) => ({
      id: row.id,
      trigger: row.trigger,
      status: row.status,
      started_at: row.started_at,
      finished_at: row.finished_at,
      duration_ms: row.duration_ms,
      scanned: row.scanned,
      marked: row.marked,
      unmarked: row.unmarked,
      trashed: row.trashed,
      purged: row.purged,
      failed: row.failed,
      held: row.held,
      albums_trashed: row.albums_trashed,
      albums_purged: row.albums_purged,
      orphans_removed: row.orphans_removed,
      uploads_cleared: row.uploads_cleared,
      bytes_reclaimed: Number(row.bytes_reclaimed),
      storage_bytes_after: row.storage_bytes_after === null ? null : Number(row.storage_bytes_after),
      error: row.error,
      triggered_by_name: row.triggered_by ? (nameById.get(row.triggered_by) ?? null) : null,
      retry_of_job_id: row.retry_of_job_id,
      retryable: retryById.get(row.id) ?? 0,
    }));
  }

  private presentItem(row: GalleryCleanupJobItem): CleanupJobItemDto {
    return {
      id: row.id,
      action: row.action,
      media_id: row.media_id,
      album_id: row.album_id,
      name: row.name,
      size_bytes: row.size_bytes,
      error: row.error,
      retried_job_id: row.retried_job_id,
      created_at: row.created_at,
    };
  }
}
