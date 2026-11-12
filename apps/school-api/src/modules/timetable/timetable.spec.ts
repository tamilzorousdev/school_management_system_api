import { DataSource, Repository } from 'typeorm';
import { AppException } from '@app/common';
import { Section } from '../setup/entities/section.entity';
import { Subject } from '../setup/entities/subject.entity';
import { Staff } from '../staff/entities/staff.entity';
import { TeacherAssignment } from '../staff/entities/teacher-assignment.entity';
import { BellPeriod } from './entities/bell-period.entity';
import { TimetableSlot } from './entities/timetable-slot.entity';
import { DEFAULT_BELL, TimetableService, validateBell } from './timetable.service';

const codeOf = (error: AppException) => (error.getResponse() as { code: string }).code;

describe('validateBell', () => {
  it('accepts the default schedule', () => {
    expect(
      validateBell(DEFAULT_BELL.map(([name, start_time, end_time]) => ({ name, start_time, end_time }))),
    ).toBeNull();
  });

  it('rejects a period that ends before it starts', () => {
    expect(validateBell([{ name: 'Period 1', start_time: '09:30', end_time: '09:00' }])).toBe(
      'Period 1 must end after it starts',
    );
  });

  it('rejects overlapping periods', () => {
    expect(
      validateBell([
        { name: 'Period 1', start_time: '09:00', end_time: '09:45' },
        { name: 'Period 2', start_time: '09:40', end_time: '10:20' },
      ]),
    ).toBe('Period 2 starts before Period 1 ends');
  });
});

describe('TimetableService.setSlot', () => {
  let teaching = 0;
  const periods = DEFAULT_BELL.map(([name, start_time, end_time, is_break], index) => ({
    id: index + 1,
    name,
    start_time,
    end_time,
    is_break,
    period_no: is_break ? null : (teaching += 1),
    sort_order: index + 1,
  }));
  const slot = { day_of_week: 1, period_no: 2, subject_id: 4 };

  function build(clash: { teacher?: boolean; room?: boolean; full?: boolean }) {
    const section = { id: 5, class_id: 1, academic_year_id: 2, name: 'A', room: 'R-6A', school_class: { name: '6' } };
    const repositories = new Map<unknown, unknown>([
      [Section, { findOne: jest.fn().mockResolvedValue(section) }],
      [Subject, { findOneBy: jest.fn().mockResolvedValue({ id: 4 }) }],
      [TeacherAssignment, { findOneBy: jest.fn().mockResolvedValue({ teacher_user_id: 9 }) }],
      [Staff, { findOneBy: jest.fn().mockResolvedValue({ staff_type: 'teaching', status: 'active' }) }],
    ]);
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('t.teacher_user_id = $4')) {
        return Promise.resolve(clash.teacher ? [{ class_name: '7', section_name: 'B', teacher: 'Kavitha' }] : []);
      }
      if (sql.includes('AS scheduled')) {
        return Promise.resolve(
          clash.full
            ? [{ user_id: 9, name: 'Joseph Antony', max_periods_per_week: 30, assigned: '30', scheduled: '30' }]
            : [],
        );
      }
      if (sql.includes('LOWER(t.room)')) {
        return Promise.resolve(clash.room ? [{ class_name: '8', section_name: 'A' }] : []);
      }
      return Promise.resolve([]);
    });
    const dataSource = { getRepository: (entity: unknown) => repositories.get(entity), query } as unknown as DataSource;
    const bells = {
      existsBy: jest.fn().mockResolvedValue(true),
      find: jest.fn().mockResolvedValue(periods),
    } as unknown as Repository<BellPeriod>;
    const save = jest.fn().mockResolvedValue({});
    const slots = {
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockReturnValue({}),
      merge: jest.fn((target: object, value: object) => Object.assign(target, value)),
      save,
    } as unknown as Repository<TimetableSlot>;
    return { service: new TimetableService(bells, slots, dataSource), save };
  }

  it('blocks a teacher who is busy in another section', async () => {
    const { service, save } = build({ teacher: true });
    await service.setSlot(1, 5, slot).then(
      () => fail('expected a clash'),
      (error: AppException) => expect(codeOf(error)).toBe('TEACHER_CLASH'),
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('blocks a room that is already used', async () => {
    const { service } = build({ room: true });
    await service.setSlot(1, 5, slot).then(
      () => fail('expected a clash'),
      (error: AppException) => expect(codeOf(error)).toBe('ROOM_CLASH'),
    );
  });

  it('blocks a teacher whose week is already full', async () => {
    const { service, save } = build({ full: true });
    await service.setSlot(1, 5, slot).then(
      () => fail('expected the weekly limit'),
      (error: AppException) => expect(codeOf(error)).toBe('TEACHER_OVER_LIMIT'),
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('saves with the assigned teacher and section room when free', async () => {
    const { service, save } = build({});
    await service.setSlot(1, 5, slot);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ teacher_user_id: 9, room: 'R-6A' }));
  });

  it('rejects a period beyond the bell schedule', async () => {
    const { service } = build({});
    await service.setSlot(1, 5, { ...slot, period_no: 9 }).then(
      () => fail('expected a validation error'),
      (error: AppException) => expect(codeOf(error)).toBe('VALIDATION_FAILED'),
    );
  });
});
