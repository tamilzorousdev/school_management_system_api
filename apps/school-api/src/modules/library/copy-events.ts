import { EntityManager } from 'typeorm';
import { CopyEventKind, LibraryCopyEvent } from './entities/library-issue.entity';

export interface CopyEventInput {
  school_id: number;
  copy_id: number;
  kind: CopyEventKind;
  issue_id?: number | null;
  member_id?: number | null;
  note?: string | null;
  actor_id?: number | null;
}

export async function logCopyEvents(manager: EntityManager, events: CopyEventInput[]): Promise<void> {
  if (!events.length) return;
  await manager.insert(
    LibraryCopyEvent,
    events.map((event) => ({
      school_id: event.school_id,
      copy_id: event.copy_id,
      kind: event.kind,
      issue_id: event.issue_id ?? null,
      member_id: event.member_id ?? null,
      note: event.note ? event.note.slice(0, 255) : null,
      actor_id: event.actor_id ?? null,
    })),
  );
}

export async function schoolInfo(
  manager: EntityManager,
  schoolId: number,
): Promise<{ code: string; name: string; address: string | null }> {
  const [row]: { code: string; name: string; address: string | null }[] = await manager.query(
    `SELECT code, name, NULLIF(CONCAT_WS(', ', address, city, pincode), '') AS address FROM schools WHERE id = $1`,
    [schoolId],
  );
  return row ?? { code: 'SCH', name: 'School', address: null };
}
