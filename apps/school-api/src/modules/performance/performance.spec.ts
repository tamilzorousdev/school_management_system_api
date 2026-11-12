import {
  bandLimits,
  belowLine,
  inBand,
  MarkRow,
  scoreStudents,
  sectionFigures,
  subjectAverages,
  weakSubjects,
} from './performance.logic';

const mark = (student: number, exam: number, subject: number, marks: number | null, absent = false): MarkRow => ({
  section_id: 7,
  student_id: student,
  exam_id: exam,
  subject_id: subject,
  subject_name: subject === 1 ? 'Maths' : 'Science',
  marks,
  is_absent: absent,
  max_marks: 100,
  pass_marks: 35,
});

const rows = [
  mark(1, 10, 1, 90),
  mark(1, 10, 2, 80),
  mark(2, 10, 1, 30),
  mark(2, 10, 2, 70),
  mark(3, 10, 1, 60),
  mark(3, 10, 2, 0, true),
  mark(1, 11, 1, 70),
  mark(1, 11, 2, 70),
];

describe('class performance', () => {
  it('scores each student across exams and counts failed results', () => {
    const scores = scoreStudents(rows);
    expect(scores.get(1)).toMatchObject({ percent: 77.5, results: 2, failed_results: 0 });
    expect(scores.get(2)).toMatchObject({ percent: 50, results: 1, failed_results: 1 });
    expect(scores.get(3)).toMatchObject({ percent: 30, results: 1, failed_results: 1 });
  });

  it('gives average, pass and fail % and how many are below average', () => {
    expect(sectionFigures([...scoreStudents(rows).values()])).toEqual({
      assessed: 3,
      average_percent: 52.5,
      pass_percent: 50,
      fail_percent: 50,
      below_average: 2,
    });
    expect(sectionFigures([])).toEqual({
      assessed: 0,
      average_percent: null,
      pass_percent: null,
      fail_percent: null,
      below_average: 0,
    });
  });

  it('finds the subjects where a student is most behind the section', () => {
    const scores = [...scoreStudents(rows).values()];
    const subjects = subjectAverages(scores);
    expect(subjects.get(1)).toBe(62.5);
    expect(weakSubjects(scoreStudents(rows).get(2)!, subjects)).toEqual([
      { subject_id: 1, name: 'Maths', percent: 30, section_percent: 62.5 },
    ]);
  });

  it('uses the section average unless a line is given', () => {
    const scores = [...scoreStudents(rows).values()];
    expect(belowLine(scores)).toBe(52.5);
    expect(belowLine(scores, 40)).toBe(40);
  });

  it('picks below-average, average or a range of students', () => {
    expect(bandLimits('below', 60, 60, {})).toEqual({ from: 0, to: 60 });
    expect(bandLimits('average', 60, 60, {})).toEqual({ from: 50, to: 70 });
    expect(bandLimits('range', 60, 60, { from: 60, to: 35 })).toEqual({ from: 35, to: 60 });
    expect(bandLimits('average', null, null, {})).toBeNull();
    expect(inBand(59.9, { from: 0, to: 60 }, true)).toBe(true);
    expect(inBand(60, { from: 0, to: 60 }, true)).toBe(false);
    expect(inBand(70, { from: 50, to: 70 }, false)).toBe(true);
  });
});
