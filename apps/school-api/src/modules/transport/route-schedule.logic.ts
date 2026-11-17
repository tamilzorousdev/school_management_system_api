import { distanceMetres } from '../../shared/school-days';

export const MIN_STOP_GAP_MINUTES = 2;
export const MAX_BUS_SPEED_KMPH = 50;
export const NOTIFY_TIME_SHIFT_MINUTES = 5;
export const NOTIFY_MOVE_METRES = 100;

export type ProblemSeverity = 'error' | 'warning';

export interface ScheduleStop {
  name: string;
  lat: number;
  lng: number;
  pickup_time: string | null;
  drop_time: string | null;
}

export interface ScheduleProblem {
  code: string;
  severity: ProblemSeverity;
  stop: string | null;
  field: string | null;
  message: string;
}

export interface SchoolDay {
  start: string | null;
  end: string | null;
}

export interface RouteTimings {
  leaves_at: string | null;
  reaches_school_at: string | null;
  leaves_school_at: string | null;
  last_drop_at: string | null;
}

export interface TimeWindow {
  from: number;
  to: number;
}

export const minutes = (time: string) => {
  const [hours, mins] = time.split(':').map(Number);
  return hours! * 60 + mins!;
};

const problem = (
  code: string,
  message: string,
  stop: string | null,
  field: string | null,
  severity: ProblemSeverity = 'error',
): ScheduleProblem => ({ code, severity, stop, field, message });

function checkLeg(
  stops: { name: string; index: number; time: string; lat: number; lng: number }[],
  kind: 'pickup' | 'drop',
  problems: ScheduleProblem[],
) {
  for (let position = 1; position < stops.length; position += 1) {
    const before = stops[position - 1]!;
    const after = stops[position]!;
    const gap = minutes(after.time) - minutes(before.time);
    const field = `items.${after.index}.${kind}_time`;
    if (gap < MIN_STOP_GAP_MINUTES) {
      problems.push(
        problem(
          kind === 'pickup' ? 'PICKUP_TIME_ORDER' : 'DROP_TIME_ORDER',
          `${kind === 'pickup' ? 'Pickup' : 'Drop'} at ${after.name} (${after.time}) must be at least ${MIN_STOP_GAP_MINUTES} minutes after ${before.name} (${before.time})`,
          after.name,
          field,
        ),
      );
      continue;
    }
    const km = distanceMetres(before.lat, before.lng, after.lat, after.lng) / 1000;
    if ((km / gap) * 60 > MAX_BUS_SPEED_KMPH) {
      problems.push(
        problem(
          'STOP_TIMES_TOO_CLOSE',
          `${before.name} to ${after.name} is ${km.toFixed(1)} km but only ${gap} minutes apart. Check the ${kind} times.`,
          after.name,
          field,
          'warning',
        ),
      );
    }
  }
}

export function checkSchedule(stops: ScheduleStop[], school: SchoolDay): ScheduleProblem[] {
  const problems: ScheduleProblem[] = [];
  const indexed = stops.map((stop, index) => ({ ...stop, index }));
  for (const kind of ['pickup', 'drop'] as const) {
    const key = kind === 'pickup' ? 'pickup_time' : 'drop_time';
    const timed = indexed.filter((stop) => stop[key]);
    if (timed.length && timed.length < stops.length) {
      for (const stop of indexed.filter((item) => !item[key])) {
        problems.push(
          problem(
            kind === 'pickup' ? 'PICKUP_TIME_MISSING' : 'DROP_TIME_MISSING',
            `Give ${stop.name} a ${kind} time, like the other stops`,
            stop.name,
            `items.${stop.index}.${key}`,
          ),
        );
      }
    }
  }
  const pickups = indexed.filter((stop) => stop.pickup_time).map((stop) => ({ ...stop, time: stop.pickup_time! }));
  const drops = indexed
    .filter((stop) => stop.drop_time)
    .reverse()
    .map((stop) => ({ ...stop, time: stop.drop_time! }));
  checkLeg(pickups, 'pickup', problems);
  checkLeg(drops, 'drop', problems);
  const lastPickup = pickups[pickups.length - 1];
  if (lastPickup && school.start && minutes(lastPickup.time) >= minutes(school.start)) {
    problems.push(
      problem(
        'PICKUP_AFTER_SCHOOL_START',
        `Pickup at ${lastPickup.name} (${lastPickup.time}) is not before school starts (${school.start})`,
        lastPickup.name,
        `items.${lastPickup.index}.pickup_time`,
      ),
    );
  }
  const firstDrop = drops[0];
  if (firstDrop && school.end && minutes(firstDrop.time) <= minutes(school.end)) {
    problems.push(
      problem(
        'DROP_BEFORE_SCHOOL_END',
        `Drop at ${firstDrop.name} (${firstDrop.time}) is not after school ends (${school.end})`,
        firstDrop.name,
        `items.${firstDrop.index}.drop_time`,
      ),
    );
  }
  return problems;
}

export const AVERAGE_BUS_KMPH = 25;
const MIN_LEG_MINUTES = 5;
const MAX_LEG_MINUTES = 120;

const clock = (total: number) =>
  `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(((total % 60) + 60) % 60).padStart(2, '0')}`;

function legMinutes(from: { lat: number; lng: number }, to: { lat: number; lng: number } | null): number | null {
  if (!to) return null;
  const km = distanceMetres(from.lat, from.lng, to.lat, to.lng) / 1000;
  const leg = Math.ceil((km / AVERAGE_BUS_KMPH) * 60);
  return leg > MAX_LEG_MINUTES ? null : Math.max(MIN_LEG_MINUTES, leg);
}

export function routeTimings(
  stops: ScheduleStop[],
  school: SchoolDay,
  schoolPoint: { lat: number; lng: number } | null = null,
): RouteTimings {
  const pickups = stops.filter((stop) => stop.pickup_time);
  const drops = stops.filter((stop) => stop.drop_time);
  const lastPickup = pickups.reduce<ScheduleStop | null>(
    (latest, stop) => (!latest || minutes(stop.pickup_time!) > minutes(latest.pickup_time!) ? stop : latest),
    null,
  );
  const firstDrop = drops.reduce<ScheduleStop | null>(
    (earliest, stop) => (!earliest || minutes(stop.drop_time!) < minutes(earliest.drop_time!) ? stop : earliest),
    null,
  );
  const earliestPickup = pickups.reduce<string | null>(
    (first, stop) => (!first || minutes(stop.pickup_time!) < minutes(first) ? stop.pickup_time! : first),
    null,
  );
  const latestDrop = drops.reduce<string | null>(
    (last, stop) => (!last || minutes(stop.drop_time!) > minutes(last) ? stop.drop_time! : last),
    null,
  );
  let reaches: string | null = null;
  if (lastPickup) {
    const leg = legMinutes(lastPickup, schoolPoint);
    const arrive = leg === null ? null : minutes(lastPickup.pickup_time!) + leg;
    reaches = arrive === null ? school.start : clock(school.start ? Math.min(arrive, minutes(school.start)) : arrive);
  }
  let leaves: string | null = null;
  if (firstDrop) {
    const leg = legMinutes(firstDrop, schoolPoint);
    const depart = leg === null ? null : minutes(firstDrop.drop_time!) - leg;
    leaves = depart === null ? school.end : clock(school.end ? Math.max(depart, minutes(school.end)) : depart);
  }
  return { leaves_at: earliestPickup, reaches_school_at: reaches, leaves_school_at: leaves, last_drop_at: latestDrop };
}

export function timeWindows(timings: RouteTimings): TimeWindow[] {
  const windows: TimeWindow[] = [];
  if (timings.leaves_at && timings.reaches_school_at) {
    windows.push({ from: minutes(timings.leaves_at), to: minutes(timings.reaches_school_at) });
  }
  if (timings.leaves_school_at && timings.last_drop_at) {
    windows.push({ from: minutes(timings.leaves_school_at), to: minutes(timings.last_drop_at) });
  }
  return windows;
}

export function windowsOverlap(left: TimeWindow[], right: TimeWindow[]): boolean {
  return left.some((a) => right.some((b) => a.from < b.to && b.from < a.to));
}

export function timeShift(before: string | null, after: string | null): number {
  if (!before || !after) return before === after ? 0 : Number.POSITIVE_INFINITY;
  return Math.abs(minutes(after) - minutes(before));
}
