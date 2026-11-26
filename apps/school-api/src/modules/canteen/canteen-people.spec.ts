import {
  addDays,
  averageRating,
  averageResolutionHours,
  canMoveFeedback,
  datesInRange,
  daysBetween,
  monthRange,
  percent,
  profitOf,
  ratingDistribution,
  resolveRange,
  toCsv,
  wageEstimate,
  withShare,
} from './canteen-people.logic';

describe('canteen people logic', () => {
  describe('date ranges', () => {
    it('adds days across month ends', () => {
      expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
      expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    });

    it('counts days between dates', () => {
      expect(daysBetween('2026-06-01', '2026-06-30')).toBe(29);
    });

    it('defaults to the last 30 days ending today', () => {
      expect(resolveRange(undefined, undefined, '2026-06-30')).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    });

    it('keeps the given bounds', () => {
      expect(resolveRange('2026-05-01', '2026-05-10', '2026-06-30')).toEqual({ from: '2026-05-01', to: '2026-05-10' });
    });

    it('anchors a missing from to the given to', () => {
      expect(resolveRange(undefined, '2026-05-30', '2026-06-30').from).toBe('2026-05-01');
    });

    it('refuses from after to', () => {
      expect(() => resolveRange('2026-06-10', '2026-06-01', '2026-06-30')).toThrow('from must not be after to');
    });

    it('accepts 366 days and refuses 367', () => {
      expect(() => resolveRange('2025-12-31', '2026-12-31', '2026-12-31')).not.toThrow();
      expect(() => resolveRange('2025-12-30', '2026-12-31', '2026-12-31')).toThrow('at most 366 days');
    });

    it('lists every date in a range', () => {
      expect(datesInRange({ from: '2026-02-27', to: '2026-03-02' })).toEqual([
        '2026-02-27',
        '2026-02-28',
        '2026-03-01',
        '2026-03-02',
      ]);
    });

    it('gives the first and last day of a month', () => {
      expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
      expect(monthRange('2028-02').to).toBe('2028-02-29');
    });
  });

  describe('percentages and ratings', () => {
    it('computes percent with rounding and a zero guard', () => {
      expect(percent(1, 3)).toBe(33.33);
      expect(percent(5, 0)).toBe(0);
    });

    it('counts the rating distribution and ignores out-of-range values', () => {
      expect(ratingDistribution([5, 5, 4, 1, 9])).toEqual({ '1': 1, '2': 0, '3': 0, '4': 1, '5': 2 });
    });

    it('averages ratings and returns null for none', () => {
      expect(averageRating([5, 4, 4])).toBe(4.33);
      expect(averageRating([])).toBeNull();
    });

    it('adds the share of the total to each row', () => {
      const rows = withShare(
        [
          { name: 'a', amount: 30 },
          { name: 'b', amount: 70 },
        ],
        (row) => row.amount,
      );
      expect(rows.map((row) => row.share_percent)).toEqual([30, 70]);
    });
  });

  describe('wages', () => {
    it('pays full days plus half of half days', () => {
      expect(wageEstimate({ present: 20, half_day: 2, daily_wage: 500 })).toBe(10500);
    });

    it('is zero without a wage', () => {
      expect(wageEstimate({ present: 20, half_day: 2, daily_wage: null })).toBe(0);
    });
  });

  describe('resolution time', () => {
    it('averages only resolved items in hours', () => {
      const base = new Date('2026-06-01T00:00:00Z');
      const spans = [
        { created_at: base, resolved_at: new Date('2026-06-01T02:00:00Z') },
        { created_at: base, resolved_at: new Date('2026-06-01T04:00:00Z') },
        { created_at: base, resolved_at: null },
      ];
      expect(averageResolutionHours(spans)).toBe(3);
    });

    it('is null when nothing is resolved', () => {
      expect(averageResolutionHours([{ created_at: new Date(), resolved_at: null }])).toBeNull();
    });
  });

  describe('feedback transitions', () => {
    it('allows the forward flow and reopening a resolved item', () => {
      expect(canMoveFeedback('open', 'in_progress')).toBe(true);
      expect(canMoveFeedback('in_progress', 'resolved')).toBe(true);
      expect(canMoveFeedback('resolved', 'closed')).toBe(true);
      expect(canMoveFeedback('resolved', 'open')).toBe(true);
    });

    it('refuses everything else', () => {
      expect(canMoveFeedback('closed', 'open')).toBe(false);
      expect(canMoveFeedback('in_progress', 'open')).toBe(false);
      expect(canMoveFeedback('open', 'closed')).toBe(false);
    });
  });

  describe('csv and profit', () => {
    it('quotes cells with commas, quotes and newlines', () => {
      expect(
        toCsv(
          ['a', 'b'],
          [
            ['x,y', 'say "hi"'],
            [1, null],
          ],
        ),
      ).toBe('a,b\r\n"x,y","say ""hi"""\r\n1,\r\n');
    });

    it('computes profit after purchases, waste and wages', () => {
      expect(profitOf(10000, 4000, 500.5, 2000)).toBe(3499.5);
    });
  });
});
