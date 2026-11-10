import { AppException } from '@app/common';
import { AttendanceStatus } from './entities/attendance-record.entity';

export interface BulkSectionRow {
  section_id: number;
  name: string;
  marked: boolean;
  total: number;
}

export interface BulkPlan {
  targets: BulkSectionRow[];
  skipped: { id: number; name: string; reason: string }[];
}

export function bulkPlan(sections: BulkSectionRow[], sectionIds: number[] | undefined, overwrite = false): BulkPlan {
  const byId = new Map(sections.map((row) => [row.section_id, row]));
  const ids = sectionIds?.length ? sectionIds : sections.filter((row) => !row.marked).map((row) => row.section_id);
  const plan: BulkPlan = { targets: [], skipped: [] };
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) plan.skipped.push({ id, name: `Section ${id}`, reason: 'Not a section of this academic year' });
    else if (row.total === 0) plan.skipped.push({ id, name: row.name, reason: 'No students' });
    else if (row.marked && !overwrite) plan.skipped.push({ id, name: row.name, reason: 'Already marked' });
    else plan.targets.push(row);
  }
  return plan;
}

export interface MarkLine {
  student_id: number;
  status: AttendanceStatus;
  remarks?: string | null;
}

export function mergeMarks(current: MarkLine[], changes: MarkLine[]): MarkLine[] {
  const ids = changes.map((item) => item.student_id);
  if (new Set(ids).size !== ids.length) {
    throw AppException.badRequest('A student appears twice in the list', 'DUPLICATE_STUDENT');
  }
  const known = new Set(current.map((item) => item.student_id));
  const stranger = ids.find((id) => !known.has(id));
  if (stranger) throw AppException.badRequest(`Student ${stranger} is not in this section`, 'STUDENT_NOT_IN_SECTION');
  const byId = new Map(changes.map((item) => [item.student_id, item]));
  return current.map((item) => {
    const change = byId.get(item.student_id);
    return {
      student_id: item.student_id,
      status: change?.status ?? item.status,
      remarks: change ? (change.remarks ?? null) : (item.remarks ?? null),
    };
  });
}
