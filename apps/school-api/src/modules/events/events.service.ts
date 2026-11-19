import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, offset, paginate, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { currentYearId, onlyCurrentYear } from '../../shared/academic-year';
import { todayIn } from '../../shared/dates';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { zoneOffset } from '../tracking/bus-timeline.logic';
import {
  CancelEventDto,
  EventDto,
  EventInputDto,
  EventInsightsDto,
  EventQueryDto,
  EventResponseDto,
  EventResponsesQueryDto,
  MyEventDto,
  MyEventsQueryDto,
  RsvpInputDto,
} from './dto/event.dto';
import { EventRsvp, EventTarget, RsvpResponse, SchoolEvent } from './entities/school-event.entity';
import { ReminderKind, reminderDue, rsvpCounts, rsvpRefusal, scheduleErrors, whenText } from './events.logic';

type ParentFilter = 'all' | 'skip_not_attending' | 'coming' | 'no_response';

const INVITED = (eventParam: string) =>
  `((SELECT ev.audience FROM school_events ev WHERE ev.id = ${eventParam}) = 'school'
    OR EXISTS (SELECT 1 FROM event_targets t WHERE t.event_id = ${eventParam}
               AND (t.class_id = e.class_id OR t.section_id = e.section_id)))`;

const ESCAPE = (value: string) => `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

const REMINDER_COLUMNS: Record<ReminderKind, 'day_before_sent_at' | 'deadline_reminder_sent_at' | 'day_of_sent_at'> = {
  day_before: 'day_before_sent_at',
  deadline: 'deadline_reminder_sent_at',
  day_of: 'day_of_sent_at',
};

@Injectable()
export class EventsService {
  private readonly logger = new Logger('Events');

  constructor(
    @InjectRepository(SchoolEvent) private readonly events: Repository<SchoolEvent>,
    @InjectRepository(EventTarget) private readonly targets: Repository<EventTarget>,
    @InjectRepository(EventRsvp) private readonly rsvps: Repository<EventRsvp>,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async list(schoolId: number, query: EventQueryDto): Promise<Paginated<EventDto>> {
    const qb = onlyCurrentYear(this.events.createQueryBuilder('ev')).where('ev.school_id = :schoolId', { schoolId });
    if (query.status) qb.andWhere('ev.status = :status', { status: query.status });
    if (query.from) qb.andWhere('ev.event_date >= :from', { from: query.from });
    if (query.to) qb.andWhere('ev.event_date <= :to', { to: query.to });
    if (query.upcoming) qb.andWhere('ev.event_date >= :today', { today: todayIn(this.app.timeZone) });
    if (query.class_id) {
      qb.andWhere(
        new Brackets((where) =>
          where.where(`ev.audience = 'school'`).orWhere(
            `EXISTS (SELECT 1 FROM event_targets t WHERE t.event_id = ev.id AND (t.class_id = :classId
               OR t.section_id IN (SELECT id FROM sections WHERE class_id = :classId)))`,
            { classId: query.class_id },
          ),
        ),
      );
    }
    const ordered = query.sort ? query : { ...query, sort: 'event_date', order: 'asc' as const };
    const page = await listQuery(qb, ordered, {
      searchable: ['ev.title', 'ev.venue', 'ev.description'],
      sortable: { event_date: 'ev.event_date', title: 'ev.title', created_at: 'ev.created_at' },
      defaultSort: 'event_date',
    });
    return { ...page, items: await this.present(page.items) };
  }

  async insights(schoolId: number): Promise<EventInsightsDto> {
    const today = todayIn(this.app.timeZone);
    const yearId = await currentYearId(this.dataSource.manager, schoolId);
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'published' AND date_trunc('month', event_date) = date_trunc('month', $3::date)) AS this_month,
              COUNT(*) FILTER (WHERE status = 'published' AND event_date >= $3::date) AS upcoming,
              COUNT(*) FILTER (WHERE status = 'published' AND event_date >= $3::date AND rsvp_required
                               AND (rsvp_deadline IS NULL OR rsvp_deadline > now())) AS awaiting_replies,
              COUNT(*) FILTER (WHERE status = 'draft') AS drafts,
              COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled
       FROM school_events WHERE school_id = $1 AND academic_year_id = $2 AND deleted_at IS NULL`,
      [schoolId, yearId, today],
    );
    return {
      this_month: Number(row.this_month),
      upcoming: Number(row.upcoming),
      awaiting_replies: Number(row.awaiting_replies),
      drafts: Number(row.drafts),
      cancelled: Number(row.cancelled),
    };
  }

  async get(schoolId: number, id: number): Promise<EventDto> {
    return (await this.present([await this.find(schoolId, id)]))[0]!;
  }

  async responses(schoolId: number, id: number, query: EventResponsesQueryDto): Promise<Paginated<EventResponseDto>> {
    const event = await this.find(schoolId, id);
    const params: unknown[] = [schoolId, event.academic_year_id, id];
    const where = [`s.school_id = $1`, `e.academic_year_id = $2`, INVITED('$3')];
    if (query.response === 'no_response') where.push('r.id IS NULL');
    else if (query.response) {
      params.push(query.response);
      where.push(`r.response = $${params.length}`);
    }
    if (query.class_id) {
      params.push(query.class_id);
      where.push(`c.id = $${params.length}`);
    }
    if (query.search) {
      params.push(ESCAPE(query.search));
      where.push(
        `(s.first_name ILIKE $${params.length} OR s.last_name ILIKE $${params.length} OR s.admission_no ILIKE $${params.length})`,
      );
    }
    const base = `FROM student_enrollments e
      JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
      LEFT JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN classes c ON c.id = COALESCE(e.class_id, sec.class_id)
      LEFT JOIN event_rsvps r ON r.event_id = $3 AND r.student_id = s.id
      LEFT JOIN users ru ON ru.id = r.responded_by
      WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*) AS total ${base}`, params);
    const rows: {
      id: number;
      first_name: string;
      last_name: string | null;
      admission_no: string;
      class_name: string | null;
      section_name: string | null;
      response: RsvpResponse | null;
      responded_at: Date | null;
      responded_by: number | null;
      responder: string | null;
      parent_mobile: string | null;
    }[] = await this.dataSource.query(
      `SELECT s.id, s.first_name, s.last_name, s.admission_no, c.name AS class_name, sec.name AS section_name,
              r.response, r.responded_at, r.responded_by, ru.name AS responder,
              (SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
               WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC, sg.id LIMIT 1) AS parent_mobile
       ${base}
       ORDER BY c.grade_level NULLS LAST, sec.name, s.first_name, s.id
       LIMIT ${query.limit} OFFSET ${offset(query.page, query.limit)}`,
      params,
    );
    return paginate(
      [
        rows.map((row) => ({
          student: { id: Number(row.id), name: [row.first_name, row.last_name].filter(Boolean).join(' ') },
          admission_no: row.admission_no,
          class_section: row.class_name ? [row.class_name, row.section_name].filter(Boolean).join(' - ') : null,
          response: row.response ?? 'no_response',
          responded_by: row.responded_by ? { id: Number(row.responded_by), name: row.responder ?? '' } : null,
          responded_at: row.responded_at,
          parent_mobile: row.parent_mobile,
        })),
        Number(total),
      ],
      query.page,
      query.limit,
    );
  }

  async create(schoolId: number, dto: EventInputDto, actor: AuthUser): Promise<EventDto> {
    const yearId = await currentYearId(this.dataSource.manager, schoolId);
    const targets = await this.validate(schoolId, yearId, dto);
    const saved = await this.dataSource.transaction(async (manager) => {
      const event = await manager.save(
        manager.create(SchoolEvent, {
          school_id: schoolId,
          academic_year_id: yearId,
          title: dto.title,
          description: dto.description ?? null,
          event_date: dto.event_date,
          start_time: dto.start_time ?? null,
          end_time: dto.start_time ? (dto.end_time ?? null) : null,
          venue: dto.venue ?? null,
          audience: dto.audience,
          rsvp_required: dto.rsvp_required ?? true,
          rsvp_deadline: dto.rsvp_deadline ? new Date(dto.rsvp_deadline) : null,
          status: 'draft',
          created_by: actor.id,
        }),
      );
      await this.saveTargets(manager, event.id, targets);
      return event;
    });
    if (dto.publish) await this.publishEvent(saved);
    return this.get(schoolId, saved.id);
  }

  async update(schoolId: number, id: number, dto: EventInputDto): Promise<EventDto> {
    const event = await this.find(schoolId, id);
    if (event.status === 'cancelled') {
      throw AppException.conflict('A cancelled event cannot be edited', 'EVENT_CANCELLED');
    }
    const targets = await this.validate(schoolId, event.academic_year_id, dto);
    const startTime = dto.start_time ?? null;
    const timingChanged = event.event_date !== dto.event_date || event.start_time !== startTime;
    const detailsChanged = timingChanged || event.venue !== (dto.venue ?? null);
    await this.dataSource.transaction(async (manager) => {
      await manager.update(SchoolEvent, id, {
        title: dto.title,
        description: dto.description ?? null,
        event_date: dto.event_date,
        start_time: startTime,
        end_time: startTime ? (dto.end_time ?? null) : null,
        venue: dto.venue ?? null,
        audience: dto.audience,
        rsvp_required: dto.rsvp_required ?? event.rsvp_required,
        rsvp_deadline: dto.rsvp_deadline ? new Date(dto.rsvp_deadline) : null,
        ...(timingChanged ? { day_before_sent_at: null, deadline_reminder_sent_at: null, day_of_sent_at: null } : {}),
      });
      await manager.delete(EventTarget, { event_id: id });
      await this.saveTargets(manager, id, targets);
    });
    const fresh = await this.find(schoolId, id);
    if (fresh.status === 'draft' && dto.publish) await this.publishEvent(fresh);
    else if (fresh.status === 'published' && detailsChanged) {
      await this.tell(fresh, TEMPLATES.EVENT_UPDATED, 'all', this.eventData(fresh));
    }
    return this.get(schoolId, id);
  }

  async publish(schoolId: number, id: number): Promise<EventDto> {
    const event = await this.find(schoolId, id);
    if (event.status !== 'draft') {
      throw AppException.conflict(`This event is already ${event.status}`, 'EVENT_NOT_DRAFT');
    }
    if (event.event_date < todayIn(this.app.timeZone)) {
      throw AppException.validation([{ field: 'event_date', message: 'The event date has already passed' }]);
    }
    await this.publishEvent(event);
    return this.get(schoolId, id);
  }

  async cancel(schoolId: number, id: number, dto: CancelEventDto): Promise<EventDto> {
    const event = await this.find(schoolId, id);
    if (event.status === 'cancelled') {
      throw AppException.conflict('This event is already cancelled', 'EVENT_CANCELLED');
    }
    const wasPublished = event.status === 'published';
    await this.events.update(id, { status: 'cancelled', cancelled_at: new Date(), cancel_reason: dto.reason ?? null });
    if (wasPublished) {
      await this.tell(event, TEMPLATES.EVENT_CANCELLED, 'all', {
        ...this.eventData(event),
        reason: dto.reason ? ` ${dto.reason}` : '',
      });
    }
    return this.get(schoolId, id);
  }

  async remove(schoolId: number, id: number): Promise<void> {
    await this.find(schoolId, id);
    await this.events.softDelete(id);
  }

  async mine(user: AuthUser, query: MyEventsQueryDto): Promise<Paginated<MyEventDto>> {
    const children = await this.childrenOf(user.id, query.student_id);
    if (!children.length) return paginate([[], 0], query.page, query.limit);
    const params: unknown[] = [children.map((child) => child.student_id)];
    const where = [
      `ev.deleted_at IS NULL`,
      `ev.status IN ('published', 'cancelled')`,
      `EXISTS (SELECT 1 FROM student_enrollments e JOIN students s ON s.id = e.student_id
               WHERE e.student_id = ANY($1) AND e.academic_year_id = ev.academic_year_id AND s.school_id = ev.school_id
                 AND ${INVITED('ev.id')})`,
    ];
    if (query.from) {
      params.push(query.from);
      where.push(`ev.event_date >= $${params.length}`);
    }
    if (query.to) {
      params.push(query.to);
      where.push(`ev.event_date <= $${params.length}`);
    }
    if (query.search) {
      params.push(ESCAPE(query.search));
      where.push(
        `(ev.title ILIKE $${params.length} OR ev.venue ILIKE $${params.length} OR ev.description ILIKE $${params.length})`,
      );
    }
    const [{ total }] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM school_events ev WHERE ${where.join(' AND ')}`,
      params,
    );
    const ids: { id: number }[] = await this.dataSource.query(
      `SELECT ev.id FROM school_events ev WHERE ${where.join(' AND ')}
       ORDER BY ev.event_date DESC, ev.start_time DESC NULLS LAST, ev.id DESC
       LIMIT ${query.limit} OFFSET ${offset(query.page, query.limit)}`,
      params,
    );
    const rows = ids.length ? await this.events.findBy({ id: In(ids.map((row) => Number(row.id))) }) : [];
    const ordered = ids.map((row) => rows.find((event) => event.id === Number(row.id))!).filter(Boolean);
    return paginate([await this.presentMine(user.id, ordered, children), Number(total)], query.page, query.limit);
  }

  async mineOne(user: AuthUser, id: number): Promise<MyEventDto> {
    const children = await this.childrenOf(user.id);
    const event = await this.events.findOneBy({ id });
    if (!event || !['published', 'cancelled'].includes(event.status)) {
      throw AppException.notFound('Event not found', 'EVENT_NOT_FOUND');
    }
    const [presented] = await this.presentMine(user.id, [event], children);
    if (!presented?.my_rsvps.length) throw AppException.notFound('Event not found', 'EVENT_NOT_FOUND');
    return presented;
  }

  async rsvp(user: AuthUser, id: number, dto: RsvpInputDto): Promise<MyEventDto> {
    const event = await this.events.findOneBy({ id });
    if (!event) throw AppException.notFound('Event not found', 'EVENT_NOT_FOUND');
    const children = await this.childrenOf(user.id, dto.student_id);
    if (!children.length) {
      throw AppException.notFound('This child is not linked to your mobile number', 'CHILD_NOT_FOUND');
    }
    const invited = await this.invitedIds(event, [dto.student_id]);
    if (!invited.includes(dto.student_id)) {
      throw AppException.conflict('This child is not invited to this event', 'EVENT_NOT_INVITED');
    }
    const refusal = rsvpRefusal(event, new Date(), this.offsetFor(event));
    if (refusal) throw AppException.conflict(refusal.message, refusal.code);
    await this.rsvps
      .createQueryBuilder()
      .insert()
      .values({
        event_id: id,
        student_id: dto.student_id,
        response: dto.response,
        responded_by: user.id,
        responded_at: new Date(),
      })
      .orUpdate(['response', 'responded_by', 'responded_at', 'updated_at'], ['event_id', 'student_id'])
      .execute();
    return this.mineOne(user, id);
  }

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'event-reminders' })
  async sendReminders(now = new Date()): Promise<number> {
    const today = todayIn(this.app.timeZone, now);
    const upcoming = await this.events
      .createQueryBuilder('ev')
      .where(`ev.status = 'published' AND ev.event_date BETWEEN :today AND (:today::date + 3)`, { today })
      .getMany();
    let sent = 0;
    for (const event of upcoming) {
      const offset = this.offsetFor(event);
      for (const kind of ['deadline', 'day_before', 'day_of'] as ReminderKind[]) {
        if (!reminderDue(kind, event, now, offset)) continue;
        const column = REMINDER_COLUMNS[kind];
        const claimed: { id: number }[] = await this.dataSource.query(
          `UPDATE school_events SET ${column} = now() WHERE id = $1 AND ${column} IS NULL AND status = 'published' RETURNING id`,
          [event.id],
        );
        const rows = Array.isArray(claimed[0]) ? (claimed[0] as { id: number }[]) : claimed;
        if (!rows.length) continue;
        const data = this.eventData(event);
        const ok =
          kind === 'deadline'
            ? await this.tell(event, TEMPLATES.EVENT_RSVP_REMINDER, 'no_response', {
                ...data,
                deadline: this.deadlineText(event),
              })
            : await this.tell(
                event,
                TEMPLATES.EVENT_REMINDER,
                kind === 'day_of' && event.rsvp_required ? 'coming' : 'skip_not_attending',
                { ...data, lead: kind === 'day_of' ? 'today' : 'tomorrow' },
              );
        if (ok) sent += 1;
      }
    }
    return sent;
  }

  private async publishEvent(event: SchoolEvent): Promise<void> {
    await this.events.update(event.id, { status: 'published', published_at: new Date() });
    await this.tell({ ...event, status: 'published' }, TEMPLATES.EVENT_PUBLISHED, 'all', {
      ...this.eventData(event),
      reply: event.rsvp_required ? ' Please reply Attending, Not attending or Maybe.' : '',
    });
  }

  private eventData(event: SchoolEvent): Record<string, string> {
    return {
      title: event.title,
      when: whenText(event),
      venue: event.venue ? ` at ${event.venue}` : '',
      event_id: String(event.id),
    };
  }

  private deadlineText(event: SchoolEvent): string {
    const deadline = event.rsvp_deadline;
    if (!deadline) return 'before the event starts';
    return deadline.toLocaleString('en-IN', {
      timeZone: this.app.timeZone,
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  private async tell(
    event: SchoolEvent,
    template: string,
    filter: ParentFilter,
    data: Record<string, string>,
  ): Promise<boolean> {
    const userIds = await this.parentsOf(event, filter);
    if (!userIds.length) return false;
    return this.notifications
      .dispatch({ template, audience: { user_ids: userIds, school_id: event.school_id }, data })
      .then(() => true)
      .catch((error: Error) => {
        this.logger.warn(`Event ${event.id} ${template} not sent: ${error.message}`);
        return false;
      });
  }

  private async parentsOf(event: SchoolEvent, filter: ParentFilter): Promise<number[]> {
    const responseFilter: Record<ParentFilter, string> = {
      all: '',
      skip_not_attending: `AND (r.response IS NULL OR r.response <> 'not_attending')`,
      coming: `AND r.response IN ('attending', 'maybe')`,
      no_response: 'AND r.id IS NULL',
    };
    const rows: { user_id: number }[] = await this.dataSource.query(
      `SELECT DISTINCT g.user_id FROM student_enrollments e
       JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       JOIN student_guardians sg ON sg.student_id = s.id
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL AND g.user_id IS NOT NULL
       JOIN users u ON u.id = g.user_id AND u.status = 'active' AND u.deleted_at IS NULL
       LEFT JOIN event_rsvps r ON r.event_id = $3 AND r.student_id = s.id
       WHERE s.school_id = $1 AND e.academic_year_id = $2 AND ${INVITED('$3')} ${responseFilter[filter]}`,
      [event.school_id, event.academic_year_id, event.id],
    );
    return rows.map((row) => Number(row.user_id));
  }

  private async invitedIds(event: SchoolEvent, studentIds?: number[]): Promise<number[]> {
    const rows: { id: number }[] = await this.dataSource.query(
      `SELECT s.id FROM student_enrollments e
       JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       WHERE s.school_id = $1 AND e.academic_year_id = $2 AND ${INVITED('$3')}
         ${studentIds ? 'AND s.id = ANY($4)' : ''}`,
      studentIds
        ? [event.school_id, event.academic_year_id, event.id, studentIds]
        : [event.school_id, event.academic_year_id, event.id],
    );
    return rows.map((row) => Number(row.id));
  }

  private async childrenOf(userId: number, studentId?: number): Promise<{ student_id: number; name: string }[]> {
    const rows: { student_id: number; first_name: string; last_name: string | null }[] = await this.dataSource.query(
      `SELECT DISTINCT s.id AS student_id, s.first_name, s.last_name FROM student_guardians sg
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
       JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       WHERE g.user_id = $1 ${studentId ? 'AND s.id = $2' : ''}`,
      studentId ? [userId, studentId] : [userId],
    );
    return rows.map((row) => ({
      student_id: Number(row.student_id),
      name: [row.first_name, row.last_name].filter(Boolean).join(' '),
    }));
  }

  private offsetFor(event: Pick<SchoolEvent, 'event_date'>): string {
    return zoneOffset(this.app.timeZone, new Date(`${event.event_date}T12:00:00Z`));
  }

  private async validate(
    schoolId: number,
    yearId: number,
    dto: EventInputDto,
  ): Promise<{ class_ids: number[]; section_ids: number[] }> {
    const errors = scheduleErrors(dto, todayIn(this.app.timeZone), this.offsetFor(dto));
    if (dto.audience === 'classes' && !(dto.class_ids?.length || dto.section_ids?.length)) {
      errors.push({ field: 'class_ids', message: 'Choose at least one class or section' });
    }
    if (errors.length) throw AppException.validation(errors);
    if (dto.audience !== 'classes') return { class_ids: [], section_ids: [] };
    const classes = [...new Set(dto.class_ids ?? [])];
    const sections = [...new Set(dto.section_ids ?? [])];
    if (classes.length) {
      const found: { id: number }[] = await this.dataSource.query(
        `SELECT id FROM classes WHERE id = ANY($1) AND school_id = $2 AND deleted_at IS NULL`,
        [classes, schoolId],
      );
      if (found.length !== classes.length) {
        throw AppException.validation([{ field: 'class_ids', message: 'A class was not found in this school' }]);
      }
    }
    if (sections.length) {
      const found: { id: number }[] = await this.dataSource.query(
        `SELECT id FROM sections WHERE id = ANY($1) AND school_id = $2 AND academic_year_id = $3 AND deleted_at IS NULL`,
        [sections, schoolId, yearId],
      );
      if (found.length !== sections.length) {
        throw AppException.validation([{ field: 'section_ids', message: 'A section was not found in this year' }]);
      }
    }
    return { class_ids: classes, section_ids: sections };
  }

  private async saveTargets(
    manager: EntityManager,
    eventId: number,
    targets: { class_ids: number[]; section_ids: number[] },
  ): Promise<void> {
    const rows = [
      ...targets.class_ids.map((classId) => ({ event_id: eventId, class_id: classId, section_id: null })),
      ...targets.section_ids.map((sectionId) => ({ event_id: eventId, class_id: null, section_id: sectionId })),
    ];
    if (rows.length) await manager.insert(EventTarget, rows);
  }

  private async find(schoolId: number, id: number): Promise<SchoolEvent> {
    const event = await onlyCurrentYear(this.events.createQueryBuilder('ev'))
      .where('ev.id = :id AND ev.school_id = :schoolId', { id, schoolId })
      .getOne();
    if (!event) throw AppException.notFound('Event not found', 'EVENT_NOT_FOUND');
    return event;
  }

  private async presentMine(
    userId: number,
    rows: SchoolEvent[],
    children: { student_id: number; name: string }[],
  ): Promise<MyEventDto[]> {
    if (!rows.length) return [];
    const childIds = children.map((child) => child.student_id);
    const replies = await this.rsvps.findBy({ event_id: In(rows.map((row) => row.id)), student_id: In(childIds) });
    const now = new Date();
    const result: MyEventDto[] = [];
    for (const event of rows) {
      const invited = await this.invitedIds(event, childIds);
      result.push({
        id: event.id,
        title: event.title,
        description: event.description,
        event_date: event.event_date,
        start_time: event.start_time,
        end_time: event.end_time,
        venue: event.venue,
        status: event.status,
        cancel_reason: event.cancel_reason,
        rsvp_required: event.rsvp_required,
        rsvp_deadline: event.rsvp_deadline,
        rsvp_open: rsvpRefusal(event, now, this.offsetFor(event)) === null,
        my_rsvps: children
          .filter((child) => invited.includes(child.student_id))
          .map((child) => {
            const reply = replies.find((row) => row.event_id === event.id && row.student_id === child.student_id);
            return {
              student: { id: child.student_id, name: child.name },
              response: reply?.response ?? null,
              responded_at: reply?.responded_at ?? null,
            };
          }),
      });
    }
    return result;
  }

  private async present(rows: SchoolEvent[]): Promise<EventDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const [targets, users, replies] = await Promise.all([
      this.dataSource.query(
        `SELECT t.event_id, t.class_id, t.section_id, c.name AS class_name, sc.name AS section_class, s.name AS section_name
         FROM event_targets t
         LEFT JOIN classes c ON c.id = t.class_id
         LEFT JOIN sections s ON s.id = t.section_id
         LEFT JOIN classes sc ON sc.id = s.class_id
         WHERE t.event_id = ANY($1)`,
        [ids],
      ) as Promise<
        {
          event_id: number;
          class_id: number | null;
          section_id: number | null;
          class_name: string | null;
          section_class: string | null;
          section_name: string | null;
        }[]
      >,
      this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [
        [...new Set(rows.map((row) => row.created_by).filter(Boolean))],
      ]) as Promise<{ id: number; name: string }[]>,
      this.dataSource.query(
        `SELECT r.event_id, r.response FROM event_rsvps r
         JOIN students s ON s.id = r.student_id AND s.deleted_at IS NULL AND s.status = 'active'
         WHERE r.event_id = ANY($1)`,
        [ids],
      ) as Promise<{ event_id: number; response: RsvpResponse }[]>,
    ]);
    const invitedCounts = new Map<number, number>();
    for (const event of rows) invitedCounts.set(event.id, (await this.invitedIds(event)).length);
    const now = new Date();
    return rows.map((row) => {
      const mine = targets.filter((target) => Number(target.event_id) === row.id);
      const classes = mine
        .filter((target) => target.class_id)
        .map((target) => ({ id: Number(target.class_id), name: target.class_name ?? '' }));
      const sections = mine
        .filter((target) => target.section_id)
        .map((target) => ({
          id: Number(target.section_id),
          name: [target.section_class, target.section_name].filter(Boolean).join(' - '),
        }));
      const names = [...classes.map((item) => `Class ${item.name}`), ...sections.map((item) => item.name)];
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        event_date: row.event_date,
        start_time: row.start_time,
        end_time: row.end_time,
        venue: row.venue,
        audience: row.audience,
        audience_label: row.audience === 'school' ? 'Whole school' : names.join(', '),
        classes,
        sections,
        rsvp_required: row.rsvp_required,
        rsvp_deadline: row.rsvp_deadline,
        rsvp_open: rsvpRefusal(row, now, this.offsetFor(row)) === null,
        status: row.status,
        published_at: row.published_at,
        cancelled_at: row.cancelled_at,
        cancel_reason: row.cancel_reason,
        counts: rsvpCounts(
          invitedCounts.get(row.id) ?? 0,
          replies.filter((reply) => Number(reply.event_id) === row.id).map((reply) => reply.response),
        ),
        created_by: {
          id: row.created_by ?? 0,
          name: users.find((user) => Number(user.id) === row.created_by)?.name ?? '',
        },
        created_at: row.created_at,
      };
    });
  }
}
