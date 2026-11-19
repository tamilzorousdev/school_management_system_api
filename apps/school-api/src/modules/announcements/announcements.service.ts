import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, offset, paginate, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { currentYearId, currentYearSql, onlyCurrentYear } from '../../shared/academic-year';
import { FilesService } from '../files/files.service';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import {
  attachmentError,
  audienceErrors,
  canChangeContent,
  canEdit,
  isVisible,
  preview,
  readPercent,
  sameIds,
  statusForPublish,
  timingErrors,
} from './announcements.logic';
import {
  AnnouncementDto,
  AnnouncementInputDto,
  AnnouncementInsightsDto,
  AnnouncementPublishDto,
  AnnouncementQueryDto,
  AnnouncementReaderDto,
  AnnouncementReadersQueryDto,
  MyAnnouncementDto,
  MyAnnouncementsQueryDto,
} from './dto/announcement.dto';
import {
  Announcement,
  AnnouncementAttachment,
  AnnouncementRecipient,
  AnnouncementStatus,
  AnnouncementTarget,
} from './entities/announcement.entity';

interface Targets {
  class_ids: number[];
  section_ids: number[];
  student_ids: number[];
  user_ids: number[];
}

interface AudienceRow {
  user_id: number;
  segment: 'parent' | 'staff';
  student_ids: number[] | null;
}

const NO_TARGETS: Targets = { class_ids: [], section_ids: [], student_ids: [], user_ids: [] };

const unique = (values: number[] | undefined) => [...new Set(values ?? [])];

@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger('Announcements');

  constructor(
    @InjectRepository(Announcement) private readonly announcements: Repository<Announcement>,
    @InjectRepository(AnnouncementTarget) private readonly targets: Repository<AnnouncementTarget>,
    @InjectRepository(AnnouncementRecipient) private readonly recipients: Repository<AnnouncementRecipient>,
    @InjectRepository(AnnouncementAttachment) private readonly attachments: Repository<AnnouncementAttachment>,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async create(schoolId: number, dto: AnnouncementInputDto, actor: AuthUser): Promise<AnnouncementDto> {
    const yearId = await currentYearId(this.dataSource.manager, schoolId);
    const plan = await this.validate(schoolId, yearId, dto);
    const saved = await this.dataSource.transaction(async (manager) => {
      const announcement = await manager.save(
        manager.create(Announcement, {
          school_id: schoolId,
          academic_year_id: yearId,
          title: dto.title,
          body: dto.body,
          audience: dto.audience,
          priority: dto.priority ?? 'normal',
          status: plan.status === 'published' ? 'draft' : plan.status,
          publish_at: plan.publishAt,
          expires_at: plan.expiresAt,
          created_by: actor.id,
        }),
      );
      await this.saveTargets(manager, announcement.id, plan.targets);
      await this.saveAttachments(manager, announcement.id, dto.file_ids ?? []);
      return announcement;
    });
    if (plan.status === 'published') await this.deliver(saved, actor.id);
    return this.get(schoolId, saved.id);
  }

  async update(schoolId: number, id: number, dto: AnnouncementInputDto, actor: AuthUser): Promise<AnnouncementDto> {
    const announcement = await this.find(schoolId, id);
    if (!canChangeContent(announcement.status)) {
      throw AppException.conflict('An archived announcement cannot be edited', 'ANNOUNCEMENT_NOT_EDITABLE');
    }
    if (announcement.status === 'published') return this.editPublished(announcement, dto, actor);
    const plan = await this.validate(schoolId, announcement.academic_year_id, dto);
    const saved = await this.dataSource.transaction(async (manager) => {
      Object.assign(announcement, {
        title: dto.title,
        body: dto.body,
        audience: dto.audience,
        priority: dto.priority ?? announcement.priority,
        status: plan.status === 'published' ? 'draft' : plan.status,
        publish_at: plan.publishAt,
        expires_at: plan.expiresAt,
      });
      await manager.delete(AnnouncementTarget, { announcement_id: announcement.id });
      await this.saveTargets(manager, announcement.id, plan.targets);
      if (dto.file_ids) {
        await manager.delete(AnnouncementAttachment, { announcement_id: announcement.id });
        await this.saveAttachments(manager, announcement.id, dto.file_ids);
      }
      return manager.save(announcement);
    });
    if (plan.status === 'published') await this.deliver(saved, actor.id);
    return this.get(schoolId, saved.id);
  }

  async publish(schoolId: number, id: number, dto: AnnouncementPublishDto, actor: AuthUser): Promise<AnnouncementDto> {
    const announcement = await this.find(schoolId, id);
    if (!canEdit(announcement.status)) {
      throw AppException.conflict(`This announcement is already ${announcement.status}`, 'ANNOUNCEMENT_NOT_EDITABLE');
    }
    const now = new Date();
    const publishAt = dto.publish_at ? new Date(dto.publish_at) : null;
    const errors = timingErrors(publishAt, announcement.expires_at, now);
    if (errors.length) throw AppException.validation(errors);
    if (statusForPublish(publishAt, now) === 'scheduled') {
      await this.announcements.update(announcement.id, { status: 'scheduled', publish_at: publishAt });
      return this.get(schoolId, id);
    }
    await this.deliver(announcement, actor.id);
    return this.get(schoolId, id);
  }

  async archive(schoolId: number, id: number): Promise<AnnouncementDto> {
    const announcement = await this.find(schoolId, id);
    if (announcement.status !== 'published') {
      throw AppException.conflict('Only a published announcement can be archived', 'ANNOUNCEMENT_NOT_PUBLISHED');
    }
    await this.announcements.update(id, { status: 'archived', archived_at: new Date() });
    return this.get(schoolId, id);
  }

  async remove(schoolId: number, id: number): Promise<void> {
    await this.find(schoolId, id);
    await this.announcements.softDelete(id);
  }

  async list(schoolId: number, query: AnnouncementQueryDto): Promise<Paginated<AnnouncementDto>> {
    const qb = onlyCurrentYear(
      this.announcements.createQueryBuilder('a').where('a.school_id = :schoolId', { schoolId }),
    );
    if (query.status) qb.andWhere('a.status = :status', { status: query.status });
    if (query.audience) qb.andWhere('a.audience = :audience', { audience: query.audience });
    if (query.priority) qb.andWhere('a.priority = :priority', { priority: query.priority });
    const page = await listQuery(qb, query.sort ? query : { ...query, sort: 'created_at', order: 'desc' }, {
      searchable: ['a.title', 'a.body'],
      sortable: {
        created_at: 'a.created_at',
        published_at: 'a.published_at',
        publish_at: 'a.publish_at',
        title: 'a.title',
        status: 'a.status',
      },
      defaultSort: 'created_at',
    });
    return { ...page, items: await this.present(page.items) };
  }

  async insights(schoolId: number): Promise<AnnouncementInsightsDto> {
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE a.status = 'draft') AS drafts,
              COUNT(*) FILTER (WHERE a.status = 'scheduled') AS scheduled,
              COUNT(*) FILTER (WHERE a.status = 'published') AS published,
              COUNT(*) FILTER (WHERE a.status = 'archived') AS archived,
              COUNT(*) FILTER (WHERE a.status = 'published' AND a.priority = 'urgent'
                               AND (a.expires_at IS NULL OR a.expires_at > now())) AS urgent_live,
              COALESCE(ROUND(AVG(CASE WHEN a.status IN ('published', 'archived') AND a.recipient_count > 0
                THEN 100.0 * (SELECT COUNT(*) FROM announcement_recipients r WHERE r.announcement_id = a.id AND r.read_at IS NOT NULL)
                     / a.recipient_count END)), 0) AS average_read_percent
       FROM announcements a ${currentYearSql('a')}
       WHERE a.school_id = $1 AND a.deleted_at IS NULL`,
      [schoolId],
    );
    return {
      drafts: Number(row.drafts),
      scheduled: Number(row.scheduled),
      published: Number(row.published),
      archived: Number(row.archived),
      urgent_live: Number(row.urgent_live),
      average_read_percent: Number(row.average_read_percent),
    };
  }

  async get(schoolId: number, id: number): Promise<AnnouncementDto> {
    return (await this.present([await this.find(schoolId, id)]))[0];
  }

  async readers(
    schoolId: number,
    id: number,
    query: AnnouncementReadersQueryDto,
  ): Promise<Paginated<AnnouncementReaderDto>> {
    const announcement = await this.find(schoolId, id);
    const where = ['r.announcement_id = $1'];
    const params: unknown[] = [id];
    if (query.state === 'read') where.push('r.read_at IS NOT NULL');
    if (query.state === 'unread') where.push('r.read_at IS NULL');
    if (query.segment) {
      params.push(query.segment);
      where.push(`r.segment = $${params.length}`);
    }
    if (query.class_id) {
      params.push(query.class_id, announcement.academic_year_id);
      where.push(
        `EXISTS (SELECT 1 FROM student_enrollments e WHERE e.student_id = ANY(r.student_ids)
                 AND e.class_id = $${params.length - 1} AND e.academic_year_id = $${params.length})`,
      );
    }
    if (query.search) {
      params.push(`%${query.search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
      where.push(`(u.name ILIKE $${params.length} OR u.mobile ILIKE $${params.length})`);
    }
    const [{ total }] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM announcement_recipients r JOIN users u ON u.id = r.user_id
       WHERE ${where.join(' AND ')}`,
      params,
    );
    const rows: {
      user_id: number;
      name: string;
      mobile: string;
      segment: 'parent' | 'staff';
      read_at: Date | null;
      student_ids: number[] | null;
    }[] = await this.dataSource.query(
      `SELECT r.user_id, u.name, u.mobile, r.segment, r.read_at, r.student_ids
       FROM announcement_recipients r JOIN users u ON u.id = r.user_id
       WHERE ${where.join(' AND ')}
       ORDER BY r.read_at DESC NULLS LAST, u.name
       LIMIT ${query.limit} OFFSET ${offset(query.page, query.limit)}`,
      params,
    );
    const children = await this.studentNames(
      rows.flatMap((row) => row.student_ids ?? []),
      announcement.academic_year_id,
    );
    return paginate(
      [
        rows.map((row) => ({
          user: { id: Number(row.user_id), name: row.name },
          mobile: row.mobile,
          segment: row.segment,
          read_at: row.read_at,
          students: (row.student_ids ?? [])
            .map((studentId) => children.get(Number(studentId)))
            .filter((child): child is { id: number; name: string } => Boolean(child)),
        })),
        Number(total),
      ],
      query.page,
      query.limit,
    );
  }

  async mine(actor: AuthUser, query: MyAnnouncementsQueryDto): Promise<Paginated<MyAnnouncementDto>> {
    const qb = this.myQuery(actor.id);
    if (query.unread) qb.andWhere('r.read_at IS NULL');
    if (query.priority) qb.andWhere('a.priority = :priority', { priority: query.priority });
    if (query.search) {
      const words = query.search.split(/\s+/).filter(Boolean).slice(0, 5);
      words.forEach((word, index) =>
        qb.andWhere(`(a.title ILIKE :word${index} OR a.body ILIKE :word${index})`, {
          [`word${index}`]: `%${word.replace(/[\\%_]/g, (char) => `\\${char}`)}%`,
        }),
      );
    }
    if (query.from) {
      qb.andWhere('(a.published_at AT TIME ZONE :tz)::date >= :from', { tz: this.app.timeZone, from: query.from });
    }
    if (query.to) {
      qb.andWhere('(a.published_at AT TIME ZONE :tz)::date <= :to', { tz: this.app.timeZone, to: query.to });
    }
    if (query.student_id) qb.andWhere(':studentId = ANY(r.student_ids)', { studentId: query.student_id });
    qb.orderBy('a.published_at', 'DESC').addOrderBy('a.id', 'DESC');
    qb.skip(offset(query.page, query.limit)).take(query.limit);
    const page = paginate(await qb.getManyAndCount(), query.page, query.limit);
    return { ...page, items: await this.presentMine(actor.id, page.items) };
  }

  async unreadCount(actor: AuthUser): Promise<{ unread: number }> {
    return { unread: await this.myQuery(actor.id).andWhere('r.read_at IS NULL').getCount() };
  }

  async myOne(actor: AuthUser, id: number): Promise<MyAnnouncementDto> {
    const announcement = await this.myQuery(actor.id).andWhere('a.id = :id', { id }).getOne();
    if (!announcement) throw AppException.notFound('Announcement not found', 'ANNOUNCEMENT_NOT_FOUND');
    return (await this.presentMine(actor.id, [announcement]))[0];
  }

  async markRead(actor: AuthUser, id: number): Promise<MyAnnouncementDto> {
    await this.myOne(actor, id);
    await this.dataSource.query(
      `UPDATE announcement_recipients SET read_at = now() WHERE announcement_id = $1 AND user_id = $2 AND read_at IS NULL`,
      [id, actor.id],
    );
    return this.myOne(actor, id);
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'announcements-scheduled' })
  async publishDue(now = new Date()): Promise<number> {
    const due = await this.announcements
      .createQueryBuilder()
      .update(Announcement)
      .set({ status: 'draft' })
      .where("status = 'scheduled' AND publish_at <= :now AND deleted_at IS NULL", { now })
      .returning('*')
      .execute()
      .then((result) => (result.raw as Announcement[]).map((row) => this.announcements.create(row)))
      .catch((error: Error) => {
        this.logger.warn(`Scheduled announcements failed: ${error.message}`);
        return [] as Announcement[];
      });
    for (const announcement of due) {
      await this.deliver(announcement, announcement.created_by).catch((error: Error) =>
        this.logger.warn(`Announcement ${announcement.id} not delivered: ${error.message}`),
      );
    }
    return due.length;
  }

  private async editPublished(
    announcement: Announcement,
    dto: AnnouncementInputDto,
    actor: AuthUser,
  ): Promise<AnnouncementDto> {
    const current = await this.targetsOf(announcement.id);
    const sameAudience =
      dto.audience === announcement.audience &&
      sameIds(dto.class_ids ?? [], current.class_ids) &&
      sameIds(dto.section_ids ?? [], current.section_ids) &&
      sameIds(dto.student_ids ?? [], current.student_ids) &&
      sameIds(dto.staff_user_ids ?? [], current.user_ids);
    if (!sameAudience) {
      throw AppException.conflict(
        'Who receives it cannot change after it is sent. Send a new announcement instead.',
        'ANNOUNCEMENT_AUDIENCE_LOCKED',
      );
    }
    const expiresAt = dto.expires_at ? new Date(dto.expires_at) : null;
    if (expiresAt && expiresAt <= (announcement.published_at ?? new Date())) {
      throw AppException.validation([
        { field: 'expires_at', message: 'The expiry must be after the announcement went out' },
      ]);
    }
    await this.checkAttachments(announcement.school_id, dto.file_ids);
    await this.dataSource.transaction(async (manager) => {
      await manager.update(Announcement, announcement.id, {
        title: dto.title,
        body: dto.body,
        priority: dto.priority ?? announcement.priority,
        expires_at: expiresAt,
        edited_at: new Date(),
        edited_by: actor.id,
      });
      if (dto.file_ids) {
        await manager.delete(AnnouncementAttachment, { announcement_id: announcement.id });
        await this.saveAttachments(manager, announcement.id, dto.file_ids);
      }
    });
    if (dto.notify_again) {
      const recipients = await this.recipients.findBy({ announcement_id: announcement.id });
      if (recipients.length) {
        await this.notifications
          .dispatch({
            template: TEMPLATES.ANNOUNCEMENT_UPDATED,
            audience: { user_ids: recipients.map((row) => row.user_id) },
            data: {
              title: dto.title,
              preview: preview(dto.body),
              announcement_id: String(announcement.id),
            },
          })
          .catch((error: Error) =>
            this.logger.warn(`Announcement ${announcement.id} update push failed: ${error.message}`),
          );
      }
    }
    return this.get(announcement.school_id, announcement.id);
  }

  private myQuery(userId: number) {
    return onlyCurrentYear(this.announcements.createQueryBuilder('a'))
      .innerJoin('announcement_recipients', 'r', 'r.announcement_id = a.id AND r.user_id = :userId', { userId })
      .where("a.status = 'published' AND (a.expires_at IS NULL OR a.expires_at > now())");
  }

  private async validate(schoolId: number, yearId: number, dto: AnnouncementInputDto) {
    const now = new Date();
    const publishAt = dto.publish_at ? new Date(dto.publish_at) : null;
    const expiresAt = dto.expires_at ? new Date(dto.expires_at) : null;
    const errors = [
      ...audienceErrors(dto.audience, dto.class_ids, dto.section_ids, dto.student_ids, dto.staff_user_ids),
      ...timingErrors(publishAt, expiresAt, now),
    ];
    if (errors.length) throw AppException.validation(errors);
    let targets: Targets = NO_TARGETS;
    if (dto.audience === 'classes') {
      targets = {
        ...NO_TARGETS,
        ...(await this.checkTargets(schoolId, yearId, dto.class_ids ?? [], dto.section_ids ?? [])),
      };
    }
    if (dto.audience === 'individuals') {
      targets = await this.checkIndividuals(schoolId, yearId, dto.student_ids ?? [], dto.staff_user_ids ?? []);
    }
    await this.checkAttachments(schoolId, dto.file_ids);
    const status: AnnouncementStatus = publishAt
      ? statusForPublish(publishAt, now)
      : dto.publish_now
        ? 'published'
        : 'draft';
    return { status, publishAt, expiresAt, targets };
  }

  private async checkAttachments(schoolId: number, fileIds: number[] | undefined): Promise<void> {
    for (const fileId of fileIds ?? []) {
      const file = await this.files.assertAttachable(fileId, schoolId, 'file_ids');
      const problem = attachmentError(file.mime_type);
      if (problem) throw AppException.validation([{ field: 'file_ids', message: `${file.original_name}: ${problem}` }]);
    }
  }

  private async checkIndividuals(
    schoolId: number,
    yearId: number,
    studentIds: number[],
    staffIds: number[],
  ): Promise<Targets> {
    const students = unique(studentIds);
    const staff = unique(staffIds);
    if (students.length) {
      const found: { id: number }[] = await this.dataSource.query(
        `SELECT s.id FROM students s JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $3
         WHERE s.id = ANY($1) AND s.school_id = $2 AND s.deleted_at IS NULL AND s.status = 'active'`,
        [students, schoolId, yearId],
      );
      const missing = students.filter((id) => !found.some((row) => Number(row.id) === id));
      if (missing.length) {
        throw AppException.validation([
          { field: 'student_ids', message: `Student ${missing[0]} is not an active student this year` },
        ]);
      }
    }
    if (staff.length) {
      const found: { id: number }[] = await this.dataSource.query(
        `SELECT DISTINCT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
         WHERE u.id = ANY($1) AND u.school_id = $2 AND u.deleted_at IS NULL AND u.status = 'active' AND r.code <> 'PARENT'`,
        [staff, schoolId],
      );
      const missing = staff.filter((id) => !found.some((row) => Number(row.id) === id));
      if (missing.length) {
        throw AppException.validation([
          { field: 'staff_user_ids', message: `User ${missing[0]} is not an active staff member of this school` },
        ]);
      }
    }
    return { ...NO_TARGETS, student_ids: students, user_ids: staff };
  }

  private async checkTargets(schoolId: number, yearId: number, classIds: number[], sectionIds: number[]) {
    const classes = unique(classIds);
    const sections = unique(sectionIds);
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
        throw AppException.validation([
          { field: 'section_ids', message: 'A section was not found in this academic year' },
        ]);
      }
    }
    return { class_ids: classes, section_ids: sections };
  }

  private async deliver(announcement: Announcement, actorId: number | null): Promise<Announcement> {
    const audience = await this.audienceOf(announcement);
    const now = new Date();
    await this.dataSource.transaction(async (manager) => {
      if (audience.length) {
        await manager
          .createQueryBuilder()
          .insert()
          .into(AnnouncementRecipient)
          .values(
            audience.map((row) => ({
              announcement_id: announcement.id,
              user_id: row.user_id,
              segment: row.segment,
              student_ids: row.student_ids,
            })),
          )
          .orIgnore()
          .execute();
      }
      await manager.update(Announcement, announcement.id, {
        status: 'published',
        published_at: now,
        published_by: actorId,
        recipient_count: audience.length,
      });
    });
    Object.assign(announcement, { status: 'published', published_at: now, published_by: actorId });
    announcement.recipient_count = audience.length;
    if (audience.length) {
      const [school] = await this.dataSource.query(`SELECT name FROM schools WHERE id = $1`, [announcement.school_id]);
      await this.notifications
        .dispatch({
          template: announcement.priority === 'urgent' ? TEMPLATES.ANNOUNCEMENT_URGENT : TEMPLATES.ANNOUNCEMENT,
          audience: { user_ids: audience.map((row) => row.user_id) },
          data: {
            title: announcement.title,
            preview: preview(announcement.body),
            school: school?.name ?? 'the school',
            announcement_id: String(announcement.id),
          },
        })
        .catch((error: Error) => this.logger.warn(`Announcement ${announcement.id} push failed: ${error.message}`));
    }
    return announcement;
  }

  private async audienceOf(announcement: Announcement): Promise<AudienceRow[]> {
    const targets = await this.targetsOf(announcement.id);
    const individuals = announcement.audience === 'individuals';
    const wantsStaff =
      ['everyone', 'staff'].includes(announcement.audience) || (individuals && targets.user_ids.length);
    const staff: { user_id: number }[] = wantsStaff
      ? await this.dataSource.query(
          `SELECT DISTINCT u.id AS user_id FROM users u
           JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
           WHERE u.school_id = $1 AND u.status = 'active' AND u.deleted_at IS NULL AND r.code <> 'PARENT'
             ${individuals ? 'AND u.id = ANY($2)' : ''}`,
          individuals ? [announcement.school_id, targets.user_ids] : [announcement.school_id],
        )
      : [];
    let parents: { user_id: number; student_ids: number[] }[] = [];
    const wantsParents = announcement.audience !== 'staff' && (!individuals || targets.student_ids.length > 0);
    if (wantsParents) {
      const params: unknown[] = [announcement.school_id, announcement.academic_year_id];
      let filter = '';
      if (announcement.audience === 'classes') {
        params.push(targets.class_ids, targets.section_ids);
        filter = 'AND (e.class_id = ANY($3) OR e.section_id = ANY($4))';
      }
      if (individuals) {
        params.push(targets.student_ids);
        filter = 'AND s.id = ANY($3)';
      }
      parents = await this.dataSource.query(
        `SELECT g.user_id, array_agg(DISTINCT s.id) AS student_ids FROM student_enrollments e
         JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
         JOIN student_guardians sg ON sg.student_id = s.id
         JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL AND g.user_id IS NOT NULL
         JOIN users u ON u.id = g.user_id AND u.status = 'active' AND u.deleted_at IS NULL
         WHERE s.school_id = $1 AND e.academic_year_id = $2 ${filter}
         GROUP BY g.user_id`,
        params,
      );
    }
    const result = new Map<number, AudienceRow>();
    staff.forEach((row) =>
      result.set(Number(row.user_id), { user_id: Number(row.user_id), segment: 'staff', student_ids: null }),
    );
    parents.forEach((row) => {
      const userId = Number(row.user_id);
      const studentIds = (row.student_ids ?? []).map(Number);
      const existing = result.get(userId);
      if (existing) existing.student_ids = studentIds;
      else result.set(userId, { user_id: userId, segment: 'parent', student_ids: studentIds });
    });
    return [...result.values()];
  }

  private async targetsOf(id: number): Promise<Targets> {
    const rows = await this.targets.findBy({ announcement_id: id });
    const pick = (key: 'class_id' | 'section_id' | 'student_id' | 'user_id') =>
      rows.map((row) => row[key]).filter((value): value is number => Boolean(value));
    return {
      class_ids: pick('class_id'),
      section_ids: pick('section_id'),
      student_ids: pick('student_id'),
      user_ids: pick('user_id'),
    };
  }

  private async find(schoolId: number, id: number): Promise<Announcement> {
    const announcement = await onlyCurrentYear(this.announcements.createQueryBuilder('a'))
      .where('a.id = :id AND a.school_id = :schoolId', { id, schoolId })
      .getOne();
    if (!announcement) throw AppException.notFound('Announcement not found', 'ANNOUNCEMENT_NOT_FOUND');
    return announcement;
  }

  private async saveTargets(manager: EntityManager, id: number, targets: Targets): Promise<void> {
    const empty = { class_id: null, section_id: null, student_id: null, user_id: null };
    const rows = [
      ...targets.class_ids.map((classId) => ({ ...empty, announcement_id: id, class_id: classId })),
      ...targets.section_ids.map((sectionId) => ({ ...empty, announcement_id: id, section_id: sectionId })),
      ...targets.student_ids.map((studentId) => ({ ...empty, announcement_id: id, student_id: studentId })),
      ...targets.user_ids.map((userId) => ({ ...empty, announcement_id: id, user_id: userId })),
    ];
    if (rows.length) await manager.insert(AnnouncementTarget, rows);
  }

  private async saveAttachments(manager: EntityManager, id: number, fileIds: number[]): Promise<void> {
    if (!fileIds.length) return;
    await manager.insert(
      AnnouncementAttachment,
      [...new Set(fileIds)].map((fileId, index) => ({ announcement_id: id, file_id: fileId, sort_order: index })),
    );
  }

  private async attachmentsOf(ids: number[]) {
    const list = ids.length
      ? await this.attachments.find({ where: { announcement_id: In(ids) }, order: { sort_order: 'ASC' } })
      : [];
    const presented = await this.files.presentMany(list.map((item) => item.file_id));
    return (id: number) =>
      list
        .filter((item) => item.announcement_id === id)
        .map((item) => presented.get(item.file_id))
        .filter((file): file is NonNullable<typeof file> => Boolean(file));
  }

  private async studentNames(ids: number[], yearId: number): Promise<Map<number, { id: number; name: string }>> {
    const wanted = unique(ids.map(Number));
    if (!wanted.length) return new Map();
    const rows: {
      id: number;
      first_name: string;
      last_name: string | null;
      class_name: string | null;
      section_name: string | null;
    }[] = await this.dataSource.query(
      `SELECT s.id, s.first_name, s.last_name, c.name AS class_name, sec.name AS section_name
       FROM students s
       LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $2
       LEFT JOIN sections sec ON sec.id = e.section_id
       LEFT JOIN classes c ON c.id = COALESCE(e.class_id, sec.class_id)
       WHERE s.id = ANY($1)`,
      [wanted, yearId],
    );
    return new Map(
      rows.map((row) => {
        const name = [row.first_name, row.last_name].filter(Boolean).join(' ');
        const klass = row.class_name ? [row.class_name, row.section_name].filter(Boolean).join(' - ') : null;
        return [Number(row.id), { id: Number(row.id), name: klass ? `${name} (${klass})` : name }];
      }),
    );
  }

  private async presentMine(userId: number, rows: Announcement[]): Promise<MyAnnouncementDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const [reads, schools, files] = await Promise.all([
      this.recipients.findBy({ announcement_id: In(ids), user_id: userId }),
      this.dataSource.query(`SELECT id, name FROM schools WHERE id = ANY($1)`, [
        [...new Set(rows.map((row) => row.school_id))],
      ]) as Promise<{ id: number; name: string }[]>,
      this.attachmentsOf(ids),
    ]);
    const readMap = new Map(reads.map((row) => [row.announcement_id, row.read_at]));
    const schoolMap = new Map(schools.map((row) => [Number(row.id), row.name]));
    const now = new Date();
    return rows
      .filter((row) => isVisible(row, now))
      .map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        priority: row.priority,
        school: { id: row.school_id, name: schoolMap.get(row.school_id) ?? '' },
        attachments: files(row.id),
        published_at: row.published_at as Date,
        expires_at: row.expires_at,
        edited_at: row.edited_at,
        is_read: Boolean(readMap.get(row.id)),
        read_at: readMap.get(row.id) ?? null,
      }));
  }

  private async present(rows: Announcement[]): Promise<AnnouncementDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const [targets, reads, files] = await Promise.all([
      this.dataSource.query(
        `SELECT t.announcement_id, t.class_id, t.section_id, t.student_id, t.user_id, c.name AS class_name,
                sc.name AS section_class, s.name AS section_name, tu.name AS user_name
         FROM announcement_targets t
         LEFT JOIN classes c ON c.id = t.class_id
         LEFT JOIN sections s ON s.id = t.section_id
         LEFT JOIN classes sc ON sc.id = s.class_id
         LEFT JOIN users tu ON tu.id = t.user_id
         WHERE t.announcement_id = ANY($1)`,
        [ids],
      ) as Promise<
        {
          announcement_id: number;
          class_id: number | null;
          section_id: number | null;
          student_id: number | null;
          user_id: number | null;
          class_name: string | null;
          section_class: string | null;
          section_name: string | null;
          user_name: string | null;
        }[]
      >,
      this.dataSource.query(
        `SELECT announcement_id, COUNT(*) FILTER (WHERE read_at IS NOT NULL) AS read FROM announcement_recipients
         WHERE announcement_id = ANY($1) GROUP BY announcement_id`,
        [ids],
      ) as Promise<{ announcement_id: number; read: string }[]>,
      this.attachmentsOf(ids),
    ]);
    const [users, years] = await Promise.all([
      this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [
        [...new Set(rows.flatMap((row) => [row.created_by, row.edited_by]).filter(Boolean))],
      ]) as Promise<{ id: number; name: string }[]>,
      this.dataSource.query(`SELECT id, name FROM academic_years WHERE id = ANY($1)`, [
        [...new Set(rows.map((row) => row.academic_year_id))],
      ]) as Promise<{ id: number; name: string }[]>,
    ]);
    const studentMaps = new Map<number, Map<number, { id: number; name: string }>>();
    for (const yearId of new Set(rows.map((row) => row.academic_year_id))) {
      studentMaps.set(
        yearId,
        await this.studentNames(
          targets
            .filter(
              (target) =>
                target.student_id &&
                rows.some((row) => row.id === Number(target.announcement_id) && row.academic_year_id === yearId),
            )
            .map((target) => Number(target.student_id)),
          yearId,
        ),
      );
    }
    const readMap = new Map(reads.map((row) => [Number(row.announcement_id), Number(row.read)]));
    const userMap = new Map(users.map((row) => [Number(row.id), row.name]));
    const yearMap = new Map(years.map((row) => [Number(row.id), row.name]));
    return rows.map((row) => {
      const mine = targets.filter((target) => Number(target.announcement_id) === row.id);
      const classes = mine
        .filter((target) => target.class_id)
        .map((target) => ({ id: Number(target.class_id), name: target.class_name ?? '' }));
      const sections = mine
        .filter((target) => target.section_id)
        .map((target) => ({
          id: Number(target.section_id),
          name: [target.section_class, target.section_name].filter(Boolean).join(' - '),
        }));
      const names = studentMaps.get(row.academic_year_id) ?? new Map();
      const students = mine
        .filter((target) => target.student_id)
        .map((target) => names.get(Number(target.student_id)) ?? { id: Number(target.student_id), name: '' });
      const staff = mine
        .filter((target) => target.user_id)
        .map((target) => ({ id: Number(target.user_id), name: target.user_name ?? '' }));
      const read = readMap.get(row.id) ?? 0;
      return {
        id: row.id,
        title: row.title,
        body: row.body,
        audience: row.audience,
        audience_label: this.audienceLabel(row.audience, classes, sections, students, staff),
        classes,
        sections,
        students,
        staff,
        priority: row.priority,
        status: row.status,
        publish_at: row.publish_at,
        published_at: row.published_at,
        expires_at: row.expires_at,
        attachments: files(row.id),
        recipient_count: row.recipient_count,
        read_count: read,
        read_percent: readPercent(row.recipient_count, read),
        author: { id: row.created_by ?? 0, name: (row.created_by && userMap.get(row.created_by)) || '' },
        academic_year: { id: row.academic_year_id, name: yearMap.get(row.academic_year_id) ?? '' },
        edited_at: row.edited_at,
        edited_by: row.edited_by ? { id: row.edited_by, name: userMap.get(row.edited_by) ?? '' } : null,
        created_at: row.created_at,
      };
    });
  }

  private audienceLabel(
    audience: Announcement['audience'],
    classes: { name: string }[],
    sections: { name: string }[],
    students: { name: string }[],
    staff: { name: string }[],
  ): string {
    if (audience === 'everyone') return 'Everyone: parents and staff';
    if (audience === 'parents') return 'All parents';
    if (audience === 'staff') return 'All staff';
    if (audience === 'individuals') {
      const parts = [
        students.length ? `parents of ${students.length} ${students.length === 1 ? 'student' : 'students'}` : null,
        staff.length ? `${staff.length} staff ${staff.length === 1 ? 'member' : 'members'}` : null,
      ].filter(Boolean);
      const text = parts.join(' and ');
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
    const names = [...classes.map((item) => `Class ${item.name}`), ...sections.map((item) => item.name)];
    return `Parents of ${names.join(', ')}`;
  }
}
