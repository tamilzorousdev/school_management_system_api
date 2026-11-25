import { EntityManager } from 'typeorm';
import { AppException } from '@app/common';
import { daysBetween } from './hostel.logic';

export interface HostelPlace {
  hostel_id: number;
  hostel_name: string;
  block_id: number | null;
  block_name: string | null;
}

export async function ensurePlace(
  manager: EntityManager,
  schoolId: number,
  hostelId: number,
  blockId: number | null | undefined,
): Promise<HostelPlace> {
  const [hostel] = await manager.query(
    `SELECT id, name FROM hostels WHERE school_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [schoolId, hostelId],
  );
  if (!hostel) throw AppException.notFound('Hostel not found', 'HOSTEL_NOT_FOUND');
  const place: HostelPlace = { hostel_id: hostelId, hostel_name: hostel.name, block_id: null, block_name: null };
  if (!blockId) return place;
  const [block] = await manager.query(
    `SELECT id, name FROM hostel_blocks WHERE school_id = $1 AND hostel_id = $2 AND id = $3 AND deleted_at IS NULL`,
    [schoolId, hostelId, blockId],
  );
  if (!block) throw AppException.notFound('Block not found in this hostel', 'HOSTEL_BLOCK_NOT_FOUND');
  return { ...place, block_id: blockId, block_name: block.name };
}

export async function staffNames(
  manager: EntityManager,
  schoolId: number,
  userIds: number[],
  field: string,
): Promise<Map<number, string>> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Map();
  const rows: { id: number; name: string }[] = await manager.query(
    `SELECT u.id, u.name FROM users u
     WHERE u.id = ANY($1) AND u.school_id = $2 AND u.deleted_at IS NULL AND u.status = 'active'
       AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.code <> 'PARENT')`,
    [ids, schoolId],
  );
  const names = new Map(rows.map((row) => [Number(row.id), row.name]));
  const missing = ids.filter((id) => !names.has(id));
  if (missing.length) {
    throw AppException.validation([
      { field, message: `Choose active staff members of this school (not staff: user ${missing.join(', ')})` },
    ]);
  }
  return names;
}

export function sortColumn(sorts: Record<string, string>, key: string): string {
  const column = sorts[key];
  if (!column) throw AppException.badRequest(`sort must be one of ${Object.keys(sorts).join(', ')}`, 'INVALID_SORT');
  return column;
}

export function checkRange(from: string, to: string, maxDays: number): void {
  if (from > to) throw AppException.validation([{ field: 'from', message: 'Must be on or before to' }]);
  if (daysBetween(from, to) > maxDays) {
    throw AppException.validation([{ field: 'to', message: `The range can be at most ${maxDays} days` }]);
  }
}
