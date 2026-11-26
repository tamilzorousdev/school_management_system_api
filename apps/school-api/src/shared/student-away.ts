export interface QueryRunnerLike {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

export type BusTrip = 'pickup' | 'drop';
export const AWAY_REASONS = ['leave', 'half_day', 'od', 'absent', 'no_bus', 'early_leave'] as const;
export type AwayReason = (typeof AWAY_REASONS)[number];

export interface TripAway {
  reason: AwayReason;
  note: string;
}

export interface DayPresence {
  leaves: string[];
  od_sessions: string[];
  od_title: string | null;
  morning: string | null;
  afternoon: string | null;
  bus_off?: string[];
  early_leave?: string | null;
}

export type AwayLookup = (studentId: number, date: string, trip: BusTrip) => TripAway | null;

const halfOf = (trip: BusTrip) => (trip === 'pickup' ? 'morning' : 'afternoon');

export function tripAway(day: DayPresence, trip: BusTrip): TripAway | null {
  if (trip === 'drop' && day.early_leave) {
    return { reason: 'early_leave', note: `Gone home early (gate pass) with ${day.early_leave}` };
  }
  if (day.bus_off?.includes(trip)) return { reason: 'no_bus', note: 'Parent: not taking the bus' };
  const half = halfOf(trip);
  const covers = (list: string[]) => list.includes('full') || list.includes(half);
  const session = trip === 'pickup' ? day.morning : (day.afternoon ?? day.morning);
  if (covers(day.od_sessions) || session === 'od') {
    return { reason: 'od', note: day.od_title ? `Sports OD – ${day.od_title}` : 'On duty (OD)' };
  }
  if (covers(day.leaves)) {
    if (day.leaves.includes('full')) return { reason: 'leave', note: 'On leave' };
    return {
      reason: 'half_day',
      note: trip === 'pickup' ? 'Half-day leave: comes in the afternoon' : 'Half-day leave: goes home at noon',
    };
  }
  if (session === 'leave') return { reason: 'leave', note: 'On leave' };
  if (session === 'absent') return { reason: 'absent', note: 'Marked absent' };
  return null;
}

export async function awayLookup(db: QueryRunnerLike, studentIds: number[], dates: string[]): Promise<AwayLookup> {
  const days = new Map<string, DayPresence>();
  if (studentIds.length && dates.length) {
    const rows = (await db.query(
      `SELECT s.id AS student_id, dd.day::text AS date,
              ARRAY(SELECT COALESCE(lr.half_day, 'full') FROM student_leave_requests lr
                    WHERE lr.student_id = s.id AND lr.status = 'approved' AND lr.deleted_at IS NULL
                      AND lr.from_date <= dd.day AND lr.to_date >= dd.day) AS leaves,
              ARRAY(SELECT COALESCE(o.session, 'full') FROM sports_on_duty o
                    WHERE o.student_id = s.id AND o.deleted_at IS NULL
                      AND o.from_date <= dd.day AND o.to_date >= dd.day) AS od_sessions,
              (SELECT o.title FROM sports_on_duty o
                WHERE o.student_id = s.id AND o.deleted_at IS NULL AND o.from_date <= dd.day AND o.to_date >= dd.day
                ORDER BY o.id LIMIT 1) AS od_title,
              ad.morning, ad.afternoon,
              ARRAY(SELECT bo.trip FROM bus_opt_outs bo
                    WHERE bo.student_id = s.id AND bo.opt_date = dd.day AND bo.deleted_at IS NULL) AS bus_off,
              (SELECT concat_ws(' ', gp.pickup_name, '(' || gp.pickup_relation || ')') FROM gate_passes gp
                WHERE gp.student_id = s.id AND gp.pass_date = dd.day AND gp.status = 'released'
                  AND gp.pickup_kind IS NOT NULL AND gp.deleted_at IS NULL
                ORDER BY gp.released_at DESC LIMIT 1) AS early_leave
       FROM unnest($1::int[]) AS s(id)
       CROSS JOIN unnest($2::date[]) AS dd(day)
       LEFT JOIN student_attendance_days ad ON ad.student_id = s.id AND ad.date = dd.day`,
      [studentIds, dates],
    )) as (DayPresence & { student_id: number; date: string })[];
    for (const row of rows) days.set(`${Number(row.student_id)}:${row.date}`, row);
  }
  return (studentId, date, trip) => {
    const day = days.get(`${studentId}:${date}`);
    return day ? tripAway(day, trip) : null;
  };
}

const HALF_SQL = (trip: string) => `(CASE WHEN ${trip} = 'pickup' THEN 'morning' ELSE 'afternoon' END)`;

export const AWAY_FOR_TRIP_SQL = (student: string, date: string, trip: string) =>
  `(EXISTS (SELECT 1 FROM student_leave_requests lr
      WHERE lr.student_id = ${student} AND lr.status = 'approved' AND lr.deleted_at IS NULL
        AND lr.from_date <= ${date} AND lr.to_date >= ${date}
        AND (lr.half_day IS NULL OR lr.half_day = ${HALF_SQL(trip)}))
    OR EXISTS (SELECT 1 FROM sports_on_duty o
      WHERE o.student_id = ${student} AND o.deleted_at IS NULL
        AND o.from_date <= ${date} AND o.to_date >= ${date}
        AND (o.session IS NULL OR o.session = ${HALF_SQL(trip)}))
    OR (${trip} = 'drop' AND EXISTS (SELECT 1 FROM gate_passes gp
      WHERE gp.student_id = ${student} AND gp.pass_date = ${date} AND gp.status = 'released'
        AND gp.pickup_kind IS NOT NULL AND gp.deleted_at IS NULL))
    OR EXISTS (SELECT 1 FROM bus_opt_outs bo
      WHERE bo.student_id = ${student} AND bo.opt_date = ${date} AND bo.trip = ${trip} AND bo.deleted_at IS NULL)
    OR EXISTS (SELECT 1 FROM student_attendance_days ad
      WHERE ad.student_id = ${student} AND ad.date = ${date}
        AND (CASE WHEN ${trip} = 'pickup' THEN ad.morning ELSE COALESCE(ad.afternoon, ad.morning) END)
          IN ('absent', 'leave', 'od')))`;
