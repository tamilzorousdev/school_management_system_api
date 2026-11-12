import {
  assertAssignedWithinLimit,
  assertCanScheduleOneMore,
  assertLimitCoversLoad,
  TeacherLoad,
} from './teacher-load';

const load = (assigned: number, scheduled: number, max = 30): TeacherLoad => ({
  user_id: 7,
  name: 'Joseph Antony',
  max_periods_per_week: max,
  assigned,
  scheduled,
});

const loads = (value: TeacherLoad) => new Map([[value.user_id, value]]);

describe('teacher weekly limit', () => {
  it('refuses assignments that take a teacher above the weekly limit', () => {
    expect(() => assertAssignedWithinLimit(loads(load(24, 0)), loads(load(36, 0)))).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'TEACHER_OVER_LIMIT' }) }),
    );
  });

  it('allows assignments within the limit or that bring an old overload down', () => {
    expect(() => assertAssignedWithinLimit(loads(load(24, 0)), loads(load(30, 0)))).not.toThrow();
    expect(() => assertAssignedWithinLimit(loads(load(36, 0)), loads(load(33, 0)))).not.toThrow();
  });

  it('refuses one more timetable period once the week is full', () => {
    expect(() => assertCanScheduleOneMore(load(30, 30))).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'TEACHER_OVER_LIMIT' }) }),
    );
    expect(() => assertCanScheduleOneMore(load(30, 29))).not.toThrow();
    expect(() => assertCanScheduleOneMore(undefined)).not.toThrow();
  });

  it('keeps the limit at or above what the teacher already has', () => {
    expect(() => assertLimitCoversLoad(load(28, 26), 27)).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'LIMIT_BELOW_LOAD' }) }),
    );
    expect(() => assertLimitCoversLoad(load(28, 26), 28)).not.toThrow();
  });
});
