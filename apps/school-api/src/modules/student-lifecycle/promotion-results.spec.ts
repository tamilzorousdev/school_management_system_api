import { groupResults, studentResults } from './promotion-results';

const mark = (student_id: number, group_id: number, marks: number | null, is_absent = false) => ({
  student_id,
  group_id,
  marks,
  is_absent,
  max_marks: 100,
  pass_marks: 35,
});

describe('promotion results', () => {
  it('fails a student who is below the pass mark or absent in any subject', () => {
    const results = studentResults([
      mark(1, 7, 80),
      mark(1, 7, 30),
      mark(2, 7, 90),
      mark(2, 7, null, true),
      mark(3, 7, 60),
    ]);
    expect(results.get(1)).toEqual({ group_id: 7, percent: 55, passed: false });
    expect(results.get(2)).toEqual({ group_id: 7, percent: 45, passed: false });
    expect(results.get(3)).toEqual({ group_id: 7, percent: 60, passed: true });
  });

  it('gives each grade its own pass and average percentage', () => {
    const grades = groupResults(
      studentResults([mark(1, 6, 80), mark(2, 6, 20), mark(3, 6, 70), mark(4, 7, 90), mark(5, 7, 50)]),
    );
    expect(grades.get(6)).toEqual({ assessed: 3, passed: 2, pass_percent: 66.7, average_percent: 56.7 });
    expect(grades.get(7)).toEqual({ assessed: 2, passed: 2, pass_percent: 100, average_percent: 70 });
  });

  it('has no grade entry when nothing is marked', () => {
    expect(groupResults(studentResults([])).size).toBe(0);
  });
});
