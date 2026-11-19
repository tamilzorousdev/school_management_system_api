import { lowRatingProblem, ratingMonth, ratingStats, topTags } from './driver-rating.logic';

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
