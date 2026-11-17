import { DayPresence, tripAway } from './student-away';

const day = (patch: Partial<DayPresence> = {}): DayPresence => ({
  leaves: [],
  od_sessions: [],
  od_title: null,
  morning: null,
  afternoon: null,
  ...patch,
});

describe('tripAway', () => {
  it('rides both buses on a normal day, even when late', () => {
    expect(tripAway(day(), 'pickup')).toBeNull();
    expect(tripAway(day({ morning: 'late', afternoon: 'present' }), 'drop')).toBeNull();
  });

  it('is away on both buses for a full-day leave', () => {
    expect(tripAway(day({ leaves: ['full'] }), 'pickup')).toEqual({ reason: 'leave', note: 'On leave' });
    expect(tripAway(day({ leaves: ['full'] }), 'drop')?.reason).toBe('leave');
  });

  it('applies a half-day leave only to its half', () => {
    const afternoonOff = day({ leaves: ['afternoon'] });
    expect(tripAway(afternoonOff, 'pickup')).toBeNull();
    expect(tripAway(afternoonOff, 'drop')).toEqual({ reason: 'half_day', note: 'Half-day leave: goes home at noon' });
    const morningOff = day({ leaves: ['morning'] });
    expect(tripAway(morningOff, 'pickup')?.note).toBe('Half-day leave: comes in the afternoon');
    expect(tripAway(morningOff, 'drop')).toBeNull();
  });

  it('counts sports OD by its session, with the event name', () => {
    expect(tripAway(day({ od_sessions: ['full'], od_title: 'District athletics' }), 'pickup')).toEqual({
      reason: 'od',
      note: 'Sports OD – District athletics',
    });
    expect(tripAway(day({ od_sessions: ['afternoon'] }), 'pickup')).toBeNull();
    expect(tripAway(day({ od_sessions: ['afternoon'] }), 'drop')?.reason).toBe('od');
    expect(tripAway(day({ morning: 'od' }), 'pickup')?.note).toBe('On duty (OD)');
  });

  it('uses the afternoon mark for the evening bus and the morning mark when it is missing', () => {
    expect(tripAway(day({ morning: 'present', afternoon: 'absent' }), 'drop')?.reason).toBe('absent');
    expect(tripAway(day({ morning: 'present', afternoon: 'absent' }), 'pickup')).toBeNull();
    expect(tripAway(day({ morning: 'absent' }), 'drop')?.note).toBe('Marked absent');
    expect(tripAway(day({ morning: 'absent', afternoon: 'present' }), 'drop')).toBeNull();
  });
});
