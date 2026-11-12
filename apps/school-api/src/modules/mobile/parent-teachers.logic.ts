export function experienceYears(joiningDate: string | null, priorYears: number, today: string): number {
  const prior = Number(priorYears) || 0;
  if (!joiningDate) return prior;
  const [joinYear, joinMonth, joinDay] = joiningDate.slice(0, 10).split('-').map(Number);
  const [year, month, day] = today.slice(0, 10).split('-').map(Number);
  let here = year - joinYear;
  if (month < joinMonth || (month === joinMonth && day < joinDay)) here -= 1;
  return prior + Math.max(0, here);
}

export type PeriodState = 'done' | 'now' | 'next' | 'later';

export function periodStates(
  periods: { start_time: string; end_time: string }[],
  isToday: boolean,
  now: string,
): PeriodState[] {
  if (!isToday) return periods.map(() => 'later');
  let nextGiven = false;
  return periods.map((period) => {
    if (now >= period.end_time) return 'done';
    if (now >= period.start_time) return 'now';
    if (!nextGiven) {
      nextGiven = true;
      return 'next';
    }
    return 'later';
  });
}

export function classLabel(className: string, sectionName: string): string {
  return `${className} - ${sectionName}`;
}

export function splitClassTeacher<T extends { is_class_teacher: boolean; name: string }>(
  teachers: T[],
): { class_teacher: T | null; subject_teachers: T[] } {
  return {
    class_teacher: teachers.find((teacher) => teacher.is_class_teacher) ?? null,
    subject_teachers: teachers
      .filter((teacher) => !teacher.is_class_teacher)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
