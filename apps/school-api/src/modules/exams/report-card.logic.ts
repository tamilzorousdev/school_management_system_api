import { GRADE_SCALE, gradeFor, percentOf, ResultStatus } from './exam-results';

export interface CardSubjectScore {
  subject_id: number;
  name: string;
  code: string;
  max_marks: number;
  pass_marks: number;
  marks: number | null;
  is_absent: boolean;
  passed: boolean | null;
  type?: string;
}

export interface CardExamInput {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  term_id: number | null;
  term_name: string | null;
  term_order: number;
  total: number;
  max_total: number;
  percent: number | null;
  grade: string | null;
  result: ResultStatus;
  section_rank: number | null;
  section_size: number;
  class_rank: number | null;
  class_size: number;
  percentile?: number | null;
  subjects: CardSubjectScore[];
}

export interface CardCell {
  exam_id: number;
  marks: number | null;
  max_marks: number;
  pass_marks: number;
  is_absent: boolean;
  passed: boolean | null;
}

export interface CardSubjectRow {
  subject_id: number;
  name: string;
  code: string;
  cells: (CardCell | null)[];
  total: number;
  max_total: number;
  percent: number | null;
  grade: string | null;
  passed: boolean | null;
}

export interface CardColumn {
  exam_id: number;
  name: string;
  start_date: string;
  end_date: string;
  common_max: number | null;
  total: number;
  max_total: number;
  percent: number | null;
  grade: string | null;
  result: ResultStatus;
  section_rank: number | null;
  section_size: number;
  class_rank: number | null;
  class_size: number;
}

export interface CardTermGroup {
  term_id: number | null;
  name: string;
  exam_ids: number[];
}

export interface CardOverall {
  total: number;
  max_total: number;
  percent: number | null;
  grade: string | null;
  result: ResultStatus;
  percentile?: number | null;
}

export interface ReportCardBody {
  terms: CardTermGroup[];
  columns: CardColumn[];
  subjects: CardSubjectRow[];
  overall: CardOverall;
  remarks: string;
}

export interface AttendanceCount {
  status: string;
  days: number;
}

export interface AttendanceSummary {
  working_days: number;
  present_days: number;
  percent: number | null;
}

export const OTHER_TERM = 'Other exams';

const TYPE_ORDER = ['language', 'theory', 'practical', 'activity'];

const typeRank = (type: string | undefined) => {
  const index = TYPE_ORDER.indexOf(type ?? '');
  return index === -1 ? TYPE_ORDER.length : index;
};

export function orderExams(exams: CardExamInput[]): CardExamInput[] {
  return [...exams].sort(
    (a, b) =>
      Number(a.term_id === null) - Number(b.term_id === null) ||
      a.term_order - b.term_order ||
      a.start_date.localeCompare(b.start_date) ||
      a.id - b.id,
  );
}

export function termGroups(exams: CardExamInput[]): CardTermGroup[] {
  const groups: CardTermGroup[] = [];
  for (const exam of exams) {
    const last = groups[groups.length - 1];
    if (last && last.term_id === exam.term_id) {
      last.exam_ids.push(exam.id);
      continue;
    }
    groups.push({ term_id: exam.term_id, name: exam.term_name ?? OTHER_TERM, exam_ids: [exam.id] });
  }
  return groups;
}

export function commonMax(exam: CardExamInput): number | null {
  const values = new Set(exam.subjects.map((subject) => subject.max_marks));
  return values.size === 1 ? [...values][0]! : null;
}

export function subjectRows(exams: CardExamInput[]): CardSubjectRow[] {
  const known = new Map<number, { name: string; code: string; type?: string }>();
  for (const exam of exams) {
    for (const subject of exam.subjects) {
      if (!known.has(subject.subject_id)) {
        known.set(subject.subject_id, { name: subject.name, code: subject.code, type: subject.type });
      }
    }
  }
  return [...known.entries()]
    .sort(([, a], [, b]) => typeRank(a.type) - typeRank(b.type) || a.name.localeCompare(b.name))
    .map(([subjectId, info]) => {
      const cells = exams.map((exam): CardCell | null => {
        const score = exam.subjects.find((subject) => subject.subject_id === subjectId);
        if (!score) return null;
        return {
          exam_id: exam.id,
          marks: score.marks,
          max_marks: score.max_marks,
          pass_marks: score.pass_marks,
          is_absent: score.is_absent,
          passed: score.passed,
        };
      });
      const entered = cells.filter((cell): cell is CardCell => cell !== null && cell.passed !== null);
      const total = round2(entered.reduce((sum, cell) => sum + (cell.is_absent ? 0 : (cell.marks ?? 0)), 0));
      const maxTotal = entered.reduce((sum, cell) => sum + cell.max_marks, 0);
      const passTotal = entered.reduce((sum, cell) => sum + cell.pass_marks, 0);
      const percent = maxTotal > 0 ? percentOf(total, maxTotal) : null;
      return {
        subject_id: subjectId,
        name: info.name,
        code: info.code,
        cells,
        total,
        max_total: maxTotal,
        percent,
        grade: percent === null ? null : gradeFor(percent),
        passed: maxTotal > 0 ? total >= passTotal : null,
      };
    });
}

export function overallOf(exams: CardExamInput[], subjects: CardSubjectRow[]): CardOverall {
  const complete = exams.filter((exam) => exam.result !== 'incomplete');
  if (!complete.length) {
    return { total: 0, max_total: 0, percent: null, grade: null, result: 'incomplete' };
  }
  const total = round2(complete.reduce((sum, exam) => sum + exam.total, 0));
  const maxTotal = complete.reduce((sum, exam) => sum + exam.max_total, 0);
  const percent = percentOf(total, maxTotal);
  const result: ResultStatus = subjects.some((subject) => subject.passed === false) ? 'fail' : 'pass';
  const percentiles = complete.map((e) => e.percentile).filter((p): p is number => p !== undefined && p !== null);
  const percentile = percentiles.length
    ? Math.round((percentiles.reduce((a, b) => a + b, 0) / percentiles.length) * 10) / 10
    : undefined;
  return {
    total,
    max_total: maxTotal,
    percent,
    grade: gradeFor(percent),
    result,
    ...(percentile !== undefined ? { percentile } : {}),
  };
}

export function remarkFor(overall: CardOverall): string {
  if (overall.percent === null) return 'Results will appear here once marks are published.';
  if (overall.result === 'fail') return 'Needs to work harder in the subjects marked below the pass mark.';
  if (overall.percent >= 91) return 'Outstanding performance. Keep it up!';
  if (overall.percent >= 81) return 'Excellent work, consistent across subjects.';
  if (overall.percent >= 71) return 'Very good progress. Aim higher next term.';
  if (overall.percent >= 61) return 'Good effort. Regular practice will improve the scores.';
  if (overall.percent >= 41) return 'Fair performance. Needs more focus and regular revision.';
  return 'Needs steady support and practice to improve.';
}

export function buildReportCard(exams: CardExamInput[]): ReportCardBody {
  const ordered = orderExams(exams);
  const subjects = subjectRows(ordered);
  const overall = overallOf(ordered, subjects);
  return {
    terms: termGroups(ordered),
    columns: ordered.map((exam) => ({
      exam_id: exam.id,
      name: exam.name,
      start_date: exam.start_date,
      end_date: exam.end_date,
      common_max: commonMax(exam),
      total: exam.total,
      max_total: exam.max_total,
      percent: exam.percent,
      grade: exam.grade,
      result: exam.result,
      section_rank: exam.section_rank,
      section_size: exam.section_size,
      class_rank: exam.class_rank,
      class_size: exam.class_size,
      percentile: exam.percentile ?? null,
    })),
    subjects,
    overall,
    remarks: remarkFor(overall),
  };
}

const PRESENT_WEIGHT: Record<string, number> = { present: 1, late: 1, half_day: 0.5 };

export function attendanceSummary(counts: AttendanceCount[]): AttendanceSummary {
  const workingDays = counts.reduce((sum, row) => sum + row.days, 0);
  const presentDays = counts.reduce((sum, row) => sum + row.days * (PRESENT_WEIGHT[row.status] ?? 0), 0);
  return {
    working_days: workingDays,
    present_days: presentDays,
    percent: workingDays ? percentOf(presentDays, workingDays) : null,
  };
}

export function gradeScale(): { grade: string; min: number; max: number }[] {
  return GRADE_SCALE.map((step, index) => ({
    grade: step.grade,
    min: step.min,
    max: index === 0 ? 100 : GRADE_SCALE[index - 1]!.min - 1,
  }));
}

export function cellText(cell: CardCell | null): string {
  if (!cell) return '—';
  if (cell.passed === null) return '·';
  if (cell.is_absent) return 'AB';
  return formatMarks(cell.marks ?? 0);
}

export function formatMarks(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
