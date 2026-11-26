import type { CheckResult, InspectionResult, LockerStatus } from './entities/hostel-rooms.entity';
import { roomNumbers } from './hostel.logic';

export const DEFAULT_CHECKLIST = [
  'Bed & mattress',
  'Cupboard',
  'Table & chair',
  'Fan & lights',
  'Windows & doors',
  'Floor clean',
  'Washroom clean',
  'Walls & ceiling',
  'No banned items',
] as const;

export const LOCKER_SETTABLE_STATUSES = ['available', 'damaged', 'blocked'] as const;
export type LockerSettableStatus = (typeof LOCKER_SETTABLE_STATUSES)[number];

export interface CheckMark {
  item: string;
  result: CheckResult;
  note?: string | null;
}

export function inspectionScore(items: Pick<CheckMark, 'result'>[]): number {
  const ok = items.filter((item) => item.result === 'ok').length;
  const issues = items.filter((item) => item.result === 'issue').length;
  if (!ok && !issues) return 100;
  return Math.round((ok / (ok + issues)) * 100);
}

export function inspectionResult(items: Pick<CheckMark, 'result'>[]): InspectionResult {
  return items.some((item) => item.result === 'issue') ? 'issues' : 'ok';
}

export function issueSummary(items: CheckMark[], max = 1000): string | null {
  const issues = items
    .filter((item) => item.result === 'issue')
    .map((item) => (item.note ? `${item.item}: ${item.note}` : item.item));
  if (!issues.length) return null;
  return `Room inspection issues: ${issues.join('; ')}`.slice(0, max);
}

export function lockerNumbers(prefix: string, from: number, count: number, pad: number): string[] {
  return roomNumbers(prefix, from, count, pad);
}

export function canChangeLockerStatus(current: LockerStatus): boolean {
  return current !== 'allotted';
}

export function missingKeys(given: number, returned: number): number {
  return Math.max(0, given - returned);
}

export function lockerAfterReturn(damaged: boolean): LockerStatus {
  return damaged ? 'damaged' : 'available';
}

export function returnNote(missing: number, note: string | null | undefined, max = 255): string | null {
  const parts = [missing ? `${missing} key${missing === 1 ? '' : 's'} not returned` : null, note || null].filter(
    Boolean,
  );
  return parts.length ? parts.join(' · ').slice(0, max) : null;
}

export function assetsToAdd<T extends { item_name: string }>(existing: string[], items: T[]): T[] {
  const taken = new Set(existing.map((name) => name.trim().toLowerCase()));
  const result: T[] = [];
  for (const item of items) {
    const key = item.item_name.trim().toLowerCase();
    if (taken.has(key)) continue;
    taken.add(key);
    result.push(item);
  }
  return result;
}

export function lockerCounts(rows: { status: string; count: number | string }[]) {
  const counts = { total: 0, available: 0, allotted: 0, damaged: 0, blocked: 0 };
  for (const row of rows) {
    const value = Number(row.count);
    counts.total += value;
    if (row.status in counts && row.status !== 'total') counts[row.status as LockerStatus] += value;
  }
  return counts;
}
