import { addDays, weekday } from '../../shared/school-days';

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface Schedule {
  timing: 'period' | 'extra_time';
  day_of_week: number | null;
  days: number[] | null;
  start_date: string | null;
  end_date: string | null;
  start_time?: string | null;
  end_time?: string | null;
}

export interface Window {
  from: string;
  to: string;
}

export interface Occurrence {
  date: string;
  start: string;
  end: string;
}

export const MAX_OCCURRENCES = 400;

export function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function scheduleDays(schedule: Schedule): number[] {
  if (schedule.timing === 'period') return schedule.day_of_week === null ? [] : [schedule.day_of_week];
  return schedule.days ?? [];
}

export function runsOn(schedule: Schedule, date: string, year: Window): boolean {
  const from = schedule.start_date ?? year.from;
  const to = schedule.end_date ?? year.to;
  if (date < from || date > to) return false;
  const days = scheduleDays(schedule);
  if (!days.length) return schedule.timing === 'extra_time' && date === from;
  return days.includes(weekday(date));
}

export function occurrences(schedule: Schedule, year: Window, within?: Window): string[] {
  const from = [schedule.start_date ?? year.from, within?.from ?? year.from].sort().pop()!;
  const to = [schedule.end_date ?? year.to, within?.to ?? year.to].sort()[0];
  const dates: string[] = [];
  for (let date = from; date <= to && dates.length < MAX_OCCURRENCES; date = addDays(date, 1)) {
    if (runsOn(schedule, date, year)) dates.push(date);
  }
  return dates;
}

export function firstClash(
  mine: Occurrence[],
  theirs: Occurrence[],
): { date: string; start: string; end: string } | null {
  const byDate = new Map<string, Occurrence[]>();
  for (const item of theirs) byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);
  for (const item of mine) {
    const other = (byDate.get(item.date) ?? []).find((slot) =>
      timesOverlap(item.start, item.end, slot.start, slot.end),
    );
    if (other) return { date: item.date, start: other.start, end: other.end };
  }
  return null;
}

export function to12(time: string | null): string {
  if (!time) return '';
  const [hours, minutes] = time.split(':').map(Number);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  return `${((hours + 11) % 12) + 1}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

const shortDate = (date: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );

export function whenText(
  schedule: Schedule & { period_no: number | null },
  times: { start: string | null; end: string | null },
): string {
  const time = times.start && times.end ? `${to12(times.start)} – ${to12(times.end)}` : '';
  if (schedule.timing === 'period') {
    const day = schedule.day_of_week === null ? '' : DAY_SHORT[schedule.day_of_week];
    return [`every ${day}`, `period ${schedule.period_no}`, time].filter(Boolean).join(', ');
  }
  const days = schedule.days ?? [];
  const range =
    schedule.start_date && schedule.end_date && schedule.start_date !== schedule.end_date
      ? `${shortDate(schedule.start_date)} to ${shortDate(schedule.end_date)}`
      : schedule.start_date
        ? `on ${shortDate(schedule.start_date)}`
        : '';
  const repeat = days.length ? `every ${days.map((day) => DAY_SHORT[day]).join(', ')}` : '';
  return [repeat, time, range].filter(Boolean).join(', ');
}
