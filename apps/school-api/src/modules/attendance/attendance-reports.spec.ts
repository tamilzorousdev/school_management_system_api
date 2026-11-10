import { clampRange, monthsBetween } from './attendance-reports.logic';

describe('attendance reports', () => {
  it('lists every month of the year so far across the new year', () => {
    expect(monthsBetween('2026-06-01', '2027-01-15')).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
  });

  it('gives one month when the range is inside a month', () => {
    expect(monthsBetween('2026-11-03', '2026-11-10')).toEqual(['2026-11']);
  });

  it('cuts a month to the year start and today', () => {
    expect(clampRange('2026-06-01', '2026-06-30', '2026-06-10', '2026-11-10')).toEqual({
      from: '2026-06-10',
      to: '2026-06-30',
    });
    expect(clampRange('2026-11-01', '2026-11-30', '2026-06-01', '2026-11-10')).toEqual({
      from: '2026-11-01',
      to: '2026-11-10',
    });
    expect(clampRange('2026-12-01', '2026-12-31', '2026-06-01', '2026-11-10')).toBeNull();
  });
});
