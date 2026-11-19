import { EntityManager } from 'typeorm';
import { FeeAuditAction, FeeAuditEntity, FeeAuditLog } from './entities/fee-audit-log.entity';

export interface FeeAuditEntry {
  school_id: number;
  entity: FeeAuditEntity;
  entity_id: number | null;
  action: FeeAuditAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  actor_id?: number | null;
}

export async function recordFeeAudit(manager: EntityManager, entry: FeeAuditEntry): Promise<void> {
  await manager.save(
    manager.create(FeeAuditLog, {
      school_id: entry.school_id,
      entity: entry.entity,
      entity_id: entry.entity_id,
      action: entry.action,
      before: entry.before ?? null,
      after: entry.after ?? null,
      reason: entry.reason || null,
      created_by: entry.actor_id ?? null,
    }),
  );
}

export function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}
