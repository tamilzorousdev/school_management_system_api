import { assertClassWithinLimit, cellsAsOf, weekStart } from './assignment-weeks';

describe('assignment weeks', () => {
  it('starts a week on Monday', () => {
    expect(weekStart('2026-11-18')).toBe('2026-11-16');
    expect(weekStart('2026-11-16')).toBe('2026-11-16');
    expect(weekStart('2026-11-22')).toBe('2026-11-16');
  });

  it('shows an earlier week as it was before later changes', () => {
    const current = [
      { section_id: 1, subject_id: 10, teacher_user_id: 7, periods_per_week: 6 },
      { section_id: 1, subject_id: 11, teacher_user_id: 8, periods_per_week: 4 },
    ];
    const changes = [
      { id: 1, section_id: 1, subject_id: 10, from_teacher_user_id: 5, from_periods: 7, week_start: '2026-11-16' },
      {
        id: 2,
        section_id: 1,
        subject_id: 11,
        from_teacher_user_id: null,
        from_periods: null,
        week_start: '2026-11-16',
      },
      { id: 0, section_id: 1, subject_id: 10, from_teacher_user_id: 9, from_periods: 5, week_start: '2026-11-09' },
    ];
    const lastWeek = cellsAsOf(current, changes, '2026-11-09');
    expect(lastWeek.get('1:10')).toMatchObject({ teacher_user_id: 5, periods_per_week: 7 });
    expect(lastWeek.has('1:11')).toBe(false);
    const thisWeek = cellsAsOf(current, changes, '2026-11-16');
    expect(thisWeek.get('1:10')).toMatchObject({ teacher_user_id: 7, periods_per_week: 6 });
    expect(cellsAsOf(current, changes, '2026-11-02').get('1:10')).toMatchObject({ teacher_user_id: 9 });
  });

  it('blocks a class going over the weekly limit but lets an old overload come down', () => {
    const names = new Map([[1, 'Class 1 - A']]);
    expect(() => assertClassWithinLimit(new Map([[1, 28]]), new Map([[1, 31]]), names, 30)).toThrow(
      /Class 1 - A would have 31 periods a week/,
    );
    expect(() => assertClassWithinLimit(new Map([[1, 36]]), new Map([[1, 34]]), names, 30)).not.toThrow();
    expect(() => assertClassWithinLimit(new Map([[1, 20]]), new Map([[1, 30]]), names, 30)).not.toThrow();
  });
});
