import {
  dayBeforeAt,
  eventStart,
  reminderDue,
  rsvpCounts,
  rsvpRefusal,
  scheduleErrors,
  whenText,
} from './events.logic';

const IST = '+05:30';
const at = (value: string) => new Date(`${value}${IST}`);
const event = {
  event_date: '2026-12-12',
  start_time: '09:00',
  end_time: '12:30',
  rsvp_deadline: null as Date | null,
  rsvp_required: true,
  status: 'published' as const,
};

describe('event timing', () => {
  it('starts at the start time, or 08:00 for an all-day event', () => {
    expect(eventStart(event, IST).toISOString()).toBe('2026-12-12T03:30:00.000Z');
    expect(eventStart({ ...event, start_time: null }, IST).toISOString()).toBe('2026-12-12T02:30:00.000Z');
  });

  it('reminds the day before at 18:00', () => {
    expect(dayBeforeAt(event, IST).toISOString()).toBe(at('2026-12-11T18:00:00').toISOString());
  });

  it('describes when it happens', () => {
    expect(whenText(event)).toBe('Sat, 12 Dec, 09:00 to 12:30');
    expect(whenText({ ...event, start_time: null, end_time: null })).toBe('Sat, 12 Dec, all day');
  });
});

describe('rsvpRefusal', () => {
  it('takes replies until the deadline, or the start when there is none', () => {
    expect(rsvpRefusal(event, at('2026-12-12T08:59:00'), IST)).toBeNull();
    expect(rsvpRefusal(event, at('2026-12-12T09:01:00'), IST)?.code).toBe('EVENT_RSVP_CLOSED');
    const withDeadline = { ...event, rsvp_deadline: at('2026-12-10T18:00:00') };
    expect(rsvpRefusal(withDeadline, at('2026-12-10T17:00:00'), IST)).toBeNull();
    expect(rsvpRefusal(withDeadline, at('2026-12-10T18:01:00'), IST)?.code).toBe('EVENT_RSVP_CLOSED');
  });

  it('refuses cancelled, draft and no-reply events', () => {
    const now = at('2026-12-01T10:00:00');
    expect(rsvpRefusal({ ...event, status: 'cancelled' }, now, IST)?.code).toBe('EVENT_CANCELLED');
    expect(rsvpRefusal({ ...event, status: 'draft' }, now, IST)?.code).toBe('EVENT_NOT_PUBLISHED');
    expect(rsvpRefusal({ ...event, rsvp_required: false }, now, IST)?.code).toBe('EVENT_NO_RSVP');
  });
});

describe('reminderDue', () => {
  it('sends the day-before reminder from 18:00 the day before until the start', () => {
    expect(reminderDue('day_before', event, at('2026-12-11T17:50:00'), IST)).toBe(false);
    expect(reminderDue('day_before', event, at('2026-12-11T18:05:00'), IST)).toBe(true);
    expect(reminderDue('day_before', event, at('2026-12-12T09:05:00'), IST)).toBe(false);
  });

  it('sends the day-of reminder in the last 2 hours', () => {
    expect(reminderDue('day_of', event, at('2026-12-12T06:50:00'), IST)).toBe(false);
    expect(reminderDue('day_of', event, at('2026-12-12T07:05:00'), IST)).toBe(true);
  });

  it('chases replies in the last day before the deadline', () => {
    const withDeadline = { ...event, rsvp_deadline: at('2026-12-10T18:00:00') };
    expect(reminderDue('deadline', withDeadline, at('2026-12-09T17:00:00'), IST)).toBe(false);
    expect(reminderDue('deadline', withDeadline, at('2026-12-09T18:30:00'), IST)).toBe(true);
    expect(reminderDue('deadline', withDeadline, at('2026-12-10T18:30:00'), IST)).toBe(false);
    expect(reminderDue('deadline', { ...withDeadline, rsvp_required: false }, at('2026-12-09T18:30:00'), IST)).toBe(
      false,
    );
  });
});

describe('counts and checks', () => {
  it('counts replies and the invited who have not answered', () => {
    expect(rsvpCounts(10, ['attending', 'attending', 'maybe', 'not_attending'])).toEqual({
      invited: 10,
      attending: 2,
      not_attending: 1,
      maybe: 1,
      no_response: 6,
    });
  });

  it('checks the date, times and deadline', () => {
    const today = '2026-11-19';
    expect(scheduleErrors({ event_date: '2026-11-18' }, today, IST)[0]?.field).toBe('event_date');
    expect(
      scheduleErrors({ event_date: '2026-12-12', start_time: '10:00', end_time: '09:00' }, today, IST)[0]?.field,
    ).toBe('end_time');
    expect(scheduleErrors({ event_date: '2026-12-12', end_time: '09:00' }, today, IST)[0]?.field).toBe('start_time');
    expect(
      scheduleErrors(
        { event_date: '2026-12-12', start_time: '09:00', rsvp_deadline: '2026-12-12T10:00:00+05:30' },
        today,
        IST,
      )[0]?.field,
    ).toBe('rsvp_deadline');
    expect(scheduleErrors({ event_date: '2026-12-12', start_time: '09:00', end_time: '12:00' }, today, IST)).toEqual(
      [],
    );
  });
});
