import { DutyPlace } from './entities/driver-ops.entity';

export const REPORTING_LEAD_MINUTES = 15;
const NEAR_METRES = 300;

export function minutesOf(time: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time ?? '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function clockOf(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

export function reportingTime(firstStop: string | null): string | null {
  const minutes = minutesOf(firstStop);
  return minutes === null ? null : clockOf(minutes - REPORTING_LEAD_MINUTES);
}

export function lateMinutes(reporting: string | null, now: string): number {
  const due = minutesOf(reporting);
  const at = minutesOf(now);
  if (due === null || at === null) return 0;
  return Math.max(0, at - due);
}

export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export function dutyPlace(
  point: { lat: number; lng: number } | null,
  school: { lat: number; lng: number; radius_m: number } | null,
  stops: { lat: number; lng: number; radius_m: number }[],
): DutyPlace {
  if (!point) return 'unknown';
  if (school && metresBetween(point, school) <= Math.max(school.radius_m, NEAR_METRES)) return 'school';
  if (stops.some((stop) => metresBetween(point, stop) <= Math.max(stop.radius_m, NEAR_METRES))) return 'stop';
  return 'other';
}

export function hoursBetween(from: Date, to: Date | null): number | null {
  if (!to) return null;
  return Math.round(((to.getTime() - from.getTime()) / 3_600_000) * 10) / 10;
}
