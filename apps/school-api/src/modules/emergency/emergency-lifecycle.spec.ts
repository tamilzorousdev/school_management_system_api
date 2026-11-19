import {
  broadcastState,
  expiryFrom,
  expiryLabel,
  expiryProblem,
  needsApproval,
  scheduleProblem,
} from './emergency.logic';

const start = new Date('2026-01-31T10:00:00.000Z');

describe('emergency expiry', () => {
  it('adds seconds, minutes, hours and days exactly', () => {
    expect(expiryFrom(start, 10, 'seconds').toISOString()).toBe('2026-01-31T10:00:10.000Z');
    expect(expiryFrom(start, 15, 'minutes').toISOString()).toBe('2026-01-31T10:15:00.000Z');
    expect(expiryFrom(start, 2, 'hours').toISOString()).toBe('2026-01-31T12:00:00.000Z');
    expect(expiryFrom(start, 3, 'days').toISOString()).toBe('2026-02-03T10:00:00.000Z');
  });

  it('adds calendar months and years, keeping to the last day of a short month', () => {
    expect(expiryFrom(start, 1, 'months').toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(expiryFrom(start, 2, 'months').toISOString()).toBe('2026-03-31T10:00:00.000Z');
    expect(expiryFrom(start, 1, 'years').toISOString()).toBe('2027-01-31T10:00:00.000Z');
  });

  it('allows 5 seconds up to 5 years', () => {
    expect(expiryProblem(4, 'seconds', start)).toMatch(/at least 5 seconds/);
    expect(expiryProblem(5, 'seconds', start)).toBeNull();
    expect(expiryProblem(5, 'years', start)).toBeNull();
    expect(expiryProblem(61, 'months', start)).toMatch(/at most 5 years/);
  });

  it('reads well', () => {
    expect(expiryLabel(1, 'hours')).toBe('1 hour');
    expect(expiryLabel(10, 'seconds')).toBe('10 seconds');
  });
});

describe('emergency approval and schedule', () => {
  it('asks the principal for whole-school or SMS broadcasts from someone who cannot approve', () => {
    expect(needsApproval({ audience: 'everyone', channels: ['push'] }, false)).toBe(true);
    expect(needsApproval({ audience: 'sections', channels: ['push', 'sms'] }, false)).toBe(true);
    expect(needsApproval({ audience: 'sections', channels: ['push'] }, false)).toBe(false);
    expect(needsApproval({ audience: 'everyone', channels: ['push', 'sms'] }, true)).toBe(false);
  });

  it('needs a send time at least a minute ahead and within 60 days', () => {
    const now = new Date('2026-11-17T10:00:00.000Z');
    expect(scheduleProblem(new Date('2026-11-17T10:00:20.000Z'), now)).toMatch(/at least 1 minute/);
    expect(scheduleProblem(new Date('2026-11-18T00:30:00.000Z'), now)).toBeNull();
    expect(scheduleProblem(new Date('2027-02-01T00:00:00.000Z'), now)).toMatch(/60 days/);
  });
});

describe('broadcastState', () => {
  const now = new Date('2026-11-17T10:00:00.000Z');
  const sent = { status: 'sent' as const, expires_at: null, ended_at: null, end_reason: null };

  it('is active until it ends or its time is up', () => {
    expect(broadcastState(sent, now)).toBe('active');
    expect(broadcastState({ ...sent, expires_at: new Date('2026-11-17T09:59:59.000Z') }, now)).toBe('expired');
    expect(broadcastState({ ...sent, ended_at: now, end_reason: 'ended' }, now)).toBe('ended');
    expect(broadcastState({ ...sent, ended_at: now, end_reason: 'all_clear' }, now)).toBe('ended');
    expect(broadcastState({ ...sent, ended_at: now, end_reason: 'expired' }, now)).toBe('expired');
  });

  it('shows waiting, scheduled, rejected and cancelled as they are', () => {
    for (const status of ['pending_approval', 'scheduled', 'rejected', 'cancelled'] as const) {
      expect(broadcastState({ ...sent, status }, now)).toBe(status);
    }
  });
});
