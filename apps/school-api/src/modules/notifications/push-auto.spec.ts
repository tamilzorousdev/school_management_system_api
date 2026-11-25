import { AppException, AuthUser } from '@app/common';
import { NotificationsService } from './notifications.service';

const template = {
  code: 'STUDENT_ABSENT',
  category: 'attendance',
  push: true,
  sms: 'fallback',
  title: 'Absent',
  body: '{{student}} is absent',
  sms_body: '{{student}} is absent',
  dlt_template_id: null,
  language: 'en',
};

const recipient = { id: 5, school_id: 1, mobile: '9000000005' };

function build(auto: boolean) {
  const rows: Record<string, unknown>[] = [];
  const notifications = {
    insert: jest.fn(async (row: Record<string, unknown>) => rows.push(row)),
    create: jest.fn((row: Record<string, unknown>) => row),
    save: jest.fn(async (row: Record<string, unknown>) => ({ ...row, id: 77 })),
    findOne: jest.fn(async () => null),
    update: jest.fn(async () => undefined),
  };
  const queue = { add: jest.fn(), register: jest.fn() };
  const push = {
    send: jest.fn(async () => ({ status: 'sent', provider: 'kafka', successCount: 1, invalidTokens: [] })),
  };
  const devices = { tokensFor: jest.fn(async () => [{ fcm_token: 'abc' }]), removeTokens: jest.fn() };
  const service = new NotificationsService(
    notifications as never,
    {} as never,
    {} as never,
    queue as never,
    push as never,
    {} as never,
    devices as never,
    { driver: 'kafka', callDriver: 'off', auto } as never,
    { toUsers: jest.fn() } as never,
  );
  return { service, rows, notifications, queue, push };
}

const user = { id: 5, school_id: 1, roles: ['PARENT'] } as unknown as AuthUser;

describe('automatic push switch', () => {
  it('skips the push and the SMS fallback when PUSH_AUTO is false, but keeps the in-app notification', async () => {
    const { service, rows, queue } = build(false);
    await service['deliverTo'](recipient as never, template as never, 'batch', { student: 'Kavin' });
    expect(rows.map((row) => [row.channel, row.status])).toEqual([
      ['in_app', 'delivered'],
      ['push', 'skipped'],
    ]);
    expect(rows[1]!.error).toBe('Automatic push is off (PUSH_AUTO=false)');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('queues the push as before when PUSH_AUTO is on', async () => {
    const { service, queue } = build(true);
    await service['deliverTo'](recipient as never, template as never, 'batch', { student: 'Kavin' });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
});

describe('sendTestPush', () => {
  it('sends to my own external id even when automatic push is off', async () => {
    const { service, push, notifications } = build(false);
    const result = await service.sendTestPush(user, { title: 'Hello', data: { category: 'chat', thread_id: '8' } });
    expect(push.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 5,
        title: 'Hello',
        data: expect.objectContaining({ category: 'system', thread_id: '8', test: 'true', notification_id: '77' }),
      }),
    );
    expect(notifications.update).toHaveBeenCalledWith(77, expect.objectContaining({ status: 'sent' }));
    expect(result).toEqual({
      notification_id: 77,
      status: 'sent',
      provider: 'kafka',
      external_id: '5',
      devices: 1,
      error: null,
    });
  });

  it('reports the failure instead of throwing when the channel errors', async () => {
    const { service, push } = build(false);
    push.send.mockRejectedValueOnce(new Error('Kafka notification service is not reachable'));
    const result = await service.sendTestPush(user, {});
    expect(result.status).toBe('failed');
    expect(result.error).toBe('Kafka notification service is not reachable');
  });

  it('allows one test push every 5 seconds', async () => {
    const { service, notifications } = build(false);
    notifications.findOne.mockResolvedValueOnce({ id: 1 } as never);
    const error = await service.sendTestPush(user, {}).catch((caught: AppException) => caught);
    expect((error as AppException).getStatus()).toBe(429);
    expect((error as AppException).getResponse()).toMatchObject({ code: 'TEST_PUSH_TOO_SOON' });
  });
});
