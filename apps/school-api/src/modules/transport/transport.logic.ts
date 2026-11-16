import { distanceMetres } from '../../shared/school-days';
import { ExpiryKind, VehicleExpiryKind } from './entities/expiry-alert.entity';

export const DUE_SOON_DAYS = 30;
export const ALERT_THRESHOLDS = [30, 15, 7, 1, 0];
export const OVERDUE_REPEAT_DAYS = 3;
export const SMS_THRESHOLDS = [7, 1, 0];
export const SELF_ALERT_THRESHOLDS = [7, 1, 0];
export const NEARLY_FULL_PERCENT = 90;
export const ROAD_KINDS: VehicleExpiryKind[] = ['insurance', 'fitness', 'permit'];

export const EXPIRY_LABELS: Record<ExpiryKind, string> = {
  insurance: 'Insurance',
  fitness: 'Fitness certificate',
  permit: 'Permit',
  puc: 'PUC certificate',
  rc: 'Registration certificate (RC)',
  road_tax: 'Road tax',
  speed_governor: 'Speed governor certificate',
  fire_extinguisher: 'Fire extinguisher refill',
  first_aid: 'First aid kit',
  licence: 'Driving licence',
  badge: 'PSV badge',
  medical: 'Medical fitness',
  police: 'Police verification',
};

export function selfAlertThreshold(daysLeft: number): number | null {
  const threshold = alertThreshold(daysLeft);
  return threshold !== null && (threshold <= 0 || SELF_ALERT_THRESHOLDS.includes(threshold)) ? threshold : null;
}

export function sendsSms(threshold: number): boolean {
  return SMS_THRESHOLDS.includes(threshold);
}

export function roadBlockers(expiries: { kind: ExpiryKind; label: string; state: string }[]): string[] {
  return expiries
    .filter((item) => (ROAD_KINDS as ExpiryKind[]).includes(item.kind) && item.state === 'expired')
    .map((item) => item.label);
}

export function occupancy(students: number, capacity: number) {
  const percent = capacity > 0 ? Math.round((students / capacity) * 100) : 0;
  return {
    occupancy_percent: percent,
    nearly_full: percent >= NEARLY_FULL_PERCENT && students <= capacity,
    over_capacity: students > capacity,
  };
}

export interface Point {
  lat: number;
  lng: number;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

export function expiryState(kind: ExpiryKind, date: string | null, today: string) {
  if (!date) return { kind, label: EXPIRY_LABELS[kind], date: null, days_left: null, state: 'missing' as const };
  const daysLeft = daysBetween(today, date);
  const state = daysLeft < 0 ? 'expired' : daysLeft <= DUE_SOON_DAYS ? 'due_soon' : 'ok';
  return { kind, label: EXPIRY_LABELS[kind], date, days_left: daysLeft, state: state as 'ok' | 'due_soon' | 'expired' };
}

export function alertThreshold(daysLeft: number): number | null {
  if (daysLeft < 0) return 0 - Math.floor(-daysLeft / OVERDUE_REPEAT_DAYS) * OVERDUE_REPEAT_DAYS;
  const reached = ALERT_THRESHOLDS.filter((threshold) => daysLeft <= threshold);
  return reached.length ? Math.min(...reached) : null;
}

export function autoSequence<T extends Point>(stops: T[], school: Point | null): T[] {
  if (stops.length < 2) return [...stops];
  const remaining = [...stops];
  const end = school ?? centroid(stops);
  remaining.sort((a, b) => distance(b, end) - distance(a, end));
  const ordered = [remaining.shift()!];
  while (remaining.length) {
    const last = ordered[ordered.length - 1]!;
    let best = 0;
    for (let index = 1; index < remaining.length; index += 1) {
      if (distance(last, remaining[index]!) < distance(last, remaining[best]!)) best = index;
    }
    ordered.push(remaining.splice(best, 1)[0]!);
  }
  return ordered;
}

export function pathKm(points: Point[]): number {
  let metres = 0;
  for (let index = 1; index < points.length; index += 1) metres += distance(points[index - 1]!, points[index]!);
  return Math.round(metres / 100) / 10;
}

function distance(a: Point, b: Point): number {
  return distanceMetres(a.lat, a.lng, b.lat, b.lng);
}

function centroid(points: Point[]): Point {
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  };
}
