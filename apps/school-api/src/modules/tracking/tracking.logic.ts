import { createHmac, timingSafeEqual } from 'crypto';
import { TransportMode } from '../transport/entities/student-transport.entity';
import { StopStatus, TripKind, TripStop } from './entities/transport-trip.entity';

export const CHILD_BUS_STATUSES = ['no_trip', 'on_the_way', 'approaching', 'at_stop', 'passed', 'trip_ended'] as const;
export type ChildBusStatus = (typeof CHILD_BUS_STATUSES)[number];

export function ridesOn(mode: TransportMode, kind: TripKind): boolean {
  return mode === 'both' || mode === kind;
}

export function orderStops<T extends { sequence: number }>(stops: T[], kind: TripKind): T[] {
  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
  return kind === 'pickup' ? sorted : sorted.reverse();
}

export function signatureValid(rawBody: Buffer | string, header: string | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const given = Buffer.from(header);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

const STOP_EVENT_STATUS: Record<string, StopStatus> = {
  'stop.approaching': 'approaching',
  'stop.arrived': 'arrived',
  'stop.departed': 'departed',
};

const STATUS_RANK: Record<StopStatus, number> = { pending: 0, approaching: 1, arrived: 2, departed: 3, skipped: 3 };

export function applyStopEvent(
  stops: TripStop[],
  type: string,
  stopId: number,
  at: string,
  etaSeconds: number | null,
): TripStop[] {
  const status = STOP_EVENT_STATUS[type];
  if (!status) return stops;
  const index = stops.findIndex((stop) => stop.stop_id === stopId);
  if (index < 0) return stops;
  return stops.map((stop, position) => {
    if (position < index && STATUS_RANK[stop.status] < 2 && status !== 'approaching') {
      return { ...stop, status: 'skipped' as const, eta_seconds: null };
    }
    if (position !== index || STATUS_RANK[status] < STATUS_RANK[stop.status]) return stop;
    return {
      ...stop,
      status,
      eta_seconds: status === 'approaching' ? etaSeconds : status === 'arrived' ? 0 : null,
      approached_at: status === 'approaching' ? at : stop.approached_at,
      arrived_at: status === 'arrived' ? at : stop.arrived_at,
      departed_at: status === 'departed' ? at : stop.departed_at,
    };
  });
}

export function childBusStatus(trip: { status: string; stops: TripStop[] } | null, stopId: number): ChildBusStatus {
  if (!trip) return 'no_trip';
  const stop = trip.stops.find((item) => item.stop_id === stopId);
  if (trip.status === 'ended') return 'trip_ended';
  if (!stop) return 'on_the_way';
  if (stop.status === 'approaching') return 'approaching';
  if (stop.status === 'arrived') return 'at_stop';
  if (stop.status === 'departed' || stop.status === 'skipped') return 'passed';
  return 'on_the_way';
}

export function minutesFrom(seconds: number | null): number {
  return Math.max(1, Math.round((seconds ?? 60) / 60));
}

export function tripLabel(kind: TripKind): { en: string; ta: string } {
  return kind === 'pickup' ? { en: 'morning pickup', ta: 'காலை' } : { en: 'evening drop', ta: 'மாலை' };
}

const DEFAULT_STOP_GAP_SECONDS = 300;

export function plannedGapSeconds(from: string | null, to: string | null): number {
  const seconds = (time: string | null) => {
    const match = /^(\d{1,2}):(\d{2})/.exec(time ?? '');
    return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 : null;
  };
  const start = seconds(from);
  const end = seconds(to);
  if (start === null || end === null) return DEFAULT_STOP_GAP_SECONDS;
  const gap = Math.abs(end - start);
  return gap > 0 && gap <= 3600 ? gap : DEFAULT_STOP_GAP_SECONDS;
}
