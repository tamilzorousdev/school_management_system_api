import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, AuthUser, Paginated, paginate } from '@app/common';
import { AuditLogDto, AuditQueryDto } from './dto/hostel-admission.dto';
import { HostelAuditLog } from './entities/hostel-admission.entity';

export interface AuditEntry {
  entity: string;
  entity_id: number;
  action: string;
  student_id?: number | null;
  changes?: Record<string, unknown> | null;
  note?: string | null;
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`);

@Injectable()
export class HostelAuditService {
  constructor(private readonly dataSource: DataSource) {}

  async record(manager: EntityManager, schoolId: number, actor: AuthUser, entry: AuditEntry): Promise<void> {
    await manager.save(
      manager.create(HostelAuditLog, {
        school_id: schoolId,
        entity: entry.entity,
        entity_id: entry.entity_id,
        action: entry.action,
        student_id: entry.student_id ?? null,
        actor_user_id: actor.id,
        actor_name: actor.name,
        changes: entry.changes ?? null,
        note: entry.note ?? null,
      }),
    );
  }

  async list(schoolId: number, query: AuditQueryDto): Promise<Paginated<AuditLogDto>> {
    if (query.sort && query.sort !== 'created_at') {
      throw AppException.badRequest('sort must be created_at', 'INVALID_SORT');
    }
    const params: unknown[] = [schoolId];
    const where = ['a.school_id = $1'];
    if (query.entity) where.push(`a.entity = $${params.push(query.entity)}`);
    if (query.student_id) where.push(`a.student_id = $${params.push(query.student_id)}`);
    if (query.from) where.push(`a.created_at >= $${params.push(query.from)}::date`);
    if (query.to) where.push(`a.created_at < ($${params.push(query.to)}::date + 1)`);
    for (const word of (query.search ?? '').split(/\s+/).filter(Boolean)) {
      const slot = `$${params.push(`%${escapeLike(word)}%`)}`;
      where.push(
        `(a.action ILIKE ${slot} OR a.actor_name ILIKE ${slot} OR a.note ILIKE ${slot} OR s.first_name ILIKE ${slot} OR s.last_name ILIKE ${slot})`,
      );
    }
    const from = `FROM hostel_audit_log a LEFT JOIN students s ON s.id = a.student_id WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const rows: AuditLogDto[] = await this.dataSource.query(
      `SELECT a.id, a.entity, a.entity_id, a.action, a.student_id,
         NULLIF(TRIM(CONCAT(s.first_name, ' ', s.last_name)), '') AS student_name,
         a.actor_name, a.changes, a.note, a.created_at
       ${from} ORDER BY a.created_at ${order}, a.id ${order}
       LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    return paginate([rows, total], query.page, query.limit);
  }
}
