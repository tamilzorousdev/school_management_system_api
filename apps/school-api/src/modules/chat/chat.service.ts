import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository, SelectQueryBuilder } from 'typeorm';
import { AppException, AuthUser, listQuery, offset, paginate, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { currentYearId, currentYearSql, onlyCurrentYear } from '../../shared/academic-year';
import { addDays, holidaySet } from '../../shared/school-days';
import { parentsOfStudent, teachersOfStudent } from '../../shared/student-contacts';
import { withoutSelf } from '../meetings/meeting-people';
import { FilesService } from '../files/files.service';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AssignmentsService } from '../staff/assignments.service';
import {
  canDeleteForEveryone,
  DELETE_WINDOW_HOURS,
  LOOKAHEAD_DAYS,
  messageKind,
  messagePreview,
  officeStatus,
  PAGE_SIZE,
  UNDO_SECONDS,
  undoUntil,
  VIDEO_MAX_SECONDS,
  zonedParts,
} from './chat.logic';
import {
  AuditMessageDto,
  AuditThreadDetailDto,
  AuditThreadsQueryDto,
  ChatInsightsDto,
  ChatMessageDto,
  ChatThreadDto,
  FlaggedMessageDto,
  FlaggedQueryDto,
  MessagesPageDto,
  MessagesQueryDto,
  OfficeHoursDto,
  ParentThreadInputDto,
  ReadReceiptDto,
  SendMessageDto,
  TeacherThreadInputDto,
  ThreadsQueryDto,
  ClearChatResultDto,
  DeleteMessageResultDto,
  DeleteScope,
} from './dto/chat.dto';
import { ChatAuditAction, ChatAuditLog, ChatMessage, ChatParty, ChatThread } from './entities/chat.entity';

interface SchoolHours {
  start: string;
  end: string;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger('Chat');

  constructor(
    @InjectRepository(ChatThread) private readonly threads: Repository<ChatThread>,
    @InjectRepository(ChatMessage) private readonly messages: Repository<ChatMessage>,
    @InjectRepository(ChatAuditLog) private readonly audits: Repository<ChatAuditLog>,
    private readonly assignments: AssignmentsService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async openAsTeacher(actor: AuthUser, dto: TeacherThreadInputDto): Promise<ChatThreadDto> {
    const schoolId = this.schoolOf(actor);
    await this.assignments.assertTeachesStudent(schoolId, actor.id, dto.student_id);
    const parents = await parentsOfStudent(this.dataSource.manager, schoolId, dto.student_id);
    if (!parents.length) throw AppException.conflict('No parent of this student has the app yet', 'NO_PARENT_ACCOUNT');
    const parent = dto.parent_user_id
      ? parents.find((item) => item.id === dto.parent_user_id)
      : (withoutSelf(parents, actor.id)[0] ?? parents[0]);
    if (!parent) {
      throw AppException.validation([
        { field: 'parent_user_id', message: 'This person is not a parent of the student with the app' },
      ]);
    }
    const thread = await this.findOrCreate(schoolId, actor.id, parent.id, dto.student_id, actor.id);
    return (await this.present([thread], actor.id))[0];
  }

  async openAsParent(
    schoolId: number,
    studentId: number,
    dto: ParentThreadInputDto,
    actor: AuthUser,
  ): Promise<ChatThreadDto> {
    const teachers = await teachersOfStudent(this.dataSource.manager, schoolId, studentId);
    if (!teachers.some((teacher) => teacher.id === dto.teacher_user_id)) {
      throw AppException.validation([{ field: 'teacher_user_id', message: 'This teacher does not teach your child' }]);
    }
    const thread = await this.findOrCreate(schoolId, dto.teacher_user_id, actor.id, studentId, actor.id);
    return (await this.present([thread], actor.id))[0];
  }

  async myThreads(actor: AuthUser, party: ChatParty, query: ThreadsQueryDto): Promise<Paginated<ChatThreadDto>> {
    const qb = this.partyQuery(actor, party);
    if (query.student_id) qb.andWhere('t.student_id = :studentId', { studentId: query.student_id });
    qb.orderBy('t.last_message_at', 'DESC', 'NULLS LAST')
      .addOrderBy('t.id', 'DESC')
      .skip(offset(query.page, query.limit))
      .take(query.limit);
    const page = paginate(await qb.getManyAndCount(), query.page, query.limit);
    return { ...page, items: await this.present(page.items, actor.id) };
  }

  async thread(actor: AuthUser, party: ChatParty, id: number): Promise<ChatThreadDto> {
    return (await this.present([await this.findForParty(actor, party, id)], actor.id))[0];
  }

  async history(actor: AuthUser, party: ChatParty, id: number, query: MessagesQueryDto): Promise<MessagesPageDto> {
    const thread = await this.findForParty(actor, party, id);
    const limit = query.limit ?? PAGE_SIZE;
    const cleared = party === 'teacher' ? thread.teacher_cleared_at : thread.parent_cleared_at;
    const qb = this.messages
      .createQueryBuilder('m')
      .where('m.thread_id = :threadId', { threadId: thread.id })
      .andWhere('NOT EXISTS (SELECT 1 FROM chat_message_hides h WHERE h.message_id = m.id AND h.user_id = :viewer)', {
        viewer: actor.id,
      });
    if (query.before_id) qb.andWhere('m.id < :beforeId', { beforeId: query.before_id });
    if (cleared) qb.andWhere('m.created_at > :cleared', { cleared });
    const rows = await qb
      .orderBy('m.id', 'DESC')
      .take(limit + 1)
      .getMany();
    return { items: await this.presentMessages(rows.slice(0, limit), actor.id), has_more: rows.length > limit };
  }

  async previewHistory(
    viewer: AuthUser,
    as: AuthUser,
    party: ChatParty,
    id: number,
    query: MessagesQueryDto,
  ): Promise<MessagesPageDto> {
    await this.log(await this.findForParty(as, party, id), viewer.id, 'viewed_thread');
    return this.history(as, party, id, query);
  }

  async unreadTotal(actor: AuthUser, party: ChatParty): Promise<number> {
    const threads = await this.myThreads(actor, party, { page: 1, limit: 100 });
    return threads.items.reduce((sum, thread) => sum + thread.unread, 0);
  }

  async send(actor: AuthUser, party: ChatParty, id: number, dto: SendMessageDto): Promise<ChatMessageDto> {
    const thread = await this.findForParty(actor, party, id);
    if (!dto.body && !dto.file_id) {
      throw AppException.validation([{ field: 'body', message: 'Write a message or attach a file' }]);
    }
    if (dto.file_id) await this.files.assertAttachable(dto.file_id, thread.school_id, 'file_id');
    const [file] = dto.file_id
      ? ((await this.dataSource.query(`SELECT mime_type FROM files WHERE id = $1`, [dto.file_id])) as {
          mime_type: string;
        }[])
      : [];
    const kind = messageKind(file?.mime_type);
    if (kind === 'video') {
      if (!dto.duration_seconds) {
        throw AppException.validation([{ field: 'duration_seconds', message: 'Send the video length in seconds' }]);
      }
      if (dto.duration_seconds > VIDEO_MAX_SECONDS) {
        throw AppException.badRequest(`A video can be at most ${VIDEO_MAX_SECONDS / 60} minutes`, 'VIDEO_TOO_LONG');
      }
    }
    const now = new Date();
    const hold = party === 'parent' ? await this.officeHoursFor(thread.school_id, now) : null;
    const held = Boolean(hold && !hold.open_now && hold.next_open_at);
    const saved = await this.dataSource.transaction(async (manager) => {
      const message = await manager.save(
        manager.create(ChatMessage, {
          school_id: thread.school_id,
          thread_id: thread.id,
          sender_user_id: actor.id,
          sender_party: party,
          body: dto.body ?? null,
          file_id: dto.file_id ?? null,
          kind,
          duration_seconds: kind === 'voice' || kind === 'video' ? (dto.duration_seconds ?? null) : null,
          push_pending: held,
          push_after: held ? hold!.next_open_at : null,
        }),
      );
      await manager
        .createQueryBuilder()
        .update(ChatThread)
        .set({
          last_message_at: now,
          last_message_preview: messagePreview(message.body, Boolean(message.file_id), kind),
          last_sender_id: actor.id,
          message_count: () => 'message_count + 1',
          ...(party === 'teacher'
            ? { parent_unread: () => 'parent_unread + 1' }
            : { teacher_unread: () => 'teacher_unread + 1' }),
        })
        .where('id = :id', { id: thread.id })
        .execute();
      return message;
    });
    const [presented] = await this.presentMessages([saved], actor.id);
    this.realtime.toUsers([thread.teacher_user_id, thread.parent_user_id], 'chat.message', presented);
    if (!held) {
      const recipient = party === 'teacher' ? thread.parent_user_id : thread.teacher_user_id;
      await this.pushMessage(
        thread,
        recipient,
        actor.name,
        messagePreview(saved.body, Boolean(saved.file_id), kind),
        1,
      );
    }
    return presented;
  }

  async markRead(actor: AuthUser, party: ChatParty, id: number): Promise<ReadReceiptDto> {
    const thread = await this.findForParty(actor, party, id);
    const now = new Date();
    const other: ChatParty = party === 'teacher' ? 'parent' : 'teacher';
    const [rows] = (await this.dataSource.query(
      `UPDATE chat_messages SET read_at = $3, updated_at = now()
       WHERE thread_id = $1 AND sender_party = $2 AND read_at IS NULL AND deleted_at IS NULL
       RETURNING id`,
      [thread.id, other, now],
    )) as [{ id: number }[], number];
    await this.threads.update(thread.id, party === 'teacher' ? { teacher_unread: 0 } : { parent_unread: 0 });
    if (rows.length) {
      this.realtime.toUsers([party === 'teacher' ? thread.parent_user_id : thread.teacher_user_id], 'chat.read', {
        thread_id: thread.id,
        reader_id: actor.id,
        read_at: now,
        message_ids: rows.map((row) => Number(row.id)),
      });
    }
    return { marked: rows.length, read_at: now };
  }

  async flag(actor: AuthUser, party: ChatParty, threadId: number, messageId: number, reason: string) {
    const thread = await this.findForParty(actor, party, threadId);
    const message = await this.messages.findOneBy({ id: messageId, thread_id: thread.id });
    if (!message) throw AppException.notFound('Message not found', 'MESSAGE_NOT_FOUND');
    if (message.sender_user_id === actor.id) {
      throw AppException.badRequest('You cannot report your own message', 'OWN_MESSAGE');
    }
    if (message.flagged_at && !message.flag_resolved_at) {
      throw AppException.conflict('This message is already reported', 'ALREADY_FLAGGED');
    }
    Object.assign(message, {
      flagged_at: new Date(),
      flagged_by: actor.id,
      flag_reason: reason,
      flag_resolved_at: null,
    });
    await this.messages.save(message);
    await this.threads.increment({ id: thread.id }, 'open_flags', 1);
    return (await this.presentMessages([message], actor.id))[0];
  }

  async deleteMessage(
    actor: AuthUser,
    party: ChatParty,
    threadId: number,
    messageId: number,
    scope: DeleteScope,
  ): Promise<DeleteMessageResultDto> {
    const thread = await this.findForParty(actor, party, threadId);
    const message = await this.visibleMessage(thread, party, actor.id, messageId);
    if (scope === 'me') {
      await this.dataSource.query(
        `INSERT INTO chat_message_hides (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [message.id, actor.id],
      );
      await this.log(thread, actor.id, 'deleted_for_me', message.id);
      return { message_id: message.id, deleted_for: 'me', undo_until: null, message: null };
    }
    if (message.sender_user_id !== actor.id) {
      throw AppException.forbidden('You can delete only your own messages for everyone', 'NOT_YOUR_MESSAGE');
    }
    if (message.deleted_for_all_at) throw AppException.conflict('This message is already deleted', 'ALREADY_DELETED');
    if (!canDeleteForEveryone(message.created_at)) {
      throw AppException.badRequest(
        `Messages can be deleted for everyone within ${DELETE_WINDOW_HOURS} hours. You can still delete it for yourself.`,
        'DELETE_WINDOW_PASSED',
      );
    }
    message.deleted_for_all_at = new Date();
    message.deleted_for_all_by = actor.id;
    await this.messages.save(message);
    await this.refreshPreview(thread.id);
    await this.log(thread, actor.id, 'deleted_for_everyone', message.id);
    const [presented] = await this.presentMessages([message], actor.id);
    this.realtime.toUsers([thread.teacher_user_id, thread.parent_user_id], 'chat.deleted', {
      thread_id: thread.id,
      message_id: message.id,
      deleted_at: message.deleted_for_all_at,
    });
    return { message_id: message.id, deleted_for: 'everyone', undo_until: presented.undo_until, message: presented };
  }

  async undoDelete(actor: AuthUser, party: ChatParty, threadId: number, messageId: number): Promise<ChatMessageDto> {
    const thread = await this.findForParty(actor, party, threadId);
    const message = await this.visibleMessage(thread, party, actor.id, messageId);
    if (!message.deleted_for_all_at || message.deleted_for_all_by !== actor.id) {
      throw AppException.conflict('There is no delete of yours to undo on this message', 'NOTHING_TO_UNDO');
    }
    if (Date.now() > undoUntil(message.deleted_for_all_at)!.getTime()) {
      throw AppException.badRequest(`Undo is possible for ${UNDO_SECONDS} seconds after deleting`, 'UNDO_EXPIRED');
    }
    message.deleted_for_all_at = null;
    message.deleted_for_all_by = null;
    await this.messages.save(message);
    await this.refreshPreview(thread.id);
    await this.log(thread, actor.id, 'undid_delete', message.id);
    const [presented] = await this.presentMessages([message], actor.id);
    this.realtime.toUsers([thread.teacher_user_id, thread.parent_user_id], 'chat.restored', presented);
    return presented;
  }

  async clearChat(actor: AuthUser, party: ChatParty, threadId: number): Promise<ClearChatResultDto> {
    const thread = await this.findForParty(actor, party, threadId);
    const now = new Date();
    await this.threads.update(
      thread.id,
      party === 'teacher'
        ? { teacher_cleared_at: now, teacher_unread: 0 }
        : { parent_cleared_at: now, parent_unread: 0 },
    );
    await this.log(thread, actor.id, 'cleared_chat');
    return { thread_id: thread.id, cleared_at: now };
  }

  async auditThreads(schoolId: number, query: AuditThreadsQueryDto): Promise<Paginated<ChatThreadDto>> {
    const base = this.threads
      .createQueryBuilder('t')
      .innerJoin('users', 'tu', 'tu.id = t.teacher_user_id')
      .innerJoin('users', 'pu', 'pu.id = t.parent_user_id')
      .innerJoin('students', 's', 's.id = t.student_id')
      .where('t.school_id = :schoolId', { schoolId });
    const qb = query.academic_year_id
      ? base.withDeleted().andWhere('t.academic_year_id = :yearId', { yearId: query.academic_year_id })
      : onlyCurrentYear(base);
    if (query.flagged) qb.andWhere('t.open_flags > 0');
    if (query.teacher_user_id) qb.andWhere('t.teacher_user_id = :teacher', { teacher: query.teacher_user_id });
    if (query.student_id) qb.andWhere('t.student_id = :student', { student: query.student_id });
    const page = await listQuery(qb, query.sort ? query : { ...query, sort: 'last_message_at', order: 'desc' }, {
      searchable: ['tu.name', 'pu.name', 's.first_name', 's.last_name', 's.admission_no'],
      sortable: {
        last_message_at: 't.last_message_at',
        created_at: 't.created_at',
        message_count: 't.message_count',
        open_flags: 't.open_flags',
      },
      defaultSort: 'last_message_at',
    });
    return { ...page, items: await this.present(page.items, null) };
  }

  async auditThread(schoolId: number, id: number, actor: AuthUser): Promise<AuditThreadDetailDto> {
    const thread = await this.threads.findOne({ where: { id, school_id: schoolId }, withDeleted: true });
    if (!thread) throw AppException.notFound('Conversation not found', 'THREAD_NOT_FOUND');
    await this.log(thread, actor.id, 'viewed_thread');
    const [presented] = await this.present([thread], null);
    const rows = await this.messages.find({ where: { thread_id: thread.id }, order: { id: 'ASC' } });
    const audit: {
      actor_user_id: number;
      name: string;
      action: string;
      message_id: number | null;
      note: string | null;
      created_at: Date;
    }[] = await this.dataSource.query(
      `SELECT a.actor_user_id, u.name, a.action, a.message_id, a.note, a.created_at
         FROM chat_audit_logs a JOIN users u ON u.id = a.actor_user_id
         WHERE a.thread_id = $1 ORDER BY a.created_at DESC LIMIT 50`,
      [thread.id],
    );
    return {
      ...presented,
      messages: await this.presentAudit(rows),
      audit: audit.map((row) => ({
        actor: { id: Number(row.actor_user_id), name: row.name },
        action: row.action,
        message_id: row.message_id ? Number(row.message_id) : null,
        note: row.note,
        at: row.created_at,
      })),
    };
  }

  async flagged(schoolId: number, query: FlaggedQueryDto): Promise<Paginated<FlaggedMessageDto>> {
    const qb = this.messages
      .createQueryBuilder('m')
      .innerJoin('chat_threads', 't', 't.id = m.thread_id AND t.deleted_at IS NULL')
      .innerJoin(
        'academic_years',
        'cy',
        'cy.id = t.academic_year_id AND cy.is_current = true AND cy.deleted_at IS NULL',
      )
      .where('m.school_id = :schoolId AND m.flagged_at IS NOT NULL', { schoolId });
    if (!query.include_resolved) qb.andWhere('m.flag_resolved_at IS NULL');
    qb.orderBy('m.flagged_at', 'DESC').skip(offset(query.page, query.limit)).take(query.limit);
    const page = paginate(await qb.getManyAndCount(), query.page, query.limit);
    const threads = page.items.length
      ? await this.threads.findBy({ id: In([...new Set(page.items.map((row) => row.thread_id))]) })
      : [];
    const presentedThreads = new Map((await this.present(threads, null)).map((row) => [row.id, row]));
    const messages = await this.presentAudit(page.items);
    return {
      ...page,
      items: messages.map((message) => ({ ...message, thread: presentedThreads.get(message.thread_id)! })),
    };
  }

  async hide(schoolId: number, messageId: number, reason: string, actor: AuthUser): Promise<AuditMessageDto> {
    const { message, thread } = await this.schoolMessage(schoolId, messageId);
    if (message.hidden_at) throw AppException.conflict('This message is already hidden', 'ALREADY_HIDDEN');
    const resolving = Boolean(message.flagged_at && !message.flag_resolved_at);
    Object.assign(message, {
      hidden_at: new Date(),
      hidden_by: actor.id,
      hidden_reason: reason,
      flag_resolved_at: resolving ? new Date() : message.flag_resolved_at,
    });
    await this.messages.save(message);
    if (resolving) await this.threads.decrement({ id: thread.id }, 'open_flags', 1);
    await this.log(thread, actor.id, 'hid_message', message.id, reason);
    const [member] = await this.presentMessages([message]);
    this.realtime.toUsers([thread.teacher_user_id, thread.parent_user_id], 'chat.updated', member);
    return (await this.presentAudit([message]))[0];
  }

  async unhide(schoolId: number, messageId: number, actor: AuthUser): Promise<AuditMessageDto> {
    const { message, thread } = await this.schoolMessage(schoolId, messageId);
    if (!message.hidden_at) throw AppException.conflict('This message is not hidden', 'NOT_HIDDEN');
    Object.assign(message, { hidden_at: null, hidden_by: null, hidden_reason: null });
    await this.messages.save(message);
    await this.log(thread, actor.id, 'unhid_message', message.id);
    const [member] = await this.presentMessages([message]);
    this.realtime.toUsers([thread.teacher_user_id, thread.parent_user_id], 'chat.updated', member);
    return (await this.presentAudit([message]))[0];
  }

  async dismissFlag(schoolId: number, messageId: number, actor: AuthUser): Promise<AuditMessageDto> {
    const { message, thread } = await this.schoolMessage(schoolId, messageId);
    if (!message.flagged_at || message.flag_resolved_at) {
      throw AppException.conflict('This message has no open report', 'NOT_FLAGGED');
    }
    message.flag_resolved_at = new Date();
    await this.messages.save(message);
    await this.threads.decrement({ id: thread.id }, 'open_flags', 1);
    await this.log(thread, actor.id, 'dismissed_flag', message.id);
    return (await this.presentAudit([message]))[0];
  }

  async insights(schoolId: number): Promise<ChatInsightsDto> {
    const today = zonedParts(new Date(), this.app.timeZone).date;
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*) AS threads,
              COUNT(*) FILTER (WHERE (t.last_message_at AT TIME ZONE $2)::date = $3::date) AS active_today,
              COALESCE(SUM(t.open_flags), 0) AS open_flags,
              (SELECT COUNT(*) FROM chat_messages m JOIN chat_threads x ON x.id = m.thread_id ${currentYearSql('x', 'cy2')}
               WHERE x.school_id = $1 AND (m.created_at AT TIME ZONE $2)::date = $3::date) AS messages_today,
              (SELECT COUNT(*) FROM chat_messages m JOIN chat_threads x ON x.id = m.thread_id ${currentYearSql('x', 'cy3')}
               WHERE x.school_id = $1 AND m.hidden_at IS NOT NULL) AS hidden,
              (SELECT COUNT(*) FROM chat_messages m JOIN chat_threads x ON x.id = m.thread_id ${currentYearSql('x', 'cy4')}
               WHERE x.school_id = $1 AND m.push_pending) AS held
       FROM chat_threads t ${currentYearSql('t')}
       WHERE t.school_id = $1 AND t.deleted_at IS NULL`,
      [schoolId, this.app.timeZone, today],
    );
    return {
      threads: Number(row.threads),
      active_today: Number(row.active_today),
      messages_today: Number(row.messages_today),
      open_flags: Number(row.open_flags),
      hidden: Number(row.hidden),
      held: Number(row.held),
    };
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'chat-office-hours' })
  async releaseHeld(now = new Date()): Promise<number> {
    const [rows] = (await this.dataSource
      .query(
        `UPDATE chat_messages SET push_pending = false, updated_at = now()
       WHERE push_pending = true AND push_after <= $1::timestamptz AND deleted_at IS NULL
       RETURNING id, thread_id, sender_user_id, body, file_id`,
        [now],
      )
      .catch((error: Error) => {
        this.logger.warn(`Held chat messages failed: ${error.message}`);
        return [[], 0];
      })) as [
      { id: number; thread_id: number; sender_user_id: number; body: string | null; file_id: number | null }[],
      number,
    ];
    const byThread = new Map<number, typeof rows>();
    rows.forEach((row) => byThread.set(Number(row.thread_id), [...(byThread.get(Number(row.thread_id)) ?? []), row]));
    for (const [threadId, list] of byThread) {
      const thread = await this.threads.findOneBy({ id: threadId });
      if (!thread) continue;
      const latest = list[list.length - 1]!;
      const [sender] = await this.dataSource.query(`SELECT name FROM users WHERE id = $1`, [latest.sender_user_id]);
      await this.pushMessage(
        thread,
        thread.teacher_user_id,
        sender?.name ?? 'Parent',
        messagePreview(latest.body, Boolean(latest.file_id)),
        list.length,
      );
    }
    return rows.length;
  }

  async officeHoursFor(schoolId: number, now = new Date()): Promise<OfficeHoursDto> {
    const hours = await this.schoolHours(schoolId);
    const today = zonedParts(now, this.app.timeZone).date;
    const holidays = await holidaySet(this.dataSource.manager, schoolId, today, addDays(today, LOOKAHEAD_DAYS));
    const status = officeStatus(now, this.app.timeZone, hours, holidays);
    return { start: hours.start, end: hours.end, open_now: status.open, next_open_at: status.next_open_at };
  }

  private async pushMessage(thread: ChatThread, recipient: number, sender: string, text: string, count: number) {
    await this.notifications
      .dispatch({
        template: TEMPLATES.CHAT_MESSAGE,
        audience: { user_ids: [recipient] },
        data: {
          sender,
          preview: count > 1 ? `${count} new messages. Latest: ${text}` : text,
          thread_id: String(thread.id),
        },
      })
      .catch((error: Error) => this.logger.warn(`Chat push for thread ${thread.id} failed: ${error.message}`));
  }

  private async findOrCreate(
    schoolId: number,
    teacherId: number,
    parentId: number,
    studentId: number,
    actorId: number,
  ): Promise<ChatThread> {
    const yearId = await currentYearId(this.dataSource.manager, schoolId);
    const where = {
      academic_year_id: yearId,
      teacher_user_id: teacherId,
      parent_user_id: parentId,
      student_id: studentId,
    };
    const existing = await this.threads.findOneBy(where);
    if (existing) return existing;
    await this.threads
      .createQueryBuilder()
      .insert()
      .into(ChatThread)
      .values({ ...where, school_id: schoolId, created_by: actorId })
      .orIgnore()
      .execute();
    return this.threads.findOneByOrFail(where);
  }

  private partyQuery(actor: AuthUser, party: ChatParty): SelectQueryBuilder<ChatThread> {
    const qb = this.threads.createQueryBuilder('t');
    if (party === 'teacher') {
      qb.where('t.teacher_user_id = :userId AND t.school_id = :schoolId', {
        userId: actor.id,
        schoolId: this.schoolOf(actor),
      });
    } else {
      qb.where('t.parent_user_id = :userId', { userId: actor.id });
    }
    return onlyCurrentYear(qb);
  }

  private async findForParty(actor: AuthUser, party: ChatParty, id: number): Promise<ChatThread> {
    const thread = await this.partyQuery(actor, party).andWhere('t.id = :id', { id }).getOne();
    if (!thread) throw AppException.notFound('Conversation not found', 'THREAD_NOT_FOUND');
    return thread;
  }

  private async visibleMessage(
    thread: ChatThread,
    party: ChatParty,
    viewerId: number,
    messageId: number,
  ): Promise<ChatMessage> {
    const cleared = party === 'teacher' ? thread.teacher_cleared_at : thread.parent_cleared_at;
    const message = await this.messages.findOneBy({ id: messageId, thread_id: thread.id });
    const [hidden] = message
      ? await this.dataSource.query(`SELECT 1 FROM chat_message_hides WHERE message_id = $1 AND user_id = $2`, [
          messageId,
          viewerId,
        ])
      : [];
    if (!message || hidden || (cleared && message.created_at <= cleared)) {
      throw AppException.notFound('Message not found', 'MESSAGE_NOT_FOUND');
    }
    return message;
  }

  private async refreshPreview(threadId: number): Promise<void> {
    const [latest] = await this.messages.find({ where: { thread_id: threadId }, order: { id: 'DESC' }, take: 1 });
    if (!latest) return;
    await this.threads.update(threadId, {
      last_message_preview: latest.deleted_for_all_at
        ? 'This message was deleted'
        : messagePreview(latest.body, Boolean(latest.file_id), latest.kind),
    });
  }

  private async schoolThread(schoolId: number, id: number): Promise<ChatThread> {
    const thread = await onlyCurrentYear(this.threads.createQueryBuilder('t'))
      .where('t.id = :id AND t.school_id = :schoolId', { id, schoolId })
      .getOne();
    if (!thread) throw AppException.notFound('Conversation not found', 'THREAD_NOT_FOUND');
    return thread;
  }

  private async schoolMessage(schoolId: number, messageId: number) {
    const message = await this.messages.findOneBy({ id: messageId, school_id: schoolId });
    if (!message) throw AppException.notFound('Message not found', 'MESSAGE_NOT_FOUND');
    return { message, thread: await this.schoolThread(schoolId, message.thread_id) };
  }

  private async log(
    thread: ChatThread,
    actorId: number,
    action: ChatAuditAction,
    messageId: number | null = null,
    note: string | null = null,
  ): Promise<void> {
    await this.audits.insert({
      school_id: thread.school_id,
      thread_id: thread.id,
      message_id: messageId,
      actor_user_id: actorId,
      action,
      note,
    });
  }

  private async schoolHours(schoolId: number): Promise<SchoolHours> {
    const [row] = await this.dataSource.query(
      `SELECT chat_office_start AS start, chat_office_end AS end FROM schools WHERE id = $1`,
      [schoolId],
    );
    return { start: row?.start ?? '08:00', end: row?.end ?? '17:00' };
  }

  private schoolOf(actor: AuthUser): number {
    if (!actor.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
    return actor.school_id;
  }

  private async users(ids: (number | null)[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids.filter((id): id is number => Boolean(id)))];
    if (!unique.length) return new Map();
    const rows: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT id, name FROM users WHERE id = ANY($1)`,
      [unique],
    );
    return new Map(rows.map((row) => [Number(row.id), row.name]));
  }

  private async presentMessages(rows: ChatMessage[], viewerId: number | null = null): Promise<ChatMessageDto[]> {
    if (!rows.length) return [];
    const gone = (row: ChatMessage) => Boolean(row.hidden_at || row.deleted_for_all_at);
    const [people, files] = await Promise.all([
      this.users(rows.map((row) => row.sender_user_id)),
      this.files.presentMany(rows.map((row) => (gone(row) ? null : row.file_id))),
    ]);
    return rows.map((row) => ({
      id: row.id,
      thread_id: row.thread_id,
      sender: { id: row.sender_user_id, name: people.get(row.sender_user_id) ?? '' },
      sender_party: row.sender_party,
      body: gone(row) ? null : row.body,
      file: gone(row) || !row.file_id ? null : (files.get(row.file_id) ?? null),
      sent_at: row.created_at,
      read_at: row.read_at,
      held_for_office_hours: row.push_pending,
      flagged: Boolean(row.flagged_at && !row.flag_resolved_at),
      hidden: Boolean(row.hidden_at),
      kind: row.kind ?? 'text',
      duration_seconds: row.duration_seconds ?? null,
      deleted: Boolean(row.deleted_for_all_at),
      deleted_at: row.deleted_for_all_at ?? null,
      can_delete_for_everyone:
        viewerId === row.sender_user_id && !row.deleted_for_all_at && canDeleteForEveryone(row.created_at),
      undo_until: viewerId !== null && row.deleted_for_all_by === viewerId ? undoUntil(row.deleted_for_all_at) : null,
    }));
  }

  private async presentAudit(rows: ChatMessage[]): Promise<AuditMessageDto[]> {
    if (!rows.length) return [];
    const hides: { message_id: number; user_id: number }[] = await this.dataSource.query(
      `SELECT message_id, user_id FROM chat_message_hides WHERE message_id = ANY($1)`,
      [rows.map((row) => row.id)],
    );
    const [base, people, files] = await Promise.all([
      this.presentMessages(rows),
      this.users([
        ...rows.flatMap((row) => [row.flagged_by, row.hidden_by, row.deleted_for_all_by]),
        ...hides.map((row) => Number(row.user_id)),
      ]),
      this.files.presentMany(rows.map((row) => row.file_id)),
    ]);
    const ref = (id: number | null) => (id ? { id, name: people.get(id) ?? '' } : null);
    return rows.map((row, index) => ({
      ...base[index]!,
      file: row.file_id ? (files.get(row.file_id) ?? null) : null,
      original_body: row.body,
      flag_reason: row.flag_reason,
      flagged_by: ref(row.flagged_by),
      flagged_at: row.flagged_at,
      flag_resolved_at: row.flag_resolved_at,
      hidden_by: ref(row.hidden_by),
      hidden_reason: row.hidden_reason,
      deleted_by: ref(row.deleted_for_all_by),
      deleted_for_me_by: hides
        .filter((hide) => Number(hide.message_id) === row.id)
        .map((hide) => ref(Number(hide.user_id))!),
    }));
  }

  private async present(rows: ChatThread[], viewerId: number | null): Promise<ChatThreadDto[]> {
    if (!rows.length) return [];
    const studentIds = [...new Set(rows.map((row) => row.student_id))];
    const [people, students, relations, years, hours] = await Promise.all([
      this.users(rows.flatMap((row) => [row.teacher_user_id, row.parent_user_id])),
      this.dataSource.query(
        `SELECT s.id, concat_ws(' ', s.first_name, s.last_name) AS name, c.name AS class_name, sec.name AS section_name
         FROM students s
         LEFT JOIN academic_years y ON y.school_id = s.school_id AND y.is_current AND y.deleted_at IS NULL
         LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = y.id
         LEFT JOIN classes c ON c.id = e.class_id LEFT JOIN sections sec ON sec.id = e.section_id
         WHERE s.id = ANY($1)`,
        [studentIds],
      ) as Promise<{ id: number; name: string; class_name: string | null; section_name: string | null }[]>,
      this.dataSource.query(
        `SELECT sg.student_id, g.user_id, sg.relation FROM student_guardians sg
         JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = ANY($1) AND g.user_id IS NOT NULL`,
        [studentIds],
      ) as Promise<{ student_id: number; user_id: number; relation: string }[]>,
      this.dataSource.query(`SELECT id, name FROM academic_years WHERE id = ANY($1)`, [
        [...new Set(rows.map((row) => row.academic_year_id))],
      ]) as Promise<{ id: number; name: string }[]>,
      Promise.all(
        [...new Set(rows.map((row) => row.school_id))].map(async (id) => [id, await this.officeHoursFor(id)] as const),
      ),
    ]);
    const studentMap = new Map(students.map((row) => [Number(row.id), row]));
    const relationMap = new Map(relations.map((row) => [`${row.student_id}:${row.user_id}`, row.relation]));
    const yearMap = new Map(years.map((row) => [Number(row.id), row.name]));
    const hoursMap = new Map(hours);
    return rows.map((row) => {
      const student = studentMap.get(row.student_id);
      const teacher = {
        id: row.teacher_user_id,
        name: people.get(row.teacher_user_id) ?? '',
        role: 'teacher' as const,
        label: 'Teacher',
      };
      const parent = {
        id: row.parent_user_id,
        name: people.get(row.parent_user_id) ?? '',
        role: 'parent' as const,
        label: relationMap.get(`${row.student_id}:${row.parent_user_id}`) ?? 'Parent',
      };
      const viewerIsTeacher = viewerId === row.teacher_user_id;
      return {
        id: row.id,
        teacher,
        parent,
        other: viewerIsTeacher ? parent : teacher,
        student: { id: row.student_id, name: student?.name ?? '' },
        class_section: student?.class_name
          ? [student.class_name, student.section_name].filter(Boolean).join(' - ')
          : null,
        last_message_at: row.last_message_at,
        last_message_preview: clearedFor(row, viewerId) ? null : row.last_message_preview,
        unread:
          viewerId === null
            ? row.teacher_unread + row.parent_unread
            : viewerIsTeacher
              ? row.teacher_unread
              : row.parent_unread,
        message_count: row.message_count,
        open_flags: row.open_flags,
        office_hours: hoursMap.get(row.school_id)!,
        academic_year: { id: row.academic_year_id, name: yearMap.get(row.academic_year_id) ?? '' },
        archived: Boolean(row.deleted_at),
      };
    });
  }
}

function clearedFor(thread: ChatThread, viewerId: number | null): boolean {
  if (viewerId === null || !thread.last_message_at) return false;
  const cleared = viewerId === thread.teacher_user_id ? thread.teacher_cleared_at : thread.parent_cleared_at;
  return Boolean(cleared && thread.last_message_at <= cleared);
}
