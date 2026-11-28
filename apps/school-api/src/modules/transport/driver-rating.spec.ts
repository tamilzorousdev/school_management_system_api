import { filterRatedDrivers, lowRatingProblem, ratingMonth, ratingStats, topTags } from './driver-rating.logic';

describe('driver rating', () => {
  it('keeps one rating per month', () => {
    expect(ratingMonth('2026-11-17')).toBe('2026-11');
  });

  it('asks for a reason only on 1 and 2 stars without a complaint chip or comment', () => {
    expect(lowRatingProblem(2, [], null)).toMatch(/what went wrong/);
    expect(lowRatingProblem(1, ['safe_driving'], '  ')).toMatch(/what went wrong/);
    expect(lowRatingProblem(1, ['rash_driving'], null)).toBeNull();
    expect(lowRatingProblem(2, [], 'Drove too fast near school')).toBeNull();
    expect(lowRatingProblem(3, [], null)).toBeNull();
    expect(lowRatingProblem(3, [], null, 3)).toMatch(/what went wrong/);
    expect(lowRatingProblem(3, ['rude'], null, 3)).toBeNull();
  });

  it('averages to one decimal with a 1 to 5 star count', () => {
    expect(ratingStats([5, 4, 4])).toEqual({ average: 4.3, count: 3, distribution: [0, 0, 0, 2, 1] });
    expect(ratingStats([])).toEqual({ average: null, count: 0, distribution: [0, 0, 0, 0, 0] });
  });

  it('lists the most picked chips first', () => {
    const tags = topTags([['on_time', 'polite'], ['on_time'], ['rude', 'polite'], ['on_time']], 2);
    expect(tags.map((tag) => [tag.code, tag.count])).toEqual([
      ['on_time', 3],
      ['polite', 2],
    ]);
    expect(tags[0]).toMatchObject({ label: 'On time', positive: true });
  });
});

describe('filterRatedDrivers', () => {
  const rows = [
    {
      driver: { name: 'Ganesan Pillai' },
      vehicle: { name: 'Bus 1', registration_no: 'TN 09 AB 1234' },
      needs_attention: true,
    },
    {
      driver: { name: 'Muthu Krishnan' },
      vehicle: { name: 'Bus 2', registration_no: 'TN 09 CD 5678' },
      needs_attention: false,
    },
    { driver: { name: 'Spare Driver' }, vehicle: null, needs_attention: false },
  ];

  it('returns everyone without a search or filter', () => {
    expect(filterRatedDrivers(rows, undefined, undefined)).toHaveLength(3);
    expect(filterRatedDrivers(rows, '  ', false)).toHaveLength(3);
  });

  it('matches every word against the driver, bus name or registration', () => {
    expect(filterRatedDrivers(rows, 'ganesan', undefined).map((r) => r.driver.name)).toEqual(['Ganesan Pillai']);
    expect(filterRatedDrivers(rows, 'muthu bus', undefined).map((r) => r.driver.name)).toEqual(['Muthu Krishnan']);
    expect(filterRatedDrivers(rows, 'cd 5678', undefined)).toHaveLength(1);
    expect(filterRatedDrivers(rows, 'ganesan muthu', undefined)).toHaveLength(0);
  });

  it('keeps drivers without a bus searchable by name', () => {
    expect(filterRatedDrivers(rows, 'spare', undefined)).toHaveLength(1);
  });

  it('shows only drivers needing attention when asked', () => {
    expect(filterRatedDrivers(rows, undefined, true).map((r) => r.driver.name)).toEqual(['Ganesan Pillai']);
  });
});
