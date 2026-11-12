import { EntityManager } from 'typeorm';
import { AppException } from '@app/common';

export interface TeacherLoad {
  user_id: number;
  name: string;
  max_periods_per_week: number;
  assigned: number;
  scheduled: number;
}

export async function teacherLoads(
  manager: Pick<EntityManager, 'query'>,
  schoolId: number,
  yearId: number,
  userIds: number[],
): Promise<Map<number, TeacherLoad>> {
  if (!userIds.length) return new Map();
  const rows: { user_id: number; name: string; max_periods_per_week: number; assigned: string; scheduled: string }[] =
    await manager.query(
      `SELECT st.user_id, u.name, st.max_periods_per_week,
              COALESCE((SELECT SUM(ta.periods_per_week) FROM teacher_assignments ta
                WHERE ta.teacher_user_id = st.user_id AND ta.academic_year_id = $2 AND ta.deleted_at IS NULL), 0) AS assigned,
              (SELECT COUNT(*) FROM timetable_slots t
                WHERE t.teacher_user_id = st.user_id AND t.academic_year_id = $2) AS scheduled
       FROM staff st JOIN users u ON u.id = st.user_id
       WHERE st.school_id = $1 AND st.user_id = ANY($3) AND st.deleted_at IS NULL`,
      [schoolId, yearId, userIds],
    );
  return new Map(
    rows.map((row) => [
      Number(row.user_id),
      {
        user_id: Number(row.user_id),
        name: row.name,
        max_periods_per_week: Number(row.max_periods_per_week),
        assigned: Number(row.assigned),
        scheduled: Number(row.scheduled),
      },
    ]),
  );
}

export function assertAssignedWithinLimit(before: Map<number, TeacherLoad>, after: Map<number, TeacherLoad>): void {
  for (const load of after.values()) {
    const previous = before.get(load.user_id)?.assigned ?? 0;
    if (load.assigned > load.max_periods_per_week && load.assigned > previous) {
      throw AppException.conflict(
        `${load.name} can teach at most ${load.max_periods_per_week} periods a week. These assignments add up to ${load.assigned} periods a week. Give some sections to another teacher, lower the periods a week, or raise the limit in the staff profile.`,
        'TEACHER_OVER_LIMIT',
      );
    }
  }
}

export function assertCanScheduleOneMore(load: TeacherLoad | undefined): void {
  if (load && load.scheduled >= load.max_periods_per_week) {
    throw AppException.conflict(
      `${load.name} already has ${load.scheduled} periods a week in the timetable, the most allowed (${load.max_periods_per_week} a week). Choose another teacher or raise the limit in the staff profile.`,
      'TEACHER_OVER_LIMIT',
    );
  }
}

export function assertLimitCoversLoad(load: TeacherLoad | undefined, limit: number): void {
  if (!load) return;
  const busiest = Math.max(load.assigned, load.scheduled);
  if (limit < busiest) {
    throw AppException.conflict(
      `${load.name} already has ${busiest} periods a week, so the limit cannot go below ${busiest} a week. Move some periods to another teacher first.`,
      'LIMIT_BELOW_LOAD',
    );
  }
}
