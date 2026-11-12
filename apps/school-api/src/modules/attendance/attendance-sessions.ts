import { AppException } from '@app/common';
import { AttendanceStatus } from './entities/attendance-record.entity';

export const ATTENDANCE_SESSIONS = ['morning', 'afternoon'] as const;
export type AttendanceSessionName = (typeof ATTENDANCE_SESSIONS)[number];

export const SESSION_PERIOD: Record<AttendanceSessionName, number> = { morning: 1, afternoon: 5 };
export const SESSION_PERIODS = Object.values(SESSION_PERIOD);

export const SESSION_LABEL: Record<AttendanceSessionName, string> = {
  morning: 'Morning (1st period)',
  afternoon: 'Afternoon (5th period)',
};

const SESSION_VALUE: Record<AttendanceStatus, number | null> = {
  present: 1,
  late: 1,
  half_day: 0.5,
  absent: 0,
  leave: null,
};

export const ATTENDANCE_MODES = ['session', 'period'] as const;
export type AttendanceMode = (typeof ATTENDANCE_MODES)[number];

export interface AttendanceSlot {
  session: AttendanceSessionName;
  period: number;
}

export const slotOfSession = (session: AttendanceSessionName): AttendanceSlot => ({
  session,
  period: SESSION_PERIOD[session],
});

export const halfOf = (period: number): AttendanceSessionName =>
  period < SESSION_PERIOD.afternoon ? 'morning' : 'afternoon';

export function slotPeriods(mode: AttendanceMode, teachingPeriods: number): number[] {
  if (mode === 'session') return [...SESSION_PERIODS];
  return Array.from({ length: Math.max(1, teachingPeriods) }, (_, index) => index + 1);
}

export function resolveSlot(
  mode: AttendanceMode,
  teachingPeriods: number,
  input: { session?: AttendanceSessionName; period?: number },
): AttendanceSlot {
  if (mode === 'session') return slotOfSession(resolveSession(input));
  if (input.period === undefined || input.period === 0) {
    return input.session ? slotOfSession(input.session) : { session: 'morning', period: 1 };
  }
  if (input.period > teachingPeriods) {
    throw AppException.badRequest(`The bell schedule has ${teachingPeriods} teaching periods`, 'PERIOD_NOT_ALLOWED');
  }
  return { session: halfOf(input.period), period: input.period };
}

export function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  return `${value}${{ 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] ?? 'th'}`;
}

export function slotName(mode: AttendanceMode, slot: AttendanceSlot): string {
  if (mode === 'period') return `${ordinal(slot.period)} period`;
  return slot.session === 'morning' ? 'Morning' : 'Afternoon';
}

export function sessionOf(period: number): AttendanceSessionName | null {
  return ATTENDANCE_SESSIONS.find((name) => SESSION_PERIOD[name] === period) ?? null;
}

export function resolveSession(input: { session?: AttendanceSessionName; period?: number }): AttendanceSessionName {
  if (input.session) return input.session;
  if (input.period === undefined || input.period === 0) return 'morning';
  const session = sessionOf(input.period);
  if (!session) {
    throw AppException.badRequest(
      'Attendance is taken only in the 1st period (morning) and the 5th period (afternoon)',
      'PERIOD_NOT_ALLOWED',
    );
  }
  return session;
}

export function dayStatus(
  morning: AttendanceStatus | null,
  afternoon: AttendanceStatus | null,
): AttendanceStatus | null {
  const marked = [morning, afternoon].filter((status): status is AttendanceStatus => status !== null);
  if (!marked.length) return null;
  const values = marked.map((status) => SESSION_VALUE[status]).filter((value): value is number => value !== null);
  if (!values.length) return 'leave';
  const value = values.reduce((sum, item) => sum + item, 0) / values.length;
  if (value === 1) return marked.includes('late') ? 'late' : 'present';
  if (value === 0) return 'absent';
  return 'half_day';
}

export function latestStatus(
  morning: AttendanceStatus | null,
  afternoon: AttendanceStatus | null,
): AttendanceStatus | null {
  return afternoon ?? morning;
}

export function afternoonDefault(morning: AttendanceStatus | null, onLeave: boolean): AttendanceStatus {
  if (onLeave) return 'leave';
  if (morning === 'absent' || morning === 'leave') return morning;
  return 'present';
}

export type SessionState = 'not_open' | 'open' | 'closed';

export interface SessionWindow {
  opens_at: string | null;
  closes_at: string | null;
}

export function sessionState(window: SessionWindow, date: string, today: string, now: string): SessionState {
  if (date < today) return 'closed';
  if (date > today) return 'not_open';
  if (window.opens_at && now < window.opens_at) return 'not_open';
  if (window.closes_at && now > window.closes_at) return 'closed';
  return 'open';
}

export function windowMessage(
  session: AttendanceSessionName | AttendanceSlot,
  window: SessionWindow & { period_ends_at?: string | null; grace_minutes?: number },
  state: SessionState,
  mode: AttendanceMode = 'session',
): string {
  const slot = typeof session === 'string' ? slotOfSession(session) : session;
  const name = slotName(mode, slot);
  const period = ordinal(slot.period);
  const grace =
    window.grace_minutes && window.period_ends_at
      ? `, period ends ${window.period_ends_at} plus ${window.grace_minutes} min`
      : '';
  const times =
    window.opens_at && window.closes_at
      ? mode === 'period'
        ? ` (${window.opens_at} to ${window.closes_at}${grace})`
        : ` (${period} period, ${window.opens_at} to ${window.closes_at}${grace})`
      : '';
  return state === 'not_open'
    ? `${name} attendance opens at ${window.opens_at ?? 'the start of the period'}${times}`
    : `${name} attendance can be taken only during the ${period} period${times}. Ask the office (AO) to mark it now.`;
}
