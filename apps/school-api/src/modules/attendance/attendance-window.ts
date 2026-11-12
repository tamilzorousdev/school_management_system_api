import { AttendanceSessionName, SessionState, SessionWindow } from './attendance-sessions';

export const DEFAULT_GRACE_MINUTES = 15;
export const MAX_GRACE_MINUTES = 30;

export interface GraceWindow extends SessionWindow {
  period_ends_at: string | null;
  grace_minutes: number;
}

export function addToTime(time: string, minutes: number): string {
  const [hours, mins] = time.split(':').map(Number);
  const total = Math.min(hours * 60 + mins + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function graceWindow(start: string | null, end: string | null, graceMinutes: number): GraceWindow {
  return {
    opens_at: start,
    period_ends_at: end,
    closes_at: end ? addToTime(end, graceMinutes) : null,
    grace_minutes: graceMinutes,
  };
}

function stateAt(window: SessionWindow, now: string): SessionState {
  if (window.opens_at && now < window.opens_at) return 'not_open';
  if (window.closes_at && now > window.closes_at) return 'closed';
  return 'open';
}

export function currentSlot<T extends { window: SessionWindow }>(
  slots: T[],
  now: string,
): { slot: T; state: SessionState } {
  const states = slots.map((slot) => ({ slot, state: stateAt(slot.window, now) }));
  return (
    states.find((item) => item.state === 'open') ??
    states.find((item) => item.state === 'not_open') ?? { slot: slots[slots.length - 1], state: 'closed' }
  );
}

export function currentSession(
  windows: Record<AttendanceSessionName, SessionWindow>,
  now: string,
): { session: AttendanceSessionName; state: SessionState } {
  const picked = currentSlot(
    (['morning', 'afternoon'] as const).map((session) => ({ session, window: windows[session] })),
    now,
  );
  return { session: picked.slot.session, state: picked.state };
}

export function windowClosed(window: SessionWindow, date: string, today: string, now: string): boolean {
  if (date < today) return true;
  if (date > today) return false;
  return Boolean(window.closes_at) && now > window.closes_at!;
}

export function inReminderTime(window: GraceWindow, now: string): boolean {
  return (
    window.grace_minutes > 0 &&
    Boolean(window.period_ends_at && window.closes_at) &&
    now >= window.period_ends_at! &&
    now <= window.closes_at!
  );
}

export function listNames(names: string[], max = 5): string {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}
