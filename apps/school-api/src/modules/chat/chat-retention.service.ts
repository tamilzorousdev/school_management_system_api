import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';

export const CHAT_KEEP_YEARS = 2;

@Injectable()
export class ChatRetentionService {
  private readonly logger = new Logger('ChatRetention');

  constructor(private readonly dataSource: DataSource) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'chat-retention' })
  async run(today = new Date().toISOString().slice(0, 10)): Promise<{ archived: number; purged: number }> {
    const archived = await this.archiveClosedYears().catch((error: Error) => {
      this.logger.warn(`Archiving old chats failed: ${error.message}`);
      return 0;
    });
    const purged = await this.purgeExpired(today).catch((error: Error) => {
      this.logger.warn(`Deleting expired chats failed: ${error.message}`);
      return 0;
    });
    if (archived || purged) this.logger.log(`Chats archived: ${archived}, deleted for good: ${purged}`);
    return { archived, purged };
  }

  async archiveClosedYears(): Promise<number> {
    const [rows] = (await this.dataSource.query(
      `UPDATE chat_threads t SET deleted_at = now()
       FROM academic_years y
       JOIN academic_years cur ON cur.school_id = y.school_id AND cur.is_current = true AND cur.deleted_at IS NULL
       WHERE t.academic_year_id = y.id AND t.deleted_at IS NULL AND y.end_date < cur.start_date
       RETURNING t.id`,
    )) as [{ id: number }[], number];
    return rows.length;
  }

  async purgeExpired(today: string): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const rows: { id: number }[] = await manager.query(
        `SELECT t.id FROM chat_threads t
         JOIN academic_years y ON y.id = t.academic_year_id
         WHERE y.end_date < $1::date - make_interval(years => $2::int)`,
        [today, CHAT_KEEP_YEARS],
      );
      if (!rows.length) return 0;
      const ids = rows.map((row) => Number(row.id));
      await manager.query(`DELETE FROM chat_audit_logs WHERE thread_id = ANY($1)`, [ids]);
      await manager.query(`DELETE FROM chat_messages WHERE thread_id = ANY($1)`, [ids]);
      await manager.query(`DELETE FROM chat_threads WHERE id = ANY($1)`, [ids]);
      return ids.length;
    });
  }
}
