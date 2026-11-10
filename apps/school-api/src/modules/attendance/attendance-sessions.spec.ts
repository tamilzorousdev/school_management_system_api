import { AppException } from '@app/common';
import {
  afternoonDefault,
  dayStatus,
  latestStatus,
  resolveSession,
  SESSION_PERIOD,
  sessionOf,
  sessionState,
  windowMessage,
} from './attendance-sessions';

const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (error) {
    return ((error as AppException).getResponse() as { code: string }).code;
  }
};

describe('attendance sessions', () => {
  it('takes attendance in the 1st and 5th periods', () => {
    expect(SESSION_PERIOD).toEqual({ morning: 1, afternoon: 5 });
    expect(sessionOf(1)).toBe('morning');
    expect(sessionOf(5)).toBe('afternoon');
    expect(sessionOf(3)).toBeNull();
  });

  it('reads the session, or the old period number', () => {
    expect(resolveSession({})).toBe('morning');
    expect(resolveSession({ session: 'afternoon', period: 1 })).toBe('afternoon');
    expect(resolveSession({ period: 0 })).toBe('morning');
    expect(resolveSession({ period: 1 })).toBe('morning');
    expect(resolveSession({ period: 5 })).toBe('afternoon');
    expect(codeOf(() => resolveSession({ period: 3 }))).toBe('PERIOD_NOT_ALLOWED');
  });

  it.each([
    ['present', null, 'present'],
    ['present', 'present', 'present'],
    ['late', 'present', 'late'],
    ['present', 'absent', 'half_day'],
    ['absent', 'present', 'half_day'],
    ['absent', 'absent', 'absent'],
    ['absent', null, 'absent'],
    ['leave', 'leave', 'leave'],
    ['leave', 'present', 'present'],
    ['half_day', 'present', 'half_day'],
    [null, null, null],
  ] as const)('morning %s + afternoon %s = %s', (morning, afternoon, expected) => {
    expect(dayStatus(morning, afternoon)).toBe(expected);
  });

  it('shows the latest session as the current status', () => {
    expect(latestStatus('present', 'absent')).toBe('absent');
    expect(latestStatus('absent', null)).toBe('absent');
    expect(latestStatus(null, null)).toBeNull();
  });

  it('starts the afternoon list from the morning marks', () => {
    expect(afternoonDefault('absent', false)).toBe('absent');
    expect(afternoonDefault('late', false)).toBe('present');
    expect(afternoonDefault(null, false)).toBe('present');
    expect(afternoonDefault('present', true)).toBe('leave');
  });

  it('lets a teacher mark only today during the period', () => {
    const morning = { opens_at: '08:50', closes_at: '09:35' };
    expect(sessionState(morning, '2026-11-11', '2026-11-11', '08:49')).toBe('not_open');
    expect(sessionState(morning, '2026-11-11', '2026-11-11', '08:50')).toBe('open');
    expect(sessionState(morning, '2026-11-11', '2026-11-11', '09:35')).toBe('open');
    expect(sessionState(morning, '2026-11-11', '2026-11-11', '09:36')).toBe('closed');
    expect(sessionState(morning, '2026-11-10', '2026-11-11', '09:00')).toBe('closed');
    expect(sessionState(morning, '2026-11-12', '2026-11-11', '09:00')).toBe('not_open');
    expect(sessionState({ opens_at: null, closes_at: null }, '2026-11-11', '2026-11-11', '17:00')).toBe('open');
  });

  it('explains when a session opens or why it is closed', () => {
    const afternoon = { opens_at: '12:45', closes_at: '13:30' };
    expect(windowMessage('afternoon', afternoon, 'not_open')).toBe(
      'Afternoon attendance opens at 12:45 (5th period, 12:45 to 13:30)',
    );
    expect(windowMessage('afternoon', afternoon, 'closed')).toMatch(/only during the 5th period .* Ask the office/);
  });
});
