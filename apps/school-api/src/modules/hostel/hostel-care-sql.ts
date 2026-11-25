import { EntityManager } from 'typeorm';
import { AppException } from '@app/common';
import { MEALS } from './entities/hostel-care.entity';

type Runner = Pick<EntityManager, 'query'>;

export interface CareAdmission {
  id: number;
  student_id: number;
  hostel_id: number;
  status: string;
}

export const mealOrder = (column: string) =>
  `array_position(ARRAY[${MEALS.map((meal) => `'${meal}'`).join(', ')}]::varchar[], ${column})`;

export const bedJoins = (
  admissionColumn: string,
) => `LEFT JOIN hostel_allocations al ON al.admission_id = ${admissionColumn} AND al.to_date IS NULL
       LEFT JOIN hostel_rooms r ON r.id = al.room_id
       LEFT JOIN hostel_beds bd ON bd.id = al.bed_id`;

export const BED_COLUMN = `CASE WHEN r.id IS NULL THEN NULL ELSE CONCAT(r.room_no, ' / ', bd.bed_no) END AS bed`;

export const pageClause = (query: { page: number; limit: number }) =>
  `LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`;

export function sortColumn(sorts: Record<string, string>, sort: string | undefined, fallback: string): string {
  const column = sorts[sort ?? fallback];
  if (!column) {
    throw AppException.badRequest(`sort must be one of ${Object.keys(sorts).join(', ')}`, 'INVALID_SORT');
  }
  return column;
}

export async function careHostel(
  runner: Runner,
  schoolId: number,
  hostelId: number,
): Promise<{ id: number; name: string }> {
  const [hostel] = await runner.query(
    `SELECT id, name FROM hostels WHERE school_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [schoolId, hostelId],
  );
  if (!hostel) throw AppException.notFound('Hostel not found', 'HOSTEL_NOT_FOUND');
  return { id: Number(hostel.id), name: hostel.name };
}

export async function careAdmission(
  runner: Runner,
  schoolId: number,
  admissionId: number,
  lock = false,
): Promise<CareAdmission> {
  const [row] = await runner.query(
    `SELECT id, student_id, hostel_id, status FROM hostel_admissions
     WHERE school_id = $1 AND id = $2 AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`,
    [schoolId, admissionId],
  );
  if (!row) throw AppException.notFound('Hostel admission not found', 'HOSTEL_ADMISSION_NOT_FOUND');
  if (row.status === 'checked_out') {
    throw AppException.conflict('This student has checked out of the hostel', 'HOSTEL_ADMISSION_CLOSED');
  }
  return {
    id: Number(row.id),
    student_id: Number(row.student_id),
    hostel_id: Number(row.hostel_id),
    status: row.status,
  };
}
