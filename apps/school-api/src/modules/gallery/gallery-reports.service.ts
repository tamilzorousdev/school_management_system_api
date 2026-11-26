import { Inject, Injectable, StreamableFile } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { appConfig, AppConfig, storageConfig, StorageConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { yearClause } from '../../shared/year-context';
import {
  CountByDto,
  DashboardQueryDto,
  GalleryDashboardDto,
  GalleryReportDto,
  ReportName,
  ReportQueryDto,
  REPORTS,
  StorageDto,
} from './dto/gallery.dto';
import { GalleryMedia } from './entities/gallery.entity';
import { tableFile, TableColumn } from './gallery-export';
import { GalleryMediaService } from './gallery-media.service';
import { heldSql } from './gallery-retention.service';
import { GallerySettingsService } from './gallery-settings.service';
import { bindNamed, storageLevel } from './gallery.logic';

interface Filters {
  media: string;
  albums: string;
  audit: string;
  jobs: string;
}

interface ReportDefinition {
  title: string;
  columns: TableColumn[];
  sql: (where: Filters) => string;
}

const MB = 1024 * 1024;
const HELD = heldSql('m', ':today');

const USAGE = [
  { key: 'albums', label: 'Albums' },
  { key: 'photos', label: 'Photos' },
  { key: 'videos', label: 'Videos' },
  { key: 'size_mb', label: 'Size (MB)' },
];

const USAGE_SQL = `COUNT(DISTINCT a.id) AS albums,
  COUNT(m.id) FILTER (WHERE m.media_type = 'image') AS photos,
  COUNT(m.id) FILTER (WHERE m.media_type = 'video') AS videos,
  ROUND(COALESCE(SUM(m.size_bytes + m.thumbnail_bytes), 0) / 1048576.0, 2) AS size_mb`;

const mediaJoin = (where: Filters) => `FROM gallery_albums a
  LEFT JOIN gallery_media m ON m.album_id = a.id AND m.deleted_at IS NULL ${where.media}`;

const auditRows = (actions: string[]) => (where: Filters) =>
  `SELECT to_char(l.created_at AT TIME ZONE :zone, 'YYYY-MM-DD HH24:MI') AS at, l.action, l.user_name, l.user_role,
          COALESCE(l.details->>'name', l.details->>'title') AS item, a.title AS album, l.result,
          COALESCE(l.details->>'reason', l.details->>'note', l.details->>'by') AS note
   FROM gallery_audit_logs l LEFT JOIN gallery_albums a ON a.id = l.album_id
   WHERE l.school_id = :school AND l.action IN (${actions.map((action) => `'${action}'`).join(', ')}) ${where.audit}
   ORDER BY l.created_at DESC LIMIT 5000`;

const AUDIT_COLUMNS = [
  { key: 'at', label: 'When' },
  { key: 'action', label: 'Action' },
  { key: 'item', label: 'Item' },
  { key: 'album', label: 'Album' },
  { key: 'user_name', label: 'By' },
  { key: 'user_role', label: 'Role' },
  { key: 'result', label: 'Result' },
  { key: 'note', label: 'Note' },
];

const TEXT_COLUMNS = new Set(['name', 'title', 'item', 'album', 'place', 'class_name', 'section_name', 'category']);

const DEFINITIONS: Record<ReportName, ReportDefinition> = {
  class_usage: {
    title: 'Class-wise gallery usage',
    columns: [{ key: 'class_name', label: 'Class' }, ...USAGE],
    sql: (where) => `SELECT c.name AS class_name, ${USAGE_SQL} ${mediaJoin(where)}
      JOIN classes c ON c.id = a.class_id
      WHERE a.school_id = :school AND a.deleted_at IS NULL AND a.scope IN ('class', 'section') ${where.albums}
      GROUP BY c.id, c.name, c.grade_level ORDER BY c.grade_level, c.name`,
  },
  section_usage: {
    title: 'Section-wise gallery usage',
    columns: [{ key: 'class_name', label: 'Class' }, { key: 'section_name', label: 'Section' }, ...USAGE],
    sql: (where) => `SELECT c.name AS class_name, sec.name AS section_name, ${USAGE_SQL} ${mediaJoin(where)}
      JOIN sections sec ON sec.id = a.section_id JOIN classes c ON c.id = sec.class_id
      WHERE a.school_id = :school AND a.deleted_at IS NULL AND a.scope = 'section' ${where.albums}
      GROUP BY c.id, c.name, c.grade_level, sec.id, sec.name ORDER BY c.grade_level, c.name, sec.name`,
  },
  album_counts: {
    title: 'Album-wise media count',
    columns: [
      { key: 'title', label: 'Album' },
      { key: 'scope', label: 'Gallery' },
      { key: 'place', label: 'Class / section' },
      { key: 'category', label: 'Category' },
      { key: 'status', label: 'Status' },
      { key: 'photos', label: 'Photos' },
      { key: 'videos', label: 'Videos' },
      { key: 'size_mb', label: 'Size (MB)' },
      { key: 'created', label: 'Created' },
    ],
    sql: (where) => `SELECT a.title, a.scope, TRIM(COALESCE(c.name, '') || ' ' || COALESCE(sec.name, '')) AS place,
        cat.name AS category, a.status, ${USAGE_SQL}, to_char(a.created_at AT TIME ZONE :zone, 'YYYY-MM-DD') AS created
      ${mediaJoin(where)}
      LEFT JOIN classes c ON c.id = a.class_id LEFT JOIN sections sec ON sec.id = a.section_id
      LEFT JOIN gallery_categories cat ON cat.id = a.category_id
      WHERE a.school_id = :school AND a.deleted_at IS NULL ${where.albums}
      GROUP BY a.id, c.name, sec.name, cat.name ORDER BY a.created_at DESC LIMIT 5000`,
  },
  category_usage: {
    title: 'Storage usage by category',
    columns: [{ key: 'category', label: 'Category' }, ...USAGE],
    sql: (where) => `SELECT COALESCE(cat.name, 'No category') AS category, ${USAGE_SQL} ${mediaJoin(where)}
      LEFT JOIN gallery_categories cat ON cat.id = a.category_id
      WHERE a.school_id = :school AND a.deleted_at IS NULL ${where.albums}
      GROUP BY cat.id, cat.name, cat.sort_order ORDER BY cat.sort_order NULLS LAST, cat.name`,
  },
  upload_activity: {
    title: 'Upload activity',
    columns: [
      { key: 'day', label: 'Date' },
      { key: 'uploads', label: 'Uploads' },
      { key: 'photos', label: 'Photos' },
      { key: 'videos', label: 'Videos' },
      { key: 'size_mb', label: 'Size (MB)' },
    ],
    sql: (where) => `SELECT to_char(m.created_at AT TIME ZONE :zone, 'YYYY-MM-DD') AS day, COUNT(*) AS uploads,
        COUNT(*) FILTER (WHERE m.media_type = 'image') AS photos, COUNT(*) FILTER (WHERE m.media_type = 'video') AS videos,
        ROUND(SUM(m.size_bytes + m.thumbnail_bytes) / 1048576.0, 2) AS size_mb
      FROM gallery_media m JOIN gallery_albums a ON a.id = m.album_id
      WHERE m.school_id = :school ${where.media} ${where.albums}
      GROUP BY 1 ORDER BY 1 DESC LIMIT 1000`,
  },
  user_uploads: {
    title: 'User upload activity',
    columns: [
      { key: 'name', label: 'User' },
      { key: 'uploads', label: 'Uploads' },
      { key: 'photos', label: 'Photos' },
      { key: 'videos', label: 'Videos' },
      { key: 'size_mb', label: 'Size (MB)' },
      { key: 'last_upload', label: 'Last upload' },
    ],
    sql: (where) => `SELECT COALESCE(u.name, 'Unknown') AS name, COUNT(*) AS uploads,
        COUNT(*) FILTER (WHERE m.media_type = 'image') AS photos, COUNT(*) FILTER (WHERE m.media_type = 'video') AS videos,
        ROUND(SUM(m.size_bytes + m.thumbnail_bytes) / 1048576.0, 2) AS size_mb,
        to_char(MAX(m.created_at) AT TIME ZONE :zone, 'YYYY-MM-DD HH24:MI') AS last_upload
      FROM gallery_media m JOIN gallery_albums a ON a.id = m.album_id LEFT JOIN users u ON u.id = m.created_by
      WHERE m.school_id = :school ${where.media} ${where.albums}
      GROUP BY u.id, u.name ORDER BY uploads DESC LIMIT 1000`,
  },
  storage: {
    title: 'Storage usage',
    columns: [
      { key: 'area', label: 'Area' },
      { key: 'items', label: 'Items' },
      { key: 'size_mb', label: 'Size (MB)' },
    ],
    sql: () => `SELECT CASE WHEN m.deleted_at IS NOT NULL THEN 'Trash'
          WHEN a.scope = 'school' THEN 'App Media Gallery' WHEN a.scope = 'class' THEN 'Class-wise Gallery'
          ELSE 'Section-wise Gallery' END AS area,
        COUNT(*) AS items, ROUND(SUM(m.size_bytes + m.thumbnail_bytes) / 1048576.0, 2) AS size_mb
      FROM gallery_media m JOIN gallery_albums a ON a.id = m.album_id
      WHERE m.school_id = :school GROUP BY 1 ORDER BY 1`,
  },
  expiring: {
    title: 'Media nearing expiration',
    columns: [
      { key: 'name', label: 'Item' },
      { key: 'album', label: 'Album' },
      { key: 'place', label: 'Class / section' },
      { key: 'expires', label: 'Retention ends' },
      { key: 'trash_on', label: 'Goes to Trash' },
      { key: 'status', label: 'Status' },
      { key: 'on_hold', label: 'On hold' },
    ],
    sql: () => `SELECT m.original_name AS name, a.title AS album,
        TRIM(COALESCE(c.name, '') || ' ' || COALESCE(sec.name, '')) AS place,
        to_char(m.expires_at AT TIME ZONE :zone, 'YYYY-MM-DD') AS expires,
        to_char(m.trash_at AT TIME ZONE :zone, 'YYYY-MM-DD') AS trash_on, m.status,
        CASE WHEN ${HELD} THEN 'yes' ELSE 'no' END AS on_hold
      FROM gallery_media m JOIN gallery_albums a ON a.id = m.album_id
      LEFT JOIN classes c ON c.id = a.class_id LEFT JOIN sections sec ON sec.id = a.section_id
      WHERE m.school_id = :school AND m.deleted_at IS NULL AND m.expires_at IS NOT NULL
        AND m.expires_at <= now() + make_interval(days => :notice)
      ORDER BY m.expires_at LIMIT 5000`,
  },
  deleted: {
    title: 'Deleted media',
    columns: AUDIT_COLUMNS,
    sql: auditRows(['media.deleted', 'media.trashed', 'album.deleted', 'album.trashed']),
  },
  restored: {
    title: 'Restored media',
    columns: AUDIT_COLUMNS,
    sql: auditRows(['media.restored', 'album.restored']),
  },
  purged: {
    title: 'Permanent deletion history',
    columns: AUDIT_COLUMNS,
    sql: auditRows(['media.purged', 'album.purged']),
  },
  cleanup_activity: {
    title: 'Cleanup activity',
    columns: [
      { key: 'started', label: 'Started' },
      { key: 'trigger', label: 'Trigger' },
      { key: 'status', label: 'Status' },
      { key: 'scanned', label: 'Scanned' },
      { key: 'marked', label: 'Marked' },
      { key: 'trashed', label: 'To Trash' },
      { key: 'purged', label: 'Deleted for good' },
      { key: 'failed', label: 'Failed' },
      { key: 'reclaimed_mb', label: 'Freed (MB)' },
      { key: 'duration_s', label: 'Duration (s)' },
    ],
    sql: (
      where,
    ) => `SELECT to_char(j.started_at AT TIME ZONE :zone, 'YYYY-MM-DD HH24:MI') AS started, j.trigger, j.status,
        j.scanned, j.marked, j.trashed, j.purged, j.failed, ROUND(j.bytes_reclaimed / 1048576.0, 2) AS reclaimed_mb,
        ROUND(COALESCE(j.duration_ms, 0) / 1000.0, 1) AS duration_s
      FROM gallery_cleanup_jobs j WHERE j.school_id = :school ${where.jobs} ORDER BY j.started_at DESC LIMIT 1000`,
  },
  cleanup_failures: {
    title: 'Cleanup failures',
    columns: [
      { key: 'at', label: 'When' },
      { key: 'job_id', label: 'Job' },
      { key: 'media_id', label: 'Media ID' },
      { key: 'name', label: 'Item' },
      { key: 'error', label: 'Error' },
      { key: 'retried', label: 'Retried in job' },
    ],
    sql: (where) => `SELECT to_char(i.created_at AT TIME ZONE :zone, 'YYYY-MM-DD HH24:MI') AS at, i.job_id, i.media_id,
        i.name, i.error, i.retried_job_id AS retried
      FROM gallery_cleanup_job_items i JOIN gallery_cleanup_jobs j ON j.id = i.job_id
      WHERE i.school_id = :school AND i.action = 'failed' ${where.jobs} ORDER BY i.created_at DESC LIMIT 5000`,
  },
};

@Injectable()
export class GalleryReportsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: GallerySettingsService,
    private readonly mediaService: GalleryMediaService,
    @Inject(storageConfig.KEY) private readonly storage: StorageConfig,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async dashboard(schoolId: number, query: DashboardQueryDto, user: AuthUser): Promise<GalleryDashboardDto> {
    const settings = await this.settings.forSchool(schoolId);
    const values: Record<string, unknown> = {
      school: schoolId,
      zone: this.app.timeZone,
      today: todayIn(settings.time_zone),
      notice: settings.notice_days,
      ...query,
    };
    const where = this.dashboardWhere(query);
    const scoped = `FROM gallery_media m JOIN gallery_albums a ON a.id = m.album_id AND a.deleted_at IS NULL
      WHERE m.school_id = :school AND m.deleted_at IS NULL ${where.media} ${where.albums}`;
    const [totals] = await this.run(
      `SELECT
         (SELECT COUNT(*) FROM gallery_albums a WHERE a.school_id = :school AND a.deleted_at IS NULL ${where.albums}) AS albums,
         COUNT(m.id) FILTER (WHERE m.media_type = 'image') AS photos,
         COUNT(m.id) FILTER (WHERE m.media_type = 'video') AS videos,
         COUNT(m.id) FILTER (WHERE m.created_at >= date_trunc('month', now() AT TIME ZONE :zone) AT TIME ZONE :zone) AS this_month,
         COUNT(m.id) FILTER (WHERE m.status = 'active' AND m.expires_at IS NOT NULL
                               AND m.expires_at <= now() + make_interval(days => :notice) AND NOT ${HELD}) AS expiring,
         COUNT(m.id) FILTER (WHERE m.status = 'pending_deletion') AS scheduled,
         COUNT(m.id) FILTER (WHERE ${HELD}) AS held
       ${scoped}`,
      values,
    );
    const [trash] = await this.run(
      `SELECT COUNT(*) AS items, COALESCE(SUM(size_bytes + thumbnail_bytes), 0) AS bytes
       FROM gallery_media WHERE school_id = :school AND deleted_at IS NOT NULL`,
      values,
    );
    const used = await this.mediaService.usedBytes(schoolId);
    const byClass = await this.countBy(
      `SELECT c.id, c.name, COUNT(m.id) FILTER (WHERE m.media_type = 'image') AS photos,
              COUNT(m.id) FILTER (WHERE m.media_type = 'video') AS videos,
              COALESCE(SUM(m.size_bytes + m.thumbnail_bytes), 0) AS size_bytes
       ${scoped.replace('WHERE', 'JOIN classes c ON c.id = a.class_id WHERE')}
       GROUP BY c.id, c.name, c.grade_level ORDER BY c.grade_level, c.name`,
      values,
    );
    const bySection = await this.countBy(
      `SELECT sec.id, c.name || ' - ' || sec.name AS name, COUNT(m.id) FILTER (WHERE m.media_type = 'image') AS photos,
              COUNT(m.id) FILTER (WHERE m.media_type = 'video') AS videos,
              COALESCE(SUM(m.size_bytes + m.thumbnail_bytes), 0) AS size_bytes
       ${scoped.replace('WHERE', 'JOIN sections sec ON sec.id = a.section_id JOIN classes c ON c.id = sec.class_id WHERE')}
       GROUP BY sec.id, sec.name, c.name, c.grade_level ORDER BY c.grade_level, c.name, sec.name`,
      values,
    );
    const recent: (GalleryMedia & { allow_download: boolean; uploader: string | null })[] = await this.run(
      `SELECT m.*, a.allow_download, (SELECT u.name FROM users u WHERE u.id = m.created_by) AS uploader
       ${scoped} ORDER BY m.created_at DESC LIMIT 12`,
      values,
    );
    const names = new Map(recent.filter((row) => row.created_by).map((row) => [row.created_by!, row.uploader ?? '']));
    return {
      albums: Number(totals.albums),
      photos: Number(totals.photos),
      videos: Number(totals.videos),
      storage: this.storageOf(used, Number(trash.bytes), settings.storage_quota_mb, settings.storage_warning_percent),
      uploaded_this_month: Number(totals.this_month),
      expiring_soon: Number(totals.expiring),
      scheduled_for_deletion: Number(totals.scheduled),
      pending_deletion: Number(trash.items),
      on_hold: Number(totals.held),
      by_class: byClass,
      by_section: bySection,
      recent: recent.map((row) =>
        this.mediaService.present(row, { allow_download: row.allow_download }, user.id, {
          downloads: true,
          held: new Set(),
          heldAlbums: new Set(),
          names,
          canDelete: () => true,
        }),
      ),
    };
  }

  async report(schoolId: number, name: string, query: ReportQueryDto): Promise<GalleryReportDto> {
    if (!(REPORTS as readonly string[]).includes(name)) {
      throw AppException.notFound(`Unknown report. Use one of: ${REPORTS.join(', ')}`, 'REPORT_NOT_FOUND');
    }
    const report = name as ReportName;
    const definition = DEFINITIONS[report];
    const settings = await this.settings.forSchool(schoolId);
    const rows: Record<string, unknown>[] = await this.run(definition.sql(this.reportWhere(query)), {
      school: schoolId,
      zone: this.app.timeZone,
      today: todayIn(settings.time_zone),
      notice: settings.notice_days,
      year: query.academic_year_id,
      from: query.from,
      to: query.to,
    });
    return {
      report,
      title: definition.title,
      columns: definition.columns,
      rows: rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            typeof value === 'string' && !TEXT_COLUMNS.has(key) && /^-?\d+(\.\d+)?$/.test(value)
              ? Number(value)
              : value,
          ]),
        ),
      ) as Record<string, string | number | null>[],
    };
  }

  async exportReport(
    schoolId: number,
    name: string,
    query: ReportQueryDto,
    format: 'xlsx' | 'csv',
  ): Promise<StreamableFile> {
    const report = await this.report(schoolId, name, query);
    const range = [query.from, query.to].filter(Boolean).join(' to ') || 'All dates';
    return tableFile(
      {
        name: `gallery-${report.report}`,
        title: report.title,
        subtitle: range,
        columns: report.columns,
        rows: report.rows,
      },
      format,
    );
  }

  storageOf(used: number, trashBytes: number, quotaMb: number, warningPercent: number): StorageDto {
    const quota = quotaMb * MB;
    return {
      driver: this.storage.driver,
      used_bytes: used,
      trash_bytes: trashBytes,
      quota_bytes: quota,
      remaining_bytes: Math.max(quota - used, 0),
      used_percent: quota ? Math.round((used / quota) * 1000) / 10 : 0,
      level: storageLevel(used, quotaMb, warningPercent),
    };
  }

  private run<T = Record<string, unknown>>(sql: string, values: Record<string, unknown>): Promise<T[]> {
    const [text, params] = bindNamed(sql, values);
    return this.dataSource.query(text, params);
  }

  private async countBy(sql: string, values: Record<string, unknown>): Promise<CountByDto[]> {
    const rows = await this.run<{ id: number; name: string; photos: string; videos: string; size_bytes: string }>(
      sql,
      values,
    );
    return rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      photos: Number(row.photos),
      videos: Number(row.videos),
      size_bytes: Number(row.size_bytes),
    }));
  }

  private dashboardWhere(query: DashboardQueryDto): { media: string; albums: string } {
    let media = '';
    let albums = query.academic_year_id
      ? ' AND a.academic_year_id = :academic_year_id'
      : ` AND a.academic_year_id = (SELECT y.id FROM academic_years y WHERE y.school_id = a.school_id AND ${yearClause('y')} AND y.deleted_at IS NULL LIMIT 1)`;
    if (query.class_id) albums += ' AND a.class_id = :class_id';
    if (query.section_id) albums += ' AND a.section_id = :section_id';
    if (query.album_id) albums += ' AND a.id = :album_id';
    if (query.category_id) albums += ' AND a.category_id = :category_id';
    if (query.media_type) media += ' AND m.media_type = :media_type';
    if (query.uploader_id) media += ' AND m.created_by = :uploader_id';
    if (query.from) media += ' AND m.created_at >= (:from::date)::timestamp AT TIME ZONE :zone';
    if (query.to) media += ' AND m.created_at < ((:to::date) + 1)::timestamp AT TIME ZONE :zone';
    return { media, albums };
  }

  private reportWhere(query: ReportQueryDto): Filters {
    const where: Filters = { media: '', albums: '', audit: '', jobs: '' };
    if (query.academic_year_id) where.albums += ' AND a.academic_year_id = :year';
    const range = (column: string) =>
      (query.from ? ` AND ${column} >= (:from::date)::timestamp AT TIME ZONE :zone` : '') +
      (query.to ? ` AND ${column} < ((:to::date) + 1)::timestamp AT TIME ZONE :zone` : '');
    where.media += range('m.created_at');
    where.audit += range('l.created_at');
    where.jobs += range('j.started_at');
    return where;
  }
}
