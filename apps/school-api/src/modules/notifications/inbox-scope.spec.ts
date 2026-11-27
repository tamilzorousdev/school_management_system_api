import { FindOperator } from 'typeorm';
import { NotificationsService } from './notifications.service';
import { NotificationApp, templatesNotFor } from './notification-apps';

function build() {
  const notifications = {
    count: jest.fn(async () => 3),
    update: jest.fn(async () => ({ affected: 2 })),
    findAndCount: jest.fn(async () => [[], 0]),
  };
  const service = new NotificationsService(
    notifications as never,
    {} as never,
    {} as never,
    { register: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, notifications };
}

type Where = Record<string, unknown>;

const hiddenTemplates = (where: Where): string[] => {
  const not = where.template_code as FindOperator<string[]>;
  return not.value;
};

const statusIsNotExpired = (where: Where) => {
  const status = where.status as FindOperator<string>;
  return status.type === 'not' && status.value === 'expired';
};

describe('inbox scope', () => {
  it('leaves expired notifications out of the unread badge, like the list', async () => {
    const { service, notifications } = build();
    await service.unreadCount(5, 'staff');
    const [{ where }] = notifications.count.mock.calls[0] as unknown as [{ where: Where }];
    expect(statusIsNotExpired(where)).toBe(true);
    expect(where.channel).toBe('in_app');
  });

  it('marks all read only for the app that asked', async () => {
    const { service, notifications } = build();
    await expect(service.markAllRead(5, 'parent')).resolves.toEqual({ updated: 2 });
    const [where] = notifications.update.mock.calls[0] as unknown as [Where];
    expect(hiddenTemplates(where)).toEqual(templatesNotFor('parent'));
    expect(hiddenTemplates(where)).toContain('STAFF_LEAVE_STATUS');
    expect(statusIsNotExpired(where)).toBe(true);
  });

  it('marks everything read when no app is given, for older app builds', async () => {
    const { service, notifications } = build();
    await service.markAllRead(5);
    const [where] = notifications.update.mock.calls[0] as unknown as [Where];
    expect(where.template_code).toBeUndefined();
    expect(where.user_id).toBe(5);
  });

  it.each<NotificationApp>(['office', 'transport'])(
    'the %s app keeps staff notifications and hides parent and driver only ones',
    (app) => {
      const hidden = templatesNotFor(app);
      expect(hidden).toEqual(expect.arrayContaining(['STUDENT_ABSENT', 'BUS_OPT_OUT']));
      expect(hidden).not.toContain('GATE_PASS_REQUESTED');
      expect(hidden).not.toContain('FLEET_DOCUMENT_EXPIRY');
    },
  );

  it('the office app hides chat rows meant for the parent or driver app, not the staff one', async () => {
    const { service, notifications } = build();
    await service.unreadCount(5, 'office');
    const [{ where }] = notifications.count.mock.calls[0] as unknown as [{ where: Where }];
    const operators = (where.data as FindOperator<FindOperator<unknown>[]>).value;
    const hiddenApps = operators.map((not) => (not.value as unknown as { app: string }).app);
    expect(hiddenApps).toEqual(expect.arrayContaining(['parent', 'driver']));
    expect(hiddenApps).not.toContain('staff');
    expect(hiddenApps).not.toContain('office');
  });

  it('uses the same scope for the list, the badge and read all', async () => {
    const { service, notifications } = build();
    await service.mine(5, { page: 1, limit: 20, app: 'office' } as never);
    await service.unreadCount(5, 'office');
    await service.markAllRead(5, 'office');
    const [{ where: listWhere }] = notifications.findAndCount.mock.calls[0] as unknown as [{ where: Where }];
    const [{ where: countWhere }] = notifications.count.mock.calls[0] as unknown as [{ where: Where }];
    const [readAllWhere] = notifications.update.mock.calls[0] as unknown as [Where];
    expect(hiddenTemplates(listWhere)).toEqual(templatesNotFor('office'));
    expect(hiddenTemplates(countWhere)).toEqual(templatesNotFor('office'));
    expect(hiddenTemplates(readAllWhere)).toEqual(templatesNotFor('office'));
  });
});
