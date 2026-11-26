import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { todayIn } from '../../shared/dates';
import {
  HoldDto,
  HoldInputDto,
  HoldQueryDto,
  PolicyDto,
  PolicyInputDto,
  PolicyUpdateDto,
  ReleaseHoldDto,
  RetentionOverviewDto,
} from './dto/gallery-config.dto';
import {
  AlbumScope,
  AlbumStatus,
  GalleryRetentionHold,
  GalleryRetentionPolicy,
  GallerySettings,
  MediaType,
} from './entities/gallery.entity';
import { GalleryAuditService } from './gallery-audit.service';
import { GallerySettingsService } from './gallery-settings.service';
import { expiryFor, PolicyRule, resolveRetention, retentionDays } from './gallery.logic';

const CHUNK = 1000;

const SCOPE_LABEL: Record<AlbumScope, string> = {
  school: 'App Media Gallery',
  class: 'Class-wise Gallery',
  section: 'Section-wise Gallery',
};

export const heldSql = (media: string, today: string) =>
  `EXISTS (SELECT 1 FROM gallery_retention_holds h WHERE h.school_id = ${media}.school_id AND h.released_at IS NULL
     AND (h.keep_until IS NULL OR h.keep_until >= ${today}::date)
     AND (h.media_id = ${media}.id OR h.album_id = ${media}.album_id))`;

interface RetentionRow {
  id: number;
  album_id: number;
  created_at: Date;
  media_type: MediaType;
  album_status: AlbumStatus;
  category_id: number | null;
  academic_year_id: number;
  scope: AlbumScope;
  expires_at: Date | null;
  retention_source: string;
}

@Injectable()
export class GalleryRetentionService {
  private readonly logger = new Logger('GalleryRetention');

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(GalleryRetentionPolicy) private readonly policies: Repository<GalleryRetentionPolicy>,
    @InjectRepository(GalleryRetentionHold) private readonly holds: Repository<GalleryRetentionHold>,
    private readonly settings: GallerySettingsService,
    private readonly audit: GalleryAuditService,
  ) {}

  async rules(schoolId: number): Promise<PolicyRule[]> {
    return this.policies.find({ where: { school_id: schoolId, is_active: true } });
  }

  async refresh(schoolId: number, filter: { album_id?: number; media_ids?: number[] } = {}): Promise<number> {
    const settings = await this.settings.forSchool(schoolId);
    const rules = await this.rules(schoolId);
    let changed = 0;
    let lastId = 0;
    for (;;) {
      const params: unknown[] = [schoolId, lastId, CHUNK];
      let extra = '';
      if (filter.album_id) {
        params.push(filter.album_id);
        extra += ` AND m.album_id = $${params.length}`;
      }
      if (filter.media_ids?.length) {
        params.push(filter.media_ids);
        extra += ` AND m.id = ANY($${params.length}::int[])`;
      }
      const rows: RetentionRow[] = await this.dataSource.query(
        `SELECT m.id, m.album_id, m.created_at, m.media_type, m.expires_at, m.retention_source,
                a.status AS album_status, a.category_id, a.academic_year_id, a.scope
         FROM gallery_media m JOIN gallery_albums a ON a.id = m.album_id
         WHERE m.school_id = $1 AND m.deleted_at IS NULL AND m.id > $2 ${extra}
         ORDER BY m.id LIMIT $3`,
        params,
      );
      if (!rows.length) break;
      lastId = rows[rows.length - 1]!.id;
      const updates = rows
        .map((row) => {
          const retention = resolveRetention(
            {
              album_id: row.album_id,
              album_status: row.album_status,
              category_id: row.category_id,
              academic_year_id: row.academic_year_id,
              scope: row.scope,
              media_type: row.media_type,
            },
            rules,
            settings,
          );
          return { id: row.id, expires: expiryFor(new Date(row.created_at), retention), source: retention.source, row };
        })
        .filter(
          (item) =>
            item.source !== item.row.retention_source ||
            (item.expires?.getTime() ?? null) !==
              (item.row.expires_at ? new Date(item.row.expires_at).getTime() : null),
        );
      if (updates.length) {
        await this.dataSource.query(
          `UPDATE gallery_media m SET expires_at = v.expires_at, retention_source = v.source, updated_at = now()
           FROM (SELECT unnest($1::int[]) AS id, unnest($2::timestamptz[]) AS expires_at, unnest($3::text[]) AS source) v
           WHERE m.id = v.id`,
          [updates.map((item) => item.id), updates.map((item) => item.expires), updates.map((item) => item.source)],
        );
        changed += updates.length;
      }
      if (rows.length < CHUNK) break;
    }
    return changed;
  }

  refreshQuietly(schoolId: number, filter: { album_id?: number } = {}): void {
    void this.refresh(schoolId, filter).catch((error: Error) =>
      this.logger.warn(`School ${schoolId}: retention dates not refreshed: ${error.message}`),
    );
  }

  async overview(schoolId: number): Promise<RetentionOverviewDto> {
    const settings = await this.settings.forSchool(schoolId);
    const policies = await this.listPolicies(schoolId);
    const [counts] = await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE retention_source = 'default') AS on_default,
              COUNT(*) FILTER (WHERE expires_at IS NULL) AS forever
       FROM gallery_media WHERE school_id = $1 AND deleted_at IS NULL`,
      [schoolId],
    );
    return {
      default_value: settings.retention_value,
      default_unit: settings.retention_unit,
      policies,
      default_media_count: Number(counts.on_default),
      kept_forever: Number(counts.forever),
    };
  }

  async listPolicies(schoolId: number): Promise<PolicyDto[]> {
    const rows: (GalleryRetentionPolicy & {
      album_title: string | null;
      category_name: string | null;
      year_name: string | null;
      media_count: string;
    })[] = await this.dataSource.query(
      `SELECT p.*, a.title AS album_title, c.name AS category_name, y.name AS year_name,
              (SELECT COUNT(*) FROM gallery_media m WHERE m.school_id = p.school_id AND m.deleted_at IS NULL
                 AND m.retention_source = 'policy:' || p.id) AS media_count
       FROM gallery_retention_policies p
       LEFT JOIN gallery_albums a ON a.id = p.album_id
       LEFT JOIN gallery_categories c ON c.id = p.category_id
       LEFT JOIN academic_years y ON y.id = p.academic_year_id
       WHERE p.school_id = $1 AND p.deleted_at IS NULL
       ORDER BY p.target, p.id`,
      [schoolId],
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      target: row.target,
      album_id: row.album_id,
      category_id: row.category_id,
      academic_year_id: row.academic_year_id,
      scope: row.scope,
      media_type: row.media_type,
      applies_to: this.label(row),
      retention_value: row.retention_value,
      retention_unit: row.retention_unit,
      keep_forever: row.keep_forever,
      is_active: row.is_active,
      media_count: Number(row.media_count),
      updated_at: row.updated_at,
    }));
  }

  async createPolicy(schoolId: number, dto: PolicyInputDto, actor: AuthUser): Promise<PolicyDto> {
    const settings = await this.settings.forSchool(schoolId);
    await this.assertTarget(schoolId, dto);
    const keepForever = dto.keep_forever ?? false;
    if (!keepForever && this.shorter(dto.retention_value!, dto.retention_unit!, settings) && !dto.confirm) {
      throw AppException.conflict(
        'This policy keeps media for less time than the school default, so some media may be deleted sooner. Send confirm: true to save it.',
        'CONFIRMATION_REQUIRED',
      );
    }
    const row = this.policies.create({
      school_id: schoolId,
      name: dto.name.trim(),
      target: dto.target,
      album_id: dto.target === 'album' ? dto.album_id! : null,
      category_id: dto.target === 'category' ? dto.category_id! : null,
      academic_year_id: dto.target === 'academic_year' ? dto.academic_year_id! : null,
      scope: dto.target === 'scope' ? dto.scope! : null,
      media_type: dto.target === 'media_type' ? dto.media_type! : null,
      retention_value: keepForever ? null : dto.retention_value!,
      retention_unit: keepForever ? null : dto.retention_unit!,
      keep_forever: keepForever,
      is_active: dto.is_active ?? true,
    });
    try {
      await this.policies.save(row);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw AppException.conflict('A policy for this already exists. Edit that one instead.', 'POLICY_EXISTS');
      }
      throw error;
    }
    await this.audit.record({
      school_id: schoolId,
      actor,
      action: 'retention.policy_created',
      album_id: row.album_id,
      details: { policy_id: row.id, ...this.describe(row) },
    });
    await this.refresh(schoolId);
    return (await this.listPolicies(schoolId)).find((item) => item.id === row.id)!;
  }

  async updatePolicy(schoolId: number, id: number, dto: PolicyUpdateDto, actor: AuthUser): Promise<PolicyDto> {
    const row = await this.policy(schoolId, id);
    const before = this.describe(row);
    const keepForever = dto.keep_forever ?? row.keep_forever;
    const value = dto.retention_value ?? row.retention_value;
    const unit = dto.retention_unit ?? row.retention_unit;
    if (!keepForever && (!value || !unit)) {
      throw AppException.validation([{ field: 'retention_value', message: 'Give retention_value and retention_unit' }]);
    }
    const wasDays = row.keep_forever ? Infinity : retentionDays(row.retention_value!, row.retention_unit!);
    const shorter = !keepForever && retentionDays(value!, unit!) < wasDays;
    const switchedOn = dto.is_active === true && !row.is_active;
    if ((shorter || (switchedOn && !keepForever)) && !dto.confirm) {
      throw AppException.conflict(
        'This change can delete media sooner. Send confirm: true to save it.',
        'CONFIRMATION_REQUIRED',
      );
    }
    Object.assign(row, {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      keep_forever: keepForever,
      retention_value: keepForever ? null : value,
      retention_unit: keepForever ? null : unit,
      ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
    });
    await this.policies.save(row);
    await this.audit.record({
      school_id: schoolId,
      actor,
      action: 'retention.policy_updated',
      album_id: row.album_id,
      details: { policy_id: row.id, from: before, to: this.describe(row) },
    });
    await this.refresh(schoolId);
    return (await this.listPolicies(schoolId)).find((item) => item.id === row.id)!;
  }

  async removePolicy(schoolId: number, id: number, actor: AuthUser, confirm: boolean): Promise<void> {
    const row = await this.policy(schoolId, id);
    const settings = await this.settings.forSchool(schoolId);
    const longerThanDefault =
      row.keep_forever ||
      retentionDays(row.retention_value!, row.retention_unit!) >
        retentionDays(settings.retention_value, settings.retention_unit);
    if (row.is_active && longerThanDefault && !confirm) {
      throw AppException.conflict(
        'Media under this policy will fall back to the shorter default retention. Send confirm=true to remove it.',
        'CONFIRMATION_REQUIRED',
      );
    }
    await this.policies.softDelete(row.id);
    await this.audit.record({
      school_id: schoolId,
      actor,
      action: 'retention.policy_removed',
      album_id: row.album_id,
      details: { policy_id: row.id, ...this.describe(row) },
    });
    await this.refresh(schoolId);
  }

  async listHolds(schoolId: number, query: HoldQueryDto, timeZone: string): Promise<Paginated<HoldDto>> {
    const today = todayIn(timeZone);
    const qb = this.holds
      .createQueryBuilder('h')
      .leftJoin('gallery_albums', 'a', 'a.id = h.album_id')
      .leftJoin('gallery_media', 'm', 'm.id = h.media_id')
      .where('h.school_id = :schoolId', { schoolId });
    const active = query.active ?? true;
    if (active) {
      qb.andWhere('h.released_at IS NULL AND (h.keep_until IS NULL OR h.keep_until >= :today)', { today });
    } else {
      qb.andWhere('(h.released_at IS NOT NULL OR h.keep_until < :today)', { today });
    }
    if (query.album_id) qb.andWhere('h.album_id = :albumId', { albumId: query.album_id });
    if (query.media_id) qb.andWhere('h.media_id = :mediaId', { mediaId: query.media_id });
    const page = await listQuery(qb, query, {
      searchable: ['h.reason', 'a.title', 'm.original_name'],
      sortable: { applied_at: 'h.applied_at', keep_until: 'h.keep_until' },
      defaultSort: 'applied_at',
    });
    return { ...page, items: await this.presentHolds(page.items, today) };
  }

  async applyHold(schoolId: number, dto: HoldInputDto, actor: AuthUser, timeZone: string): Promise<HoldDto> {
    if ((dto.album_id === undefined) === (dto.media_id === undefined)) {
      throw AppException.validation([{ field: 'album_id', message: 'Send album_id or media_id, not both' }]);
    }
    const today = todayIn(timeZone);
    if (dto.keep_until && dto.keep_until < today) {
      throw AppException.validation([{ field: 'keep_until', message: 'keep_until must be today or later' }]);
    }
    const place = await this.holdTarget(schoolId, dto);
    const hold = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(
        manager.create(GalleryRetentionHold, {
          school_id: schoolId,
          album_id: dto.album_id ?? null,
          media_id: dto.media_id ?? null,
          reason: dto.reason.trim(),
          keep_until: dto.keep_until ?? null,
          applied_by: actor.id,
          applied_at: new Date(),
        }),
      );
      const released = await this.unmarkHeld(manager, schoolId, today);
      await this.audit.record(
        {
          school_id: schoolId,
          actor,
          action: 'retention.hold_applied',
          album_id: place.album_id,
          media_id: dto.media_id ?? null,
          class_id: place.class_id,
          section_id: place.section_id,
          details: { hold_id: saved.id, reason: saved.reason, keep_until: saved.keep_until, unscheduled: released },
        },
        manager,
      );
      return saved;
    });
    return (await this.presentHolds([hold], today))[0]!;
  }

  async releaseHold(
    schoolId: number,
    id: number,
    dto: ReleaseHoldDto,
    actor: AuthUser,
    timeZone: string,
  ): Promise<HoldDto> {
    const hold = await this.holds.findOneBy({ id, school_id: schoolId });
    if (!hold) throw AppException.notFound('Retention hold not found', 'HOLD_NOT_FOUND');
    if (hold.released_at) throw AppException.conflict('This hold was already released', 'HOLD_RELEASED');
    const settings = await this.settings.forSchool(schoolId);
    const [due] = await this.dataSource.query(
      `SELECT COUNT(*) AS count FROM gallery_media m
       WHERE m.school_id = $1 AND m.deleted_at IS NULL AND m.expires_at IS NOT NULL
         AND m.expires_at <= now() + make_interval(days => $2)
         AND (m.id = $3 OR m.album_id = $4)`,
      [schoolId, settings.notice_days, hold.media_id ?? 0, hold.album_id ?? 0],
    );
    if (Number(due.count) > 0 && !dto.confirm) {
      throw AppException.conflict(
        `${due.count} photos and videos under this hold are past their retention and will be scheduled for Trash. Send confirm: true to release it.`,
        'CONFIRMATION_REQUIRED',
      );
    }
    hold.released_at = new Date();
    hold.released_by = actor.id;
    hold.release_reason = dto.reason.trim();
    await this.holds.save(hold);
    await this.audit.record({
      school_id: schoolId,
      actor,
      action: 'retention.hold_released',
      album_id: hold.album_id,
      media_id: hold.media_id,
      details: { hold_id: hold.id, reason: hold.release_reason, now_due: Number(due.count) },
    });
    return (await this.presentHolds([hold], todayIn(timeZone)))[0]!;
  }

  async heldIds(schoolId: number, today: string): Promise<{ albums: Set<number>; media: Set<number> }> {
    const rows: { album_id: number | null; media_id: number | null }[] = await this.dataSource.query(
      `SELECT album_id, media_id FROM gallery_retention_holds
       WHERE school_id = $1 AND released_at IS NULL AND (keep_until IS NULL OR keep_until >= $2::date)`,
      [schoolId, today],
    );
    return {
      albums: new Set(rows.filter((row) => row.album_id).map((row) => Number(row.album_id))),
      media: new Set(rows.filter((row) => row.media_id).map((row) => Number(row.media_id))),
    };
  }

  async unmarkHeld(manager: EntityManager, schoolId: number, today: string): Promise<number> {
    const rows: { id: number }[] = await manager.query(
      `UPDATE gallery_media m SET status = 'active', trash_at = NULL, notice_sent_at = NULL, updated_at = now()
       WHERE m.school_id = $1 AND m.deleted_at IS NULL AND m.status = 'pending_deletion' AND ${heldSql('m', '$2')}
       RETURNING m.id`,
      [schoolId, today],
    );
    return (Array.isArray(rows[0]) ? (rows[0] as unknown[]) : rows).length;
  }

  private async presentHolds(rows: GalleryRetentionHold[], today: string): Promise<HoldDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const extra: {
      id: number;
      album_title: string | null;
      media_name: string | null;
      applied_by_name: string | null;
      released_by_name: string | null;
    }[] = await this.dataSource.query(
      `SELECT h.id, a.title AS album_title, m.original_name AS media_name, ua.name AS applied_by_name, ur.name AS released_by_name
       FROM gallery_retention_holds h
       LEFT JOIN gallery_albums a ON a.id = h.album_id
       LEFT JOIN gallery_media m ON m.id = h.media_id
       LEFT JOIN users ua ON ua.id = h.applied_by
       LEFT JOIN users ur ON ur.id = h.released_by
       WHERE h.id = ANY($1::int[])`,
      [ids],
    );
    const byId = new Map(extra.map((row) => [Number(row.id), row]));
    return rows.map((row) => {
      const more = byId.get(row.id);
      return {
        id: row.id,
        kind: row.keep_until ? 'extension' : 'permanent',
        album_id: row.album_id,
        album_title: more?.album_title ?? null,
        media_id: row.media_id,
        media_name: more?.media_name ?? null,
        reason: row.reason,
        keep_until: row.keep_until,
        is_active: row.released_at === null && (row.keep_until === null || row.keep_until >= today),
        applied_by_name: more?.applied_by_name ?? null,
        applied_at: row.applied_at,
        released_by_name: more?.released_by_name ?? null,
        released_at: row.released_at,
        release_reason: row.release_reason,
      };
    });
  }

  private async holdTarget(
    schoolId: number,
    dto: HoldInputDto,
  ): Promise<{ album_id: number; class_id: number | null; section_id: number | null }> {
    if (dto.album_id !== undefined) {
      const [album] = await this.dataSource.query(
        `SELECT id, class_id, section_id, deleted_at FROM gallery_albums WHERE id = $1 AND school_id = $2`,
        [dto.album_id, schoolId],
      );
      if (!album) throw AppException.notFound('Album not found', 'ALBUM_NOT_FOUND');
      if (album.deleted_at) throw AppException.conflict('This album is in Trash. Restore it first.', 'ALBUM_IN_TRASH');
      return { album_id: Number(album.id), class_id: album.class_id, section_id: album.section_id };
    }
    const [media] = await this.dataSource.query(
      `SELECT m.album_id, m.deleted_at, a.class_id, a.section_id FROM gallery_media m
       JOIN gallery_albums a ON a.id = m.album_id WHERE m.id = $1 AND m.school_id = $2`,
      [dto.media_id, schoolId],
    );
    if (!media) throw AppException.notFound('Photo or video not found', 'MEDIA_NOT_FOUND');
    if (media.deleted_at) throw AppException.conflict('This item is in Trash. Restore it first.', 'MEDIA_IN_TRASH');
    return { album_id: Number(media.album_id), class_id: media.class_id, section_id: media.section_id };
  }

  private async assertTarget(schoolId: number, dto: PolicyInputDto): Promise<void> {
    const checks: Record<string, [string, number | undefined, string, string]> = {
      album: ['gallery_albums', dto.album_id, 'album_id', 'Album not found'],
      category: ['gallery_categories', dto.category_id, 'category_id', 'Category not found'],
      academic_year: ['academic_years', dto.academic_year_id, 'academic_year_id', 'Academic year not found'],
    };
    const check = checks[dto.target];
    if (!check) return;
    const [table, id, field, message] = check;
    const [row] = await this.dataSource.query(
      `SELECT 1 FROM ${table} WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [id, schoolId],
    );
    if (!row) throw AppException.validation([{ field, message }]);
  }

  private async policy(schoolId: number, id: number): Promise<GalleryRetentionPolicy> {
    const row = await this.policies.findOneBy({ id, school_id: schoolId });
    if (!row) throw AppException.notFound('Retention policy not found', 'POLICY_NOT_FOUND');
    return row;
  }

  private shorter(value: number, unit: GallerySettings['retention_unit'], settings: GallerySettings): boolean {
    return retentionDays(value, unit) < retentionDays(settings.retention_value, settings.retention_unit);
  }

  private describe(row: GalleryRetentionPolicy): Record<string, unknown> {
    return {
      name: row.name,
      target: row.target,
      retention: row.keep_forever ? 'forever' : `${row.retention_value} ${row.retention_unit}`,
      is_active: row.is_active,
    };
  }

  private label(
    row: GalleryRetentionPolicy & {
      album_title: string | null;
      category_name: string | null;
      year_name: string | null;
    },
  ): string {
    switch (row.target) {
      case 'album':
        return `Album: ${row.album_title ?? row.album_id}`;
      case 'archived':
        return 'Archived albums';
      case 'category':
        return `Category: ${row.category_name ?? row.category_id}`;
      case 'academic_year':
        return `Academic year: ${row.year_name ?? row.academic_year_id}`;
      case 'scope':
        return SCOPE_LABEL[row.scope!];
      case 'media_type':
        return row.media_type === 'video' ? 'Videos' : 'Photos';
    }
  }
}
