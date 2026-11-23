import {
  computeSlaDueDate,
  defaultSlaHours,
  formatTicketNumber,
  isSlaBreached,
  parseTicketSequence,
} from './grievances.logic';

describe('Grievances logic', () => {
  describe('defaultSlaHours', () => {
    it('returns 12 for critical priority', () => {
      expect(defaultSlaHours('transport', 'critical')).toBe(12);
      expect(defaultSlaHours('academics', 'critical')).toBe(12);
    });

    it('returns 24 for high priority or safety_bullying category', () => {
      expect(defaultSlaHours('transport', 'high')).toBe(24);
      expect(defaultSlaHours('safety_bullying', 'low')).toBe(24);
    });

    it('returns 48 for medium priority or transport/academics', () => {
      expect(defaultSlaHours('facilities', 'medium')).toBe(48);
      expect(defaultSlaHours('transport', 'low')).toBe(48);
      expect(defaultSlaHours('academics', 'low')).toBe(48);
    });

    it('returns 72 for low priority other categories', () => {
      expect(defaultSlaHours('other', 'low')).toBe(72);
      expect(defaultSlaHours('facilities', 'low')).toBe(72);
    });
  });

  describe('computeSlaDueDate', () => {
    it('adds hours correctly to a given date', () => {
      const base = new Date('2026-11-20T10:00:00.000Z');
      const due = computeSlaDueDate(24, base);
      expect(due.toISOString()).toBe('2026-11-21T10:00:00.000Z');
    });
  });

  describe('isSlaBreached', () => {
    it('detects SLA breach for open tickets past due', () => {
      const past = new Date(Date.now() - 100000);
      expect(isSlaBreached(past, 'in_progress')).toBe(true);
    });

    it('detects no breach for tickets ahead of SLA', () => {
      const future = new Date(Date.now() + 100000);
      expect(isSlaBreached(future, 'in_progress')).toBe(false);
    });

    it('checks resolved_at for resolved tickets', () => {
      const sla = new Date('2026-11-20T12:00:00.000Z');
      const resolvedOnTime = new Date('2026-11-20T11:00:00.000Z');
      const resolvedLate = new Date('2026-11-20T13:00:00.000Z');

      expect(isSlaBreached(sla, 'resolved', resolvedOnTime)).toBe(false);
      expect(isSlaBreached(sla, 'resolved', resolvedLate)).toBe(true);
    });
  });

  describe('ticket numbers', () => {
    it('formats ticket number with 4-digit zero padding', () => {
      expect(formatTicketNumber(2026, 1)).toBe('GRV-2026-0001');
      expect(formatTicketNumber(2026, 42)).toBe('GRV-2026-0042');
      expect(formatTicketNumber(2026, 1050)).toBe('GRV-2026-1050');
    });

    it('parses ticket sequence number', () => {
      expect(parseTicketSequence('GRV-2026-0005')).toBe(5);
      expect(parseTicketSequence('invalid')).toBeNull();
    });
  });
});
