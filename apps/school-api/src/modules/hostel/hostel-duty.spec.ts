import {
  averageOf,
  capacityPlan,
  checkInWindow,
  crossesMidnight,
  dateRange,
  duplicateKeys,
  pairUp,
  percentOf,
  runsOn,
  seatLabels,
  seatNumber,
  shiftBounds,
  shiftEndDate,
  weekdayOf,
  zonedDate,
  zoneOffsetMinutes,
} from './hostel-duty.logic';

const IST = 'Asia/Kolkata';

describe('hostel duty logic', () => {
  describe('shift times', () => {
    it('knows when a shift crosses midnight', () => {
      expect(crossesMidnight('21:00', '06:00')).toBe(true);
      expect(crossesMidnight('06:00', '14:00')).toBe(false);
      expect(shiftEndDate('2026-07-14', '21:00', '06:00')).toBe('2026-07-15');
      expect(shiftEndDate('2026-12-31', '22:00', '06:00')).toBe('2027-01-01');
      expect(shiftEndDate('2026-07-14', '06:00', '14:00')).toBe('2026-07-14');
    });

    it('turns a local date and time into the right instant', () => {
      expect(zoneOffsetMinutes(IST, new Date('2026-07-14T00:00:00Z'))).toBe(330);
      expect(zonedDate('2026-07-14', '06:00', IST).toISOString()).toBe('2026-07-14T00:30:00.000Z');
      expect(zonedDate('2026-07-14', '06:00', 'UTC').toISOString()).toBe('2026-07-14T06:00:00.000Z');
    });

    it('builds the window of a night shift into the next day', () => {
      const bounds = shiftBounds('2026-07-14', '21:00', '06:00', IST);
      expect(bounds.start.toISOString()).toBe('2026-07-14T15:30:00.000Z');
      expect(bounds.end.toISOString()).toBe('2026-07-15T00:30:00.000Z');
    });
  });

  describe('checkInWindow', () => {
    const bounds = shiftBounds('2026-07-14', '06:00', '14:00', IST);
    const at = (iso: string) => new Date(iso);

    it('opens 30 minutes before the start', () => {
      expect(checkInWindow(bounds, at('2026-07-13T23:59:00Z'))).toBe('too_early');
      expect(checkInWindow(bounds, at('2026-07-14T00:00:00Z'))).toBe('open');
      expect(checkInWindow(bounds, at('2026-07-14T03:00:00Z'))).toBe('open');
    });

    it('closes when the shift ends', () => {
      expect(checkInWindow(bounds, at('2026-07-14T08:30:00Z'))).toBe('open');
      expect(checkInWindow(bounds, at('2026-07-14T08:31:00Z'))).toBe('over');
    });

    it('honours a custom early allowance', () => {
      expect(checkInWindow(bounds, at('2026-07-14T00:00:00Z'), 10)).toBe('too_early');
    });
  });

  describe('study days', () => {
    it('reads the weekday of a date (0 = Sunday)', () => {
      expect(weekdayOf('2026-07-12')).toBe(0);
      expect(weekdayOf('2026-07-14')).toBe(2);
      expect(weekdayOf('2026-07-18')).toBe(6);
    });

    it('says whether a schedule runs on a date', () => {
      expect(runsOn([1, 2, 3, 4, 5], '2026-07-14')).toBe(true);
      expect(runsOn([1, 2, 3, 4, 5], '2026-07-12')).toBe(false);
      expect(runsOn([0], '2026-07-12')).toBe(true);
    });
  });

  describe('seats', () => {
    it('labels seats S1..Sn and skips taken labels', () => {
      expect(seatLabels(3)).toEqual(['S1', 'S2', 'S3']);
      expect(seatLabels(2, ['S1', 's3'])).toEqual(['S2', 'S4']);
      expect(seatLabels(0)).toEqual([]);
    });

    it('reads the seat number', () => {
      expect(seatNumber('S12')).toBe(12);
      expect(seatNumber('X')).toBe(0);
    });

    const seats = [
      { id: 1, seat_no: 'S1', active: true, occupied: true },
      { id: 2, seat_no: 'S2', active: true, occupied: false },
      { id: 3, seat_no: 'S3', active: true, occupied: true },
      { id: 4, seat_no: 'S4', active: false, occupied: false },
    ];

    it('reuses turned-off seats first, then adds new ones', () => {
      expect(capacityPlan(seats, 5)).toEqual({ activate: [4], deactivate: [], add: ['S5'] });
      expect(capacityPlan(seats, 4)).toEqual({ activate: [4], deactivate: [], add: [] });
    });

    it('turns off only free seats, highest first', () => {
      expect(capacityPlan(seats, 2)).toEqual({ activate: [], deactivate: [2], add: [] });
      expect(capacityPlan(seats, 3)).toEqual({ activate: [], deactivate: [], add: [] });
    });

    it('refuses to go below the seats in use', () => {
      expect(capacityPlan(seats, 1)).toBeNull();
    });

    it('pairs students with seats in order', () => {
      expect(pairUp(['a', 'b', 'c'], [10, 20])).toEqual({
        pairs: [
          ['a', 10],
          ['b', 20],
        ],
        left: ['c'],
      });
      expect(pairUp(['a'], [10, 20]).left).toEqual([]);
    });
  });

  describe('numbers and lists', () => {
    it('computes percent and average with one decimal', () => {
      expect(percentOf(2, 3)).toBe(66.7);
      expect(percentOf(1, 0)).toBe(0);
      expect(averageOf(25, 4)).toBe(6.3);
      expect(averageOf(5, 0)).toBe(0);
    });

    it('finds repeated keys', () => {
      expect(duplicateKeys([1, 2, 1, 3, 2], String)).toEqual(['1', '2']);
      expect(duplicateKeys([1, 2], String)).toEqual([]);
    });

    it('fills a default date range', () => {
      expect(dateRange(undefined, undefined, '2026-07-14', 7)).toEqual({ from: '2026-07-14', to: '2026-07-20' });
      expect(dateRange('2026-07-01', undefined, '2026-07-14', 7)).toEqual({ from: '2026-07-01', to: '2026-07-07' });
      expect(dateRange(undefined, '2026-07-10', '2026-07-14', 7)).toEqual({ from: '2026-07-04', to: '2026-07-10' });
      expect(dateRange('2026-07-01', '2026-07-03', '2026-07-14', 7)).toEqual({ from: '2026-07-01', to: '2026-07-03' });
    });
  });
});
