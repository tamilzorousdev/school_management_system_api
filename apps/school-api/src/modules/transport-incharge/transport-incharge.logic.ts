import { BoardStatus } from '../driver-ops/dto/driver-ops.dto';
import { ExpiryDto } from '../transport/dto/transport.dto';

const MOST_URGENT = 10;

export const LATE_MINUTES = 10;
export const DUE_SOON_DAYS = 30;
export const DUE_SOON_KM = 1000;
export const END_OF_DAY_MINUTES = 23 * 60 + 59;

export function paperCounts(items: ExpiryDto[]) {
  const sorted = [...items].sort((a, b) => a.days_left - b.days_left);
  return {
    expired: items.filter((item) => item.days_left < 0).length,
    due_soon: items.filter((item) => item.days_left >= 0).length,
    items: sorted.slice(0, MOST_URGENT),
  };
}

export type LateStatus = 'late_start' | 'running_late' | 'not_started' | 'missed_stops';

export interface LateInput {
  status: BoardStatus;
  planned_minutes: number | null;
  started_minutes: number | null;
  now_minutes: number | null;
  delay_minutes: number | null;
  skipped_stops: number;
}

export interface LateResult {
  status: LateStatus;
  delay_minutes: number;
}

export function classifyLate(input: LateInput): LateResult | null {
  const startDelay =
    input.planned_minutes !== null && input.started_minutes !== null
      ? Math.max(0, input.started_minutes - input.planned_minutes)
      : 0;
  if (input.started_minutes === null && input.status !== 'completed') {
    if (input.planned_minutes === null || input.now_minutes === null) return null;
    const waiting = input.now_minutes - input.planned_minutes;
    return waiting >= LATE_MINUTES ? { status: 'not_started', delay_minutes: waiting } : null;
  }
  if (input.status === 'completed') {
    if (input.skipped_stops > 0) return { status: 'missed_stops', delay_minutes: startDelay };
    return startDelay >= LATE_MINUTES ? { status: 'late_start', delay_minutes: startDelay } : null;
  }
  const running = input.delay_minutes ?? 0;
  if (running >= LATE_MINUTES) return { status: 'running_late', delay_minutes: running };
  return startDelay >= LATE_MINUTES ? { status: 'late_start', delay_minutes: startDelay } : null;
}

export function lateCounts(items: { status: LateStatus }[]) {
  return {
    late: items.filter((item) => item.status === 'late_start' || item.status === 'running_late').length,
    not_started: items.filter((item) => item.status === 'not_started').length,
    missed_stops: items.filter((item) => item.status === 'missed_stops').length,
  };
}

export type MaintenanceDueStatus = 'overdue' | 'due_soon';

export function maintenanceDue(schedule: {
  days_left: number | null;
  km_left: number | null;
}): MaintenanceDueStatus | null {
  const { days_left: days, km_left: km } = schedule;
  if ((days !== null && days < 0) || (km !== null && km < 0)) return 'overdue';
  if ((days !== null && days <= DUE_SOON_DAYS) || (km !== null && km <= DUE_SOON_KM)) return 'due_soon';
  return null;
}

export function onTimePercent(onTime: number, run: number): number {
  return run > 0 ? Math.round((onTime / run) * 1000) / 10 : 0;
}

export function weightedKmPerLitre(rows: { litres: number; km_per_litre: number | null }[]): number | null {
  const rated = rows.filter((row) => row.km_per_litre !== null && row.litres > 0);
  const litres = rated.reduce((sum, row) => sum + row.litres, 0);
  if (!litres) return null;
  const total = rated.reduce((sum, row) => sum + row.litres * row.km_per_litre!, 0);
  return Math.round((total / litres) * 100) / 100;
}

export function monthBounds(month: string): { from: string; to: string } {
  const [year, value] = month.split('-').map(Number) as [number, number];
  const next = new Date(Date.UTC(year, value, 1)).toISOString().slice(0, 10);
  return { from: `${month}-01`, to: next };
}

export function liveCounts(buses: { state: string; trip: unknown }[]) {
  return {
    total: buses.length,
    moving: buses.filter((bus) => bus.state === 'moving').length,
    stopped: buses.filter((bus) => bus.state === 'idle' || bus.state === 'parked').length,
    offline: buses.filter((bus) => bus.state === 'offline').length,
    no_data: buses.filter((bus) => bus.state === 'no_data').length,
    on_trip: buses.filter((bus) => bus.trip !== null).length,
  };
}
