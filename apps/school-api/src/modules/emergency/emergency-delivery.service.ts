import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { afterFailure, rollupStatus, textFor } from './emergency.logic';
import { DeliveryStatus, EmergencyBroadcast } from './entities/emergency.entity';

const BATCH = 50;
const STUCK_AFTER = '2 minutes';

interface ClaimedRow {
  id: number;
  broadcast_id: number;
  user_id: number | null;
  name: string;
  mobile: string | null;
  language: 'en' | 'ta';
  attempts: number;
}

interface Outcome {
  status: 'sent' | 'failed' | 'skipped';
  error?: string;
}

@Injectable()
export class EmergencyDeliveryService {
  private readonly logger = new Logger('EmergencyDelivery');
  private running = false;
  private again = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    @InjectRepository(EmergencyBroadcast) private readonly broadcasts: Repository<EmergencyBroadcast>,
  ) {}

  kick(): void {
    setImmediate(() => void this.tick());
  }

  @Interval('emergency-delivery', 5000)
  async tick(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        await this.releaseStuck();
        let claimed = 0;
        do {
          const [push, sms] = await Promise.all([this.claim('push'), this.claim('sms')]);
          claimed = push.length + sms.length;
          if (!claimed) break;
          const context = await this.context([...push, ...sms].map((row) => row.broadcast_id));
          await Promise.all([
            ...push.map((row) => this.deliver('push', row, context)),
            ...sms.map((row) => this.deliver('sms', row, context)),
          ]);
        } while (claimed);
        await this.finish();
      } while (this.again);
    } catch (error) {
      this.logger.error(`Emergency delivery round failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async claim(channel: 'push' | 'sms'): Promise<ClaimedRow[]> {
    const rows: ClaimedRow[] = await this.dataSource.query(
      `UPDATE emergency_recipients SET ${channel}_status = 'sending', updated_at = now()
       WHERE id IN (
         SELECT id FROM emergency_recipients
         WHERE ${channel}_status = 'pending' AND (${channel}_next_at IS NULL OR ${channel}_next_at <= now())
         ORDER BY id LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
       RETURNING id, broadcast_id, user_id, name, mobile, language, ${channel}_attempts AS attempts`,
    );
    return (Array.isArray(rows[0]) ? (rows[0] as ClaimedRow[]) : rows).map((row) => ({
      ...row,
      id: Number(row.id),
      broadcast_id: Number(row.broadcast_id),
      user_id: row.user_id === null ? null : Number(row.user_id),
      attempts: Number(row.attempts),
    }));
  }

  private async context(ids: number[]) {
    const broadcasts = await this.broadcasts.findBy({ id: In([...new Set(ids)]) });
    const schools: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT id, name FROM schools WHERE id = ANY($1)`,
      [[...new Set(broadcasts.map((item) => item.school_id))]],
    );
    return new Map(
      broadcasts.map((item) => [
        item.id,
        { broadcast: item, school: schools.find((school) => Number(school.id) === item.school_id)?.name ?? '' },
      ]),
    );
  }

  private async deliver(
    channel: 'push' | 'sms',
    row: ClaimedRow,
    context: Map<number, { broadcast: EmergencyBroadcast; school: string }>,
  ): Promise<void> {
    const entry = context.get(row.broadcast_id);
    if (!entry) return;
    const { broadcast, school } = entry;
    const title = textFor(row.language, broadcast.title, broadcast.title_ta);
    const message = textFor(row.language, broadcast.message, broadcast.message_ta);
    let outcome: Outcome;
    try {
      outcome =
        channel === 'push'
          ? await this.notifications.pushNow({
              userId: row.user_id!,
              title,
              body: message,
              data: {
                category: 'alert',
                template: TEMPLATES.EMERGENCY_BROADCAST,
                broadcast_id: String(broadcast.id),
                severity: broadcast.severity,
              },
            })
          : await this.notifications.smsNow({
              mobile: row.mobile!,
              text: `${school}: ${title}. ${message}`,
              templateCode: TEMPLATES.EMERGENCY_BROADCAST,
              variables: { school, title, message, name: row.name },
              language: row.language,
            });
    } catch (error) {
      outcome = { status: 'failed', error: (error as Error).message };
    }
    const attempts = row.attempts + 1;
    const next =
      outcome.status === 'failed'
        ? afterFailure(attempts)
        : { status: outcome.status as DeliveryStatus, next_at: null as Date | null };
    await this.dataSource.query(
      `UPDATE emergency_recipients
       SET ${channel}_status = $2, ${channel}_attempts = $3, ${channel}_error = $4, ${channel}_next_at = $5, updated_at = now()
       WHERE id = $1`,
      [row.id, next.status, attempts, outcome.error?.slice(0, 255) ?? null, next.next_at],
    );
  }

  private async releaseStuck(): Promise<void> {
    for (const channel of ['push', 'sms']) {
      await this.dataSource.query(
        `UPDATE emergency_recipients SET ${channel}_status = 'pending', updated_at = now()
         WHERE ${channel}_status = 'sending' AND updated_at < now() - interval '${STUCK_AFTER}'`,
      );
    }
  }

  private async finish(): Promise<void> {
    const rows: Record<string, string | number>[] = await this.dataSource.query(
      `SELECT b.id,
              ${['push', 'sms']
                .flatMap((channel) =>
                  ['pending', 'sending', 'sent', 'failed', 'skipped'].map(
                    (status) => `COUNT(r.id) FILTER (WHERE r.${channel}_status = '${status}') AS ${channel}_${status}`,
                  ),
                )
                .join(', ')}
       FROM emergency_broadcasts b LEFT JOIN emergency_recipients r ON r.broadcast_id = b.id
       WHERE b.status = 'sending' AND b.deleted_at IS NULL
       GROUP BY b.id`,
    );
    for (const row of rows) {
      const counts = (channel: string) => ({
        pending: Number(row[`${channel}_pending`]),
        sending: Number(row[`${channel}_sending`]),
        sent: Number(row[`${channel}_sent`]),
        failed: Number(row[`${channel}_failed`]),
        skipped: Number(row[`${channel}_skipped`]),
      });
      const status = rollupStatus(counts('push'), counts('sms'));
      if (status === 'sending') continue;
      await this.broadcasts.update(Number(row.id), { status, completed_at: new Date() });
      this.logger.log(`Emergency broadcast ${row.id} finished: ${status}`);
    }
  }
}
