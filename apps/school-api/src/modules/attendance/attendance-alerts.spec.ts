import 'reflect-metadata';
import { AttendanceAlertsService } from './attendance-alerts.service';
import { graceWindow } from './attendance-window';

function setup() {
  const claimed = new Set<string>();
  const attendance = {
    isSchoolDay: jest.fn().mockResolvedValue(true),
    window: jest.fn((_manager: unknown, _school: number, session: string) =>
      Promise.resolve(session === 'morning' ? graceWindow('09:00', '09:45', 15) : graceWindow('13:30', '14:15', 15)),
    ),
    unmarkedSections: jest.fn().mockResolvedValue([
      { section_id: 4, name: '6 - A', class_teacher_user_id: 31 },
      { section_id: 5, name: '6 - B', class_teacher_user_id: null },
    ]),
  };
  const dataSource = {
    manager: {},
    query: jest.fn((sql: string, params: unknown[]) => {
      if (sql.includes('INSERT INTO attendance_alerts')) {
        const [, ids, date, period, kind] = params as [number, number[], string, number, string];
        const fresh = ids.filter((id) => !claimed.has(`${id}:${date}:${period}:${kind}`));
        fresh.forEach((id) => claimed.add(`${id}:${date}:${period}:${kind}`));
        return Promise.resolve(fresh.map((section_id) => ({ section_id })));
      }
      if (sql.includes('FROM substitutions')) {
        return Promise.resolve(params[1] === 4 ? [{ substitute_user_id: 77 }] : []);
      }
      return Promise.resolve([]);
    }),
  };
  const notifications = { dispatch: jest.fn().mockResolvedValue({}) };
  const service = new AttendanceAlertsService(
    attendance as never,
    notifications as never,
    dataSource as never,
    { timeZone: 'Asia/Kolkata' } as never,
  );
  return { service, notifications, attendance };
}

describe('attendance alerts', () => {
  it('reminds the class teacher and the proxy once when the 1st period ends', async () => {
    const { service, notifications } = setup();
    await service.checkSchool(1, '09:46');
    await service.checkSchool(1, '09:50');
    expect(notifications.dispatch).toHaveBeenCalledTimes(1);
    expect(notifications.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'ATTENDANCE_REMINDER',
        audience: { user_ids: [31, 77] },
        data: expect.objectContaining({ section: '6 - A', session: 'morning', closes_at: '10:00' }),
      }),
    );
  });

  it('tells the AO and admin once after the grace is over', async () => {
    const { service, notifications } = setup();
    await service.checkSchool(1, '10:01');
    await service.checkSchool(1, '10:05');
    expect(notifications.dispatch).toHaveBeenCalledTimes(1);
    expect(notifications.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'ATTENDANCE_MISSED',
        audience: { roles: ['AO', 'ADMIN'], school_id: 1 },
        data: expect.objectContaining({ count: '2 sections', sections: '6 - A, 6 - B', grace: '15' }),
      }),
    );
  });

  it('stays quiet during the period, long after it, and on holidays', async () => {
    const { service, notifications, attendance } = setup();
    await service.checkSchool(1, '09:20');
    await service.checkSchool(1, '12:30');
    attendance.isSchoolDay.mockResolvedValue(false);
    await service.checkSchool(1, '09:50');
    expect(notifications.dispatch).not.toHaveBeenCalled();
  });

  it('covers the afternoon session the same way', async () => {
    const { service, notifications } = setup();
    await service.checkSchool(1, '14:20');
    await service.checkSchool(1, '14:31');
    expect(notifications.dispatch.mock.calls.map(([call]) => call.template)).toEqual([
      'ATTENDANCE_REMINDER',
      'ATTENDANCE_MISSED',
    ]);
  });
});
