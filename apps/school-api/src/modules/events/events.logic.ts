import { FieldError } from '@app/common';
import { EventStatus, RsvpResponse } from './entities/school-event.entity';

export const DAY_BEFORE_HOUR = 18;
export const DAY_OF_LEAD_MINUTES = 120;
export const DEADLINE_LEAD_HOURS = 24;
export const ALL_DAY_START = '08:00';

const HOUR_MS = 3_600_000;

export interface EventTiming {
  event_date: string;
  start_time: string | null;
  rsvp_deadline: Date | null;
}

export interface Refusal {
  code: string;
  message: string;
}

export interface RsvpCounts {
  invited: number;
  attending: number;
  not_attending: number;
  maybe: number;
  no_response: number;
}

export function eventStart(event: Pick<EventTiming, 'event_date' | 'start_time'>, offset: string): Date {
  return new Date(`${event.event_date}T${event.start_time ?? ALL_DAY_START}:00${offset}`);
}

export function rsvpDeadline(event: EventTiming, offset: string): Date {
  return event.rsvp_deadline ?? eventStart(event, offset);
}

export function rsvpRefusal(
  event: EventTiming & { status: EventStatus; rsvp_required: boolean },
  now: Date,
  offset: string,
): Refusal | null {
  if (event.status === 'cancelled') return { code: 'EVENT_CANCELLED', message: 'This event was cancelled' };
  if (event.status !== 'published') return { code: 'EVENT_NOT_PUBLISHED', message: 'This event is not open yet' };
  if (!event.rsvp_required) return { code: 'EVENT_NO_RSVP', message: 'This event does not ask for a reply' };
  if (now.getTime() > rsvpDeadline(event, offset).getTime()) {
    return { code: 'EVENT_RSVP_CLOSED', message: 'Replies for this event are closed' };
  }
  return null;
}

export function rsvpCounts(invited: number, responses: RsvpResponse[]): RsvpCounts {
  const count = (value: RsvpResponse) => responses.filter((response) => response === value).length;
  return {
    invited,
    attending: count('attending'),
    not_attending: count('not_attending'),
    maybe: count('maybe'),
    no_response: Math.max(invited - responses.length, 0),
  };
}

export function dayBeforeAt(event: Pick<EventTiming, 'event_date'>, offset: string): Date {
  const day = new Date(`${event.event_date}T${String(DAY_BEFORE_HOUR).padStart(2, '0')}:00:00${offset}`);
  return new Date(day.getTime() - 24 * HOUR_MS);
}

export type ReminderKind = 'day_before' | 'deadline' | 'day_of';

export function reminderDue(
  kind: ReminderKind,
  event: EventTiming & { rsvp_required: boolean },
  now: Date,
  offset: string,
): boolean {
  const start = eventStart(event, offset).getTime();
  const time = now.getTime();
  if (time >= start) return false;
  if (kind === 'day_before') return time >= dayBeforeAt(event, offset).getTime();
  if (kind === 'day_of') return time >= start - DAY_OF_LEAD_MINUTES * 60_000;
  if (!event.rsvp_required) return false;
  const deadline = rsvpDeadline(event, offset).getTime();
  return time < deadline && time >= deadline - DEADLINE_LEAD_HOURS * HOUR_MS;
}

export function scheduleErrors(
  input: { event_date: string; start_time?: string | null; end_time?: string | null; rsvp_deadline?: string | null },
  today: string,
  offset: string,
): FieldError[] {
  const errors: FieldError[] = [];
  if (input.event_date < today) errors.push({ field: 'event_date', message: 'The event date has already passed' });
  if (input.end_time && !input.start_time) {
    errors.push({ field: 'start_time', message: 'Add the start time, or leave both times empty for all day' });
  }
  if (input.start_time && input.end_time && input.end_time <= input.start_time) {
    errors.push({ field: 'end_time', message: 'The end time must be after the start time' });
  }
  if (input.rsvp_deadline) {
    const deadline = new Date(input.rsvp_deadline);
    if (
      deadline.getTime() >
      eventStart({ event_date: input.event_date, start_time: input.start_time ?? null }, offset).getTime()
    ) {
      errors.push({ field: 'rsvp_deadline', message: 'The reply deadline must be before the event starts' });
    }
  }
  return errors;
}

export function whenText(event: Pick<EventTiming, 'event_date' | 'start_time'> & { end_time: string | null }): string {
  const [year, month, day] = event.event_date.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  if (!event.start_time) return `${date}, all day`;
  return event.end_time ? `${date}, ${event.start_time} to ${event.end_time}` : `${date}, ${event.start_time}`;
}
