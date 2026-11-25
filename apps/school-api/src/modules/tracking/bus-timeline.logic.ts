import { addDays } from '../../shared/school-days';
import { TransportMode } from '../transport/entities/student-transport.entity';
import { StopStatus, TripKind, TripStop } from './entities/transport-trip.entity';
import { BoardingAction } from './entities/trip-boarding.entity';
import { orderStops, ridesOn } from './tracking.logic';

export const BOARDING_STATUSES = ['not_yet', 'boarded', 'alighted', 'not_at_stop'] as const;
export type BoardingStatus = (typeof BOARDING_STATUSES)[number];

export const TIMELINE_SOURCES = ['live', 'scheduled'] as const;
export type TimelineSource = (typeof TIMELINE_SOURCES)[number];

export interface TimelineStop {
  stop_id: number;
  name: string;
  sequence: number;
  planned_time: string | null;
  planned_at: Date | null;
  status: StopStatus;
  eta_seconds: number | null;
  eta_at: Date | null;
  arrived_at: Date | null;
  departed_at: Date | null;
  is_child_stop: boolean;
  minutes_late: number | null;
}

export interface PlannedStop {
  id: number;
  name: string;
  sequence: number;
  pickup_time: string | null;
  drop_time: string | null;
}

const UPCOMING: StopStatus[] = ['pending', 'approaching'];
const MINUTE = 60_000;

export function zoneOffset(timeZone: string, at: Date): string {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-]\d{2}):?(\d{2})?/.exec(name);
  return match ? `${match[1]}:${match[2] ?? '00'}` : '+00:00';
}

export function plannedAt(date: string, time: string | null, offset: string): Date | null {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return null;
  const value = new Date(`${date}T${time}:00${offset}`);
  return Number.isNaN(value.getTime()) ? null : value;
}

export function minutesLate(planned: Date | null, actual: Date | null): number | null {
  if (!planned || !actual) return null;
  return Math.round((actual.getTime() - planned.getTime()) / MINUTE) || 0;
}

const toDate = (value: string | Date | null): Date | null => (value ? new Date(value) : null);

export function liveTimeline(
  stops: TripStop[],
  options: { childStopId: number; tripDate: string; offset: string; positionAt: Date | null; now: Date },
): TimelineStop[] {
  const base = options.positionAt ?? options.now;
  return stops.map((stop) => {
    const planned = plannedAt(options.tripDate, stop.planned_time, options.offset);
    const upcoming = UPCOMING.includes(stop.status);
    const etaSeconds = upcoming ? stop.eta_seconds : null;
    const etaAt = etaSeconds !== null ? new Date(base.getTime() + etaSeconds * 1000) : null;
    const arrivedAt = upcoming ? null : toDate(stop.arrived_at);
    const departedAt = upcoming ? null : toDate(stop.departed_at);
    const overdue = upcoming && !etaAt && planned && options.now > planned ? options.now : null;
    const actual = stop.status === 'skipped' ? null : (arrivedAt ?? departedAt ?? etaAt ?? overdue);
    return {
      stop_id: stop.stop_id,
      name: stop.name,
      sequence: stop.sequence,
      planned_time: stop.planned_time,
      planned_at: planned,
      status: stop.status,
      eta_seconds: etaSeconds,
      eta_at: etaAt,
      arrived_at: arrivedAt,
      departed_at: departedAt,
      is_child_stop: stop.stop_id === options.childStopId,
      minutes_late: minutesLate(planned, actual),
    };
  });
}

export function plannedTimeline(
  stops: PlannedStop[],
  options: { kind: TripKind; childStopId: number; tripDate: string; offset: string },
): TimelineStop[] {
  return orderStops(stops, options.kind).map((stop) => {
    const time = options.kind === 'pickup' ? stop.pickup_time : stop.drop_time;
    return {
      stop_id: stop.id,
      name: stop.name,
      sequence: stop.sequence,
      planned_time: time,
      planned_at: plannedAt(options.tripDate, time, options.offset),
      status: 'pending',
      eta_seconds: null,
      eta_at: null,
      arrived_at: null,
      departed_at: null,
      is_child_stop: stop.id === options.childStopId,
      minutes_late: null,
    };
  });
}

export function boardingStatus(latest: BoardingAction | null | undefined): BoardingStatus {
  if (latest === 'missed') return 'not_at_stop';
  return latest ?? 'not_yet';
}

export function nextScheduledTrip(options: {
  mode: TransportMode;
  today: string;
  nowTime: string;
  ranToday: TripKind[];
  lastPlanned: Record<TripKind, string | null>;
  isDayOff: (date: string) => boolean;
  lookAheadDays?: number;
}): { trip_date: string; kind: TripKind } | null {
  const kinds = (['pickup', 'drop'] as const).filter((kind) => ridesOn(options.mode, kind));
  if (!kinds.length) return null;
  if (!options.isDayOff(options.today)) {
    const later = kinds.find((kind) => {
      const last = options.lastPlanned[kind];
      return !options.ranToday.includes(kind) && (!last || last > options.nowTime);
    });
    if (later) return { trip_date: options.today, kind: later };
  }
  for (let offset = 1; offset <= (options.lookAheadDays ?? 14); offset += 1) {
    const date = addDays(options.today, offset);
    if (!options.isDayOff(date)) return { trip_date: date, kind: kinds[0]! };
  }
  return null;
}
