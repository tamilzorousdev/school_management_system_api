import { QrTokens } from '../security/qr-tokens';
import {
  addDays,
  applicationMove,
  bedLabels,
  billableItems,
  checkoutItems,
  complaintMove,
  depositRefund,
  scheduleErrors,
  shareOf,
  slaDueAt,
  ticketCanMove,
  daysBetween,
  DEFAULT_ENABLED_MODULES,
  genderAllowed,
  lateMinutes,
  leaveMove,
  outingWithinWindow,
  rollStatusFromLeave,
  serialNumber,
  DEFAULT_TIMINGS,
  mergeEnabledModules,
  occupancyPercent,
  roomNumbers,
  timingErrors,
} from './hostel.logic';

describe('hostel logic', () => {
  describe('bedLabels', () => {
    it('labels beds A, B, C in order', () => {
      expect(bedLabels(4)).toEqual(['A', 'B', 'C', 'D']);
    });

    it('skips labels already used in the room', () => {
      expect(bedLabels(2, ['A', 'c'])).toEqual(['B', 'D']);
    });

    it('continues past Z with AA, AB', () => {
      expect(bedLabels(28).slice(-3)).toEqual(['Z', 'AA', 'AB']);
    });
  });

  describe('roomNumbers', () => {
    it('builds a padded run with a prefix', () => {
      expect(roomNumbers('A-', 1, 3, 3)).toEqual(['A-001', 'A-002', 'A-003']);
    });

    it('builds plain numbers without padding', () => {
      expect(roomNumbers('', 101, 2, 0)).toEqual(['101', '102']);
    });
  });

  describe('mergeEnabledModules', () => {
    it('returns defaults when nothing is stored', () => {
      expect(mergeEnabledModules(null)).toEqual(DEFAULT_ENABLED_MODULES);
    });

    it('keeps stored switches and ignores unknown keys and non-booleans', () => {
      const merged = mergeEnabledModules({ lockers: true, staff_duty: 'yes', unknown: true });
      expect(merged.lockers).toBe(true);
      expect(merged.staff_duty).toBe(false);
      expect(merged).not.toHaveProperty('unknown');
    });
  });

  describe('timingErrors', () => {
    it('accepts the defaults', () => {
      expect(timingErrors(DEFAULT_TIMINGS)).toEqual([]);
    });

    it('rejects study ending before it starts and lights out before in-time', () => {
      const errors = timingErrors({ ...DEFAULT_TIMINGS, study_end_time: '18:00', lights_out_time: '18:00' });
      expect(errors.map((error) => error.field)).toEqual(['study_end_time', 'lights_out_time']);
    });

    it('rejects an outing window that ends before it starts', () => {
      const errors = timingErrors({ ...DEFAULT_TIMINGS, outing_until_time: '15:00' });
      expect(errors.map((error) => error.field)).toEqual(['outing_until_time']);
    });
  });

  describe('genderAllowed', () => {
    it('lets anyone into a mixed hostel', () => {
      expect(genderAllowed('mixed', 'male')).toBe(true);
      expect(genderAllowed('mixed', 'other')).toBe(true);
    });

    it('keeps boys and girls hostels separate', () => {
      expect(genderAllowed('boys', 'male')).toBe(true);
      expect(genderAllowed('boys', 'female')).toBe(false);
      expect(genderAllowed('girls', 'female')).toBe(true);
      expect(genderAllowed('girls', 'male')).toBe(false);
    });
  });

  describe('applicationMove', () => {
    it('approves pending and waitlisted applications', () => {
      expect(applicationMove('pending', 'approve')).toBe('approved');
      expect(applicationMove('waitlisted', 'approve')).toBe('approved');
    });

    it('can put an approved application back on the waitlist', () => {
      expect(applicationMove('approved', 'waitlist')).toBe('waitlisted');
    });

    it('never changes a closed application', () => {
      for (const state of ['rejected', 'cancelled', 'admitted'] as const) {
        for (const action of ['approve', 'waitlist', 'reject', 'cancel'] as const) {
          expect(applicationMove(state, action)).toBeNull();
        }
      }
    });
  });

  describe('checkoutItems', () => {
    it('has the standard clearance list without lockers', () => {
      expect(checkoutItems({ lockers: false }).map((item) => item.code)).toEqual([
        'room_handover',
        'key_return',
        'damage_check',
        'fee_dues',
        'deposit_refund',
      ]);
    });

    it('adds the locker step when lockers are turned on', () => {
      expect(checkoutItems({ lockers: true }).map((item) => item.code)).toContain('locker_return');
    });
  });

  describe('serialNumber', () => {
    it('pads the running number', () => {
      expect(serialNumber('HST', '2026', 7)).toBe('HST-2026-0007');
    });
  });

  describe('leaveMove', () => {
    it('follows the request, consent, approval and gate flow', () => {
      expect(leaveMove('awaiting_parent', 'consent_given')).toBe('pending');
      expect(leaveMove('awaiting_parent', 'consent_refused')).toBe('rejected');
      expect(leaveMove('pending', 'approve')).toBe('approved');
      expect(leaveMove('approved', 'out')).toBe('out');
      expect(leaveMove('out', 'in')).toBe('returned');
    });

    it('cannot approve before the parent agrees or cancel once the student is out', () => {
      expect(leaveMove('awaiting_parent', 'approve')).toBeNull();
      expect(leaveMove('out', 'cancel')).toBeNull();
      expect(leaveMove('pending', 'out')).toBeNull();
      expect(leaveMove('returned', 'in')).toBeNull();
    });
  });

  describe('outingWithinWindow', () => {
    const window = { outing_from_time: '16:00', outing_until_time: '18:30' };

    it('accepts an outing inside the window', () => {
      expect(outingWithinWindow('16:15', '18:00', window)).toBe(true);
    });

    it('rejects leaving early, coming back late or a reversed time', () => {
      expect(outingWithinWindow('15:30', '17:00', window)).toBe(false);
      expect(outingWithinWindow('16:30', '19:00', window)).toBe(false);
      expect(outingWithinWindow('17:00', '16:30', window)).toBe(false);
    });
  });

  describe('lateMinutes', () => {
    it('counts whole minutes past the expected time', () => {
      const expected = new Date('2026-07-12T13:30:00Z');
      expect(lateMinutes(expected, new Date('2026-07-12T13:55:30Z'))).toBe(25);
    });

    it('is zero when on time or early', () => {
      const expected = new Date('2026-07-12T13:30:00Z');
      expect(lateMinutes(expected, new Date('2026-07-12T13:00:00Z'))).toBe(0);
    });
  });

  describe('dates', () => {
    it('counts days inclusively', () => {
      expect(daysBetween('2026-07-10', '2026-07-12')).toBe(3);
      expect(daysBetween('2026-07-10', '2026-07-10')).toBe(1);
    });

    it('adds days across a month end', () => {
      expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
      expect(addDays('2026-08-01', -1)).toBe('2026-07-31');
    });
  });

  describe('rollStatusFromLeave', () => {
    it('suggests outing or on leave only while the student is out', () => {
      expect(rollStatusFromLeave('outing', 'out')).toBe('outing');
      expect(rollStatusFromLeave('home', 'out')).toBe('on_leave');
      expect(rollStatusFromLeave('home', null)).toBeNull();
    });
  });

  describe('hostel pass QR', () => {
    const tokens = new QrTokens('a-test-secret-that-is-long-enough-1234');

    it('reads back its own pass', () => {
      const token = tokens.hostelPass(9, 2);
      expect(token.startsWith('TZH1.9.2.')).toBe(true);
      expect(tokens.readHostelPass(token)).toEqual({ leave_id: 9, version: 2 });
    });

    it('rejects a changed or foreign token', () => {
      const token = tokens.hostelPass(9, 2);
      expect(tokens.readHostelPass(token.replace('TZH1.9.', 'TZH1.10.'))).toBeNull();
      expect(new QrTokens('another-secret-that-is-long-enough-9999').readHostelPass(token)).toBeNull();
      expect(tokens.readHostelPass(tokens.student(9, 2))).toBeNull();
    });
  });

  describe('hostel fee schedule', () => {
    const items = [
      { id: 1, label: 'Term 1', due_date: '2026-06-10', share_percent: 40 },
      { id: 2, label: 'Term 2', due_date: '2026-10-01', share_percent: 30 },
      { id: 3, label: 'Term 3', due_date: '2027-01-05', share_percent: 30 },
    ];

    it('bills every instalment for a student admitted at the start', () => {
      expect(billableItems(items, '2026-06-01', '2027-03-31').map((item) => item.id)).toEqual([1, 2, 3]);
    });

    it('bills the running term and later ones for a mid-year admission', () => {
      expect(billableItems(items, '2026-11-15', '2027-03-31').map((item) => item.id)).toEqual([2, 3]);
    });

    it('accepts shares that add up to 100 inside the year', () => {
      expect(scheduleErrors(items, { start_date: '2026-06-01', end_date: '2027-03-31' })).toEqual([]);
    });

    it('rejects wrong totals, dates outside the year and repeated dates', () => {
      const errors = scheduleErrors(
        [
          { due_date: '2026-05-01', share_percent: 50 },
          { due_date: '2026-05-01', share_percent: 40 },
        ],
        { start_date: '2026-06-01', end_date: '2027-03-31' },
      );
      expect(errors).toHaveLength(3);
    });

    it('works out the share of the annual fee', () => {
      expect(shareOf(60000, 40)).toBe(24000);
      expect(shareOf(50000, 33.33)).toBe(16665);
    });

    it('refunds the deposit less the deduction, never below zero', () => {
      expect(depositRefund(5000, 750)).toBe(4250);
      expect(depositRefund(5000, 6000)).toBe(0);
    });
  });

  describe('complaints and maintenance', () => {
    it('sets the fix-by time from the priority', () => {
      const at = new Date('2026-07-01T10:00:00Z');
      expect(slaDueAt(at, 'urgent').toISOString()).toBe('2026-07-01T14:00:00.000Z');
      expect(slaDueAt(at, 'normal').toISOString()).toBe('2026-07-04T10:00:00.000Z');
    });

    it('moves a complaint through its life', () => {
      expect(complaintMove('open', 'start')).toBe('in_progress');
      expect(complaintMove('in_progress', 'resolve')).toBe('resolved');
      expect(complaintMove('resolved', 'close')).toBe('closed');
      expect(complaintMove('resolved', 'reopen')).toBe('in_progress');
      expect(complaintMove('closed', 'reopen')).toBeNull();
      expect(complaintMove('open', 'close')).toBeNull();
    });

    it('never moves a finished ticket', () => {
      expect(ticketCanMove('open', 'assigned')).toBe(true);
      expect(ticketCanMove('on_hold', 'in_progress')).toBe(true);
      expect(ticketCanMove('done', 'in_progress')).toBe(false);
      expect(ticketCanMove('cancelled', 'open')).toBe(false);
    });
  });

  describe('occupancyPercent', () => {
    it('is zero when there are no beds', () => {
      expect(occupancyPercent(0, 0)).toBe(0);
    });

    it('rounds to one decimal', () => {
      expect(occupancyPercent(2, 3)).toBe(66.7);
    });
  });
});
