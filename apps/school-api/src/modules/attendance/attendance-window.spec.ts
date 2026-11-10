import { addToTime, currentSession, graceWindow, inReminderTime, listNames, windowClosed } from './attendance-window';

const morning = graceWindow('09:00', '09:45', 15);
const afternoon = graceWindow('13:30', '14:15', 15);
const windows = { morning, afternoon };

describe('attendance window with grace', () => {
  it('adds the grace minutes to the end of the period', () => {
    expect(morning).toEqual({ opens_at: '09:00', period_ends_at: '09:45', closes_at: '10:00', grace_minutes: 15 });
    expect(addToTime('09:50', 15)).toBe('10:05');
    expect(addToTime('23:50', 30)).toBe('23:59');
    expect(graceWindow('09:00', '09:45', 0).closes_at).toBe('09:45');
    expect(graceWindow(null, null, 15).closes_at).toBeNull();
  });

  it('picks the open session from the server time', () => {
    expect(currentSession(windows, '08:30')).toEqual({ session: 'morning', state: 'not_open' });
    expect(currentSession(windows, '09:10')).toEqual({ session: 'morning', state: 'open' });
    expect(currentSession(windows, '09:58')).toEqual({ session: 'morning', state: 'open' });
    expect(currentSession(windows, '10:01')).toEqual({ session: 'afternoon', state: 'not_open' });
    expect(currentSession(windows, '13:45')).toEqual({ session: 'afternoon', state: 'open' });
    expect(currentSession(windows, '14:29')).toEqual({ session: 'afternoon', state: 'open' });
    expect(currentSession(windows, '14:31')).toEqual({ session: 'afternoon', state: 'closed' });
  });

  it('counts a session as missed only after the grace is over', () => {
    expect(windowClosed(morning, '2026-11-10', '2026-11-10', '09:59')).toBe(false);
    expect(windowClosed(morning, '2026-11-10', '2026-11-10', '10:01')).toBe(true);
    expect(windowClosed(afternoon, '2026-11-09', '2026-11-10', '08:00')).toBe(true);
    expect(windowClosed(afternoon, '2026-11-11', '2026-11-10', '23:00')).toBe(false);
  });

  it('reminds between the end of the period and the end of the grace', () => {
    expect(inReminderTime(morning, '09:44')).toBe(false);
    expect(inReminderTime(morning, '09:45')).toBe(true);
    expect(inReminderTime(morning, '10:00')).toBe(true);
    expect(inReminderTime(morning, '10:01')).toBe(false);
    expect(inReminderTime(graceWindow('09:00', '09:45', 0), '09:45')).toBe(false);
  });

  it('shortens long section lists', () => {
    expect(listNames(['6 - A', '7 - B'])).toBe('6 - A, 7 - B');
    expect(listNames(['1', '2', '3', '4', '5', '6', '7'])).toBe('1, 2, 3, 4, 5 and 2 more');
  });
});
