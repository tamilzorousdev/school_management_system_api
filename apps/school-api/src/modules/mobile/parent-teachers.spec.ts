import { classLabel, experienceYears, periodStates, splitClassTeacher } from './parent-teachers.logic';

describe('parent view of teachers', () => {
  it('adds the years at this school to the experience before joining', () => {
    expect(experienceYears('2023-06-01', 5, '2026-11-11')).toBe(8);
    expect(experienceYears('2023-12-01', 5, '2026-11-11')).toBe(7);
    expect(experienceYears('2026-06-01', 0, '2026-11-11')).toBe(0);
    expect(experienceYears(null, 4, '2026-11-11')).toBe(4);
  });

  it('marks which periods are done, now and next today', () => {
    const periods = [
      { start_time: '08:50', end_time: '09:35' },
      { start_time: '09:35', end_time: '10:20' },
      { start_time: '10:35', end_time: '11:20' },
      { start_time: '11:20', end_time: '12:05' },
    ];
    expect(periodStates(periods, true, '09:40')).toEqual(['done', 'now', 'next', 'later']);
    expect(periodStates(periods, true, '10:25')).toEqual(['done', 'done', 'next', 'later']);
    expect(periodStates(periods, true, '07:00')).toEqual(['next', 'later', 'later', 'later']);
    expect(periodStates(periods, false, '09:40')).toEqual(['later', 'later', 'later', 'later']);
  });

  it('names a class like the rest of the app', () => {
    expect(classLabel('6', 'A')).toBe('6 - A');
  });

  it('shows the class teacher on its own and the rest as subject teachers', () => {
    const list = [
      { id: 1, name: 'Priya', is_class_teacher: true },
      { id: 3, name: 'Senthil', is_class_teacher: false },
      { id: 2, name: 'Arun', is_class_teacher: false },
    ];
    expect(splitClassTeacher(list)).toEqual({
      class_teacher: list[0],
      subject_teachers: [list[2], list[1]],
    });
    expect(splitClassTeacher([list[1]]).class_teacher).toBeNull();
  });
});
