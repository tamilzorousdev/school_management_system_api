import { AppException } from '@app/common';
import { addDays } from '../../shared/school-days';

export function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}

export interface CellState {
  section_id: number;
  subject_id: number;
  teacher_user_id: number | null;
  periods_per_week: number | null;
}

export interface CellChange {
  section_id: number;
  subject_id: number;
  from_teacher_user_id: number | null;
  from_periods: number | null;
  week_start: string;
  id: number;
}

export function cellsAsOf(current: CellState[], changes: CellChange[], week: string): Map<string, CellState> {
  const key = (sectionId: number, subjectId: number) => `${sectionId}:${subjectId}`;
  const cells = new Map(current.map((cell) => [key(cell.section_id, cell.subject_id), { ...cell }]));
  const later = changes.filter((change) => change.week_start > week).sort((a, b) => b.id - a.id);
  for (const change of later) {
    const id = key(change.section_id, change.subject_id);
    if (change.from_teacher_user_id === null) {
      cells.delete(id);
    } else {
      cells.set(id, {
        section_id: change.section_id,
        subject_id: change.subject_id,
        teacher_user_id: change.from_teacher_user_id,
        periods_per_week: change.from_periods,
      });
    }
  }
  return cells;
}

export function assertClassWithinLimit(
  before: Map<number, number>,
  after: Map<number, number>,
  names: Map<number, string>,
  limit: number,
): void {
  for (const [sectionId, total] of after) {
    if (total > limit && total > (before.get(sectionId) ?? 0)) {
      throw AppException.conflict(
        `${names.get(sectionId) ?? 'This class'} would have ${total} periods a week, but a class can have at most ${limit}. Lower the periods a week of a subject or remove one.`,
        'CLASS_OVER_LIMIT',
      );
    }
  }
}
