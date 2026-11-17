import { busPassState, crewLabel, feeStanding, graceEnds, isIssued, passNumber } from './bus-pass.logic';

const base = {
  today: '2026-11-17',
  valid_until: '2027-03-31',
  issued: true,
  hold: 'active' as const,
  hold_kind: null,
  standing: 'clear' as const,
};

describe('bus pass', () => {
  it('waits for the first bus fee before it is issued, unless the stop is free', () => {
    const unpaid = { oldest_unpaid_due: '2026-11-10', any_paid: false, any_billed: true };
    expect(isIssued(unpaid, false, false)).toBe(false);
    expect(isIssued(unpaid, true, false)).toBe(true);
    expect(isIssued({ ...unpaid, any_paid: true }, false, false)).toBe(true);
    expect(busPassState({ ...base, issued: false })).toBe('awaiting_payment');
  });

  it('counts the grace days from the oldest unpaid bus fee', () => {
    const facts = { oldest_unpaid_due: '2026-11-10', any_paid: true, any_billed: true };
    expect(graceEnds('2026-11-10', 7)).toBe('2026-11-17');
    expect(feeStanding(facts, 7, '2026-11-17')).toBe('due');
    expect(feeStanding(facts, 7, '2026-11-18')).toBe('past_grace');
    expect(feeStanding({ ...facts, oldest_unpaid_due: null }, 7, '2026-11-18')).toBe('clear');
  });

  it('keeps a fee hold only while the fee is still past the grace days', () => {
    expect(busPassState({ ...base, hold: 'on_hold', hold_kind: 'fee', standing: 'past_grace' })).toBe('on_hold');
    expect(busPassState({ ...base, hold: 'on_hold', hold_kind: 'fee', standing: 'clear' })).toBe('active');
    expect(busPassState({ ...base, hold: 'on_hold', hold_kind: 'office', standing: 'clear' })).toBe('on_hold');
  });

  it('expires after its end date', () => {
    expect(busPassState({ ...base, today: '2027-04-01' })).toBe('expired');
  });

  it('numbers passes per school and year', () => {
    expect(passNumber('TZMS', 2026, 42)).toBe('TZMS-BP-2026-0042');
  });

  it('tells the crew why without amounts', () => {
    expect(crewLabel('on_hold', 'fee')).toBe('Pass on hold – fee pending, contact office');
    expect(crewLabel('on_hold', 'office')).toBe('Pass on hold – contact office');
    expect(crewLabel('active', null)).toBeNull();
  });
});
