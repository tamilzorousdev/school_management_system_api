import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository, SelectQueryBuilder } from 'typeorm';
import { AppException, AuthUser, listQuery, offset, paginate, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { currentYearId, currentYearSql, onlyCurrentYear } from '../../shared/academic-year';
import { todayIn } from '../../shared/dates';
import { addDays } from '../../shared/school-days';
import { FilesService } from '../files/files.service';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { DiaryReviewMode } from '../schools/entities/school.entity';
import { AssignmentsService } from '../staff/assignments.service';
import {
  DiaryDetailDto,
  DiaryEntryDto,
  DiaryFeedItemDto,
  DiaryInputDto,
  DiaryInsightsDto,
  DiaryQueryDto,
  DiaryRecipientDto,
  DiaryUpdateDto,
  ParentDiaryQueryDto,
  TeacherDiaryQueryDto,
} from './dto/diary.dto';
import { DiaryAttachment } from './entities/diary-attachment.entity';
import { DiaryEntry, DiaryStatus } from './entities/diary-entry.entity';
import { DiaryRecipient } from './entities/diary-recipient.entity';
import { canEdit, dueDateError, initialStatus, scopeErrors, targetLabel, TYPE_LABELS } from './diary.logic';

interface Audience {
  class_id: number | null;
  section_id: number | null;
  student_ids: number[];
}

@Injectable()
export class DiaryService {
  private readonly logger = new Logger('Diary');

  constructor(
    @InjectRepository(DiaryEntry) private readonly entries: Repository<DiaryEntry>,
    @InjectRepository(DiaryRecipient) private readonly recipients: Repository<DiaryRecipient>,
    @InjectRepository(DiaryAttachment) private readonly attachments: Repository<DiaryAttachment>,
    private readonly assignments: AssignmentsService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async create(actor: AuthUser, dto: DiaryInputDto): Promise<DiaryDetailDto> {
    const schoolId = this.teacherSchool(actor);
    const errors = scopeErrors(dto);
    const due = dueDateError(dto.type, dto.due_date, todayIn(this.app.timeZone));
    if (due) errors.push(due);
    if (errors.length) throw AppException.validation(errors);
    const yearId = await currentYearId(this.dataSource.manager, schoolId);
    const audience = await this.audience(schoolId, yearId, actor.id, dto);
    if (!audience.student_ids.length) {
      throw AppException.conflict('There are no students in this class or section yet', 'NO_STUDENTS');
    }
    await this.assertSubject(schoolId, dto.subject_id);
    await this.assertFiles(schoolId, dto.file_ids);
    const status = initialStatus(await this.reviewMode(schoolId), dto.type);
    const now = new Date();
    const saved = await this.dataSource.transaction(async (manager) => {
      const entry = await manager.save(
        manager.create(DiaryEntry, {
          school_id: schoolId,
          academic_year_id: yearId,
          type: dto.type,
          scope: dto.scope,
          class_id: audience.class_id,
          section_id: audience.section_id,
          subject_id: dto.subject_id ?? null,
          title: dto.title,
          body: dto.body,
          due_date: dto.due_date ?? null,
          status,
          published_at: status === 'published' ? now : null,
          recipient_count: audience.student_ids.length,
          created_by: actor.id,
        }),
      );
      await manager.insert(
        DiaryRecipient,
        audience.student_ids.map((studentId) => ({ school_id: schoolId, entry_id: entry.id, student_id: studentId })),
      );
      await this.saveAttachments(manager, entry.id, dto.file_ids ?? []);
      return entry;
    });
    if (status === 'published') await this.notifyParents(saved, actor.name);
    return this.detailOf(saved);
  }

  async listForTeacher(actor: AuthUser, query: TeacherDiaryQueryDto): Promise<Paginated<DiaryEntryDto>> {
    const qb = onlyCurrentYear(this.entries.createQueryBuilder('d'))
      .where('d.school_id = :schoolId AND d.created_by = :userId', {
        schoolId: this.teacherSchool(actor),
        userId: actor.id,
      })
      .orderBy('d.created_at', 'DESC')
      .addOrderBy('d.id', 'DESC');
    if (query.status) qb.andWhere('d.status = :status', { status: query.status });
    if (query.type) qb.andWhere('d.type = :type', { type: query.type });
    if (query.section_id) qb.andWhere('d.section_id = :section', { section: query.section_id });
    qb.skip(offset(query.page, query.limit)).take(query.limit);
    const page = paginate(await qb.getManyAndCount(), query.page, query.limit);
    return { ...page, items: await this.present(page.items) };
  }

  async getForTeacher(actor: AuthUser, id: number): Promise<DiaryDetailDto> {
    return this.detailOf(await this.ownEntry(actor, id));
  }

  async update(actor: AuthUser, id: number, dto: DiaryUpdateDto): Promise<DiaryDetailDto> {
    const entry = await this.ownEntry(actor, id);
    if (!canEdit(entry.status)) {
      throw AppException.conflict(
        `Only a post waiting for review or sent back can be edited. This one is ${entry.status.replace('_', ' ')}.`,
        'DIARY_NOT_EDITABLE',
      );
    }
    const due = dueDateError(entry.type, dto.due_date, todayIn(this.app.timeZone));
    if (due) throw AppException.validation([due]);
    await this.assertSubject(entry.school_id, dto.subject_id);
    await this.assertFiles(entry.school_id, dto.file_ids);
    const status = initialStatus(await this.reviewMode(entry.school_id), entry.type);
    const saved = await this.dataSource.transaction(async (manager) => {
      Object.assign(entry, {
        title: dto.title,
        body: dto.body,
        subject_id: dto.subject_id ?? null,
        due_date: dto.due_date ?? null,
        status,
        published_at: status === 'published' ? new Date() : null,
        reviewed_by: null,
        reviewed_at: null,
        review_note: null,
      });
      if (dto.file_ids) {
        await manager.delete(DiaryAttachment, { entry_id: entry.id });
        await this.saveAttachments(manager, entry.id, dto.file_ids);
      }
      return manager.save(entry);
    });
    if (status === 'published') await this.notifyParents(saved, actor.name);
    return this.detailOf(saved);
  }

  async remove(actor: AuthUser, id: number): Promise<void> {
    const entry = await this.ownEntry(actor, id);
    await this.entries.softDelete(entry.id);
  }

  async feed(schoolId: number, studentId: number, query: ParentDiaryQueryDto): Promise<Paginated<DiaryFeedItemDto>> {
    const qb = this.feedQuery(schoolId, studentId).orderBy('d.published_at', 'DESC').addOrderBy('d.id', 'DESC');
    if (query.type) qb.andWhere('d.type = :type', { type: query.type });
    qb.skip(offset(query.page, query.limit)).take(query.limit);
    const page = paginate(await qb.getManyAndCount(), query.page, query.limit);
    const seen = page.items.length
      ? await this.recipients.findBy({ entry_id: In(page.items.map((item) => item.id)), student_id: studentId })
      : [];
    const seenMap = new Map(seen.map((row) => [row.entry_id, row.seen_at]));
    const presented = await this.present(page.items);
    return {
      ...page,
      items: presented.map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        body: item.body,
        due_date: item.due_date,
        subject: item.subject,
        teacher: item.author,
        attachments: item.attachments,
        published_at: item.published_at as Date,
        seen: Boolean(seenMap.get(item.id)),
        seen_at: seenMap.get(item.id) ?? null,
      })),
    };
  }

  async markSeen(schoolId: number, studentId: number, entryId: number, actor: AuthUser): Promise<{ seen_at: Date }> {
    const entry = await this.feedQuery(schoolId, studentId).andWhere('d.id = :entryId', { entryId }).getOne();
    if (!entry) throw AppException.notFound('Diary post not found', 'DIARY_NOT_FOUND');
    const now = new Date();
    await this.dataSource.query(
      `UPDATE diary_recipients SET seen_at = $3, seen_by = $4
       WHERE entry_id = $1 AND student_id = $2 AND seen_at IS NULL`,
      [entryId, studentId, now, actor.id],
    );
    const row = await this.recipients.findOneByOrFail({ entry_id: entryId, student_id: studentId });
    return { seen_at: row.seen_at ?? now };
  }

  async list(schoolId: number, query: DiaryQueryDto): Promise<Paginated<DiaryEntryDto>> {
    const qb = onlyCurrentYear(
      this.entries
        .createQueryBuilder('d')
        .innerJoin('users', 'author', 'author.id = d.created_by')
        .where('d.school_id = :schoolId', { schoolId }),
    );
    if (query.status) qb.andWhere('d.status = :status', { status: query.status });
    if (query.type) qb.andWhere('d.type = :type', { type: query.type });
    if (query.class_id) qb.andWhere('d.class_id = :classId', { classId: query.class_id });
    if (query.section_id) qb.andWhere('d.section_id = :sectionId', { sectionId: query.section_id });
    if (query.author_user_id) qb.andWhere('d.created_by = :author', { author: query.author_user_id });
    const page = await listQuery(qb, query.sort ? query : { ...query, sort: 'created_at', order: 'desc' }, {
      searchable: ['d.title', 'd.body', 'author.name'],
      sortable: { created_at: 'd.created_at', published_at: 'd.published_at', status: 'd.status', type: 'd.type' },
      defaultSort: 'created_at',
    });
    return { ...page, items: await this.present(page.items) };
  }

  async insights(schoolId: number): Promise<DiaryInsightsDto> {
    const today = todayIn(this.app.timeZone);
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE d.status = 'pending_review') AS pending_review,
              COUNT(*) FILTER (WHERE d.status = 'published' AND (d.published_at AT TIME ZONE $2)::date = $3::date) AS published_today,
              COUNT(*) FILTER (WHERE d.status = 'published') AS published,
              COUNT(*) FILTER (WHERE d.status = 'rejected') AS rejected,
              COUNT(*) FILTER (WHERE d.status = 'hidden') AS hidden,
              COUNT(*) FILTER (WHERE d.status = 'published' AND d.type = 'homework'
                               AND d.due_date BETWEEN $3::date AND $4::date) AS homework_due_this_week
       FROM diary_entries d ${currentYearSql('d')}
       WHERE d.school_id = $1 AND d.deleted_at IS NULL`,
      [schoolId, this.app.timeZone, today, addDays(today, 7)],
    );
    return {
      pending_review: Number(row.pending_review),
      published_today: Number(row.published_today),
      published: Number(row.published),
      rejected: Number(row.rejected),
      hidden: Number(row.hidden),
      homework_due_this_week: Number(row.homework_due_this_week),
      review_mode: await this.reviewMode(schoolId),
    };
  }

  async detail(schoolId: number, id: number): Promise<DiaryDetailDto> {
    return this.detailOf(await this.schoolEntry(schoolId, id));
  }

  async approve(schoolId: number, id: number, actor: AuthUser): Promise<DiaryDetailDto> {
    const entry = await this.schoolEntry(schoolId, id);
    this.assertStatus(entry, ['pending_review'], 'Only a post waiting for review can be approved');
    Object.assign(entry, {
      status: 'published',
      published_at: new Date(),
      reviewed_by: actor.id,
      reviewed_at: new Date(),
      review_note: null,
    });
    const saved = await this.entries.save(entry);
    await this.notifyParents(saved);
    return this.detailOf(saved);
  }

  async reject(schoolId: number, id: number, note: string, actor: AuthUser): Promise<DiaryDetailDto> {
    const entry = await this.schoolEntry(schoolId, id);
    this.assertStatus(entry, ['pending_review'], 'Only a post waiting for review can be sent back');
    Object.assign(entry, { status: 'rejected', reviewed_by: actor.id, reviewed_at: new Date(), review_note: note });
    const saved = await this.entries.save(entry);
    if (saved.created_by) {
      await this.notifications
        .dispatch({
          template: TEMPLATES.DIARY_REJECTED,
          audience: { user_ids: [saved.created_by] },
          data: { reviewer: actor.name, type: saved.type, title: saved.title, note: ` ${note}` },
        })
        .catch((error: Error) => this.logger.warn(`Diary ${saved.id} send-back notice failed: ${error.message}`));
    }
    return this.detailOf(saved);
  }

  async hide(schoolId: number, id: number, note: string | null | undefined, actor: AuthUser): Promise<DiaryDetailDto> {
    const entry = await this.schoolEntry(schoolId, id);
    this.assertStatus(entry, ['published'], 'Only a published post can be hidden');
    Object.assign(entry, {
      status: 'hidden',
      reviewed_by: actor.id,
      reviewed_at: new Date(),
      review_note: note ?? null,
    });
    return this.detailOf(await this.entries.save(entry));
  }

  async restore(schoolId: number, id: number, actor: AuthUser): Promise<DiaryDetailDto> {
    const entry = await this.schoolEntry(schoolId, id);
    this.assertStatus(entry, ['hidden'], 'Only a hidden post can be shown again');
    Object.assign(entry, { status: 'published', reviewed_by: actor.id, reviewed_at: new Date(), review_note: null });
    return this.detailOf(await this.entries.save(entry));
  }

  private feedQuery(schoolId: number, studentId: number): SelectQueryBuilder<DiaryEntry> {
    return onlyCurrentYear(this.entries.createQueryBuilder('d'))
      .innerJoin('diary_recipients', 'r', 'r.entry_id = d.id AND r.student_id = :studentId', { studentId })
      .where("d.school_id = :schoolId AND d.status = 'published'", { schoolId });
  }

  private async audience(schoolId: number, yearId: number, userId: number, dto: DiaryInputDto): Promise<Audience> {
    if (dto.scope === 'section') {
      await this.assignments.assertTeachesSection(schoolId, userId, dto.section_id!);
      const [section] = await this.dataSource.query(
        `SELECT class_id FROM sections WHERE id = $1 AND school_id = $2 AND academic_year_id = $3 AND deleted_at IS NULL`,
        [dto.section_id, schoolId, yearId],
      );
      if (!section) throw AppException.notFound('Section not found in this academic year', 'SECTION_NOT_FOUND');
      return {
        class_id: Number(section.class_id),
        section_id: dto.section_id!,
        student_ids: await this.studentsIn(yearId, [dto.section_id!]),
      };
    }
    const mine = new Set((await this.assignments.teacherClasses(schoolId, userId)).map((row) => row.section_id));
    if (dto.scope === 'class') {
      const sections: { id: number }[] = await this.dataSource.query(
        `SELECT id FROM sections WHERE class_id = $1 AND school_id = $2 AND academic_year_id = $3 AND deleted_at IS NULL`,
        [dto.class_id, schoolId, yearId],
      );
      if (!sections.length) throw AppException.notFound('Class not found in this academic year', 'CLASS_NOT_FOUND');
      const ids = sections.map((row) => Number(row.id));
      if (ids.some((id) => !mine.has(id))) {
        throw AppException.forbidden('You do not teach every section of this class', 'NOT_YOUR_SECTION');
      }
      return { class_id: dto.class_id!, section_id: null, student_ids: await this.studentsIn(yearId, ids) };
    }
    const rows: { student_id: number; section_id: number | null }[] = await this.dataSource.query(
      `SELECT s.id AS student_id, e.section_id FROM students s
       LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $2
       WHERE s.id = ANY($1) AND s.school_id = $3 AND s.deleted_at IS NULL AND s.status = 'active'`,
      [dto.student_ids, yearId, schoolId],
    );
    if (rows.length !== dto.student_ids!.length) {
      throw AppException.validation([{ field: 'student_ids', message: 'A student was not found in this school' }]);
    }
    if (rows.some((row) => !row.section_id || !mine.has(Number(row.section_id)))) {
      throw AppException.forbidden('One of these students is not in a section you teach', 'NOT_YOUR_SECTION');
    }
    return { class_id: null, section_id: null, student_ids: rows.map((row) => Number(row.student_id)) };
  }

  private async studentsIn(yearId: number, sectionIds: number[]): Promise<number[]> {
    const rows: { student_id: number }[] = await this.dataSource.query(
      `SELECT e.student_id FROM student_enrollments e
       JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       WHERE e.academic_year_id = $1 AND e.section_id = ANY($2)`,
      [yearId, sectionIds],
    );
    return rows.map((row) => Number(row.student_id));
  }

  private async assertSubject(schoolId: number, subjectId: number | null | undefined): Promise<void> {
    if (!subjectId) return;
    const [row] = await this.dataSource.query(
      `SELECT 1 FROM subjects WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [subjectId, schoolId],
    );
    if (!row) throw AppException.validation([{ field: 'subject_id', message: 'Subject not found in this school' }]);
  }

  private async assertFiles(schoolId: number, fileIds: number[] | undefined): Promise<void> {
    for (const fileId of fileIds ?? []) await this.files.assertAttachable(fileId, schoolId, 'file_ids');
  }

  private async saveAttachments(manager: EntityManager, entryId: number, fileIds: number[]): Promise<void> {
    if (!fileIds.length) return;
    await manager.insert(
      DiaryAttachment,
      [...new Set(fileIds)].map((fileId, index) => ({ entry_id: entryId, file_id: fileId, sort_order: index })),
    );
  }

  private async reviewMode(schoolId: number): Promise<DiaryReviewMode> {
    const [row] = await this.dataSource.query(`SELECT diary_review_mode FROM schools WHERE id = $1`, [schoolId]);
    return (row?.diary_review_mode as DiaryReviewMode) ?? 'none';
  }

  private async ownEntry(actor: AuthUser, id: number): Promise<DiaryEntry> {
    const entry = await onlyCurrentYear(this.entries.createQueryBuilder('d'))
      .where('d.id = :id AND d.school_id = :schoolId AND d.created_by = :userId', {
        id,
        schoolId: this.teacherSchool(actor),
        userId: actor.id,
      })
      .getOne();
    if (!entry) throw AppException.notFound('Diary post not found', 'DIARY_NOT_FOUND');
    return entry;
  }

  private async schoolEntry(schoolId: number, id: number): Promise<DiaryEntry> {
    const entry = await onlyCurrentYear(this.entries.createQueryBuilder('d'))
      .where('d.id = :id AND d.school_id = :schoolId', { id, schoolId })
      .getOne();
    if (!entry) throw AppException.notFound('Diary post not found', 'DIARY_NOT_FOUND');
    return entry;
  }

  private assertStatus(entry: DiaryEntry, allowed: DiaryStatus[], message: string): void {
    if (!allowed.includes(entry.status)) {
      throw AppException.conflict(`${message}. This one is ${entry.status.replace('_', ' ')}.`, 'DIARY_WRONG_STATUS');
    }
  }

  private teacherSchool(actor: AuthUser): number {
    if (!actor.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
    return actor.school_id;
  }

  private async notifyParents(entry: DiaryEntry, teacherName?: string): Promise<void> {
    const rows: { name: string; user_ids: number[] }[] = await this.dataSource.query(
      `SELECT s.first_name AS name, array_remove(array_agg(DISTINCT g.user_id), NULL) AS user_ids
       FROM diary_recipients r
       JOIN students s ON s.id = r.student_id
       JOIN student_guardians sg ON sg.student_id = s.id AND sg.receives_alerts = true
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
       WHERE r.entry_id = $1
       GROUP BY s.id, s.first_name`,
      [entry.id],
    );
    const [extra] = await this.dataSource.query(
      `SELECT (SELECT name FROM users WHERE id = $1) AS teacher, (SELECT name FROM subjects WHERE id = $2) AS subject`,
      [entry.created_by, entry.subject_id],
    );
    for (const row of rows) {
      const userIds = (row.user_ids ?? []).map(Number);
      if (!userIds.length) continue;
      await this.notifications
        .dispatch({
          template: TEMPLATES.DIARY_POSTED,
          audience: { user_ids: userIds },
          data: {
            type: TYPE_LABELS[entry.type],
            student: row.name,
            teacher: teacherName ?? extra?.teacher ?? 'The teacher',
            subject: extra?.subject ?? 'class',
            title: entry.title,
            entry_id: String(entry.id),
          },
        })
        .catch((error: Error) => this.logger.warn(`Diary ${entry.id} push failed: ${error.message}`));
    }
  }

  private async detailOf(entry: DiaryEntry): Promise<DiaryDetailDto> {
    const [presented] = await this.present([entry]);
    const rows: {
      student_id: number;
      name: string;
      class_name: string | null;
      section_name: string | null;
      seen_at: Date | null;
      seen_by: number | null;
      seen_by_name: string | null;
    }[] = await this.dataSource.query(
      `SELECT r.student_id, concat_ws(' ', s.first_name, s.last_name) AS name, c.name AS class_name, sec.name AS section_name,
              r.seen_at, r.seen_by, u.name AS seen_by_name
       FROM diary_recipients r
       JOIN students s ON s.id = r.student_id
       LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $2
       LEFT JOIN classes c ON c.id = e.class_id LEFT JOIN sections sec ON sec.id = e.section_id
       LEFT JOIN users u ON u.id = r.seen_by
       WHERE r.entry_id = $1
       ORDER BY sec.name, s.first_name`,
      [entry.id, entry.academic_year_id],
    );
    const recipients: DiaryRecipientDto[] = rows.map((row) => ({
      student: { id: Number(row.student_id), name: row.name },
      class_section: row.class_name ? [row.class_name, row.section_name].filter(Boolean).join(' - ') : null,
      seen_at: row.seen_at,
      seen_by: row.seen_by ? { id: Number(row.seen_by), name: row.seen_by_name ?? '' } : null,
    }));
    return { ...presented, recipients };
  }

  private async present(rows: DiaryEntry[]): Promise<DiaryEntryDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const lookup = async (sql: string, values: (number | null)[]) => {
      const wanted = [...new Set(values.filter((value): value is number => Boolean(value)))];
      if (!wanted.length) return new Map<number, string>();
      const result: { id: number; name: string }[] = await this.dataSource.query(sql, [wanted]);
      return new Map(result.map((row) => [Number(row.id), row.name]));
    };
    const [users, subjects, classes, sections, years, files, seen, studentCounts] = await Promise.all([
      lookup(
        `SELECT id, name FROM users WHERE id = ANY($1)`,
        rows.flatMap((row) => [row.created_by, row.reviewed_by]),
      ),
      lookup(
        `SELECT id, name FROM subjects WHERE id = ANY($1)`,
        rows.map((row) => row.subject_id),
      ),
      lookup(
        `SELECT id, name FROM classes WHERE id = ANY($1)`,
        rows.map((row) => row.class_id),
      ),
      lookup(
        `SELECT id, name FROM sections WHERE id = ANY($1)`,
        rows.map((row) => row.section_id),
      ),
      lookup(
        `SELECT id, name FROM academic_years WHERE id = ANY($1)`,
        rows.map((row) => row.academic_year_id),
      ),
      this.attachments
        .find({ where: { entry_id: In(ids) }, order: { sort_order: 'ASC' } })
        .then(async (list) => ({ list, presented: await this.files.presentMany(list.map((item) => item.file_id)) })),
      this.dataSource.query(
        `SELECT entry_id, COUNT(*) FILTER (WHERE seen_at IS NOT NULL) AS seen FROM diary_recipients
         WHERE entry_id = ANY($1) GROUP BY entry_id`,
        [ids],
      ) as Promise<{ entry_id: number; seen: string }[]>,
      Promise.resolve(new Map(rows.map((row) => [row.id, row.recipient_count]))),
    ]);
    const seenMap = new Map(seen.map((row) => [Number(row.entry_id), Number(row.seen)]));
    const ref = (map: Map<number, string>, id: number | null) => (id ? { id, name: map.get(id) ?? '' } : null);
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      due_date: row.due_date,
      subject: ref(subjects, row.subject_id),
      scope: row.scope,
      target_label: targetLabel(row.scope, {
        class_name: row.class_id ? classes.get(row.class_id) : null,
        section_name: row.section_id ? sections.get(row.section_id) : null,
        students: studentCounts.get(row.id),
      }),
      class: ref(classes, row.class_id),
      section: ref(sections, row.section_id),
      author: { id: row.created_by ?? 0, name: (row.created_by && users.get(row.created_by)) || '' },
      status: row.status,
      review: { by: ref(users, row.reviewed_by), at: row.reviewed_at, note: row.review_note },
      published_at: row.published_at,
      attachments: files.list
        .filter((item) => item.entry_id === row.id)
        .map((item) => files.presented.get(item.file_id))
        .filter((file): file is NonNullable<typeof file> => Boolean(file)),
      recipient_count: row.recipient_count,
      seen_count: seenMap.get(row.id) ?? 0,
      academic_year: { id: row.academic_year_id, name: years.get(row.academic_year_id) ?? '' },
      created_at: row.created_at,
    }));
  }
}
