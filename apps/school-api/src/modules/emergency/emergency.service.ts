import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated, paginate } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { PERMISSIONS, ROLES } from '../access/access.catalog';
import { Notification } from '../notifications/entities/notification.entity';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  CreateEmergencyDto,
  EmergencyAudienceDto,
  EmergencyBroadcastDto,
  EmergencyCountsDto,
  EmergencyInsightsDto,
  EmergencyPreviewDto,
  EmergencyQueryDto,
  EmergencyRecipientDto,
  EmergencyTemplateDto,
  EmergencyTemplateInputDto,
  EmergencyTemplateUpdateDto,
  MyEmergencyDto,
  MyEmergencyQueryDto,
  RecipientsQueryDto,
  ResendDto,
  ResendResultDto,
  ReviewEmergencyDto,
} from './dto/emergency.dto';
import { AudienceService } from './audience.service';
import { EmergencyDeliveryService } from './emergency-delivery.service';
import {
  broadcastState,
  EMERGENCY_TEMPLATES,
  expiryFrom,
  expiryLabel,
  expiryProblem,
  MergedRecipient,
  needsApproval,
  scheduleProblem,
  share,
  startingStatus,
  textFor,
} from './emergency.logic';
import {
  DISPATCHED_STATUSES,
  EmergencyBroadcast,
  EmergencyChannel,
  EmergencyMessageTemplate,
  EmergencyRecipient,
  EndReason,
} from './entities/emergency.entity';

const DEFAULT_CHANNELS: EmergencyChannel[] = ['push', 'sms'];
const CHUNK = 500;

interface CountRow {
  broadcast_id: number;
  [key: string]: number | string;
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

@Injectable()
export class EmergencyService {
  private readonly logger = new Logger('Emergency');
  private ticking = false;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(EmergencyBroadcast) private readonly broadcasts: Repository<EmergencyBroadcast>,
    @InjectRepository(EmergencyRecipient) private readonly recipients: Repository<EmergencyRecipient>,
    @InjectRepository(EmergencyMessageTemplate) private readonly messageTemplates: Repository<EmergencyMessageTemplate>,
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    private readonly delivery: EmergencyDeliveryService,
    private readonly audience: AudienceService,
    private readonly notify: NotificationsService,
    private readonly realtime: RealtimeGateway,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async templates(schoolId: number, all = false): Promise<EmergencyTemplateDto[]> {
    await this.seedTemplates(schoolId);
    const rows = await this.messageTemplates.find({
      where: { school_id: schoolId, ...(all ? {} : { is_active: true }) },
      order: { sort_order: 'ASC', id: 'ASC' },
    });
    return rows.map((row) => this.presentTemplate(row));
  }

  async createTemplate(
    actor: AuthUser,
    schoolId: number,
    dto: EmergencyTemplateInputDto,
  ): Promise<EmergencyTemplateDto> {
    await this.seedTemplates(schoolId);
    const last = await this.messageTemplates.findOne({ where: { school_id: schoolId }, order: { sort_order: 'DESC' } });
    const saved = await this.messageTemplates.save(
      this.messageTemplates.create({
        school_id: schoolId,
        category: dto.category,
        severity: dto.severity ?? 'warning',
        title: dto.title,
        message: dto.message,
        title_ta: dto.title_ta || null,
        message_ta: dto.message_ta || null,
        is_active: dto.is_active ?? true,
        sort_order: dto.sort_order ?? (last?.sort_order ?? 0) + 1,
        created_by: actor.id,
      }),
    );
    return this.presentTemplate(saved);
  }

  async updateTemplate(schoolId: number, id: number, dto: EmergencyTemplateUpdateDto): Promise<EmergencyTemplateDto> {
    const row = await this.findTemplate(schoolId, id);
    const blankToNull = (value: string | undefined) => (value === undefined ? undefined : value || null);
    const changes = Object.fromEntries(
      Object.entries({
        category: dto.category,
        severity: dto.severity,
        title: dto.title,
        message: dto.message,
        title_ta: blankToNull(dto.title_ta),
        message_ta: blankToNull(dto.message_ta),
        is_active: dto.is_active,
        sort_order: dto.sort_order,
      }).filter(([, value]) => value !== undefined),
    );
    return this.presentTemplate(await this.messageTemplates.save(this.messageTemplates.merge(row, changes)));
  }

  async removeTemplate(schoolId: number, id: number): Promise<void> {
    await this.messageTemplates.softRemove(await this.findTemplate(schoolId, id));
  }

  async preview(schoolId: number, dto: EmergencyAudienceDto): Promise<EmergencyPreviewDto> {
    const people = await this.audience.resolve(schoolId, emergencyAudience(dto));
    const withApp = people.filter((person) => person.user_id).length;
    const withMobile = people.filter((person) => person.mobile).length;
    return {
      recipients: people.length,
      parents: people.filter((person) => person.kind !== 'staff').length,
      staff: people.filter((person) => person.kind !== 'parent').length,
      with_app: withApp,
      with_mobile: withMobile,
      sms_only: people.filter((person) => !person.user_id && person.mobile).length,
      unreachable: people.filter((person) => !person.user_id && !person.mobile).length,
    };
  }

  async create(actor: AuthUser, schoolId: number, dto: CreateEmergencyDto): Promise<EmergencyBroadcastDto> {
    if (dto.client_id) {
      const existing = await this.broadcasts.findOneBy({ school_id: schoolId, client_id: dto.client_id });
      if (existing) return this.detail(schoolId, existing.id);
    }
    if (dto.follow_up_of) await this.find(schoolId, dto.follow_up_of);
    const now = new Date();
    if (dto.expires_in) {
      const problem = expiryProblem(dto.expires_in.value, dto.expires_in.unit, now);
      if (problem) throw AppException.validation([{ field: 'expires_in', message: problem }]);
    }
    const sendAt = dto.send_at ? new Date(dto.send_at) : null;
    if (sendAt) {
      const problem = scheduleProblem(sendAt, now);
      if (problem) throw AppException.validation([{ field: 'send_at', message: problem }]);
    }
    const people = await this.audience.resolve(schoolId, emergencyAudience(dto));
    if (!people.length) throw AppException.badRequest('Nobody matches this audience', 'NO_RECIPIENTS');
    const channels = dto.channels?.length ? dto.channels : DEFAULT_CHANNELS;
    const approval = needsApproval(
      { audience: dto.audience, channels },
      actor.permissions.includes(PERMISSIONS.EMERGENCY_APPROVE),
    );
    const saved = await this.broadcasts.save(
      this.broadcasts.create({
        school_id: schoolId,
        batch_id: randomUUID(),
        title: dto.title,
        message: dto.message,
        title_ta: dto.title_ta || null,
        message_ta: dto.message_ta || null,
        category: dto.category,
        severity: dto.severity ?? 'critical',
        audience: dto.audience,
        class_ids: dto.audience === 'classes' ? (dto.class_ids ?? []) : null,
        section_ids: dto.audience === 'sections' ? (dto.section_ids ?? []) : null,
        student_ids: dto.audience === 'students' ? (dto.student_ids ?? []) : null,
        include_teachers: Boolean(dto.include_teachers),
        staff_groups: dto.audience === 'staff' && dto.staff_groups?.length ? dto.staff_groups : null,
        channels,
        status: approval ? 'pending_approval' : sendAt ? 'scheduled' : 'sending',
        total: people.length,
        client_id: dto.client_id ?? null,
        follow_up_of: dto.follow_up_of ?? null,
        sent_at: sendAt ?? now,
        send_at: sendAt,
        expiry_value: dto.expires_in?.value ?? null,
        expiry_unit: dto.expires_in?.unit ?? null,
        created_by: actor.id,
      }),
    );
    if (saved.status === 'sending') await this.dispatch(saved, people, actor.id);
    if (saved.status === 'pending_approval') await this.askApproval(saved, actor);
    this.logger.log(
      `Emergency broadcast ${saved.id} "${saved.title}" by user ${actor.id}: ${saved.status} (${people.length} people)`,
    );
    return this.detail(schoolId, saved.id);
  }

  async approve(
    actor: AuthUser,
    schoolId: number,
    id: number,
    dto: ReviewEmergencyDto,
  ): Promise<EmergencyBroadcastDto> {
    const broadcast = await this.pendingApproval(schoolId, id);
    const now = new Date();
    const later = broadcast.send_at && broadcast.send_at.getTime() > now.getTime() + 30_000;
    await this.broadcasts.update(id, {
      status: later ? 'scheduled' : 'sending',
      reviewed_by: actor.id,
      reviewed_at: now,
      review_note: dto.note || null,
    });
    if (!later) await this.dispatch({ ...broadcast, status: 'sending' }, null, actor.id);
    await this.tellSender(broadcast, actor, 'approved', dto.note);
    return this.detail(schoolId, id);
  }

  async reject(actor: AuthUser, schoolId: number, id: number, dto: ReviewEmergencyDto): Promise<EmergencyBroadcastDto> {
    if (!dto.note) throw AppException.validation([{ field: 'note', message: 'Tell the sender why it was rejected' }]);
    const broadcast = await this.pendingApproval(schoolId, id);
    await this.broadcasts.update(id, {
      status: 'rejected',
      reviewed_by: actor.id,
      reviewed_at: new Date(),
      review_note: dto.note,
    });
    await this.tellSender(broadcast, actor, 'rejected', dto.note);
    return this.detail(schoolId, id);
  }

  async cancel(schoolId: number, id: number): Promise<EmergencyBroadcastDto> {
    const result = await this.broadcasts
      .createQueryBuilder()
      .update(EmergencyBroadcast)
      .set({ status: 'cancelled' })
      .where('id = :id AND school_id = :schoolId AND status IN (:...statuses)', {
        id,
        schoolId,
        statuses: ['scheduled', 'pending_approval'],
      })
      .execute();
    if (!result.affected) {
      await this.find(schoolId, id);
      throw AppException.conflict('Only a scheduled or waiting broadcast can be cancelled', 'NOT_CANCELLABLE');
    }
    return this.detail(schoolId, id);
  }

  async end(actor: AuthUser, schoolId: number, id: number): Promise<EmergencyBroadcastDto> {
    const broadcast = await this.find(schoolId, id);
    if (broadcastState(broadcast) !== 'active') {
      throw AppException.conflict('This broadcast is not on screen any more', 'NOT_ACTIVE');
    }
    await this.close(broadcast, 'ended', actor.id, new Date());
    return this.detail(schoolId, id);
  }

  async remove(schoolId: number, id: number): Promise<void> {
    const broadcast = await this.find(schoolId, id);
    if (['pending_approval', 'scheduled', 'active'].includes(broadcastState(broadcast))) {
      throw AppException.conflict('End or cancel it first, then remove it from the history', 'STILL_ACTIVE');
    }
    await this.dataSource.query(
      `UPDATE notifications SET status = 'expired', read_at = COALESCE(read_at, now()), updated_at = now()
       WHERE batch_id = $1 AND channel = 'in_app' AND status <> 'expired'`,
      [broadcast.batch_id],
    );
    await this.broadcasts.softDelete(id);
    this.logger.log(`Emergency broadcast ${id} removed from the history`);
  }

  async list(schoolId: number, query: EmergencyQueryDto): Promise<Paginated<EmergencyBroadcastDto>> {
    const qb = this.broadcasts.createQueryBuilder('b').where('b.school_id = :schoolId', { schoolId });
    if (query.category) qb.andWhere('b.category = :category', { category: query.category });
    if (query.status) qb.andWhere('b.status = :status', { status: query.status });
    if (query.state) this.whereState(qb, query.state);
    if (query.from)
      qb.andWhere(`b.sent_at >= (:from::date)::timestamp AT TIME ZONE :tz`, {
        from: query.from,
        tz: this.app.timeZone,
      });
    if (query.to) {
      qb.andWhere(`b.sent_at < ((:to::date) + 1)::timestamp AT TIME ZONE :tz`, { to: query.to, tz: this.app.timeZone });
    }
    const page = await listQuery(qb, query, {
      searchable: ['b.title', 'b.message'],
      sortable: { sent_at: 'b.sent_at', title: 'b.title' },
      defaultSort: 'sent_at',
    });
    return { ...page, items: await this.present(page.items) };
  }

  async detail(schoolId: number, id: number): Promise<EmergencyBroadcastDto> {
    const [presented] = await this.present([await this.find(schoolId, id)]);
    return presented!;
  }

  async recipientsOf(
    schoolId: number,
    id: number,
    query: RecipientsQueryDto,
  ): Promise<Paginated<EmergencyRecipientDto>> {
    await this.find(schoolId, id);
    const qb = this.recipients.createQueryBuilder('r').where('r.broadcast_id = :id', { id });
    const filter = query.filter ?? 'all';
    if (filter === 'failed') qb.andWhere(`(r.push_status = 'failed' OR r.sms_status = 'failed')`);
    if (filter === 'not_read') qb.andWhere('r.read_at IS NULL');
    if (filter === 'not_acknowledged') qb.andWhere('r.acknowledged_at IS NULL');
    if (filter === 'sms_only') qb.andWhere('r.user_id IS NULL AND r.mobile IS NOT NULL');
    if (filter === 'unreachable') qb.andWhere(`r.push_status = 'none' AND r.sms_status = 'none' AND r.user_id IS NULL`);
    if (query.search?.trim()) {
      qb.andWhere(`(r.name ILIKE :search OR r.mobile ILIKE :search OR r.students::text ILIKE :search)`, {
        search: `%${escapeLike(query.search.trim())}%`,
      });
    }
    const [rows, total] = await qb
      .orderBy('r.name', 'ASC')
      .addOrderBy('r.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return paginate(
      [
        rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          name: row.name,
          mobile: row.mobile,
          has_app: Boolean(row.user_id),
          students: row.students,
          push_status: row.push_status,
          push_error: row.push_error,
          sms_status: row.sms_status,
          sms_error: row.sms_error,
          read_at: row.read_at,
          acknowledged_at: row.acknowledged_at,
        })),
        total,
      ],
      query.page,
      query.limit,
    );
  }

  async resend(schoolId: number, id: number, dto: ResendDto): Promise<ResendResultDto> {
    const broadcast = await this.find(schoolId, id);
    if (!DISPATCHED_STATUSES.includes(broadcast.status)) {
      throw AppException.conflict('This broadcast has not gone out yet', 'NOT_SENT_YET');
    }
    if (broadcast.status === 'sending') {
      throw AppException.conflict('This broadcast is still sending. Try again when it finishes.', 'STILL_SENDING');
    }
    if (broadcastState(broadcast) !== 'active') {
      throw AppException.conflict('This broadcast has ended, so it is not sent again', 'NOT_ACTIVE');
    }
    const allowed = dto.channels?.length ? dto.channels : broadcast.channels;
    const push = allowed.includes('push');
    const sms = allowed.includes('sms');
    const reset = (channel: 'push' | 'sms', where: string) =>
      this.dataSource.query(
        `UPDATE emergency_recipients
         SET ${channel}_status = 'pending', ${channel}_attempts = 0, ${channel}_error = NULL,
             ${channel}_next_at = now(), updated_at = now()
         WHERE broadcast_id = $1 AND ${where}`,
        [id],
      );
    let condition: string;
    if (dto.target === 'failed') {
      const failed = [...(push ? [`push_status = 'failed'`] : []), ...(sms ? [`sms_status = 'failed'`] : [])];
      condition = `(${failed.join(' OR ') || 'false'})`;
    } else {
      const reachable = [...(push ? ['user_id IS NOT NULL'] : []), ...(sms ? ['mobile IS NOT NULL'] : [])];
      condition = `acknowledged_at IS NULL AND (${reachable.join(' OR ') || 'false'})`;
    }
    const [count] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM emergency_recipients WHERE broadcast_id = $1 AND ${condition}`,
      [id],
    );
    const queued = Number(count?.total ?? 0);
    if (!queued) return { queued: 0 };
    if (dto.target === 'failed') {
      if (push) await reset('push', `push_status = 'failed'`);
      if (sms) await reset('sms', `sms_status = 'failed'`);
    } else {
      if (push) await reset('push', `acknowledged_at IS NULL AND user_id IS NOT NULL`);
      if (sms) await reset('sms', `acknowledged_at IS NULL AND mobile IS NOT NULL`);
    }
    await this.broadcasts.update(id, { status: 'sending', completed_at: null });
    this.logger.log(`Emergency broadcast ${id}: resend to ${queued} (${dto.target}, ${allowed.join('+')})`);
    this.delivery.kick();
    return { queued };
  }

  async insights(schoolId: number): Promise<EmergencyInsightsDto> {
    const monthStart = `${todayIn(this.app.timeZone).slice(0, 7)}-01`;
    const [row] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT b.id) AS broadcasts, COUNT(r.id) AS recipients,
              COUNT(r.id) FILTER (WHERE r.push_status = 'sent' OR r.sms_status = 'sent') AS reached,
              COUNT(r.id) FILTER (WHERE r.acknowledged_at IS NOT NULL) AS acknowledged
       FROM emergency_broadcasts b LEFT JOIN emergency_recipients r ON r.broadcast_id = b.id
       WHERE b.school_id = $1 AND b.deleted_at IS NULL AND b.status = ANY($4)
         AND b.sent_at >= ($2::date)::timestamp AT TIME ZONE $3`,
      [schoolId, monthStart, this.app.timeZone, DISPATCHED_STATUSES],
    );
    const sending = await this.broadcasts.countBy({ school_id: schoolId, status: 'sending' });
    const last = await this.broadcasts.findOne({
      where: { school_id: schoolId, status: In(DISPATCHED_STATUSES) },
      order: { sent_at: 'DESC' },
    });
    const recipients = Number(row?.recipients ?? 0);
    return {
      this_month: Number(row?.broadcasts ?? 0),
      recipients,
      reached_percent: share(Number(row?.reached ?? 0), recipients),
      acknowledged_percent: share(Number(row?.acknowledged ?? 0), recipients),
      sending,
      last: last ? (await this.present([last]))[0]! : null,
    };
  }

  async mine(user: AuthUser, query: MyEmergencyQueryDto): Promise<Paginated<MyEmergencyDto>> {
    const qb = this.recipients
      .createQueryBuilder('r')
      .innerJoin(EmergencyBroadcast, 'b', 'b.id = r.broadcast_id AND b.deleted_at IS NULL')
      .where('r.user_id = :userId', { userId: user.id });
    if (query.pending) qb.andWhere('r.acknowledged_at IS NULL');
    if (!query.include_ended) qb.andWhere('b.ended_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > now())');
    const [rows, total] = await qb
      .orderBy('b.sent_at', 'DESC')
      .addOrderBy('r.id', 'DESC')
      .offset((query.page - 1) * query.limit)
      .limit(query.limit)
      .getManyAndCount();
    return paginate([await this.presentMine(rows), total], query.page, query.limit);
  }

  async mineOne(user: AuthUser, id: number): Promise<MyEmergencyDto> {
    const row = await this.myRow(user, id);
    if (!row.read_at) {
      row.read_at = new Date();
      await this.recipients.update(row.id, { read_at: row.read_at });
      await this.markInAppRead(user.id, id);
    }
    return (await this.presentMine([row]))[0]!;
  }

  async acknowledge(user: AuthUser, id: number): Promise<MyEmergencyDto> {
    const row = await this.myRow(user, id);
    const now = new Date();
    if (!row.acknowledged_at) {
      row.acknowledged_at = now;
      row.read_at ??= now;
      await this.recipients.update(row.id, { acknowledged_at: row.acknowledged_at, read_at: row.read_at });
      await this.markInAppRead(user.id, id);
    }
    return (await this.presentMine([row]))[0]!;
  }

  @Interval('emergency-lifecycle', 5000)
  async lifecycle(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.sendDue();
      await this.closeExpired();
    } catch (error) {
      this.logger.error(`Emergency lifecycle round failed: ${(error as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async sendDue(): Promise<void> {
    const claimed = await this.dataSource.query(
      `UPDATE emergency_broadcasts SET status = 'sending', updated_at = now()
       WHERE id IN (
         SELECT id FROM emergency_broadcasts
         WHERE status = 'scheduled' AND send_at <= now() AND deleted_at IS NULL
         ORDER BY send_at LIMIT 10 FOR UPDATE SKIP LOCKED)
       RETURNING id`,
    );
    const ids: number[] = (Array.isArray(claimed[0]) ? claimed[0] : claimed).map((row: { id: number }) =>
      Number(row.id),
    );
    for (const id of ids) {
      const broadcast = await this.broadcasts.findOneBy({ id });
      if (!broadcast) continue;
      await this.dispatch(broadcast, null, broadcast.created_by).catch((error: Error) =>
        this.logger.error(`Scheduled broadcast ${id} failed to go out: ${error.message}`),
      );
    }
  }

  private async closeExpired(): Promise<void> {
    const due = await this.broadcasts
      .createQueryBuilder('b')
      .where('b.ended_at IS NULL AND b.expires_at IS NOT NULL AND b.expires_at <= now()')
      .andWhere('b.status IN (:...statuses)', { statuses: DISPATCHED_STATUSES })
      .take(50)
      .getMany();
    for (const broadcast of due) await this.close(broadcast, 'expired', null, broadcast.expires_at!);
  }

  private async dispatch(
    broadcast: EmergencyBroadcast,
    known: MergedRecipient[] | null,
    actorId: number | null,
  ): Promise<void> {
    const people = known ?? (await this.audience.resolve(broadcast.school_id, this.audienceOf(broadcast)));
    const now = new Date();
    const expiresAt =
      broadcast.expiry_value && broadcast.expiry_unit
        ? expiryFrom(now, broadcast.expiry_value, broadcast.expiry_unit)
        : null;
    const channels = broadcast.channels;
    await this.dataSource.transaction(async (manager) => {
      await manager.update(EmergencyBroadcast, broadcast.id, {
        status: people.length ? 'sending' : 'sent',
        sent_at: now,
        total: people.length,
        expires_at: expiresAt,
        completed_at: people.length ? null : now,
      });
      for (let start = 0; start < people.length; start += CHUNK) {
        const slice = people.slice(start, start + CHUNK);
        await manager.insert(
          EmergencyRecipient,
          slice.map((person) => {
            const push = startingStatus('push', person, channels);
            const sms = startingStatus('sms', person, channels);
            return {
              school_id: broadcast.school_id,
              broadcast_id: broadcast.id,
              kind: person.kind,
              user_id: person.user_id,
              guardian_id: person.guardian_id,
              name: person.name.slice(0, 150),
              mobile: person.mobile,
              language: person.language,
              students: person.students,
              push_status: push,
              push_next_at: push === 'pending' ? now : null,
              sms_status: sms,
              sms_next_at: sms === 'pending' ? now : null,
            };
          }),
        );
        const appUsers = slice.filter((person) => person.user_id);
        if (appUsers.length) {
          await manager.insert(
            Notification,
            appUsers.map((person) => ({
              school_id: broadcast.school_id,
              user_id: person.user_id!,
              batch_id: broadcast.batch_id,
              channel: 'in_app' as const,
              category: 'alert' as const,
              template_code: TEMPLATES.EMERGENCY_BROADCAST,
              title: textFor(person.language, broadcast.title, broadcast.title_ta),
              body: textFor(person.language, broadcast.message, broadcast.message_ta),
              data: {
                broadcast_id: String(broadcast.id),
                severity: broadcast.severity,
                category: 'alert',
                ...(expiresAt ? { expires_at: expiresAt.toISOString() } : {}),
              },
              status: 'delivered' as const,
              sent_at: now,
            })),
          );
        }
      }
    });
    this.alertLive({ ...broadcast, sent_at: now, expires_at: expiresAt }, people);
    if (broadcast.follow_up_of && broadcast.category === 'all_clear') {
      const original = await this.broadcasts.findOneBy({ id: broadcast.follow_up_of, school_id: broadcast.school_id });
      if (original && broadcastState(original) === 'active') await this.close(original, 'all_clear', actorId, now);
    }
    this.delivery.kick();
  }

  private async close(broadcast: EmergencyBroadcast, reason: EndReason, by: number | null, at: Date): Promise<void> {
    const result = await this.broadcasts
      .createQueryBuilder()
      .update(EmergencyBroadcast)
      .set({ ended_at: at, end_reason: reason, ended_by: by })
      .where('id = :id AND ended_at IS NULL', { id: broadcast.id })
      .execute();
    if (!result.affected) return;
    for (const channel of ['push', 'sms']) {
      await this.dataSource.query(
        `UPDATE emergency_recipients
         SET ${channel}_status = 'skipped', ${channel}_error = $2, ${channel}_next_at = NULL, updated_at = now()
         WHERE broadcast_id = $1 AND ${channel}_status = 'pending'`,
        [broadcast.id, reason === 'expired' ? 'Expired before it could be sent' : 'Ended before it could be sent'],
      );
    }
    await this.dataSource.query(
      `UPDATE notifications SET status = 'expired', read_at = COALESCE(read_at, now()), updated_at = now()
       WHERE batch_id = $1 AND channel = 'in_app'`,
      [broadcast.batch_id],
    );
    const users: { user_id: number }[] = await this.dataSource.query(
      `SELECT user_id FROM emergency_recipients WHERE broadcast_id = $1 AND user_id IS NOT NULL`,
      [broadcast.id],
    );
    if (users.length) {
      this.realtime.toUsers(
        users.map((row) => Number(row.user_id)),
        'emergency.ended',
        { broadcast_id: broadcast.id, reason, ended_at: at },
      );
    }
    this.delivery.kick();
    this.logger.log(`Emergency broadcast ${broadcast.id} ${reason}`);
  }

  private async askApproval(broadcast: EmergencyBroadcast, actor: AuthUser): Promise<void> {
    const [label] = [...(await this.audience.labels([broadcast])).values()];
    await this.notify
      .dispatch({
        template: TEMPLATES.EMERGENCY_APPROVAL_NEEDED,
        audience: { roles: [ROLES.ADMIN, ROLES.PRINCIPAL], school_id: broadcast.school_id },
        data: {
          sender: actor.name,
          title: broadcast.title,
          audience: label ?? '',
          broadcast_id: String(broadcast.id),
        },
      })
      .catch((error: Error) => this.logger.warn(`Approval request ${broadcast.id} not sent: ${error.message}`));
  }

  private async tellSender(
    broadcast: EmergencyBroadcast,
    reviewer: AuthUser,
    decision: 'approved' | 'rejected',
    note: string | undefined,
  ): Promise<void> {
    if (!broadcast.created_by || broadcast.created_by === reviewer.id) return;
    await this.notify
      .dispatch({
        template: TEMPLATES.EMERGENCY_REVIEWED,
        audience: { user_ids: [broadcast.created_by] },
        data: {
          title: broadcast.title,
          decision,
          decision_ta: decision === 'approved' ? 'ஒப்புதல் பெற்றது' : 'நிராகரிக்கப்பட்டது',
          reviewer: reviewer.name,
          note: note ?? '',
          broadcast_id: String(broadcast.id),
        },
      })
      .catch((error: Error) => this.logger.warn(`Review notice ${broadcast.id} not sent: ${error.message}`));
  }

  private async pendingApproval(schoolId: number, id: number): Promise<EmergencyBroadcast> {
    const broadcast = await this.find(schoolId, id);
    if (broadcast.status !== 'pending_approval') {
      throw AppException.conflict('This broadcast is not waiting for approval', 'NOT_PENDING_APPROVAL');
    }
    return broadcast;
  }

  private whereState(qb: ReturnType<Repository<EmergencyBroadcast>['createQueryBuilder']>, state: string): void {
    const live = `b.status IN ('sending', 'sent', 'partly_failed')`;
    const clauses: Record<string, string> = {
      pending_approval: `b.status = 'pending_approval'`,
      scheduled: `b.status = 'scheduled'`,
      rejected: `b.status = 'rejected'`,
      cancelled: `b.status = 'cancelled'`,
      active: `${live} AND b.ended_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > now())`,
      expired: `${live} AND ((b.ended_at IS NOT NULL AND b.end_reason = 'expired') OR (b.ended_at IS NULL AND b.expires_at <= now()))`,
      ended: `${live} AND b.ended_at IS NOT NULL AND b.end_reason <> 'expired'`,
    };
    qb.andWhere(clauses[state] ?? 'true');
  }

  private audienceOf(broadcast: EmergencyBroadcast): EmergencyAudienceDto {
    return {
      audience: broadcast.audience,
      class_ids: broadcast.class_ids ?? undefined,
      section_ids: broadcast.section_ids ?? undefined,
      student_ids: broadcast.student_ids ?? undefined,
      include_teachers: broadcast.include_teachers,
      staff_groups: broadcast.staff_groups ?? undefined,
    };
  }

  private async seedTemplates(schoolId: number): Promise<void> {
    const existing = await this.messageTemplates.count({ where: { school_id: schoolId }, withDeleted: true });
    if (existing) return;
    await this.messageTemplates.insert(
      EMERGENCY_TEMPLATES.map((template, index) => ({
        school_id: schoolId,
        category: template.category,
        severity: template.severity,
        title: template.title,
        message: template.message,
        title_ta: template.title_ta,
        message_ta: template.message_ta,
        is_active: true,
        sort_order: index + 1,
      })),
    );
  }

  private async findTemplate(schoolId: number, id: number): Promise<EmergencyMessageTemplate> {
    const row = await this.messageTemplates.findOneBy({ id, school_id: schoolId });
    if (!row) throw AppException.notFound('Ready message not found', 'TEMPLATE_NOT_FOUND');
    return row;
  }

  private presentTemplate(row: EmergencyMessageTemplate): EmergencyTemplateDto {
    return {
      id: row.id,
      key: `t${row.id}`,
      is_active: row.is_active,
      sort_order: row.sort_order,
      category: row.category,
      severity: row.severity,
      title: row.title,
      message: row.message,
      title_ta: row.title_ta,
      message_ta: row.message_ta,
    };
  }

  private alertLive(broadcast: EmergencyBroadcast, people: MergedRecipient[]): void {
    for (const language of ['en', 'ta'] as const) {
      const userIds = people
        .filter((person) => person.user_id && person.language === language)
        .map((person) => person.user_id!);
      if (!userIds.length) continue;
      this.realtime.toUsers(userIds, 'emergency.alert', {
        broadcast_id: broadcast.id,
        title: textFor(language, broadcast.title, broadcast.title_ta),
        message: textFor(language, broadcast.message, broadcast.message_ta),
        category: broadcast.category,
        severity: broadcast.severity,
        sent_at: broadcast.sent_at,
        expires_at: broadcast.expires_at,
      });
    }
  }

  private async markInAppRead(userId: number, broadcastId: number): Promise<void> {
    await this.dataSource.query(
      `UPDATE notifications SET read_at = now(), status = 'read', updated_at = now()
       WHERE user_id = $1 AND channel = 'in_app' AND read_at IS NULL AND status <> 'expired'
         AND batch_id = (SELECT batch_id FROM emergency_broadcasts WHERE id = $2)`,
      [userId, broadcastId],
    );
  }

  private async myRow(user: AuthUser, id: number): Promise<EmergencyRecipient> {
    const row = await this.recipients
      .createQueryBuilder('r')
      .innerJoin(EmergencyBroadcast, 'b', 'b.id = r.broadcast_id AND b.deleted_at IS NULL')
      .where('r.broadcast_id = :id AND r.user_id = :userId', { id, userId: user.id })
      .getOne();
    if (!row) throw AppException.notFound('Emergency message not found', 'BROADCAST_NOT_FOUND');
    return row;
  }

  private async find(schoolId: number, id: number): Promise<EmergencyBroadcast> {
    const broadcast = await this.broadcasts.findOneBy({ id, school_id: schoolId });
    if (!broadcast) throw AppException.notFound('Emergency broadcast not found', 'BROADCAST_NOT_FOUND');
    return broadcast;
  }

  private async presentMine(rows: EmergencyRecipient[]): Promise<MyEmergencyDto[]> {
    if (!rows.length) return [];
    const broadcasts = await this.broadcasts.findBy({ id: In(rows.map((row) => row.broadcast_id)) });
    const schools: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT id, name FROM schools WHERE id = ANY($1)`,
      [[...new Set(broadcasts.map((item) => item.school_id))]],
    );
    return rows.map((row) => {
      const broadcast = broadcasts.find((item) => item.id === row.broadcast_id)!;
      return {
        id: broadcast.id,
        title: textFor(row.language, broadcast.title, broadcast.title_ta),
        message: textFor(row.language, broadcast.message, broadcast.message_ta),
        category: broadcast.category,
        severity: broadcast.severity,
        school: schools.find((item) => Number(item.id) === broadcast.school_id)?.name ?? '',
        students: row.students,
        sent_at: broadcast.sent_at,
        read_at: row.read_at,
        acknowledged_at: row.acknowledged_at,
        follow_up_of: broadcast.follow_up_of,
        is_active: broadcastState(broadcast) === 'active',
        expires_at: broadcast.expires_at,
        ended_at: broadcast.ended_at,
        end_reason: broadcast.end_reason,
      };
    });
  }

  private async present(rows: EmergencyBroadcast[]): Promise<EmergencyBroadcastDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const counts: CountRow[] = await this.dataSource.query(
      `SELECT broadcast_id, COUNT(*) AS total,
              COUNT(*) FILTER (WHERE kind <> 'staff') AS parents,
              COUNT(*) FILTER (WHERE kind <> 'parent') AS staff,
              COUNT(*) FILTER (WHERE user_id IS NOT NULL) AS in_app,
              ${['push', 'sms']
                .flatMap((channel) =>
                  ['pending', 'sending', 'sent', 'failed', 'skipped'].map(
                    (status) => `COUNT(*) FILTER (WHERE ${channel}_status = '${status}') AS ${channel}_${status}`,
                  ),
                )
                .join(', ')},
              COUNT(*) FILTER (WHERE push_status = 'sent' OR sms_status = 'sent') AS reached,
              COUNT(*) FILTER (WHERE read_at IS NOT NULL) AS read,
              COUNT(*) FILTER (WHERE acknowledged_at IS NOT NULL) AS acknowledged
       FROM emergency_recipients WHERE broadcast_id = ANY($1) GROUP BY broadcast_id`,
      [ids],
    );
    const userIds = [
      ...new Set(
        rows
          .flatMap((row) => [row.created_by, row.ended_by, row.reviewed_by])
          .filter((id): id is number => Boolean(id)),
      ),
    ];
    const followIds = [...new Set(rows.map((row) => row.follow_up_of).filter((id): id is number => Boolean(id)))];
    const [users, follows, labels] = await Promise.all([
      userIds.length
        ? (this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [userIds]) as Promise<
            { id: number; name: string }[]
          >)
        : Promise.resolve([]),
      followIds.length ? this.broadcasts.findBy({ id: In(followIds) }) : Promise.resolve([]),
      this.audience.labels(rows),
    ]);
    const userRef = (id: number | null) => {
      const found = id ? users.find((user) => Number(user.id) === id) : undefined;
      return found ? { id: Number(found.id), name: found.name } : null;
    };
    const now = new Date();
    return rows.map((row) => {
      const count = counts.find((item) => Number(item.broadcast_id) === row.id);
      const value = (key: string) => Number(count?.[key] ?? 0);
      const channel = (name: 'push' | 'sms') => ({
        pending: value(`${name}_pending`),
        sending: value(`${name}_sending`),
        sent: value(`${name}_sent`),
        failed: value(`${name}_failed`),
        skipped: value(`${name}_skipped`),
      });
      const total = value('total');
      const counted: EmergencyCountsDto = {
        total,
        parents: value('parents'),
        staff: value('staff'),
        in_app: value('in_app'),
        push: channel('push'),
        sms: channel('sms'),
        reached: value('reached'),
        read: value('read'),
        acknowledged: value('acknowledged'),
        reached_percent: share(value('reached'), total),
        acknowledged_percent: share(value('acknowledged'), total),
      };
      const follow = follows.find((item) => item.id === row.follow_up_of);
      return {
        id: row.id,
        title: row.title,
        message: row.message,
        title_ta: row.title_ta,
        message_ta: row.message_ta,
        category: row.category,
        severity: row.severity,
        audience: row.audience,
        audience_label: labels.get(row.id) ?? '',
        class_ids: row.class_ids ?? [],
        section_ids: row.section_ids ?? [],
        student_ids: row.student_ids ?? [],
        include_teachers: row.include_teachers,
        staff_groups: row.staff_groups ?? [],
        channels: row.channels,
        status: row.status,
        state: broadcastState(row, now),
        send_at: row.send_at,
        expiry:
          row.expiry_value && row.expiry_unit
            ? { value: row.expiry_value, unit: row.expiry_unit, label: expiryLabel(row.expiry_value, row.expiry_unit) }
            : null,
        expires_at: row.expires_at,
        ended_at: row.ended_at,
        end_reason: row.end_reason,
        ended_by: userRef(row.ended_by),
        reviewed_by: userRef(row.reviewed_by),
        reviewed_at: row.reviewed_at,
        review_note: row.review_note,
        sent_by: userRef(row.created_by),
        sent_at: row.sent_at,
        completed_at: row.completed_at,
        follow_up_of: follow ? { id: follow.id, name: follow.title } : null,
        counts: counted,
      };
    });
  }
}

function emergencyAudience(dto: EmergencyAudienceDto): EmergencyAudienceDto {
  return { ...dto, staff_groups: dto.audience === 'staff' ? dto.staff_groups : undefined };
}
