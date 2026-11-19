import {
  CRITICAL_PRE_TRIP_ITEMS,
  PRE_TRIP_ITEMS,
  PreTripItem,
  PreTripMark,
  ServiceCategory,
} from './entities/fleet-maintenance.entity';

export type DueStatus = 'ok' | 'due_soon' | 'overdue';

export interface ScheduleRule {
  every_km: number | null;
  every_months: number | null;
  last_done_on: string;
  last_done_km: number | null;
}

export interface DueWindow {
  due_soon_km: number;
  due_soon_days: number;
}

export interface ScheduleState {
  next_due_on: string | null;
  next_due_km: number | null;
  days_left: number | null;
  km_left: number | null;
  status: DueStatus;
}

export interface FillRow {
  id: number;
  odometer_km: number;
  litres: number;
  is_full: boolean;
}

export interface FillEconomy {
  km_since_last: number | null;
  km_per_litre: number | null;
}

export type GpsCheckStatus = 'ok' | 'mismatch' | 'unknown';

export interface WarrantyTicket {
  id: number;
  category: string | null;
  closed_at: Date | null;
  odometer_km: number | null;
  warranty_months: number | null;
  warranty_km: number | null;
}

export interface WarrantyMatch {
  ticket_id: number;
  until: string | null;
  until_km: number | null;
}

export const STANDARD_SCHEDULES: {
  category: ServiceCategory;
  title: string;
  every_km: number | null;
  every_months: number | null;
}[] = [
  { category: 'engine_oil', title: 'Engine oil and filter change', every_km: 10000, every_months: 6 },
  { category: 'tyres', title: 'Tyre rotation and check', every_km: 15000, every_months: null },
  { category: 'brakes', title: 'Brake check', every_km: null, every_months: 3 },
  { category: 'general_service', title: 'General service', every_km: null, every_months: 6 },
];

const DAY_MS = 86400000;
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function scheduleState(
  rule: ScheduleRule,
  currentKm: number | null,
  today: string,
  window: DueWindow,
): ScheduleState {
  const nextDueOn = rule.every_months ? addMonths(rule.last_done_on, rule.every_months) : null;
  const nextDueKm =
    rule.every_km && rule.last_done_km !== null ? round(Number(rule.last_done_km) + rule.every_km, 1) : null;
  const daysLeft = nextDueOn ? daysBetween(today, nextDueOn) : null;
  const kmLeft = nextDueKm !== null && currentKm !== null ? round(nextDueKm - currentKm, 1) : null;
  const overdue = (daysLeft !== null && daysLeft < 0) || (kmLeft !== null && kmLeft < 0);
  const soon =
    (daysLeft !== null && daysLeft <= window.due_soon_days) || (kmLeft !== null && kmLeft <= window.due_soon_km);
  return {
    next_due_on: nextDueOn,
    next_due_km: nextDueKm,
    days_left: daysLeft,
    km_left: kmLeft,
    status: overdue ? 'overdue' : soon ? 'due_soon' : 'ok',
  };
}

export function fillEconomy(rows: FillRow[]): Map<number, FillEconomy> {
  const sorted = [...rows].sort((a, b) => a.odometer_km - b.odometer_km || a.id - b.id);
  const result = new Map<number, FillEconomy>();
  let previous: FillRow | null = null;
  let lastFull: FillRow | null = null;
  let litresSinceFull = 0;
  for (const row of sorted) {
    litresSinceFull += row.litres;
    const kmSinceLast = previous ? round(row.odometer_km - previous.odometer_km, 1) : null;
    let kmPerLitre: number | null = null;
    if (row.is_full) {
      if (lastFull && litresSinceFull > 0 && row.odometer_km > lastFull.odometer_km) {
        kmPerLitre = round((row.odometer_km - lastFull.odometer_km) / litresSinceFull, 2);
      }
      lastFull = row;
      litresSinceFull = 0;
    }
    result.set(row.id, { km_since_last: kmSinceLast, km_per_litre: kmPerLitre });
    previous = row;
  }
  return result;
}

export function priceWarning(price: number, average: number | null, percent: number): string | null {
  if (!average || average <= 0 || price <= 0) return null;
  const gap = ((price - average) / average) * 100;
  if (Math.abs(gap) <= percent) return null;
  return `Price ₹${price.toFixed(2)}/L is ${Math.abs(Math.round(gap))}% ${gap > 0 ? 'above' : 'below'} this bus's recent average of ₹${average.toFixed(2)}/L`;
}

export function mileageDropped(kmPerLitre: number | null, normal: number | null, percent: number): boolean {
  if (kmPerLitre === null || normal === null || normal <= 0) return false;
  return kmPerLitre < normal * (1 - percent / 100);
}

export function gpsCheck(odometerKm: number | null, gpsKm: number | null): GpsCheckStatus {
  if (odometerKm === null || gpsKm === null || gpsKm <= 0 || odometerKm <= 0) return 'unknown';
  if (gpsKm > odometerKm * 1.1 + 10) return 'mismatch';
  if (odometerKm > gpsKm * 1.5 + 30) return 'mismatch';
  return 'ok';
}

export function warrantyMatch(
  earlier: WarrantyTicket[],
  category: string | null,
  today: string,
  currentKm: number | null,
  zone: string,
): WarrantyMatch | null {
  if (!category) return null;
  for (const ticket of earlier) {
    if (ticket.category !== category || !ticket.closed_at) continue;
    if (!ticket.warranty_months && !ticket.warranty_km) continue;
    const closedOn = ticket.closed_at.toLocaleDateString('en-CA', { timeZone: zone });
    const until = ticket.warranty_months ? addMonths(closedOn, ticket.warranty_months) : null;
    const untilKm =
      ticket.warranty_km && ticket.odometer_km !== null
        ? round(Number(ticket.odometer_km) + ticket.warranty_km, 1)
        : null;
    const inDate = until !== null && today <= until;
    const inKm = untilKm !== null && currentKm !== null && currentKm <= untilKm;
    if (inDate || inKm) return { ticket_id: ticket.id, until, until_km: untilKm };
  }
  return null;
}

export function isLocked(date: string | null, lockedUntil: string | null): boolean {
  return Boolean(date && lockedUntil && date <= lockedUntil);
}

export function isMonthEnd(date: string): boolean {
  return addMonths(date.slice(0, 8) + '01', 1) === nextDay(date);
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

export function preTripResult(marks: { item: PreTripItem; ok: boolean; note?: string | null }[]): {
  items: PreTripMark[];
  failed: PreTripItem[];
  critical_failed: boolean;
} {
  const byItem = new Map(marks.map((mark) => [mark.item, mark]));
  const items = PRE_TRIP_ITEMS.map((item) => ({
    item,
    ok: byItem.get(item)?.ok ?? false,
    note: byItem.get(item)?.note?.trim() || null,
  }));
  const failed = items.filter((mark) => !mark.ok).map((mark) => mark.item);
  return { items, failed, critical_failed: failed.some((item) => CRITICAL_PRE_TRIP_ITEMS.includes(item)) };
}

export function idleLitres(minutes: number, litresPerHour: number): number {
  return round((Math.max(0, minutes) / 60) * litresPerHour, 1);
}

export function costPerKm(cost: number, km: number | null): number | null {
  return km && km > 0 ? round(cost / km, 2) : null;
}
