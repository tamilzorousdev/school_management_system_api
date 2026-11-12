export interface MarkRow {
  section_id: number;
  student_id: number;
  exam_id: number;
  subject_id: number;
  subject_name: string;
  marks: number | null;
  is_absent: boolean;
  max_marks: number;
  pass_marks: number;
}

export interface StudentScore {
  student_id: number;
  section_id: number;
  percent: number;
  results: number;
  failed_results: number;
  subjects: Map<number, { name: string; got: number; max: number }>;
}

export const round1 = (value: number) => Math.round(value * 10) / 10;

export const average = (values: number[]): number | null =>
  values.length ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : null;

export const shareOf = (part: number, whole: number): number | null =>
  whole > 0 ? round1((part / whole) * 100) : null;

export function scoreStudents(rows: MarkRow[]): Map<number, StudentScore> {
  const exams = new Map<string, { section_id: number; got: number; max: number; failed: boolean }>();
  const subjects = new Map<number, Map<number, { name: string; got: number; max: number }>>();
  for (const row of rows) {
    const got = row.is_absent ? 0 : Number(row.marks ?? 0);
    const key = `${row.student_id}:${row.exam_id}`;
    const exam = exams.get(key) ?? { section_id: Number(row.section_id), got: 0, max: 0, failed: false };
    exam.got += got;
    exam.max += Number(row.max_marks);
    exam.failed = exam.failed || row.is_absent || got < Number(row.pass_marks);
    exams.set(key, exam);
    const own = subjects.get(Number(row.student_id)) ?? new Map();
    const subject = own.get(Number(row.subject_id)) ?? { name: row.subject_name, got: 0, max: 0 };
    subject.got += got;
    subject.max += Number(row.max_marks);
    own.set(Number(row.subject_id), subject);
    subjects.set(Number(row.student_id), own);
  }
  const byStudent = new Map<number, { section_id: number; percents: number[]; failed: number }>();
  for (const [key, exam] of exams) {
    const studentId = Number(key.split(':')[0]);
    const entry = byStudent.get(studentId) ?? { section_id: exam.section_id, percents: [], failed: 0 };
    entry.percents.push(exam.max > 0 ? (exam.got / exam.max) * 100 : 0);
    if (exam.failed) entry.failed += 1;
    byStudent.set(studentId, entry);
  }
  return new Map(
    [...byStudent].map(([studentId, entry]) => [
      studentId,
      {
        student_id: studentId,
        section_id: entry.section_id,
        percent: average(entry.percents) ?? 0,
        results: entry.percents.length,
        failed_results: entry.failed,
        subjects: subjects.get(studentId) ?? new Map(),
      },
    ]),
  );
}

export function sectionFigures(scores: StudentScore[]) {
  const results = scores.reduce((sum, score) => sum + score.results, 0);
  const failed = scores.reduce((sum, score) => sum + score.failed_results, 0);
  const sectionAverage = average(scores.map((score) => score.percent));
  return {
    assessed: scores.length,
    average_percent: sectionAverage,
    pass_percent: shareOf(results - failed, results),
    fail_percent: shareOf(failed, results),
    below_average: sectionAverage === null ? 0 : scores.filter((score) => score.percent < sectionAverage).length,
  };
}

export function subjectAverages(scores: StudentScore[]): Map<number, number> {
  const totals = new Map<number, { got: number; max: number }>();
  for (const score of scores) {
    for (const [subjectId, subject] of score.subjects) {
      const total = totals.get(subjectId) ?? { got: 0, max: 0 };
      total.got += subject.got;
      total.max += subject.max;
      totals.set(subjectId, total);
    }
  }
  return new Map([...totals].map(([id, total]) => [id, total.max > 0 ? round1((total.got / total.max) * 100) : 0]));
}

export function weakSubjects(score: StudentScore, sectionSubjects: Map<number, number>, limit = 3) {
  return [...score.subjects]
    .map(([subjectId, subject]) => ({
      subject_id: subjectId,
      name: subject.name,
      percent: subject.max > 0 ? round1((subject.got / subject.max) * 100) : 0,
      section_percent: sectionSubjects.get(subjectId) ?? 0,
    }))
    .filter((subject) => subject.percent < subject.section_percent)
    .sort((a, b) => a.percent - a.section_percent - (b.percent - b.section_percent))
    .slice(0, limit);
}

export function belowLine(scores: StudentScore[], threshold?: number): number | null {
  if (threshold !== undefined) return threshold;
  return average(scores.map((score) => score.percent));
}
