import { AppException } from '@app/common';
import { bulkPlan, mergeMarks } from './bulk-attendance.logic';

const sections = [
  { section_id: 1, name: '6 - A', marked: false, total: 30 },
  { section_id: 2, name: '6 - B', marked: true, total: 28 },
  { section_id: 3, name: '7 - A', marked: false, total: 0 },
  { section_id: 4, name: '7 - B', marked: false, total: 25 },
];

describe('bulk section attendance plan', () => {
  it('takes every section not marked yet when none are chosen', () => {
    const plan = bulkPlan(sections, undefined);
    expect(plan.targets.map((row) => row.section_id)).toEqual([1, 4]);
    expect(plan.skipped).toEqual([{ id: 3, name: '7 - A', reason: 'No students' }]);
  });

  it('skips marked sections unless asked to replace them', () => {
    expect(bulkPlan(sections, [1, 2]).skipped).toEqual([{ id: 2, name: '6 - B', reason: 'Already marked' }]);
    expect(bulkPlan(sections, [1, 2], true).targets.map((row) => row.section_id)).toEqual([1, 2]);
  });

  it('reports an unknown section', () => {
    expect(bulkPlan(sections, [99]).skipped[0]).toMatchObject({
      id: 99,
      reason: 'Not a section of this academic year',
    });
  });

  it('has nothing to do when every section is marked', () => {
    expect(bulkPlan([{ section_id: 2, name: '6 - B', marked: true, total: 28 }], undefined)).toEqual({
      targets: [],
      skipped: [],
    });
  });
});

describe('mark only some students', () => {
  const roster = [
    { student_id: 1, status: 'present' as const, remarks: null },
    { student_id: 2, status: 'leave' as const, remarks: 'Approved leave' },
    { student_id: 3, status: 'present' as const, remarks: null },
  ];
  const codeOf = (fn: () => unknown) => {
    try {
      fn();
      return null;
    } catch (error) {
      return ((error as AppException).getResponse() as { code: string }).code;
    }
  };

  it('changes only the students sent and keeps everyone else', () => {
    expect(
      mergeMarks(roster, [
        { student_id: 1, status: 'absent' },
        { student_id: 3, status: 'late', remarks: 'Came at 9:20' },
      ]),
    ).toEqual([
      { student_id: 1, status: 'absent', remarks: null },
      { student_id: 2, status: 'leave', remarks: 'Approved leave' },
      { student_id: 3, status: 'late', remarks: 'Came at 9:20' },
    ]);
  });

  it('refuses a student from another section or the same student twice', () => {
    expect(codeOf(() => mergeMarks(roster, [{ student_id: 99, status: 'absent' }]))).toBe('STUDENT_NOT_IN_SECTION');
    expect(
      codeOf(() =>
        mergeMarks(roster, [
          { student_id: 1, status: 'absent' },
          { student_id: 1, status: 'present' },
        ]),
      ),
    ).toBe('DUPLICATE_STUDENT');
  });
});
