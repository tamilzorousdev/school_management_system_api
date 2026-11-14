export const STAR_LABELS: Record<number, string> = {
  5: 'Excellent',
  4: 'Very good',
  3: 'Good',
  2: 'Average',
  1: 'Needs improvement',
};

export const starLabel = (stars: number | null): string | null =>
  stars === null ? null : (STAR_LABELS[stars] ?? null);

const round1 = (value: number) => Math.round(value * 10) / 10;

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

const addMonths = (iso: string, months: number) => {
  const date = new Date(`${iso}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return isoDate(date);
};

const dayBefore = (iso: string) => isoDate(new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000));

export function ratingCycle(
  yearStart: string,
  yearEnd: string,
  today: string,
  months: number,
): { start: string; end: string } | null {
  if (today < yearStart || today > yearEnd) return null;
  let start = yearStart;
  while (addMonths(start, months) <= today) start = addMonths(start, months);
  const next = dayBefore(addMonths(start, months));
  return { start, end: next < yearEnd ? next : yearEnd };
}

export interface RatingRow {
  teacher_user_id: number;
  stars: number;
  behaviour: 'good' | 'bad';
}

export interface RatingSummary {
  ratings: number;
  average_stars: number | null;
  good: number;
  bad: number;
  good_percent: number | null;
}

export function summariseRatings(rows: RatingRow[]): RatingSummary {
  const good = rows.filter((row) => row.behaviour === 'good').length;
  return {
    ratings: rows.length,
    average_stars: rows.length ? round1(rows.reduce((sum, row) => sum + Number(row.stars), 0) / rows.length) : null,
    good,
    bad: rows.length - good,
    good_percent: rows.length ? round1((good / rows.length) * 100) : null,
  };
}

export function rankTeachers<T extends { teacher_user_id: number; name: string }>(
  teachers: T[],
  rows: RatingRow[],
): (T & RatingSummary & { rank: number | null })[] {
  const summaries = teachers.map((teacher) => ({
    ...teacher,
    ...summariseRatings(rows.filter((row) => Number(row.teacher_user_id) === Number(teacher.teacher_user_id))),
  }));
  const ranked = summaries
    .filter((item) => item.ratings > 0)
    .sort(
      (a, b) =>
        b.average_stars! - a.average_stars! ||
        b.good_percent! - a.good_percent! ||
        b.ratings - a.ratings ||
        a.name.localeCompare(b.name),
    );
  const unrated = summaries.filter((item) => item.ratings === 0).sort((a, b) => a.name.localeCompare(b.name));
  return [
    ...ranked.map((item, index) => ({ ...item, rank: index + 1 })),
    ...unrated.map((item) => ({ ...item, rank: null })),
  ];
}

export interface PaperRow {
  section_id: number;
  subject_id: number;
  student_id: number;
  marks: number | null;
  is_absent: boolean;
  max_marks: number;
  pass_marks: number;
}

export interface SubjectResult {
  section_id: number;
  subject_id: number;
  students: number;
  papers: number;
  passed: number;
  pass_percent: number | null;
  fail_percent: number | null;
  average_percent: number | null;
}

export function subjectResults(rows: PaperRow[]): Map<string, SubjectResult> {
  const groups = new Map<string, { students: Set<number>; papers: number; passed: number; percent: number }>();
  for (const row of rows) {
    const key = `${row.section_id}:${row.subject_id}`;
    const group = groups.get(key) ?? { students: new Set<number>(), papers: 0, passed: 0, percent: 0 };
    const got = row.is_absent ? 0 : Number(row.marks ?? 0);
    group.students.add(Number(row.student_id));
    group.papers += 1;
    group.passed += !row.is_absent && got >= Number(row.pass_marks) ? 1 : 0;
    group.percent += Number(row.max_marks) > 0 ? (got / Number(row.max_marks)) * 100 : 0;
    groups.set(key, group);
  }
  return new Map(
    [...groups].map(([key, group]) => {
      const [sectionId, subjectId] = key.split(':').map(Number);
      const pass = group.papers ? round1((group.passed / group.papers) * 100) : null;
      return [
        key,
        {
          section_id: sectionId!,
          subject_id: subjectId!,
          students: group.students.size,
          papers: group.papers,
          passed: group.passed,
          pass_percent: pass,
          fail_percent: pass === null ? null : round1(100 - pass),
          average_percent: group.papers ? round1(group.percent / group.papers) : null,
        },
      ];
    }),
  );
}
