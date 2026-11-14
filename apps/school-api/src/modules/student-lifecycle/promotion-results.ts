export interface MarkRow {
  student_id: number;
  group_id: number;
  marks: number | null;
  is_absent: boolean;
  max_marks: number;
  pass_marks: number;
}

export interface StudentResult {
  percent: number;
  passed: boolean;
}

export interface GroupResult {
  assessed: number;
  passed: number;
  pass_percent: number | null;
  average_percent: number | null;
}

const oneDecimal = (value: number) => Math.round(value * 10) / 10;

export function studentResults(rows: MarkRow[]): Map<number, StudentResult & { group_id: number }> {
  const totals = new Map<number, { got: number; max: number; failed: boolean; group_id: number }>();
  for (const row of rows) {
    const got = row.is_absent ? 0 : Number(row.marks ?? 0);
    const entry = totals.get(row.student_id) ?? { got: 0, max: 0, failed: false, group_id: row.group_id };
    entry.got += got;
    entry.max += Number(row.max_marks);
    entry.failed = entry.failed || row.is_absent || got < Number(row.pass_marks);
    totals.set(row.student_id, entry);
  }
  return new Map(
    [...totals].map(([studentId, entry]) => [
      studentId,
      {
        group_id: entry.group_id,
        percent: entry.max > 0 ? oneDecimal((entry.got / entry.max) * 100) : 0,
        passed: !entry.failed,
      },
    ]),
  );
}

export function groupResults(results: Map<number, StudentResult & { group_id: number }>): Map<number, GroupResult> {
  const groups = new Map<number, { assessed: number; passed: number; total: number }>();
  for (const result of results.values()) {
    const group = groups.get(result.group_id) ?? { assessed: 0, passed: 0, total: 0 };
    group.assessed += 1;
    group.passed += result.passed ? 1 : 0;
    group.total += result.percent;
    groups.set(result.group_id, group);
  }
  return new Map(
    [...groups].map(([id, group]) => [
      id,
      {
        assessed: group.assessed,
        passed: group.passed,
        pass_percent: group.assessed ? oneDecimal((group.passed / group.assessed) * 100) : null,
        average_percent: group.assessed ? oneDecimal(group.total / group.assessed) : null,
      },
    ]),
  );
}
