import { FieldError } from '@app/common';
import { addDays, daysBetween } from './hostel.logic';

export const DEFAULT_REPORT_DAYS = 30;
export const MAX_REPORT_DAYS = 366;
export const REPEAT_CASE_THRESHOLD = 3;
export const DEFAULT_TOP = 10;

export interface ReportRange {
  from: string;
  to: string;
  days: number;
}

export interface CountRow {
  key: string;
  count: number;
}

export function defaultRange(query: { from?: string; to?: string }, today: string): { from: string; to: string } {
  if (query.from && !query.to) {
    const end = addDays(query.from, DEFAULT_REPORT_DAYS - 1);
    return { from: query.from, to: end < today ? end : today };
  }
  const to = query.to ?? today;
  return { from: query.from ?? addDays(to, -(DEFAULT_REPORT_DAYS - 1)), to };
}

export function rangeErrors(from: string, to: string): FieldError[] {
  if (from > to) return [{ field: 'from', message: 'from must be on or before to' }];
  if (daysBetween(from, to) > MAX_REPORT_DAYS) {
    return [{ field: 'to', message: `A report can cover at most ${MAX_REPORT_DAYS} days` }];
  }
  return [];
}

export function reportRange(from: string, to: string): ReportRange {
  return { from, to, days: daysBetween(from, to) };
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function percent(part: number, whole: number, digits = 1): number | null {
  if (!whole) return null;
  return round((part / whole) * 100, digits);
}

export function averageOf(value: unknown, digits = 1): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? round(number, digits) : null;
}

export function dayKeys(from: string, to: string): string[] {
  const keys: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) keys.push(day);
  return keys;
}

export function monthKeys(from: string, to: string): string[] {
  const keys: string[] = [];
  let [year, month] = from.slice(0, 7).split('-').map(Number);
  const last = to.slice(0, 7);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (key > last) return keys;
    keys.push(key);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
}

export function bucketByMonth(rows: { date: string; count: number }[], from: string, to: string): CountRow[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const month = row.date.slice(0, 7);
    totals.set(month, (totals.get(month) ?? 0) + row.count);
  }
  return monthKeys(from, to).map((key) => ({ key, count: totals.get(key) ?? 0 }));
}

export function fillBy<T>(keys: string[], rows: T[], keyOf: (row: T) => string, empty: (key: string) => T): T[] {
  const byKey = new Map(rows.map((row) => [keyOf(row), row]));
  return keys.map((key) => byKey.get(key) ?? empty(key));
}

export function countsFor(catalog: readonly string[], rows: CountRow[]): CountRow[] {
  const byKey = new Map(rows.map((row) => [row.key, row.count]));
  const known = catalog.map((key) => ({ key, count: byKey.get(key) ?? 0 }));
  const extra = rows.filter((row) => !catalog.includes(row.key));
  return [...known, ...extra];
}

export function tally<T extends { count: number }>(
  rows: T[],
  keyOf: (row: T) => string | null,
  include: (row: T) => boolean = () => true,
): CountRow[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null || !include(row)) continue;
    totals.set(key, (totals.get(key) ?? 0) + row.count);
  }
  return [...totals].map(([key, count]) => ({ key, count }));
}

export function sumCounts(rows: CountRow[]): number {
  return rows.reduce((total, row) => total + row.count, 0);
}

export function labelOf(key: string): string {
  const words = key.replace(/_/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

export function attendanceRate(counts: { present: number; late: number; absent: number }): number | null {
  return percent(counts.present + counts.late, counts.present + counts.late + counts.absent);
}
