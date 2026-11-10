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

export function windowMessage(session: AttendanceSessionName, window: SessionWindow, state: SessionState): string {
  const name = session === 'morning' ? 'Morning' : 'Afternoon';
  const period = session === 'morning' ? '1st' : '5th';
  const times =
    window.opens_at && window.closes_at ? ` (${period} period, ${window.opens_at} to ${window.closes_at})` : '';
  return state === 'not_open'
    ? `${name} attendance opens at ${window.opens_at ?? 'the start of the period'}${times}`
    : `${name} attendance can be taken only during the ${period} period${times}. Ask the office (AO) to mark it now.`;
}
