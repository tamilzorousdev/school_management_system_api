import { rankTeachers, ratingCycle, starLabel, subjectResults, summariseRatings } from './feedback.logic';

describe('ratingCycle', () => {
  it('splits the academic year into windows of the chosen months', () => {
    expect(ratingCycle('2026-06-01', '2027-04-30', '2026-11-14', 3)).toEqual({
      start: '2026-09-01',
      end: '2026-11-30',
    });
    expect(ratingCycle('2026-06-01', '2027-04-30', '2026-11-14', 1)).toEqual({
      start: '2026-11-01',
      end: '2026-11-30',
    });
    expect(ratingCycle('2026-06-01', '2027-04-30', '2026-11-14', 6)).toEqual({
      start: '2026-06-01',
      end: '2026-11-30',
    });
  });

  it('stops the last window at the end of the year', () => {
    expect(ratingCycle('2026-06-01', '2027-04-30', '2027-04-10', 12)).toEqual({
      start: '2026-06-01',
      end: '2027-04-30',
    });
    expect(ratingCycle('2026-06-01', '2027-04-30', '2027-04-10', 2)).toEqual({
      start: '2027-04-01',
      end: '2027-04-30',
    });
  });

  it('has no window outside the academic year', () => {
    expect(ratingCycle('2026-06-01', '2027-04-30', '2027-05-02', 3)).toBeNull();
  });

  it('keeps month ends inside short months', () => {
    expect(ratingCycle('2026-01-31', '2026-12-31', '2026-03-05', 1)).toEqual({
      start: '2026-02-28',
      end: '2026-03-27',
    });
  });
});

describe('starLabel', () => {
  it('names each star level', () => {
    expect([5, 4, 3, 2, 1].map(starLabel)).toEqual(['Excellent', 'Very good', 'Good', 'Average', 'Needs improvement']);
    expect(starLabel(null)).toBeNull();
  });
});

describe('ratings', () => {
  const rows = [
    { teacher_user_id: 1, stars: 5, behaviour: 'good' as const },
    { teacher_user_id: 1, stars: 4, behaviour: 'good' as const },
    { teacher_user_id: 2, stars: 5, behaviour: 'bad' as const },
    { teacher_user_id: 3, stars: 4, behaviour: 'good' as const },
    { teacher_user_id: 3, stars: 5, behaviour: 'good' as const },
    { teacher_user_id: 3, stars: 5, behaviour: 'good' as const },
  ];

  it('averages stars and counts good and bad behaviour', () => {
    expect(summariseRatings(rows.slice(0, 3))).toEqual({
      ratings: 3,
      average_stars: 4.7,
      good: 2,
      bad: 1,
      good_percent: 66.7,
    });
    expect(summariseRatings([]).average_stars).toBeNull();
  });

  it('ranks by average stars, then good behaviour, then number of ratings; unrated teachers come last', () => {
    const ranked = rankTeachers(
      [
        { teacher_user_id: 1, name: 'Anand' },
        { teacher_user_id: 2, name: 'Bala' },
        { teacher_user_id: 3, name: 'Chitra' },
        { teacher_user_id: 4, name: 'Devi' },
      ],
      rows,
    );
    expect(ranked.map((item) => [item.name, item.rank])).toEqual([
      ['Bala', 1],
      ['Chitra', 2],
      ['Anand', 3],
      ['Devi', null],
    ]);
  });
});

describe('subjectResults', () => {
  const paper = (
    section_id: number,
    subject_id: number,
    student_id: number,
    marks: number | null,
    is_absent = false,
  ) => ({
    section_id,
    subject_id,
    student_id,
    marks,
    is_absent,
    max_marks: 100,
    pass_marks: 35,
  });

  it('gives pass, fail and average per section and subject', () => {
    const results = subjectResults([
      paper(7, 1, 10, 80),
      paper(7, 1, 11, 30),
      paper(7, 1, 12, null, true),
      paper(7, 1, 10, 90),
      paper(7, 2, 10, 60),
    ]);
    expect(results.get('7:1')).toEqual({
      section_id: 7,
      subject_id: 1,
      students: 3,
      papers: 4,
      passed: 2,
      pass_percent: 50,
      fail_percent: 50,
      average_percent: 50,
    });
    expect(results.get('7:2')?.pass_percent).toBe(100);
  });
});
