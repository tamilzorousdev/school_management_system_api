import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { AppException, AuthUser, listQuery, offset, paginate, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { currentYearId, currentYearSql, onlyCurrentYear } from '../../shared/academic-year';
import { todayIn } from '../../shared/dates';
import { parentsOfStudent, teachersOfStudent } from '../../shared/student-contacts';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AssignmentsService } from '../staff/assignments.service';
import { agoraSignatureValid, AgoraTokenService } from './agora-token.service';
import {
  CancelMeetingDto,
  ExtendMeetingDto,
  JoinMeetingDto,
  MeetingCallLogDto,
  MeetingDetailDto,
  MeetingDto,
  MeetingInsightsDto,
  MeetingJoinDto,
  MeetingParentOptionDto,
  MeetingQueryDto,
  MeetingTeacherOptionDto,
  MobileMeetingQueryDto,
  ParentMeetingInputDto,
  TeacherMeetingInputDto,
  RespondMeetingDto,
} from './dto/meeting.dto';
import { MeetingCallLog } from './entities/meeting-call-log.entity';
import { Meeting, MeetingParty, MeetingResponse, MeetingStatus } from './entities/meeting.entity';
import { replyError } from './meeting-reply';
import {
  CallCancelReason,
  callerLeft,
  callPayload,
  canReject,
  joinOutcome,
  newCallId,
  otherParty,
  RING_TIMEOUT_SECONDS,
} from './meeting-ring';
import { agoraUid, participantOf } from './meeting-uid';
import {
  ACTIVE_STATUSES,
  actualMinutes,
  AGORA_JOIN_EVENTS,
  AGORA_LEAVE_EVENTS,
  AGORA_LEAVE_REASONS,
  canJoin,
  channelName,
  EMPTY_CLOSE_MINUTES,
  END_REMINDER_MINUTES,
  endsAt,
  enterBlockReason,
  extendedEnd,
  extensionError,
  formatMeetingTime,
  HARD_STOP_MINUTES,
  joinClosesAt,
  joinOpensAt,
  minutesBetween,
  NO_SHOW_GRACE_MINUTES,
  OPEN_STATUSES,
  scheduleError,
  START_REMINDER_MINUTES,
  statusAfterJoin,
} from './meetings.logic';

const DEFAULT_DURATION = 15;

interface NewMeeting {
  schoolId: number;
  studentId: number;
  teacherUserId: number;
  parentUserId: number;
  scheduledBy: MeetingParty;
  dto: TeacherMeetingInputDto | ParentMeetingInputDto;
  actor: AuthUser;
}

interface StudentRow {
  id: number;
  name: string;
  class_name: string | null;
  section_name: string | null;
}

interface AgoraNotice {
  noticeId?: string;
  productId?: number;
  eventType?: number;
  payload?: {
    channelName?: string;
    uid?: number;
    ts?: number;
    clientSeq?: number;
    reason?: number;
    platform?: number;
  };
}

const AGORA_PLATFORMS: Record<number, string> = { 1: 'android', 2: 'ios', 5: 'windows', 6: 'linux', 7: 'web' };

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger('Meetings');

  constructor(
    @InjectRepository(Meeting) private readonly meetings: Repository<Meeting>,
    @InjectRepository(MeetingCallLog) private readonly logs: Repository<MeetingCallLog>,
    private readonly agora: AgoraTokenService,
    private readonly assignments: AssignmentsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async scheduleByTeacher(actor: AuthUser, dto: TeacherMeetingInputDto): Promise<MeetingDto> {
    const schoolId = this.teacherSchool(actor);
    await this.assignments.assertTeachesStudent(schoolId, actor.id, dto.student_id);
    const parents = await this.parentsForStudent(schoolId, dto.student_id);
    if (!parents.length) {
      throw AppException.conflict('No parent of this student has the app yet', 'NO_PARENT_ACCOUNT');
    }
    const parent = dto.parent_user_id ? parents.find((item) => item.id === dto.parent_user_id) : parents[0];
    if (!parent) {
      throw AppException.validation([
        { field: 'parent_user_id', message: 'This person is not a parent of the student with the app' },
      ]);
    }
    return this.create({
      schoolId,
      studentId: dto.student_id,
      teacherUserId: actor.id,
      parentUserId: parent.id,
      scheduledBy: 'teacher',
      dto,
      actor,
    });
  }

  async scheduleByParent(
    schoolId: number,
    studentId: number,
    dto: ParentMeetingInputDto,
    actor: AuthUser,
  ): Promise<MeetingDto> {
    const teachers = await this.teachersForStudent(schoolId, studentId);
    if (!teachers.some((teacher) => teacher.id === dto.teacher_user_id)) {
      throw AppException.validation([{ field: 'teacher_user_id', message: 'This teacher does not teach your child' }]);
    }
    return this.create({
      schoolId,
      studentId,
      teacherUserId: dto.teacher_user_id,
      parentUserId: actor.id,
      scheduledBy: 'parent',
      dto,
      actor,
    });
  }

  async listForParty(
    actor: AuthUser,
    party: MeetingParty,
    query: MobileMeetingQueryDto,
  ): Promise<Paginated<MeetingDto>> {
    const qb = this.partyQuery(actor, party);
    if (query.student_id) qb.andWhere('m.student_id = :studentId', { studentId: query.student_id });
    if (query.scope === 'upcoming') {
      qb.andWhere('m.status IN (:...open)', { open: OPEN_STATUSES }).orderBy('m.scheduled_at', 'ASC');
    } else if (query.scope === 'past') {
      qb.andWhere('m.status NOT IN (:...open)', { open: OPEN_STATUSES }).orderBy('m.scheduled_at', 'DESC');
    } else {
      qb.orderBy('m.scheduled_at', 'DESC');
    }
    qb.addOrderBy('m.id', 'DESC').skip(offset(query.page, query.limit)).take(query.limit);
    const page = paginate(await qb.getManyAndCount(), query.page, query.limit);
    return { ...page, items: await this.present(page.items) };
  }

  async getForParty(actor: AuthUser, party: MeetingParty, id: number): Promise<MeetingDetailDto> {
    return this.withCallLog(await this.findForParty(actor, party, id));
  }

  async join(actor: AuthUser, party: MeetingParty, id: number, dto: JoinMeetingDto): Promise<MeetingJoinDto> {
    const meeting = await this.findForParty(actor, party, id);
    const now = new Date();
    this.assertJoinable(meeting, now);
    const grant = this.agora.issue(meeting.channel_name, agoraUid(actor.id, party), now);
    const before = meeting.status;
    const saved = await this.dataSource.transaction(async (manager) => {
      meeting.status = statusAfterJoin(meeting.status, meeting.scheduled_end_at, now);
      meeting.started_at ??= now;
      await this.closeOpenLogs(manager, meeting.id, now, actor.id, 'rejoined');
      await manager.save(
        manager.create(MeetingCallLog, {
          school_id: meeting.school_id,
          meeting_id: meeting.id,
          user_id: actor.id,
          party,
          platform: dto.platform ?? 'android',
          source: 'app',
          joined_at: now,
        }),
      );
      return manager.save(meeting);
    });
    if (before !== saved.status) this.announceStatus(saved, actor.id);
    this.realtime.toUsers(this.members(saved), 'meeting.participant', {
      meeting_id: saved.id,
      user_id: actor.id,
      party,
      action: 'joined',
    });
    this.later(`ring for meeting ${saved.id}`, () => this.ringOnJoin(saved, actor, party));
    return this.grantResponse(saved, actor, party, grant);
  }

  async rejectCall(actor: AuthUser, party: MeetingParty, id: number): Promise<MeetingDto> {
    const meeting = await this.findForParty(actor, party, id);
    if (canReject(meeting, party)) await this.stopRing(meeting.id, 'declined');
    return (await this.present([await this.meetings.findOneByOrFail({ id: meeting.id })]))[0];
  }

  async renewToken(actor: AuthUser, party: MeetingParty, id: number): Promise<MeetingJoinDto> {
    const meeting = await this.findForParty(actor, party, id);
    const now = new Date();
    this.assertJoinable(meeting, now);
    return this.grantResponse(
      meeting,
      actor,
      party,
      this.agora.issue(meeting.channel_name, agoraUid(actor.id, party), now),
    );
  }

  async leave(actor: AuthUser, party: MeetingParty, id: number): Promise<MeetingDto> {
    const meeting = await this.findForParty(actor, party, id);
    const now = new Date();
    await this.closeOpenLogs(this.dataSource.manager, meeting.id, now, actor.id, 'left');
    if (callerLeft(meeting, party))
      this.later(`ring stop ${meeting.id}`, () => this.stopRing(meeting.id, 'caller_left'));
    this.realtime.toUsers(this.members(meeting), 'meeting.participant', {
      meeting_id: meeting.id,
      user_id: actor.id,
      party,
      action: 'left',
    });
    const [closed] = await this.transition(
      `id = $2 AND status IN ('in_progress', 'time_exceeded')
       AND NOT EXISTS (SELECT 1 FROM meeting_call_logs l WHERE l.meeting_id = meetings.id AND l.left_at IS NULL)`,
      `status = 'completed', end_reason = 'empty', ended_at = $1::timestamptz`,
      [now, meeting.id],
    );
    if (closed) {
      this.announceStatus(closed, actor.id);
      this.later(`ring stop ${closed.id}`, () => this.stopRing(closed.id, 'ended'));
      return (await this.present([closed]))[0];
    }
    return (await this.present([meeting]))[0];
  }

  async extend(actor: AuthUser, id: number, dto: ExtendMeetingDto): Promise<MeetingDto> {
    const meeting = await this.findForParty(actor, 'teacher', id);
    if (!ACTIVE_STATUSES.includes(meeting.status)) {
      throw AppException.conflict('Only a meeting in progress can be extended', 'MEETING_NOT_LIVE');
    }
    const tooLong = extensionError(meeting.extended_minutes, dto.minutes);
    if (tooLong) throw AppException.validation([{ field: 'minutes', message: tooLong }]);
    const now = new Date();
    Object.assign(meeting, {
      scheduled_end_at: extendedEnd(meeting.scheduled_end_at, dto.minutes, now),
      extended_minutes: meeting.extended_minutes + dto.minutes,
      extended_at: now,
      extended_by: actor.id,
      status: 'in_progress' as MeetingStatus,
      end_reminder_sent_at: null,
    });
    const saved = await this.meetings.save(meeting);
    this.announceStatus(saved, actor.id);
    return (await this.present([saved]))[0];
  }

  async end(actor: AuthUser, id: number): Promise<MeetingDto> {
    const meeting = await this.findForParty(actor, 'teacher', id);
    if (!ACTIVE_STATUSES.includes(meeting.status)) {
      throw AppException.conflict(
        meeting.status === 'scheduled'
          ? 'Nobody has joined yet. Cancel the meeting instead.'
          : `This meeting is already ${meeting.status}`,
        'MEETING_NOT_LIVE',
      );
    }
    const now = new Date();
    const saved = await this.dataSource.transaction(async (manager) => {
      Object.assign(meeting, { status: 'completed', ended_at: now, ended_by: actor.id, end_reason: 'host_ended' });
      await this.closeOpenLogs(manager, meeting.id, now, undefined, 'meeting_ended');
      return manager.save(meeting);
    });
    this.announceStatus(saved, actor.id);
    this.later(`ring stop ${saved.id}`, () => this.stopRing(saved.id, 'ended'));
    const kicked = await this.agora.endChannel(saved.channel_name);
    if (kicked.rule_id) {
      await this.meetings.update(saved.id, { agora_kick_rule_id: kicked.rule_id });
      saved.agora_kick_rule_id = kicked.rule_id;
    }
    return (await this.present([saved]))[0];
  }

  async respond(
    actor: AuthUser,
    party: MeetingParty,
    id: number,
    answer: Exclude<MeetingResponse, 'pending'>,
    dto: RespondMeetingDto,
  ): Promise<MeetingDto> {
    const meeting = await this.findForParty(actor, party, id);
    replyError(meeting, party);
    Object.assign(meeting, { response: answer, responded_at: new Date(), response_note: dto.note ?? null });
    const saved = await this.meetings.save(meeting);
    const [presented] = await this.present([saved]);
    this.announceStatus(saved, actor.id);
    await this.notify(
      answer === 'accepted' ? TEMPLATES.MEETING_ACCEPTED : TEMPLATES.MEETING_DECLINED,
      presented.from.id,
      {
        by: actor.name,
        student: presented.student.name,
        time: formatMeetingTime(saved.scheduled_at, this.app.timeZone),
        title: saved.title,
        note: dto.note ? ` Note: ${dto.note}` : '',
      },
      saved,
    );
    return presented;
  }

  async cancel(actor: AuthUser, party: MeetingParty, id: number, dto: CancelMeetingDto): Promise<MeetingDto> {
    const meeting = await this.findForParty(actor, party, id);
    if (meeting.status !== 'scheduled') {
      throw AppException.conflict(
        `Only a meeting that has not started can be cancelled. This one is ${meeting.status}.`,
        'MEETING_NOT_CANCELLABLE',
      );
    }
    Object.assign(meeting, { status: 'cancelled', cancelled_by: actor.id, cancel_reason: dto.reason ?? null });
    const saved = await this.meetings.save(meeting);
    const [presented] = await this.present([saved]);
    const other = party === 'teacher' ? presented.parent : presented.teacher;
    this.announceStatus(saved, actor.id);
    await this.notify(
      TEMPLATES.MEETING_CANCELLED,
      other.id,
      {
        by: actor.name,
        student: presented.student.name,
        time: formatMeetingTime(saved.scheduled_at, this.app.timeZone),
        title: saved.title,
        reason: dto.reason ? ` Reason: ${dto.reason}` : '',
      },
      saved,
    );
    return presented;
  }

  teachersForStudent(schoolId: number, studentId: number): Promise<MeetingTeacherOptionDto[]> {
    return teachersOfStudent(this.dataSource.manager, schoolId, studentId);
  }

  parentsForStudent(schoolId: number, studentId: number): Promise<MeetingParentOptionDto[]> {
    return parentsOfStudent(this.dataSource.manager, schoolId, studentId);
  }

  async list(schoolId: number, query: MeetingQueryDto): Promise<Paginated<MeetingDto>> {
    const qb = onlyCurrentYear(
      this.meetings
        .createQueryBuilder('m')
        .innerJoin('users', 't', 't.id = m.teacher_user_id')
        .innerJoin('users', 'p', 'p.id = m.parent_user_id')
        .innerJoin('students', 's', 's.id = m.student_id')
        .where('m.school_id = :schoolId', { schoolId }),
    );
    if (query.status) qb.andWhere('m.status = :status', { status: query.status });
    if (query.scheduled_by) qb.andWhere('m.scheduled_by = :by', { by: query.scheduled_by });
    if (query.teacher_user_id) qb.andWhere('m.teacher_user_id = :teacher', { teacher: query.teacher_user_id });
    if (query.student_id) qb.andWhere('m.student_id = :student', { student: query.student_id });
    if (query.guardian_id) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM guardians g WHERE g.id = :guardian AND g.school_id = m.school_id AND g.user_id = m.parent_user_id)',
        { guardian: query.guardian_id },
      );
    }
    if (query.date_from) {
      qb.andWhere('(m.scheduled_at AT TIME ZONE :tz)::date >= :from', { tz: this.app.timeZone, from: query.date_from });
    }
    if (query.date_to) {
      qb.andWhere('(m.scheduled_at AT TIME ZONE :tz)::date <= :to', { tz: this.app.timeZone, to: query.date_to });
    }
    if (query.when === 'today') {
      qb.andWhere('(m.scheduled_at AT TIME ZONE :tz)::date = :today', {
        tz: this.app.timeZone,
        today: todayIn(this.app.timeZone),
      });
    } else if (query.when === 'upcoming') {
      qb.andWhere("m.status = 'scheduled' AND m.scheduled_at >= now()");
    } else if (query.when === 'past') {
      qb.andWhere('m.status NOT IN (:...open)', { open: OPEN_STATUSES });
    }
    const page = await listQuery(qb, query.sort ? query : { ...query, sort: 'scheduled_at', order: 'desc' }, {
      searchable: ['m.title', 't.name', 'p.name', 's.first_name', 's.last_name', 's.admission_no'],
      sortable: {
        scheduled_at: 'm.scheduled_at',
        created_at: 'm.created_at',
        status: 'm.status',
        title: 'm.title',
      },
      defaultSort: 'scheduled_at',
    });
    return { ...page, items: await this.present(page.items) };
  }

  async insights(schoolId: number): Promise<MeetingInsightsDto> {
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE (m.scheduled_at AT TIME ZONE $2)::date = $3::date) AS today,
              COUNT(*) FILTER (WHERE m.status = 'scheduled' AND m.scheduled_at >= now()) AS upcoming,
              COUNT(*) FILTER (WHERE m.status IN ('in_progress', 'time_exceeded')) AS live,
              COUNT(*) FILTER (WHERE m.status = 'time_exceeded') AS time_exceeded,
              COUNT(*) FILTER (WHERE m.status = 'completed') AS completed,
              COUNT(*) FILTER (WHERE m.status = 'missed') AS missed,
              COUNT(*) FILTER (WHERE m.status = 'cancelled') AS cancelled
       FROM meetings m ${currentYearSql('m')}
       WHERE m.school_id = $1 AND m.deleted_at IS NULL`,
      [schoolId, this.app.timeZone, todayIn(this.app.timeZone)],
    );
    return {
      total: Number(row.total),
      today: Number(row.today),
      upcoming: Number(row.upcoming),
      live: Number(row.live),
      time_exceeded: Number(row.time_exceeded),
      completed: Number(row.completed),
      missed: Number(row.missed),
      cancelled: Number(row.cancelled),
    };
  }

  async detail(schoolId: number, id: number): Promise<MeetingDetailDto> {
    const meeting = await onlyCurrentYear(this.meetings.createQueryBuilder('m'))
      .where('m.id = :id AND m.school_id = :schoolId', { id, schoolId })
      .getOne();
    if (!meeting) throw AppException.notFound('Meeting not found', 'MEETING_NOT_FOUND');
    return this.withCallLog(meeting);
  }

  async receiveAgoraEvent(rawBody: Buffer | undefined, signature: string | undefined): Promise<{ ok: true }> {
    if (!this.agora.webhookSecret) {
      throw AppException.unavailable('Agora notifications are switched off', 'AGORA_WEBHOOK_OFF');
    }
    if (!rawBody || !agoraSignatureValid(rawBody, signature, this.agora.webhookSecret)) {
      throw AppException.unauthorized('Signature is missing or wrong', 'SIGNATURE_INVALID');
    }
    let notice: AgoraNotice;
    try {
      notice = JSON.parse(rawBody.toString('utf8')) as AgoraNotice;
    } catch {
      throw AppException.badRequest('Body is not JSON', 'VALIDATION_FAILED');
    }
    await this.applyAgoraEvent(notice);
    return { ok: true };
  }

  async applyAgoraEvent(notice: AgoraNotice): Promise<void> {
    const type = Number(notice.eventType);
    const payload = notice.payload ?? {};
    const joining = AGORA_JOIN_EVENTS.includes(type);
    const leaving = AGORA_LEAVE_EVENTS.includes(type);
    if (!joining && !leaving) return;
    if (!payload.channelName || !payload.uid) return;
    const meeting = await this.meetings.findOneBy({ channel_name: payload.channelName });
    if (!meeting) return;
    const participant = participantOf(meeting, payload.uid);
    if (!participant) {
      this.logger.warn(`Agora: uid ${payload.uid} is not a participant of meeting ${meeting.id}`);
      return;
    }
    const { user_id: userId, party } = participant;
    const at = payload.ts ? new Date(payload.ts * 1000) : new Date();
    const seq = payload.clientSeq !== undefined ? String(payload.clientSeq) : null;
    const open = await this.logs.findOne({
      where: { meeting_id: meeting.id, user_id: userId, left_at: IsNull() },
      order: { joined_at: 'DESC' },
    });
    if (joining && meeting.ring_to === party) {
      this.later(`ring stop ${meeting.id}`, () => this.stopRing(meeting.id, 'answered'));
    }
    if (leaving && callerLeft(meeting, party)) {
      this.later(`ring stop ${meeting.id}`, () => this.stopRing(meeting.id, 'caller_left'));
    }
    if (joining) {
      if (open) {
        if (!open.confirmed_at) await this.logs.update(open.id, { confirmed_at: at, client_seq: seq });
        return;
      }
      const duplicate = seq
        ? await this.logs.findOneBy({ meeting_id: meeting.id, user_id: userId, client_seq: seq })
        : null;
      if (duplicate) return;
      await this.logs.save(
        this.logs.create({
          school_id: meeting.school_id,
          meeting_id: meeting.id,
          user_id: userId,
          party,
          platform: AGORA_PLATFORMS[Number(payload.platform)] ?? 'other',
          source: 'agora',
          joined_at: at,
          confirmed_at: at,
          client_seq: seq,
        }),
      );
      return;
    }
    if (!open) return;
    if (seq && open.client_seq && BigInt(seq) < BigInt(open.client_seq)) return;
    await this.logs.update(open.id, {
      left_at: at,
      leave_reason: AGORA_LEAVE_REASONS[Number(payload.reason)] ?? 'other',
    });
    this.realtime.toUsers(this.members(meeting), 'meeting.participant', {
      meeting_id: meeting.id,
      user_id: userId,
      party,
      action: 'left',
    });
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'meeting-lifecycle' })
  async tick(): Promise<void> {
    const now = new Date();
    for (const [name, step] of [
      ['start reminders', () => this.sendStartReminders(now)],
      ['over time', () => this.markOverTime(now)],
      ['end reminders', () => this.sendEndReminders(now)],
      ['no-shows', () => this.markMissed(now)],
      ['empty meetings', () => this.closeEmpty(now)],
      ['time up', () => this.closeTimeUp(now)],
      ['ring timeouts', () => this.stopExpiredRings(now)],
    ] as const) {
      await step().catch((error: Error) => this.logger.warn(`${name} failed: ${error.message}`));
    }
  }

  async sendStartReminders(now: Date): Promise<number> {
    const due = await this.claim(
      'reminder_sent_at',
      "status = 'scheduled' AND reminder_sent_at IS NULL AND scheduled_at <= :soon AND scheduled_at > :late",
      {
        soon: new Date(now.getTime() + START_REMINDER_MINUTES * 60_000),
        late: new Date(now.getTime() - START_REMINDER_MINUTES * 60_000),
      },
      now,
    );
    for (const meeting of due) {
      const [presented] = await this.present([meeting]);
      const time = formatMeetingTime(meeting.scheduled_at, this.app.timeZone);
      await this.notify(
        TEMPLATES.MEETING_REMINDER,
        presented.parent.id,
        { host: presented.teacher.name, student: presented.student.name, time },
        meeting,
      );
      await this.notify(
        TEMPLATES.MEETING_REMINDER,
        presented.teacher.id,
        { host: presented.parent.name, student: presented.student.name, time },
        meeting,
      );
      this.realtime.toUsers(this.members(meeting), 'meeting.reminder', {
        meeting_id: meeting.id,
        kind: 'start',
        starts_at: meeting.scheduled_at,
      });
    }
    return due.length;
  }

  async sendEndReminders(now: Date): Promise<number> {
    const due = await this.claim(
      'end_reminder_sent_at',
      "status = 'in_progress' AND end_reminder_sent_at IS NULL AND scheduled_end_at <= :soon AND scheduled_end_at > :now",
      { soon: new Date(now.getTime() + END_REMINDER_MINUTES * 60_000), now },
      now,
    );
    for (const meeting of due) {
      const [presented] = await this.present([meeting]);
      const time = formatMeetingTime(meeting.scheduled_end_at, this.app.timeZone);
      for (const [userId, other] of [
        [presented.parent.id, presented.teacher.name],
        [presented.teacher.id, presented.parent.name],
      ] as const) {
        await this.notify(
          TEMPLATES.MEETING_ENDING,
          userId,
          {
            host: other,
            student: presented.student.name,
            minutes: String(END_REMINDER_MINUTES),
            time,
          },
          meeting,
        );
      }
      this.realtime.toUsers(this.members(meeting), 'meeting.reminder', {
        meeting_id: meeting.id,
        kind: 'ending',
        minutes_left: END_REMINDER_MINUTES,
        ends_at: meeting.scheduled_end_at,
      });
    }
    return due.length;
  }

  async markOverTime(now: Date): Promise<number> {
    const changed = await this.transition(
      "status = 'in_progress' AND scheduled_end_at <= $1::timestamptz",
      "status = 'time_exceeded'",
      [now],
    );
    changed.forEach((meeting) => this.announceStatus(meeting, null));
    return changed.length;
  }

  async markMissed(now: Date): Promise<number> {
    const changed = await this.transition(
      "status = 'scheduled' AND scheduled_end_at + make_interval(mins => $2::int) < $1::timestamptz",
      "status = 'missed'",
      [now, NO_SHOW_GRACE_MINUTES],
    );
    changed.forEach((meeting) => this.announceStatus(meeting, null));
    return changed.length;
  }

  async closeEmpty(now: Date): Promise<number> {
    const changed = await this.transition(
      `status IN ('in_progress', 'time_exceeded')
       AND NOT EXISTS (SELECT 1 FROM meeting_call_logs l WHERE l.meeting_id = meetings.id AND l.left_at IS NULL)
       AND COALESCE((SELECT MAX(l.left_at) FROM meeting_call_logs l WHERE l.meeting_id = meetings.id), started_at, scheduled_at)
           <= $1::timestamptz - make_interval(mins => $2::int)`,
      `status = 'completed', end_reason = 'empty',
       ended_at = COALESCE((SELECT MAX(l.left_at) FROM meeting_call_logs l WHERE l.meeting_id = meetings.id), $1::timestamptz)`,
      [now, EMPTY_CLOSE_MINUTES],
    );
    for (const meeting of changed) {
      this.announceStatus(meeting, null);
      await this.stopRing(meeting.id, 'ended');
    }
    return changed.length;
  }

  async closeTimeUp(now: Date): Promise<number> {
    const changed = await this.transition(
      `status IN ('in_progress', 'time_exceeded')
       AND scheduled_end_at + make_interval(mins => $2::int) < $1::timestamptz`,
      `status = 'completed', end_reason = 'time_up', ended_at = $1::timestamptz`,
      [now, HARD_STOP_MINUTES],
    );
    for (const meeting of changed) {
      await this.closeOpenLogs(this.dataSource.manager, meeting.id, now, undefined, 'meeting_ended');
      this.announceStatus(meeting, null);
      await this.stopRing(meeting.id, 'ended');
      const kicked = await this.agora.endChannel(meeting.channel_name).catch(() => ({ rule_id: null }));
      if (kicked.rule_id) await this.meetings.update(meeting.id, { agora_kick_rule_id: kicked.rule_id });
    }
    return changed.length;
  }

  async stopExpiredRings(now: Date): Promise<number> {
    const rows: { id: number }[] = await this.dataSource.query(
      `SELECT id FROM meetings
       WHERE ring_call_id IS NOT NULL AND ring_started_at <= $1::timestamptz - make_interval(secs => $2::int)`,
      [now, RING_TIMEOUT_SECONDS],
    );
    for (const row of rows) await this.stopRing(Number(row.id), 'timeout');
    return rows.length;
  }

  private async ringOnJoin(meeting: Meeting, actor: AuthUser, party: MeetingParty): Promise<void> {
    const other = otherParty(party);
    const otherUserId = Number(other === 'teacher' ? meeting.teacher_user_id : meeting.parent_user_id);
    const otherInCall = await this.logs.exists({
      where: { meeting_id: meeting.id, user_id: otherUserId, party: other, left_at: IsNull() },
    });
    const outcome = joinOutcome(meeting, party, otherInCall);
    if (outcome === 'answer') {
      await this.stopRing(meeting.id, 'answered');
      return;
    }
    if (outcome !== 'ring') return;
    const callId = newCallId();
    const [claimed] = (await this.dataSource.query(
      `UPDATE meetings SET ring_call_id = $2, ring_to = $3, ring_by = $4, ring_started_at = now()
       WHERE id = $1 AND ring_call_id IS NULL RETURNING id`,
      [meeting.id, callId, other, actor.id],
    )) as [{ id: number }[], number];
    if (!claimed.length) return;
    const call = await this.callDetails(meeting, callId, party);
    this.realtime.toUsers(this.members(meeting), 'meeting.call', callPayload('ring', call));
    await this.notifications.sendCallPush(otherUserId, callPayload('ring', call), RING_TIMEOUT_SECONDS);
    setTimeout(() => {
      this.later(`ring timeout ${meeting.id}`, () => this.stopRing(meeting.id, 'timeout', callId));
    }, RING_TIMEOUT_SECONDS * 1000).unref();
  }

  private async stopRing(meetingId: number, reason: CallCancelReason, callId?: string): Promise<void> {
    const [rows] = (await this.dataSource.query(
      `UPDATE meetings m SET ring_call_id = NULL, ring_to = NULL, ring_by = NULL, ring_started_at = NULL
       FROM (SELECT id, ring_call_id, ring_to, ring_by FROM meetings
             WHERE id = $1 AND ring_call_id IS NOT NULL AND ($2::varchar IS NULL OR ring_call_id = $2::varchar)
             FOR UPDATE) old
       WHERE m.id = old.id
       RETURNING old.ring_call_id, old.ring_to, old.ring_by`,
      [meetingId, callId ?? null],
    )) as [{ ring_call_id: string; ring_to: MeetingParty; ring_by: number }[], number];
    const stopped = rows[0];
    if (!stopped) return;
    const meeting = await this.meetings.findOneByOrFail({ id: meetingId });
    const call = await this.callDetails(meeting, stopped.ring_call_id, otherParty(stopped.ring_to));
    const payload = callPayload('cancel', call, reason);
    this.realtime.toUsers(this.members(meeting), 'meeting.call', payload);
    const ringingUser = Number(stopped.ring_to === 'teacher' ? meeting.teacher_user_id : meeting.parent_user_id);
    await this.notifications.sendCallPush(ringingUser, payload, RING_TIMEOUT_SECONDS);
  }

  private async callDetails(meeting: Meeting, callId: string, callerRole: MeetingParty) {
    const [presented] = await this.present([meeting]);
    return {
      call_id: callId,
      meeting_id: meeting.id,
      channel_name: meeting.channel_name,
      caller_name: (callerRole === 'teacher' ? presented.teacher : presented.parent).name,
      caller_role: callerRole,
      student_name: presented.student.name,
    };
  }

  private later(label: string, work: () => Promise<void>): void {
    void work().catch((error: Error) => this.logger.warn(`${label} failed: ${error.message}`));
  }

  private async transition(where: string, set: string, params: unknown[]): Promise<Meeting[]> {
    const [rows] = (await this.dataSource.query(
      `UPDATE meetings SET ${set}, updated_at = now()
       WHERE deleted_at IS NULL AND ${where}
       RETURNING *`,
      params,
    )) as [Meeting[], number];
    return rows.map((row) => this.meetings.create(row));
  }

  private async claim(
    column: 'reminder_sent_at' | 'end_reminder_sent_at',
    where: string,
    params: Record<string, unknown>,
    now: Date,
  ): Promise<Meeting[]> {
    return this.meetings
      .createQueryBuilder()
      .update(Meeting)
      .set({ [column]: now })
      .where(`deleted_at IS NULL AND ${where}`, params)
      .returning('*')
      .execute()
      .then((result) => (result.raw as Meeting[]).map((row) => this.meetings.create(row)));
  }

  private async create(input: NewMeeting): Promise<MeetingDto> {
    const now = new Date();
    const scheduledAt = new Date(input.dto.scheduled_at);
    const error = scheduleError(scheduledAt, now);
    if (error) throw AppException.validation([error]);
    const duration = input.dto.duration_minutes ?? DEFAULT_DURATION;
    const academicYearId = await currentYearId(this.dataSource.manager, input.schoolId);
    const [clash] = await this.dataSource.query(
      `SELECT id FROM meetings
       WHERE deleted_at IS NULL AND status IN ('scheduled', 'in_progress', 'time_exceeded')
         AND response <> 'declined'
         AND (teacher_user_id = $1 OR parent_user_id = $2)
         AND scheduled_at < $4 AND scheduled_end_at > $3
       LIMIT 1`,
      [input.teacherUserId, input.parentUserId, scheduledAt, endsAt(scheduledAt, duration)],
    );
    if (clash) {
      throw AppException.conflict('The teacher or the parent already has a meeting at this time', 'MEETING_CLASH');
    }
    const saved = await this.meetings.save(
      this.meetings.create({
        school_id: input.schoolId,
        academic_year_id: academicYearId,
        student_id: input.studentId,
        teacher_user_id: input.teacherUserId,
        parent_user_id: input.parentUserId,
        scheduled_by: input.scheduledBy,
        title: input.dto.title,
        agenda: input.dto.agenda ?? null,
        scheduled_at: scheduledAt,
        duration_minutes: duration,
        scheduled_end_at: endsAt(scheduledAt, duration),
        status: 'scheduled',
        channel_name: channelName(input.schoolId, randomBytes(8).toString('hex')),
        reminder_sent_at: scheduledAt.getTime() <= now.getTime() + START_REMINDER_MINUTES * 60_000 ? now : null,
        created_by: input.actor.id,
      }),
    );
    const [presented] = await this.present([saved]);
    await this.notify(
      TEMPLATES.MEETING_SCHEDULED,
      presented.to.id,
      {
        by: presented.from.name,
        student: presented.student.name,
        time: formatMeetingTime(saved.scheduled_at, this.app.timeZone),
        title: saved.title,
      },
      saved,
    );
    this.realtime.toUsers([presented.to.id], 'meeting.status', this.statusPayload(saved, input.actor.id));
    return presented;
  }

  private partyQuery(actor: AuthUser, party: MeetingParty): SelectQueryBuilder<Meeting> {
    const qb = this.meetings.createQueryBuilder('m');
    if (party === 'teacher') {
      qb.where('m.teacher_user_id = :userId AND m.school_id = :schoolId', {
        userId: actor.id,
        schoolId: this.teacherSchool(actor),
      });
    } else {
      qb.where('m.parent_user_id = :userId', { userId: actor.id });
    }
    return onlyCurrentYear(qb);
  }

  async findForParty(actor: AuthUser, party: MeetingParty, id: number): Promise<Meeting> {
    const meeting = await this.partyQuery(actor, party).andWhere('m.id = :id', { id }).getOne();
    if (!meeting) throw AppException.notFound('Meeting not found', 'MEETING_NOT_FOUND');
    return meeting;
  }

  private assertJoinable(meeting: Meeting, now: Date): void {
    const blocked = enterBlockReason(meeting, now);
    if (blocked) throw AppException.conflict(blocked.message, blocked.code);
  }

  private grantResponse(
    meeting: Meeting,
    actor: AuthUser,
    party: MeetingParty,
    grant: { app_id: string; token: string; expires_at: Date },
  ): Promise<MeetingJoinDto> {
    return this.present([meeting]).then(([presented]) => ({
      provider: 'agora' as const,
      app_id: grant.app_id,
      channel_name: meeting.channel_name,
      uid: agoraUid(actor.id, party),
      token: grant.token,
      expires_at: grant.expires_at,
      role: party === 'teacher' ? ('host' as const) : ('participant' as const),
      meeting: presented,
    }));
  }

  private members(meeting: Pick<Meeting, 'teacher_user_id' | 'parent_user_id'>): number[] {
    return [Number(meeting.teacher_user_id), Number(meeting.parent_user_id)];
  }

  private statusPayload(meeting: Meeting, by: number | null) {
    return {
      meeting_id: meeting.id,
      status: meeting.status,
      response: meeting.response,
      ends_at: meeting.scheduled_end_at,
      extended_minutes: meeting.extended_minutes,
      ended_at: meeting.ended_at,
      end_reason: meeting.end_reason,
      by,
    };
  }

  private announceStatus(meeting: Meeting, by: number | null): void {
    this.realtime.toUsers(this.members(meeting), 'meeting.status', this.statusPayload(meeting, by));
  }

  private teacherSchool(actor: AuthUser): number {
    if (!actor.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
    return actor.school_id;
  }

  private async closeOpenLogs(
    manager: EntityManager,
    meetingId: number,
    at: Date,
    userId?: number,
    reason = 'left',
  ): Promise<void> {
    await manager.update(
      MeetingCallLog,
      { meeting_id: meetingId, left_at: IsNull(), ...(userId ? { user_id: userId } : {}) },
      { left_at: at, leave_reason: reason },
    );
  }

  private async notify(
    template: string,
    userId: number,
    data: Record<string, string>,
    meeting: Pick<Meeting, 'id' | 'student_id'>,
  ): Promise<void> {
    await this.notifications
      .dispatch({
        template,
        audience: { user_ids: [userId] },
        data: { ...data, meeting_id: String(meeting.id), student_id: String(meeting.student_id) },
      })
      .catch((error: Error) => this.logger.warn(`${template} for user ${userId} not sent: ${error.message}`));
  }

  private async withCallLog(meeting: Meeting): Promise<MeetingDetailDto> {
    const [presented] = await this.present([meeting]);
    const rows = await this.logs.find({ where: { meeting_id: meeting.id }, order: { joined_at: 'ASC', id: 'ASC' } });
    const people = await this.people(rows.map((row) => row.user_id));
    const call_log: MeetingCallLogDto[] = rows.map((row) => ({
      user: { id: row.user_id, name: people.get(row.user_id) ?? '' },
      party: row.party,
      platform: row.platform,
      source: row.source,
      joined_at: row.joined_at,
      left_at: row.left_at,
      leave_reason: row.leave_reason,
      minutes: minutesBetween(row.joined_at, row.left_at),
    }));
    return { ...presented, call_log };
  }

  private async people(ids: (number | null)[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids.filter((id): id is number => Boolean(id)))];
    if (!unique.length) return new Map();
    const rows: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT id, name FROM users WHERE id = ANY($1)`,
      [unique],
    );
    return new Map(rows.map((row) => [Number(row.id), row.name]));
  }

  private async present(rows: Meeting[]): Promise<MeetingDto[]> {
    if (!rows.length) return [];
    const now = new Date();
    const studentIds = [...new Set(rows.map((row) => row.student_id))];
    const yearIds = [...new Set(rows.map((row) => row.academic_year_id))];
    const [people, students, relations, years, open] = await Promise.all([
      this.people(
        rows.flatMap((row) => [
          row.teacher_user_id,
          row.parent_user_id,
          row.cancelled_by,
          row.extended_by,
          row.ended_by,
        ]),
      ),
      this.dataSource.query(
        `SELECT s.id, concat_ws(' ', s.first_name, s.last_name) AS name, c.name AS class_name, sec.name AS section_name
         FROM students s
         LEFT JOIN academic_years y ON y.school_id = s.school_id AND y.is_current AND y.deleted_at IS NULL
         LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = y.id
         LEFT JOIN classes c ON c.id = e.class_id LEFT JOIN sections sec ON sec.id = e.section_id
         WHERE s.id = ANY($1)`,
        [studentIds],
      ) as Promise<StudentRow[]>,
      this.dataSource.query(
        `SELECT sg.student_id, g.user_id, sg.relation
         FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
         WHERE sg.student_id = ANY($1) AND g.user_id IS NOT NULL`,
        [studentIds],
      ) as Promise<{ student_id: number; user_id: number; relation: string }[]>,
      this.dataSource.query(`SELECT id, name FROM academic_years WHERE id = ANY($1)`, [yearIds]) as Promise<
        { id: number; name: string }[]
      >,
      this.dataSource.query(
        `SELECT DISTINCT meeting_id, party FROM meeting_call_logs WHERE meeting_id = ANY($1) AND left_at IS NULL`,
        [rows.map((row) => row.id)],
      ) as Promise<{ meeting_id: number; party: MeetingParty }[]>,
    ]);
    const inCall = new Set(open.map((row) => `${row.meeting_id}:${row.party}`));
    const studentMap = new Map(students.map((row) => [Number(row.id), row]));
    const relationMap = new Map(relations.map((row) => [`${row.student_id}:${row.user_id}`, row.relation]));
    const yearMap = new Map(years.map((row) => [Number(row.id), row.name]));
    const ref = (id: number | null) => (id ? { id, name: people.get(id) ?? '' } : null);
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
      return {
        id: row.id,
        title: row.title,
        agenda: row.agenda,
        status: row.status,
        response: row.response,
        responded_at: row.responded_at,
        response_note: row.response_note,
        scheduled_at: row.scheduled_at,
        ends_at: row.scheduled_end_at,
        duration_minutes: row.duration_minutes,
        extended_minutes: row.extended_minutes,
        extended_at: row.extended_at,
        extended_by: ref(row.extended_by),
        academic_year: { id: row.academic_year_id, name: yearMap.get(row.academic_year_id) ?? '' },
        host_id: row.teacher_user_id,
        scheduled_by: row.scheduled_by,
        from: row.scheduled_by === 'teacher' ? teacher : parent,
        to: row.scheduled_by === 'teacher' ? parent : teacher,
        teacher,
        parent,
        student: {
          id: row.student_id,
          name: student?.name ?? '',
          class_section: student?.class_name
            ? [student.class_name, student.section_name].filter(Boolean).join(' - ')
            : null,
        },
        can_join: canJoin(row, now),
        in_call: { teacher: inCall.has(`${row.id}:teacher`), parent: inCall.has(`${row.id}:parent`) },
        active_participants: Number(inCall.has(`${row.id}:teacher`)) + Number(inCall.has(`${row.id}:parent`)),
        join_opens_at: joinOpensAt(row),
        join_closes_at: joinClosesAt(row),
        started_at: row.started_at,
        ended_at: row.ended_at,
        call_minutes: actualMinutes(row, now),
        ended_by: ref(row.ended_by),
        end_reason: row.end_reason,
        cancelled_by: ref(row.cancelled_by),
        cancel_reason: row.cancel_reason,
        created_at: row.created_at,
      };
    });
  }
}
