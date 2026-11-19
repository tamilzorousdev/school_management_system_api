import { TransportMode } from '../transport/entities/student-transport.entity';
import { TripKind } from './entities/transport-trip.entity';
import { BoardingAction } from './entities/trip-boarding.entity';
import { ridesOn, tripLabel } from './tracking.logic';

export interface Refusal {
  code: string;
  message: string;
}

export type BoardingStep = 'record' | 'duplicate' | 'not_boarded';

export function routeRefusal(
  assignment: { route_id: number; mode: TransportMode } | null,
  trip: { route_id: number; kind: TripKind },
): Refusal | null {
  if (!assignment || assignment.route_id !== trip.route_id) {
    return { code: 'NOT_ON_THIS_ROUTE', message: 'This student is not on this bus route' };
  }
  if (!ridesOn(assignment.mode, trip.kind)) {
    return { code: 'NOT_ON_THIS_TRIP', message: `This student does not ride the ${tripLabel(trip.kind).en}` };
  }
  return null;
}

export function boardingStep(recorded: BoardingAction[], action: BoardingAction): BoardingStep {
  if (recorded.includes(action)) return 'duplicate';
  if (action === 'alighted' && !recorded.includes('boarded')) return 'not_boarded';
  return 'record';
}

export function boardingStopId(action: BoardingAction, kind: TripKind, assignedStopId: number): number | null {
  const atHomeStop = (kind === 'pickup' && action === 'boarded') || (kind === 'drop' && action === 'alighted');
  return atHomeStop ? assignedStopId : null;
}

export function clockIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone }).format(at);
}

export const RIDER_STATUSES = ['away', 'waiting', 'on_bus', 'off_bus'] as const;
export type RiderStatus = (typeof RIDER_STATUSES)[number];

export const TRIP_FLAGS = ['not_boarded', 'not_alighted'] as const;
export type TripFlag = (typeof TRIP_FLAGS)[number];

export const TRIP_FLAG_FILTERS = ['any', ...TRIP_FLAGS] as const;
export type TripFlagFilter = (typeof TRIP_FLAG_FILTERS)[number];

export interface RiderMarks {
  boarded: boolean;
  alighted: boolean;
  away_today: boolean;
}

export interface ChecklistSummary {
  total: number;
  away: number;
  waiting: number;
  on_bus: number;
  off_bus: number;
  not_boarded: number;
  not_alighted: number;
}

export function riderStatus(rider: RiderMarks): RiderStatus {
  if (rider.alighted) return 'off_bus';
  if (rider.boarded) return 'on_bus';
  return rider.away_today ? 'away' : 'waiting';
}

export function tripFlag(rider: RiderMarks, tripEnded: boolean): TripFlag | null {
  if (!tripEnded) return null;
  const status = riderStatus(rider);
  if (status === 'waiting') return 'not_boarded';
  if (status === 'on_bus') return 'not_alighted';
  return null;
}

export function missedTheBus<T extends RiderMarks>(riders: T[]): T[] {
  if (!riders.some((rider) => rider.boarded || rider.alighted)) return [];
  return riders.filter((rider) => !rider.boarded && !rider.alighted && !rider.away_today);
}

export function checklistSummary(riders: RiderMarks[], tripEnded: boolean): ChecklistSummary {
  const summary: ChecklistSummary = {
    total: riders.length,
    away: 0,
    waiting: 0,
    on_bus: 0,
    off_bus: 0,
    not_boarded: 0,
    not_alighted: 0,
  };
  for (const rider of riders) {
    summary[riderStatus(rider)] += 1;
    const flag = tripFlag(rider, tripEnded);
    if (flag) summary[flag] += 1;
  }
  return summary;
}

export function undoRefusal(recorded: BoardingAction[], target: BoardingAction): Refusal | null {
  if (target === 'boarded' && recorded.includes('alighted')) {
    return { code: 'UNDO_ALIGHTED_FIRST', message: 'Undo "got off" first, then undo "boarded"' };
  }
  return null;
}
