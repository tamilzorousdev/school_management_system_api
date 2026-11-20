export interface ScaleStep {
  grade: string;
  min: number;
  max?: number;
  description?: string;
  grade_point?: number;
}

export const CBSE_SCALE: ScaleStep[] = [
  { grade: 'A1', min: 91, max: 100, description: 'Outstanding', grade_point: 10.0 },
  { grade: 'A2', min: 81, max: 90, description: 'Excellent', grade_point: 9.0 },
  { grade: 'B1', min: 71, max: 80, description: 'Very Good', grade_point: 8.0 },
  { grade: 'B2', min: 61, max: 70, description: 'Good', grade_point: 7.0 },
  { grade: 'C1', min: 51, max: 60, description: 'Above Average', grade_point: 6.0 },
  { grade: 'C2', min: 41, max: 50, description: 'Average', grade_point: 5.0 },
  { grade: 'D', min: 33, max: 40, description: 'Pass', grade_point: 4.0 },
  { grade: 'E', min: 0, max: 32, description: 'Needs Improvement / Fail', grade_point: 0.0 },
];

export const STATE_SCALE: ScaleStep[] = [
  { grade: 'A+', min: 80, max: 100, description: 'Distinction', grade_point: 10.0 },
  { grade: 'A', min: 60, max: 79, description: 'First Class', grade_point: 8.0 },
  { grade: 'B', min: 50, max: 59, description: 'Second Class', grade_point: 6.0 },
  { grade: 'C', min: 35, max: 49, description: 'Third Class / Pass', grade_point: 4.0 },
  { grade: 'Fail', min: 0, max: 34, description: 'Needs Improvement / Fail', grade_point: 0.0 },
];

export const ICSE_SCALE: ScaleStep[] = [
  { grade: '1', min: 90, max: 100, description: 'Outstanding', grade_point: 10.0 },
  { grade: '2', min: 80, max: 89, description: 'Very Good', grade_point: 9.0 },
  { grade: '3', min: 70, max: 79, description: 'Good', grade_point: 8.0 },
  { grade: '4', min: 60, max: 69, description: 'Satisfactory', grade_point: 7.0 },
  { grade: '5', min: 50, max: 59, description: 'Fair', grade_point: 6.0 },
  { grade: '6', min: 40, max: 49, description: 'Pass', grade_point: 5.0 },
  { grade: '7', min: 33, max: 39, description: 'Borderline Pass', grade_point: 4.0 },
  { grade: '8', min: 0, max: 32, description: 'Fail', grade_point: 0.0 },
];

export const GRADE_SCALE = CBSE_SCALE;

export type ResultStatus = 'pass' | 'fail' | 'incomplete';

export interface SubjectScore {
  subject_id: number;
  max_marks: number;
  pass_marks: number;
  marks: number | null;
  is_absent: boolean;
  entered: boolean;
}

export interface StudentScore {
  total: number;
  max_total: number;
  percent: number | null;
  grade: string | null;
  result: ResultStatus;
}

export interface MarkInput {
  student_id: number;
  marks: number | null;
  is_absent: boolean;
}

export interface MarkError {
  index: number;
  message: string;
}

export function percentOf(total: number, maxTotal: number): number {
  if (maxTotal <= 0) return 0;
  return Math.round((total / maxTotal) * 1000) / 10;
}

export function gradeFor(percent: number, scale?: ScaleStep[]): string {
  const active = scale && scale.length ? scale : GRADE_SCALE;
  return (active.find((step) => percent >= step.min) ?? active[active.length - 1]).grade;
}

export function subjectPassed(score: SubjectScore): boolean | null {
  if (!score.entered) return null;
  if (score.is_absent || score.marks === null) return false;
  return score.marks >= score.pass_marks;
}

export function scoreStudent(scores: SubjectScore[], scale?: ScaleStep[]): StudentScore {
  const total = round2(scores.reduce((sum, score) => sum + (score.is_absent ? 0 : (score.marks ?? 0)), 0));
  const maxTotal = scores.reduce((sum, score) => sum + score.max_marks, 0);
  const complete = scores.length > 0 && scores.every((score) => score.entered);
  if (!complete) return { total, max_total: maxTotal, percent: null, grade: null, result: 'incomplete' };
  const percent = percentOf(total, maxTotal);
  const failed = scores.some((score) => subjectPassed(score) === false);
  return { total, max_total: maxTotal, percent, grade: gradeFor(percent, scale), result: failed ? 'fail' : 'pass' };
}

export function competitionRanks(scores: (number | null)[]): (number | null)[] {
  const ranked = scores.filter((score): score is number => score !== null).sort((a, b) => b - a);
  return scores.map((score) => (score === null ? null : ranked.findIndex((value) => value === score) + 1));
}

export function calculatePercentile(score: number | null, allScores: (number | null)[]): number | null {
  if (score === null) return null;
  const valid = allScores.filter((s): s is number => s !== null);
  if (!valid.length) return null;
  const strictlyLower = valid.filter((s) => s < score).length;
  return Math.round((strictlyLower / valid.length) * 1000) / 10;
}

export function calculatePercentiles(scores: (number | null)[]): (number | null)[] {
  const valid = scores.filter((s): s is number => s !== null);
  const total = valid.length;
  if (total === 0) return scores.map(() => null);
  return scores.map((score) => {
    if (score === null) return null;
    const lowerCount = valid.filter((s) => s < score).length;
    return Math.round((lowerCount / total) * 1000) / 10;
  });
}

export function validateMarks(items: MarkInput[], maxMarks: number, names: Map<number, string>): MarkError[] {
  const errors: MarkError[] = [];
  items.forEach((item, index) => {
    if (item.is_absent || item.marks === null) return;
    if (item.marks < 0 || item.marks > maxMarks) {
      const name = names.get(item.student_id) ?? `Student ${item.student_id}`;
      errors.push({ index, message: `Marks for ${name} must be between 0 and ${maxMarks}` });
    }
  });
  return errors;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
