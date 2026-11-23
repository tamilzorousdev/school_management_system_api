import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { applySearch, applySort, AuthUser, ListOptions, listQuery, Paginated, RequestContext } from '@app/common';
import { AuditLogDto, AuditQueryDto } from './dto/gallery.dto';
import { GalleryAuditLog } from './entities/gallery.entity';

export interface AuditPlace {
  album_id?: number | null;
  media_id?: number | null;
  class_id?: number | null;
  section_id?: number | null;
}

export interface AuditEntry extends AuditPlace {
  school_id: number;
  actor: AuthUser | null;
  action: string;
  result?: 'success' | 'failure';
  details?: Record<string, unknown>;
}

const EXPORT_LIMIT = 10_000;

const AUDIT_LIST: ListOptions = {
  searchable: ['l.user_name', 'l.action'],
  sortable: { created_at: 'l.created_at', action: 'l.action', user_name: 'l.user_name' },
  defaultSort: 'created_at',
};

const ROLE_ORDER = ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL', 'AO', 'HOD', 'TEACHER', 'PARENT'];

export function mainRole(roles: string[]): string | null {
  return ROLE_ORDER.find((role) => roles.includes(role)) ?? roles[0] ?? null;
}

@Injectable()
export class GalleryAuditService {
  private readonly logger = new Logger('GalleryAudit');

  constructor(@InjectRepository(GalleryAuditLog) private readonly logs: Repository<GalleryAuditLog>) {}

  async record(entry: AuditEntry, manager?: EntityManager): Promise<void> {
    await this.recordMany([entry], manager);
  }

  async recordMany(entries: AuditEntry[], manager?: EntityManager): Promise<void> {
    if (!entries.length) return;
    const repo = manager ? manager.getRepository(GalleryAuditLog) : this.logs;
    const ip = RequestContext.ip()?.slice(0, 64) ?? null;
    const rows = entries.map((entry) =>
      repo.create({
        school_id: entry.school_id,
        user_id: entry.actor?.id ?? null,
        user_name: entry.actor?.name ?? null,
        user_role: entry.actor ? mainRole(entry.actor.roles) : 'SYSTEM',
        action: entry.action,
        album_id: entry.album_id ?? null,
        media_id: entry.media_id ?? null,
        class_id: entry.class_id ?? null,
        section_id: entry.section_id ?? null,
        result: entry.result ?? 'success',
        details: entry.details ?? {},
        ip: entry.actor ? ip : null,
      }),
    );
    for (let index = 0; index < rows.length; index += 500) {
      await repo.insert(rows.slice(index, index + 500) as QueryDeepPartialEntity<GalleryAuditLog>[]);
    }
  }

  recordQuietly(entry: AuditEntry): void {
    void this.record(entry).catch((error: Error) =>
      this.logger.warn(`Gallery audit row not written (${entry.action}): ${error.message}`),
    );
  }

  async list(schoolId: number, query: AuditQueryDto, timeZone: string): Promise<Paginated<AuditLogDto>> {
    const page = await listQuery(this.filtered(schoolId, query, timeZone), query, AUDIT_LIST);
    return { ...page, items: page.items.map((row) => this.present(row)) };
  }

  async exportRows(schoolId: number, query: AuditQueryDto, timeZone: string): Promise<AuditLogDto[]> {
    const qb = this.filtered(schoolId, query, timeZone);
    applySearch(qb, query.search, AUDIT_LIST.searchable);
    applySort(qb, query, AUDIT_LIST);
    const rows = await qb.take(EXPORT_LIMIT).getMany();
    return rows.map((row) => this.present(row));
  }

  private filtered(schoolId: number, query: AuditQueryDto, timeZone: string) {
    const qb = this.logs.createQueryBuilder('l').where('l.school_id = :schoolId', { schoolId });
    if (query.action) qb.andWhere('l.action = :action', { action: query.action });
    if (query.user_id) qb.andWhere('l.user_id = :userId', { userId: query.user_id });
    if (query.album_id) qb.andWhere('l.album_id = :albumId', { albumId: query.album_id });
    if (query.media_id) qb.andWhere('l.media_id = :mediaId', { mediaId: query.media_id });
    if (query.result) qb.andWhere('l.result = :result', { result: query.result });
    if (query.from) {
      qb.andWhere('l.created_at >= (:from::date)::timestamp AT TIME ZONE :zone', { from: query.from, zone: timeZone });
    }
    if (query.to) {
      qb.andWhere(`l.created_at < ((:to::date) + 1)::timestamp AT TIME ZONE :zone`, { to: query.to, zone: timeZone });
    }
    return qb;
  }

  present(row: GalleryAuditLog): AuditLogDto {
    return {
      id: row.id,
      user_id: row.user_id,
      user_name: row.user_name,
      user_role: row.user_role,
      action: row.action,
      album_id: row.album_id,
      media_id: row.media_id,
      class_id: row.class_id,
      section_id: row.section_id,
      result: row.result,
      details: row.details,
      ip: row.ip,
      created_at: row.created_at,
    };
  }
}
