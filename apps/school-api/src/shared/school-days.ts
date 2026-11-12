import { EntityManager } from 'typeorm';

export const WEEKLY_OFF = [0];

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to && dates.length < 400; date = addDays(date, 1)) dates.push(date);
  return dates;
}

export function monthRange(month: string): { from: string; to: string } {
  const [year, value] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, value, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export function workingDays(from: string, to: string, holidays: Set<string>): string[] {
  return datesBetween(from, to).filter((date) => !WEEKLY_OFF.includes(weekday(date)) && !holidays.has(date));
}

export const forClass = (param: string) => `(class_ids IS NULL OR ${param}::int = ANY(class_ids))`;

export async function holidaySet(
  manager: EntityManager,
  schoolId: number,
  from: string,
  to: string,
  classId?: number | null,
): Promise<Set<string>> {
  const rows: { date: string; end_date: string | null }[] = await manager.query(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, to_char(end_date, 'YYYY-MM-DD') AS end_date FROM holidays
     WHERE school_id = $1 AND deleted_at IS NULL AND type <> 'event'
       AND date <= $3 AND COALESCE(end_date, date) >= $2
       AND ${classId ? forClass('$4') : 'class_ids IS NULL'}`,
    classId ? [schoolId, from, to, classId] : [schoolId, from, to],
  );
  const set = new Set<string>();
  for (const row of rows) for (const date of datesBetween(row.date, row.end_date ?? row.date)) set.add(date);
  return set;
}

export function distanceMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radius = 6371000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * radius * Math.asin(Math.sqrt(a)));
}

export function percent(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}
