import { FieldError } from '@app/common';
import { MeetingStatus } from './entities/meeting.entity';

export const JOIN_EARLY_MINUTES = 10;
export const NO_SHOW_GRACE_MINUTES = 30;
export const START_REMINDER_MINUTES = 10;
export const END_REMINDER_MINUTES = 5;
export const EMPTY_CLOSE_MINUTES = 5;
export const HARD_STOP_MINUTES = 10;
export const MAX_DAYS_AHEAD = 60;
export const PAST_TOLERANCE_MINUTES = 1;
export const MAX_EXTENSION_MINUTES = 120;
export const OPEN_STATUSES: MeetingStatus[] = ['scheduled', 'in_progress', 'time_exceeded'];
export const ACTIVE_STATUSES: MeetingStatus[] = ['in_progress', 'time_exceeded'];

const MINUTE_MS = 60_000;

export const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * MINUTE_MS);

export function endsAt(scheduledAt: Date, durationMinutes: number): Date {
  return addMinutes(scheduledAt, durationMinutes);
}

export interface MeetingTiming {
  status: MeetingStatus;
  scheduled_at: Date;
  scheduled_end_at: Date;
}

export function joinOpensAt(meeting: Pick<MeetingTiming, 'scheduled_at'>): Date {
  return addMinutes(meeting.scheduled_at, -JOIN_EARLY_MINUTES);
}

export function noShowAt(meeting: Pick<MeetingTiming, 'scheduled_end_at'>): Date {
  return addMinutes(meeting.scheduled_end_at, NO_SHOW_GRACE_MINUTES);
}

export function hardStopAt(meeting: Pick<MeetingTiming, 'scheduled_end_at'>): Date {
  return addMinutes(meeting.scheduled_end_at, HARD_STOP_MINUTES);
}

export function isPastHardStop(meeting: MeetingTiming, now: Date): boolean {
  return ACTIVE_STATUSES.includes(meeting.status) && now > hardStopAt(meeting);
}

export function joinBlockReason(meeting: MeetingTiming, now: Date): { message: string; code: string } | null {
  if (meeting.status === 'cancelled') return { message: 'This meeting was cancelled', code: 'MEETING_CANCELLED' };
  if (meeting.status === 'completed' || meeting.status === 'missed') {
    return { message: 'This meeting has ended', code: 'MEETING_ENDED' };
  }
  if (ACTIVE_STATUSES.includes(meeting.status)) {
    return now > hardStopAt(meeting) ? { message: 'This meeting has ended', code: 'MEETING_ENDED' } : null;
  }
  if (now < joinOpensAt(meeting)) {
    return {
      message: `The meeting opens ${JOIN_EARLY_MINUTES} minutes before it starts`,
      code: 'MEETING_NOT_OPEN',
    };
  }
  if (now > noShowAt(meeting)) return { message: 'This meeting has ended', code: 'MEETING_ENDED' };
  return null;
}

export function canJoin(meeting: MeetingTiming, now: Date): boolean {
  return joinBlockReason(meeting, now) === null;
}

export function statusAfterJoin(status: MeetingStatus, scheduledEndAt: Date, now: Date): MeetingStatus {
  if (status !== 'scheduled') return status;
  return now >= scheduledEndAt ? 'time_exceeded' : 'in_progress';
}

export function isOverTime(meeting: MeetingTiming, now: Date): boolean {
  return meeting.status === 'in_progress' && now >= meeting.scheduled_end_at;
}

export function endReminderDue(meeting: MeetingTiming & { end_reminder_sent_at: Date | null }, now: Date): boolean {
  return (
    meeting.status === 'in_progress' &&
    !meeting.end_reminder_sent_at &&
    now >= addMinutes(meeting.scheduled_end_at, -END_REMINDER_MINUTES) &&
    now < meeting.scheduled_end_at
  );
}

export function isNoShow(meeting: MeetingTiming, now: Date): boolean {
  return meeting.status === 'scheduled' && now > noShowAt(meeting);
}

export function closesWhenEmpty(
  meeting: MeetingTiming,
  openParticipants: number,
  lastActivity: Date,
  now: Date,
): boolean {
  return (
    ACTIVE_STATUSES.includes(meeting.status) &&
    openParticipants === 0 &&
    now >= addMinutes(lastActivity, EMPTY_CLOSE_MINUTES)
  );
}

export function extendedEnd(currentEnd: Date, minutes: number, now: Date): Date {
  return addMinutes(currentEnd > now ? currentEnd : now, minutes);
}

export function extensionError(alreadyExtended: number, minutes: number): string | null {
  if (alreadyExtended + minutes > MAX_EXTENSION_MINUTES) {
    return `A meeting can be extended by up to ${MAX_EXTENSION_MINUTES} minutes in total`;
  }
  return null;
}

export function overlaps(aStart: Date, aMinutes: number, bStart: Date, bMinutes: number): boolean {
  return aStart < endsAt(bStart, bMinutes) && bStart < endsAt(aStart, aMinutes);
}

export function scheduleError(scheduledAt: Date, now: Date): FieldError | null {
  if (Number.isNaN(scheduledAt.getTime())) {
    return { field: 'scheduled_at', message: 'scheduled_at must be a date and time' };
  }
  if (scheduledAt.getTime() < now.getTime() - PAST_TOLERANCE_MINUTES * MINUTE_MS) {
    return { field: 'scheduled_at', message: 'The meeting time has already passed' };
  }
  if (scheduledAt.getTime() > now.getTime() + MAX_DAYS_AHEAD * 24 * 60 * MINUTE_MS) {
    return { field: 'scheduled_at', message: `A meeting can be booked up to ${MAX_DAYS_AHEAD} days ahead` };
  }
  return null;
}

export function channelName(schoolId: number, token: string): string {
  return `tzs_${schoolId}_${token}`.slice(0, 63);
}

export function minutesBetween(from: Date | null, to: Date | null): number | null {
  if (!from || !to) return null;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / MINUTE_MS));
}

export function actualMinutes(
  meeting: { started_at: Date | null; ended_at: Date | null; status: MeetingStatus },
  now: Date,
): number | null {
  if (!meeting.started_at) return null;
  return minutesBetween(
    meeting.started_at,
    meeting.ended_at ?? (ACTIVE_STATUSES.includes(meeting.status) ? now : null),
  );
}

export const AGORA_LEAVE_REASONS: Record<number, string> = {
  0: 'other',
  1: 'left',
  2: 'timeout',
  3: 'removed',
  4: 'agora_internal',
  5: 'switched_device',
  9: 'reconnecting',
  10: 'network',
  12: 'token_expired',
  99: 'network_unknown',
  999: 'abnormal',
};

export const AGORA_JOIN_EVENTS = [103, 105, 107];
export const AGORA_LEAVE_EVENTS = [104, 106, 108];

export function formatMeetingTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}
