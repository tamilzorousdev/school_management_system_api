import 'reflect-metadata';
import { CHAT_KEEP_YEARS, ChatRetentionService } from './chat-retention.service';

function setup(expired: number[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const manager = {
    query: jest.fn((sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT t.id')) return Promise.resolve(expired.map((id) => ({ id })));
      return Promise.resolve([]);
    }),
  };
  const dataSource = {
    query: jest.fn().mockResolvedValue([[{ id: 1 }, { id: 2 }], 2]),
    transaction: jest.fn((work: (m: typeof manager) => Promise<number>) => work(manager)),
  };
  return { service: new ChatRetentionService(dataSource as never), dataSource, calls };
}

describe('chat retention', () => {
  it('soft deletes chats of years that ended before the current year started', async () => {
    const { service, dataSource } = setup([]);
    expect(await service.archiveClosedYears()).toBe(2);
    const sql = dataSource.query.mock.calls[0][0] as string;
    expect(sql).toContain('SET deleted_at = now()');
    expect(sql).toContain('y.end_date < cur.start_date');
    expect(sql).not.toContain('DELETE');
  });

  it(`deletes for good only chats of years that ended more than ${CHAT_KEEP_YEARS} years ago`, async () => {
    const { service, calls } = setup([7, 9]);
    expect(await service.purgeExpired('2029-06-01')).toBe(2);
    expect(calls[0].params).toEqual(['2029-06-01', CHAT_KEEP_YEARS]);
    expect(calls.slice(1).map((call) => call.sql.split(' WHERE')[0])).toEqual([
      'DELETE FROM chat_audit_logs',
      'DELETE FROM chat_messages',
      'DELETE FROM chat_threads',
    ]);
    expect(calls[3].params).toEqual([[7, 9]]);
  });

  it('deletes nothing when no year is old enough', async () => {
    const { service, calls } = setup([]);
    expect(await service.purgeExpired('2027-06-01')).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('keeps running when one step fails', async () => {
    const { service, dataSource } = setup([]);
    dataSource.query.mockRejectedValueOnce(new Error('db down'));
    await expect(service.run('2027-06-01')).resolves.toEqual({ archived: 0, purged: 0 });
  });
});
