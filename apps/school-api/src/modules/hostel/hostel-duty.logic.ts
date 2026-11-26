import { addDays } from './hostel.logic';

export const CHECK_IN_EARLY_MINUTES = 30;
export const STUDY_BACK_DAYS = 2;
export const MAX_ROSTER_DAYS = 31;
export const MAX_REPORT_DAYS = 366;

export type CheckInWindow = 'too_early' | 'open' | 'over';

export interface ShiftBounds {
  start: Date;
  end: Date;
}

export interface SeatState {
  id: number;
  seat_no: string;
  active: boolean;
  occupied: boolean;
}

export interface CapacityPlan {
  activate: number[];
  deactivate: number[];
  add: string[];
}

export function crossesMidnight(startTime: string, endTime: string): boolean {
  return endTime <= startTime;
}

export function shiftEndDate(dutyDate: string, startTime: string, endTime: string): string {
  return crossesMidnight(startTime, endTime) ? addDays(dutyDate, 1) : dutyDate;
}

export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return Math.round((wall - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

export function zonedDate(date: string, time: string, timeZone: string): Date {
  const wall = Date.parse(`${date}T${time}:00Z`);
  return new Date(wall - zoneOffsetMinutes(timeZone, new Date(wall)) * 60000);
}

export function shiftBounds(dutyDate: string, startTime: string, endTime: string, timeZone: string): ShiftBounds {
  return {
    start: zonedDate(dutyDate, startTime, timeZone),
    end: zonedDate(shiftEndDate(dutyDate, startTime, endTime), endTime, timeZone),
  };
}

export function checkInWindow(bounds: ShiftBounds, now: Date, earlyMinutes = CHECK_IN_EARLY_MINUTES): CheckInWindow {
  if (now.getTime() < bounds.start.getTime() - earlyMinutes * 60000) return 'too_early';
  if (now.getTime() > bounds.end.getTime()) return 'over';
  return 'open';
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function runsOn(days: number[], date: string): boolean {
  return days.map(Number).includes(weekdayOf(date));
}

export function seatNumber(label: string): number {
  const digits = label.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

export function seatLabels(count: number, existing: string[] = []): string[] {
  const taken = new Set(existing.map((label) => label.toUpperCase()));
  const labels: string[] = [];
  let number = 1;
  while (labels.length < count) {
    const label = `S${number}`;
    if (!taken.has(label)) labels.push(label);
    number += 1;
  }
  return labels;
}

export function capacityPlan(seats: SeatState[], capacity: number): CapacityPlan | null {
  const ordered = [...seats].sort((a, b) => seatNumber(a.seat_no) - seatNumber(b.seat_no));
  const active = ordered.filter((seat) => seat.active);
  const plan: CapacityPlan = { activate: [], deactivate: [], add: [] };
  if (capacity > active.length) {
    const needed = capacity - active.length;
    const inactive = ordered.filter((seat) => !seat.active).slice(0, needed);
    plan.activate = inactive.map((seat) => seat.id);
    plan.add = seatLabels(
      needed - inactive.length,
      ordered.map((seat) => seat.seat_no),
    );
    return plan;
  }
  const surplus = active.length - capacity;
  const free = active.filter((seat) => !seat.occupied).reverse();
  if (free.length < surplus) return null;
  plan.deactivate = free.slice(0, surplus).map((seat) => seat.id);
  return plan;
}

export function pairUp<A, B>(candidates: A[], seats: B[]): { pairs: [A, B][]; left: A[] } {
  const count = Math.min(candidates.length, seats.length);
  return {
    pairs: candidates.slice(0, count).map((candidate, index) => [candidate, seats[index]] as [A, B]),
    left: candidates.slice(count),
  };
}

export function percentOf(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

export function averageOf(total: number, count: number): number {
  if (!count) return 0;
  return Math.round((total / count) * 10) / 10;
}

export function duplicateKeys<T>(items: T[], key: (item: T) => string): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

export function dateRange(
  from: string | undefined,
  to: string | undefined,
  today: string,
  defaultDays: number,
): { from: string; to: string } {
  const start = from ?? (to ? addDays(to, -(defaultDays - 1)) : today);
  const end = to ?? addDays(start, defaultDays - 1);
  return { from: start, to: end };
}
