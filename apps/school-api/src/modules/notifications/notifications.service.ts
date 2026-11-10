import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { AppException, AuthUser, listQuery, offset, paginate, Paginated } from '@app/common';
import { ROLES } from '../access/access.catalog';
import { SmsService } from '../sms/sms.service';
import { Language, User } from '../users/entities/user.entity';
import { UserDevicesService } from '../users/user-devices.service';
import {
  DispatchResultDto,
  MyNotificationDto,
  MyNotificationsQueryDto,
  OutboxInsightsDto,
  OutboxItemDto,
  OutboxQueryDto,
} from './dto/notification.dto';
import { Notification } from './entities/notification.entity';
import { NotificationTemplate } from './entities/notification-template.entity';
import { JOB_QUEUE, JobQueue } from './queue/job-queue';
import { PushResult, PushService } from './push.service';
import { renderTemplate, TemplateData, toStringData } from './template.renderer';

export interface Audience {
  user_ids?: number[];
  roles?: string[];
  school_id?: number | null;
}

export interface DispatchInput {
  template: string;
  audience: Audience;
  data?: TemplateData;
}

interface SmsFollowUp {
  body: string;
  dlt_template_id: string | null;
  language: Language;
}

interface PushJob {
  notification_id: number;
  sms_fallback: SmsFollowUp | null;
}

interface SmsJob {
  notification_id: number;
  dlt_template_id: string | null;
  language: Language;
}

type Recipient = Pick<User, 'id' | 'school_id' | 'mobile' | 'language' | 'name'>;

const PUSH_JOB = 'notifications.push';
const SMS_JOB = 'notifications.sms';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger('Notifications');

  constructor(
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    @InjectRepository(NotificationTemplate) private readonly templates: Repository<NotificationTemplate>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    private readonly push: PushService,
    private readonly sms: SmsService,
    private readonly devices: UserDevicesService,
  ) {}

  onModuleInit(): void {
    this.queue.register<PushJob>(PUSH_JOB, {
      run: (job, attempt) => this.deliverPush(job, attempt),
      failed: (job, error) => this.pushFailed(job, error),
    });
    this.queue.register<SmsJob>(SMS_JOB, {
      run: (job, attempt) => this.deliverSms(job, attempt),
      failed: (job, error) => this.markFailed(job.notification_id, error),
    });
  }

  async dispatch(input: DispatchInput): Promise<DispatchResultDto> {
    const templates = await this.templates.find({ where: { code: input.template, is_active: true } });
    if (!templates.length)
      throw AppException.notFound(`Notification template ${input.template} not found`, 'TEMPLATE_NOT_FOUND');
    const byLanguage = new Map(templates.map((template) => [template.language, template]));
    const recipients = await this.resolve(input.audience);
    const batchId = randomUUID();
    const data = input.data ?? {};

    for (const user of recipients) {
      const template = byLanguage.get(user.language) ?? byLanguage.get('en') ?? templates[0];
      await this.deliverTo(user, template, batchId, { name: user.name, ...data });
    }
    return { batch_id: batchId, recipients: recipients.length };
  }

  async mine(userId: number, query: MyNotificationsQueryDto): Promise<Paginated<MyNotificationDto>> {
    const where = {
      user_id: userId,
      channel: 'in_app' as const,
      ...(query.unread ? { read_at: IsNull() } : {}),
      ...(query.category ? { category: query.category } : {}),
    };
    const [rows, total] = await this.notifications.findAndCount({
      where,
      order: { created_at: 'DESC', id: 'DESC' },
      skip: offset(query.page, query.limit),
      take: query.limit,
    });
    return paginate([rows.map((row) => this.toMine(row)), total], query.page, query.limit);
  }

  async unreadCount(userId: number): Promise<number> {
    return this.notifications.count({ where: { user_id: userId, channel: 'in_app', read_at: IsNull() } });
  }

  async markRead(userId: number, id: number): Promise<MyNotificationDto> {
    const row = await this.notifications.findOneBy({ id, user_id: userId, channel: 'in_app' });
    if (!row) throw AppException.notFound('Notification not found');
    if (!row.read_at) {
      row.read_at = new Date();
      row.status = 'read';
      await this.notifications.save(row);
    }
    return this.toMine(row);
  }

  async markAllRead(userId: number): Promise<{ updated: number }> {
    const result = await this.notifications.update(
      { user_id: userId, channel: 'in_app', read_at: IsNull() },
      { read_at: new Date(), status: 'read' },
    );
    return { updated: result.affected ?? 0 };
  }

  async outbox(query: OutboxQueryDto, actor: AuthUser): Promise<Paginated<OutboxItemDto>> {
    const qb = this.scoped(actor).leftJoinAndSelect('n.user', 'recipient_user');
    if (query.channel) qb.andWhere('n.channel = :channel', { channel: query.channel });
    if (query.status) qb.andWhere('n.status = :status', { status: query.status });
    if (query.category) qb.andWhere('n.category = :category', { category: query.category });
    const page = await listQuery(qb, query, {
      searchable: [
        'n.title',
        'n.body',
        'n.recipient',
        'n.template_code',
        'recipient_user.name',
        'recipient_user.mobile',
      ],
      sortable: { created_at: 'n.created_at', status: 'n.status', channel: 'n.channel' },
      defaultSort: 'created_at',
    });
    return { ...page, items: page.items.map((row) => this.toOutbox(row)) };
  }

  async outboxInsights(actor: AuthUser): Promise<OutboxInsightsDto> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await this.scoped(actor)
      .select('n.channel', 'channel')
      .addSelect('n.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .andWhere('n.created_at >= :since', { since })
      .groupBy('n.channel')
      .addGroupBy('n.status')
      .getRawMany<{ channel: string; status: string; count: string }>();
    const unread = await this.scoped(actor).andWhere(`n.channel = 'in_app'`).andWhere('n.read_at IS NULL').getCount();
    const empty = () => ({ sent: 0, skipped: 0, failed: 0, queued: 0 });
    const push: Record<string, number> = empty();
    const sms: Record<string, number> = empty();
    let total = 0;
    rows.forEach((row) => {
      const count = Number(row.count);
      total += count;
      if (row.channel === 'push') push[row.status] = (push[row.status] ?? 0) + count;
      if (row.channel === 'sms') sms[row.status] = (sms[row.status] ?? 0) + count;
    });
    return { last_24h: total, push, sms, unread_in_app: unread };
  }

  listTemplates(): Promise<NotificationTemplate[]> {
    return this.templates.find({ order: { code: 'ASC', language: 'ASC' } });
  }

  async sendTest(userId: number, actor: AuthUser): Promise<DispatchResultDto> {
    const qb = this.users
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.school', 'school')
      .where('u.id = :userId', { userId });
    if (!actor.roles.includes(ROLES.SUPER_ADMIN)) qb.andWhere('u.school_id = :schoolId', { schoolId: actor.school_id });
    const user = await qb.getOne();
    if (!user) throw AppException.notFound('User not found');
    return this.dispatch({
      template: 'SYSTEM_TEST',
      audience: { user_ids: [user.id] },
      data: { school: user.school?.name ?? 'the school' },
    });
  }

  private async deliverTo(
    user: Recipient,
    template: NotificationTemplate,
    batchId: string,
    data: TemplateData,
  ): Promise<void> {
    const title = renderTemplate(template.title, data);
    const body = renderTemplate(template.body, data);
    const payload = toStringData(data);
    const smsBody = template.sms_body ? renderTemplate(template.sms_body, data) : null;
    const base = {
      school_id: user.school_id,
      user_id: user.id,
      batch_id: batchId,
      category: template.category,
      template_code: template.code,
      title,
      data: payload,
    };

    await this.notifications.insert({ ...base, channel: 'in_app', body, status: 'delivered', sent_at: new Date() });

    const smsFollowUp = smsBody
      ? { body: smsBody, dlt_template_id: template.dlt_template_id, language: template.language }
      : null;
    if (template.push) {
      const push = await this.notifications.save(
        this.notifications.create({ ...base, channel: 'push', body, status: 'queued' }),
      );
      this.queue.add<PushJob>(PUSH_JOB, {
        notification_id: push.id,
        sms_fallback: template.sms === 'fallback' ? smsFollowUp : null,
      });
    } else if (template.sms === 'fallback' && smsFollowUp) {
      await this.queueSms(base, user.mobile, smsFollowUp);
    }
    if (template.sms === 'always' && smsFollowUp) await this.queueSms(base, user.mobile, smsFollowUp);
  }

  private async queueSms(base: Partial<Notification>, mobile: string, followUp: SmsFollowUp): Promise<void> {
    const row = await this.notifications.save(
      this.notifications.create({ ...base, channel: 'sms', body: followUp.body, status: 'queued', recipient: mobile }),
    );
    this.queue.add<SmsJob>(SMS_JOB, {
      notification_id: row.id,
      dlt_template_id: followUp.dlt_template_id,
      language: followUp.language,
    });
  }

  async sendCallPush(userId: number, data: Record<string, string>, ttlSeconds: number): Promise<PushResult> {
    const devices = await this.devices.tokensFor(userId);
    const result = await this.push.sendData({
      userId,
      tokens: devices.map((device) => device.fcm_token),
      data,
      ttlSeconds,
    });
    await this.devices.removeTokens(result.invalidTokens);
    this.logger.log(`call ${data.event} ${data.call_id} to user ${userId}: ${result.status} via ${result.provider}`);
    return result;
  }

  private async deliverPush(job: PushJob, attempt: number): Promise<void> {
    const row = await this.notifications.findOneByOrFail({ id: job.notification_id });
    const devices = await this.devices.tokensFor(row.user_id);
    const tokens = devices.map((device) => device.fcm_token);
    const user = await this.users.findOneBy({ id: row.user_id });
    const result = await this.push.send({
      tokens,
      title: row.title,
      body: row.body,
      data: { ...row.data, notification_id: String(row.id), category: row.category, template: row.template_code ?? '' },
      userId: row.user_id,
      variables: toStringData({ ...row.data, name: user?.name ?? '' }),
    });
    await this.devices.removeTokens(result.invalidTokens);
    await this.notifications.update(row.id, {
      status: result.status,
      provider: result.provider,
      recipient: tokens.length ? `${tokens.length} device${tokens.length === 1 ? '' : 's'}` : null,
      error: result.error ?? null,
      attempts: attempt,
      sent_at: result.status === 'sent' ? new Date() : null,
    });
    if (result.status !== 'sent' && job.sms_fallback) await this.fallbackToSms(row, job.sms_fallback);
  }

  private async pushFailed(job: PushJob, error: Error): Promise<void> {
    await this.markFailed(job.notification_id, error);
    if (!job.sms_fallback) return;
    const row = await this.notifications.findOneBy({ id: job.notification_id });
    if (row) await this.fallbackToSms(row, job.sms_fallback);
  }

  private async fallbackToSms(push: Notification, followUp: SmsFollowUp): Promise<void> {
    const user = await this.users.findOneBy({ id: push.user_id });
    if (!user) return;
    await this.queueSms(
      {
        school_id: push.school_id,
        user_id: push.user_id,
        batch_id: push.batch_id,
        category: push.category,
        template_code: push.template_code,
        title: push.title,
        data: push.data,
      },
      user.mobile,
      followUp,
    );
  }

  private async deliverSms(job: SmsJob, attempt: number): Promise<void> {
    const row = await this.notifications.findOneByOrFail({ id: job.notification_id });
    const result = await this.sms.send({
      mobile: row.recipient ?? '',
      text: row.body,
      dltTemplateId: job.dlt_template_id,
      language: job.language,
      templateCode: row.template_code,
      variables: row.data,
    });
    await this.notifications.update(row.id, {
      status: result.status,
      provider: result.provider,
      provider_ref: result.providerRef ?? null,
      error: result.error ?? null,
      attempts: attempt,
      sent_at: result.status === 'sent' ? new Date() : null,
    });
    if (result.status === 'failed') throw new Error(result.error ?? 'SMS failed');
  }

  private async markFailed(notificationId: number, error: Error): Promise<void> {
    this.logger.error(`Notification ${notificationId} failed: ${error.message}`);
    await this.notifications.update(notificationId, { status: 'failed', error: error.message.slice(0, 1000) });
  }

  private async resolve(audience: Audience): Promise<Recipient[]> {
    const qb = this.users
      .createQueryBuilder('u')
      .select(['u.id', 'u.school_id', 'u.mobile', 'u.language', 'u.name'])
      .where(`u.status = 'active'`);
    if (audience.school_id) qb.andWhere('u.school_id = :schoolId', { schoolId: audience.school_id });
    if (audience.user_ids?.length) qb.andWhere({ id: In(audience.user_ids) });
    if (audience.roles?.length) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM user_roles ur INNER JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.code IN (:...roles))',
        { roles: audience.roles },
      );
    }
    if (!audience.user_ids?.length && !audience.roles?.length) {
      throw AppException.badRequest('A notification needs user_ids or roles', 'EMPTY_AUDIENCE');
    }
    return qb.getMany();
  }

  private scoped(actor: AuthUser): SelectQueryBuilder<Notification> {
    const qb = this.notifications.createQueryBuilder('n');
    if (!actor.roles.includes(ROLES.SUPER_ADMIN)) qb.andWhere('n.school_id = :schoolId', { schoolId: actor.school_id });
    return qb;
  }

  private toMine(row: Notification): MyNotificationDto {
    return {
      id: row.id,
      category: row.category,
      template_code: row.template_code,
      title: row.title,
      body: row.body,
      data: row.data,
      is_read: Boolean(row.read_at),
      read_at: row.read_at,
      created_at: row.created_at,
    };
  }

  private toOutbox(row: Notification): OutboxItemDto {
    return {
      id: row.id,
      channel: row.channel,
      category: row.category,
      template_code: row.template_code,
      title: row.title,
      body: row.body,
      status: row.status,
      recipient: row.recipient,
      provider: row.provider,
      error: row.error,
      attempts: row.attempts,
      sent_at: row.sent_at,
      created_at: row.created_at,
      user: row.user ? { id: row.user.id, name: row.user.name, mobile: row.user.mobile } : null,
    };
  }
}
