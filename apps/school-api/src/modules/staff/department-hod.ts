import { EntityManager } from 'typeorm';
import { ROLES } from '../access/access.catalog';

export async function departmentHodUserId(
  db: Pick<EntityManager, 'query'>,
  schoolId: number,
  department: string | null,
  excludeUserId: number,
): Promise<number | null> {
  if (!department?.trim()) return null;
  const [row] = await db.query(
    `SELECT st.user_id FROM staff st
     JOIN user_roles ur ON ur.user_id = st.user_id JOIN roles r ON r.id = ur.role_id AND r.code = $3
     WHERE st.school_id = $1 AND LOWER(st.department) = LOWER($2) AND st.user_id <> $4
       AND st.deleted_at IS NULL AND st.status = 'active'
     ORDER BY st.joining_date LIMIT 1`,
    [schoolId, department, ROLES.HOD, excludeUserId],
  );
  return row ? Number(row.user_id) : null;
}
