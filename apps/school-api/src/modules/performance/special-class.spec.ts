import { firstClash, occurrences, runsOn, timesOverlap, to12, whenText } from './special-class.logic';

const year = { from: '2026-06-01', to: '2027-04-30' };

const extra = {
  timing: 'extra_time' as const,
  day_of_week: null,
  period_no: null,
  days: [1, 3],
  start_date: '2026-12-01',
  end_date: '2026-12-31',
  start_time: '16:00',
  end_time: '17:00',
};

describe('special class schedule', () => {
  it('runs on the chosen weekdays inside the dates', () => {
    expect(runsOn(extra, '2026-12-02', year)).toBe(true);
    expect(runsOn(extra, '2026-12-03', year)).toBe(false);
    expect(runsOn(extra, '2027-01-04', year)).toBe(false);
    expect(occurrences(extra, year)).toHaveLength(9);
  });

  it('runs once on a single date when no weekday is chosen', () => {
    const oneOff = { ...extra, days: [], start_date: '2026-12-13', end_date: '2026-12-13' };
    expect(occurrences(oneOff, year)).toEqual(['2026-12-13']);
  });

  it('repeats a period class every week of the year', () => {
    const period = {
      ...extra,
      timing: 'period' as const,
      day_of_week: 3,
      days: null,
      start_date: null,
      end_date: null,
    };
    expect(runsOn(period, '2026-12-02', year)).toBe(true);
    expect(occurrences(period, year, { from: '2026-12-01', to: '2026-12-31' })).toHaveLength(5);
  });

  it('finds the first time two classes meet', () => {
    expect(timesOverlap('16:00', '17:00', '16:30', '17:30')).toBe(true);
    expect(timesOverlap('16:00', '17:00', '17:00', '18:00')).toBe(false);
    expect(
      firstClash(
        [{ date: '2026-12-02', start: '16:00', end: '17:00' }],
        [{ date: '2026-12-02', start: '16:45', end: '17:30' }],
      ),
    ).toEqual({ date: '2026-12-02', start: '16:45', end: '17:30' });
    expect(firstClash([{ date: '2026-12-02', start: '16:00', end: '17:00' }], [])).toBeNull();
  });

  it('describes when the class runs', () => {
    expect(to12('16:05')).toBe('4:05 PM');
    expect(whenText(extra, { start: '16:00', end: '17:00' })).toBe(
      'every Mon, Wed, 4:00 PM – 5:00 PM, 1 Dec to 31 Dec',
    );
    expect(
      whenText(
        { ...extra, timing: 'period', day_of_week: 3, period_no: 7, days: null },
        { start: '14:30', end: '15:15' },
      ),
    ).toBe('every Wed, period 7, 2:30 PM – 3:15 PM');
  });
});
