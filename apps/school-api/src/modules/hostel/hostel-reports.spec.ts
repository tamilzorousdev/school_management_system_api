import {
  attendanceRate,
  averageOf,
  bucketByMonth,
  countsFor,
  dayKeys,
  defaultRange,
  fillBy,
  labelOf,
  monthKeys,
  percent,
  rangeErrors,
  reportRange,
  round,
  sumCounts,
  tally,
} from './hostel-reports.logic';

describe('hostel reports logic', () => {
  describe('percent', () => {
    it('rounds to one decimal place', () => {
      expect(percent(138, 160)).toBe(86.3);
      expect(percent(1, 3, 2)).toBe(33.33);
      expect(percent(5, 5)).toBe(100);
    });

    it('is null when there is nothing to divide by', () => {
      expect(percent(0, 0)).toBeNull();
    });
  });

  describe('round and averageOf', () => {
    it('rounds money to two places', () => {
      expect(round(1234.567)).toBe(1234.57);
    });

    it('reads SQL averages and keeps null', () => {
      expect(averageOf(null)).toBeNull();
      expect(averageOf(undefined)).toBeNull();
      expect(averageOf('37.456')).toBe(37.5);
      expect(averageOf(12)).toBe(12);
    });
  });

  describe('defaultRange', () => {
    it('defaults to the last 30 days ending today', () => {
      expect(defaultRange({}, '2026-11-25')).toEqual({ from: '2026-10-27', to: '2026-11-25' });
    });

    it('counts back 30 days from a given to', () => {
      expect(defaultRange({ to: '2026-03-01' }, '2026-11-25')).toEqual({ from: '2026-01-31', to: '2026-03-01' });
    });

    it('runs 30 days forward from a given from, never past today', () => {
      expect(defaultRange({ from: '2026-01-01' }, '2026-11-25')).toEqual({ from: '2026-01-01', to: '2026-01-30' });
      expect(defaultRange({ from: '2026-11-20' }, '2026-11-25')).toEqual({ from: '2026-11-20', to: '2026-11-25' });
    });

    it('keeps both dates when given', () => {
      expect(defaultRange({ from: '2026-06-01', to: '2026-06-30' }, '2026-11-25')).toEqual({
        from: '2026-06-01',
        to: '2026-06-30',
      });
    });
  });

  describe('rangeErrors', () => {
    it('accepts a valid range, including a single day', () => {
      expect(rangeErrors('2026-06-01', '2026-06-30')).toEqual([]);
      expect(rangeErrors('2026-06-01', '2026-06-01')).toEqual([]);
    });

    it('rejects from after to', () => {
      expect(rangeErrors('2026-07-01', '2026-06-30')).toEqual([
        { field: 'from', message: 'from must be on or before to' },
      ]);
    });

    it('allows 366 days and rejects 367', () => {
      expect(rangeErrors('2027-01-01', '2028-01-01')).toEqual([]);
      expect(rangeErrors('2026-01-01', '2027-01-02')).toEqual([
        { field: 'to', message: 'A report can cover at most 366 days' },
      ]);
    });
  });

  describe('reportRange', () => {
    it('counts both ends', () => {
      expect(reportRange('2026-10-27', '2026-11-25')).toEqual({ from: '2026-10-27', to: '2026-11-25', days: 30 });
    });
  });

  describe('dayKeys and monthKeys', () => {
    it('lists every day across a month end', () => {
      expect(dayKeys('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
    });

    it('lists every month across a year end', () => {
      expect(monthKeys('2026-11-15', '2027-02-03')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
      expect(monthKeys('2026-05-01', '2026-05-31')).toEqual(['2026-05']);
    });
  });

  describe('bucketByMonth', () => {
    it('adds days into months and fills empty months with 0', () => {
      expect(
        bucketByMonth(
          [
            { date: '2026-09-03', count: 2 },
            { date: '2026-09-28', count: 1 },
            { date: '2026-11-10', count: 4 },
          ],
          '2026-09-01',
          '2026-11-30',
        ),
      ).toEqual([
        { key: '2026-09', count: 3 },
        { key: '2026-10', count: 0 },
        { key: '2026-11', count: 4 },
      ]);
    });
  });

  describe('fillBy', () => {
    it('keeps the key order and fills gaps', () => {
      const rows = [{ slot: 'night', count: 5 }];
      expect(
        fillBy(
          ['morning', 'night'],
          rows,
          (row) => row.slot,
          (slot) => ({ slot, count: 0 }),
        ),
      ).toEqual([
        { slot: 'morning', count: 0 },
        { slot: 'night', count: 5 },
      ]);
    });
  });

  describe('tally, countsFor and sumCounts', () => {
    const rows = [
      { kind: 'outing', status: 'returned', count: 4 },
      { kind: 'outing', status: 'cancelled', count: 1 },
      { kind: 'home', status: 'returned', count: 2 },
    ];

    it('adds counts per key and can skip rows', () => {
      expect(tally(rows, (row) => row.kind)).toEqual([
        { key: 'outing', count: 5 },
        { key: 'home', count: 2 },
      ]);
      expect(
        tally(
          rows,
          (row) => row.kind,
          (row) => row.status !== 'cancelled',
        ),
      ).toEqual([
        { key: 'outing', count: 4 },
        { key: 'home', count: 2 },
      ]);
      expect(tally(rows, (row) => (row.status === 'returned' ? 'returned' : null))).toEqual([
        { key: 'returned', count: 6 },
      ]);
    });

    it('lists every catalog key in order and keeps unknown keys at the end', () => {
      const counts = countsFor(
        ['home', 'outing', 'medical'],
        [
          { key: 'outing', count: 5 },
          { key: 'legacy', count: 1 },
        ],
      );
      expect(counts).toEqual([
        { key: 'home', count: 0 },
        { key: 'outing', count: 5 },
        { key: 'medical', count: 0 },
        { key: 'legacy', count: 1 },
      ]);
      expect(sumCounts(counts)).toBe(6);
    });
  });

  describe('attendanceRate', () => {
    it('counts late as present and leaves away and sick out', () => {
      expect(attendanceRate({ present: 90, late: 5, absent: 5 })).toBe(95);
      expect(attendanceRate({ present: 0, late: 0, absent: 0 })).toBeNull();
    });
  });

  describe('labelOf', () => {
    it('turns codes into labels', () => {
      expect(labelOf('absent_without_leave')).toBe('Absent without leave');
      expect(labelOf('home')).toBe('Home');
    });
  });
});
