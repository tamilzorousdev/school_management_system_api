import { HttpStatus, Inject, Injectable, Logger, StreamableFile } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AppException, AuthUser, FieldError, listQuery, Paginated, paginate } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { yearClause, yearWhere } from '../../shared/year-context';
import { AudienceInput, AudienceService, narrowStaffGroups } from '../emergency/audience.service';
import { StaffGroup } from '../emergency/entities/emergency.entity';
import { scheduleProblem, share } from '../emergency/emergency.logic';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { AcademicYear } from '../setup/entities/academic-year.entity';
import {
  CreateSurveyDto,
  ExtendSurveyDto,
  MySurveyDto,
  MySurveyItemDto,
  NotAnsweredDto,
  NotAnsweredQueryDto,
  RemindResultDto,
  ResultsQueryDto,
  SendSurveyDto,
  SubmitAnswersDto,
  SurveyDto,
  SurveyInsightsDto,
  SurveyPreviewDto,
  SurveyPreviewInputDto,
  SurveyQueryDto,
  SurveyQuestionDto,
  SurveyResultsDto,
  SurveyTemplateDto,
  SurveyTemplateInputDto,
  SurveyTemplateUpdateDto,
  UpdateSurveyDto,
} from './dto/survey.dto';
import {
  AnswerValue,
  Survey,
  SurveyAnswer,
  SurveyAudience,
  SurveyQuestion,
  SurveyRecipient,
  SurveyResponse,
  SurveyTemplate,
} from './entities/survey.entity';
import { surveyFile } from './survey-export';
import {
  AnswerRow,
  AppRole,
  checkAnswers,
  closesProblem,
  editProblem,
  expandRecipients,
  normalizeQuestions,
  pushRole,
  QuestionInput,
  questionProblems,
  READY_FORMS,
  recipientRole,
  REMINDER_LEAD_MS,
  reminderDue,
  summarize,
} from './survey.logic';

const CHUNK = 500;
const ROLE_KINDS: Record<'parent' | 'staff', string[]> = { parent: ['parent', 'both'], staff: ['staff', 'both'] };

interface RecipientFilter {
  class_id?: number;
  section_id?: number;
  role?: 'parent' | 'staff';
}

interface AudienceFields {
  audience: SurveyAudience;
  class_ids: number[] | null;
  section_ids: number[] | null;
  staff_groups: StaffGroup[] | null;
  per_child: boolean;
}

const rowsOf = <T>(result: unknown): T[] =>
  (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as T[];

@Injectable()
export class SurveysService {
  private readonly logger = new Logger('Surveys');
  private ticking = false;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Survey) private readonly surveys: Repository<Survey>,
    @InjectRepository(SurveyQuestion) private readonly questions: Repository<SurveyQuestion>,
    @InjectRepository(SurveyRecipient) private readonly recipients: Repository<SurveyRecipient>,
    @InjectRepository(SurveyTemplate) private readonly formTemplates: Repository<SurveyTemplate>,
    private readonly audience: AudienceService,
    private readonly notify: NotificationsService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async list(schoolId: number, query: SurveyQueryDto): Promise<Paginated<SurveyDto>> {
    const qb = this.surveys
      .createQueryBuilder('s')
      .where('s.school_id = :schoolId', { schoolId })
      .andWhere(`s.academic_year_id = ${this.yearSql(':schoolId')}`);
    if (query.status) qb.andWhere('s.status = :status', { status: query.status });
    const page = await listQuery(qb, query, {
      searchable: ['s.title', 's.description'],
      sortable: { created_at: 's.created_at', title: 's.title', closes_at: 's.closes_at', sent_at: 's.sent_at' },
      defaultSort: 'created_at',
    });
    return { ...page, items: await this.present(page.items) };
  }

  async insights(schoolId: number): Promise<SurveyInsightsDto> {
    const monthStart = `${todayIn(this.app.timeZone).slice(0, 7)}-01`;
    const year = this.yearSql('$1');
    const [statuses] = await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'open') AS open, COUNT(*) FILTER (WHERE status = 'draft') AS drafts
       FROM surveys WHERE school_id = $1 AND deleted_at IS NULL AND academic_year_id = ${year}`,
      [schoolId],
    );
    const [answers] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM survey_responses p JOIN surveys s ON s.id = p.survey_id AND s.deleted_at IS NULL
       WHERE p.school_id = $1 AND p.submitted_at >= ($2::date)::timestamp AT TIME ZONE $3`,
      [schoolId, monthStart, this.app.timeZone],
    );
    const [rate] = await this.dataSource.query(
      `SELECT AVG(rate) AS average FROM (
         SELECT COUNT(r.answered_at)::float / NULLIF(COUNT(r.id), 0) * 100 AS rate
         FROM surveys s JOIN survey_recipients r ON r.survey_id = s.id
         WHERE s.school_id = $1 AND s.deleted_at IS NULL AND s.status IN ('open', 'closed')
           AND s.academic_year_id = ${year}
         GROUP BY s.id) rates`,
      [schoolId],
    );
    return {
      open: Number(statuses?.open ?? 0),
      drafts: Number(statuses?.drafts ?? 0),
      answers_this_month: Number(answers?.total ?? 0),
      average_response_rate:
        rate?.average === null || rate?.average === undefined ? null : Math.round(rate.average * 10) / 10,
    };
  }

  async create(actor: AuthUser, schoolId: number, dto: CreateSurveyDto): Promise<SurveyDto> {
    const year = await this.dataSource.getRepository(AcademicYear).findOneBy(yearWhere(schoolId));
    if (!year) throw AppException.badRequest('Set the current academic year first', 'NO_CURRENT_YEAR');
    const fields = this.audienceFields(dto, null);
    const questions = this.checkedQuestions(dto.questions ?? []);
    const id = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(
        manager.create(Survey, {
          school_id: schoolId,
          academic_year_id: year.id,
          title: dto.title,
          description: dto.description || null,
          ...fields,
          is_anonymous: Boolean(dto.is_anonymous),
          status: 'draft',
          created_by: actor.id,
        }),
      );
      await this.replaceQuestions(manager, saved, questions);
      return saved.id;
    });
    this.logger.log(`Survey ${id} "${dto.title}" drafted by user ${actor.id}`);
    return this.detail(schoolId, id);
  }

  async update(schoolId: number, id: number, dto: UpdateSurveyDto): Promise<SurveyDto> {
    const survey = await this.find(schoolId, id);
    const changed = Object.entries(dto)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    const questions = dto.questions ? this.checkedQuestions(dto.questions) : null;
    await this.dataSource.transaction(async (manager) => {
      const current = await this.lockSurvey(manager, survey.id);
      const [answered] = await manager.query(
        `SELECT EXISTS (SELECT 1 FROM survey_responses WHERE survey_id = $1) AS locked`,
        [id],
      );
      const problem = editProblem(current.status, Boolean(answered?.locked), changed);
      if (problem) throw AppException.conflict(problem.message, problem.code);
      if (questions && !questions.length && current.status !== 'draft') {
        throw AppException.validation([{ field: 'questions', message: 'A sent form needs at least one question' }]);
      }
      const changes: Partial<Survey> = {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description || null } : {}),
        ...(dto.is_anonymous !== undefined ? { is_anonymous: dto.is_anonymous } : {}),
        ...(current.status === 'draft' ? this.audienceFields(dto, current) : {}),
      };
      if (Object.keys(changes).length) await manager.update(Survey, id, changes);
      if (questions) await this.replaceQuestions(manager, current, questions);
    });
    return this.detail(schoolId, id);
  }

  async remove(schoolId: number, id: number): Promise<void> {
    const survey = await this.find(schoolId, id);
    if (survey.status !== 'draft') {
      throw AppException.conflict('Only a draft can be deleted. Close the form instead.', 'SURVEY_NOT_DRAFT');
    }
    await this.surveys.softDelete(id);
  }

  async preview(schoolId: number, dto: SurveyPreviewInputDto): Promise<SurveyPreviewDto> {
    const fields = this.audienceFields(dto, null);
    const people = await this.audience.resolve(schoolId, this.audienceInput(fields));
    const withApp = people.filter((person) => person.user_id);
    return {
      recipients: expandRecipients(people, fields.per_child).length,
      people: withApp.length,
      parents: withApp.filter((person) => person.kind !== 'staff').length,
      staff: withApp.filter((person) => person.kind !== 'parent').length,
      without_app: people.length - withApp.length,
    };
  }

  async send(actor: AuthUser, schoolId: number, id: number, dto: SendSurveyDto): Promise<SurveyDto> {
    const survey = await this.find(schoolId, id);
    if (survey.status !== 'draft') throw AppException.conflict('This form has already been sent', 'SURVEY_NOT_DRAFT');
    const now = new Date();
    const sendAt = dto.send_at ? new Date(dto.send_at) : null;
    const closesAt = new Date(dto.closes_at);
    const errors: FieldError[] = [];
    const scheduled = sendAt ? scheduleProblem(sendAt, now) : null;
    if (scheduled) errors.push({ field: 'send_at', message: scheduled });
    const closing = closesProblem(closesAt, sendAt ?? now);
    if (closing) errors.push({ field: 'closes_at', message: closing });
    if (errors.length) throw AppException.validation(errors);
    const slots = await this.dataSource.transaction(async (manager) => {
      const current = await this.lockSurvey(manager, survey.id);
      if (current.status !== 'draft')
        throw AppException.conflict('This form has already been sent', 'SURVEY_NOT_DRAFT');
      if (!(await manager.countBy(SurveyQuestion, { survey_id: id }))) {
        throw AppException.validation([{ field: 'questions', message: 'Add at least one question before sending' }]);
      }
      const fields = this.audienceFields({}, current);
      const people = await this.audience.resolve(schoolId, this.audienceInput(fields));
      const slots = expandRecipients(people, fields.per_child);
      if (!slots.length) {
        throw AppException.badRequest('Nobody in this audience has the app to answer the form', 'NO_RECIPIENTS');
      }
      await manager.update(Survey, id, {
        status: sendAt ? 'scheduled' : 'open',
        send_at: sendAt,
        closes_at: closesAt,
        sent_at: sendAt ? null : now,
      });
      for (let start = 0; start < slots.length; start += CHUNK) {
        await manager.insert(
          SurveyRecipient,
          slots.slice(start, start + CHUNK).map((slot) => ({ ...slot, school_id: schoolId, survey_id: id })),
        );
      }
      return slots;
    });
    this.logger.log(
      `Survey ${id} ${sendAt ? `scheduled for ${sendAt.toISOString()}` : 'sent'} by user ${actor.id} to ${slots.length} slots`,
    );
    if (!sendAt) this.announceInBackground(id);
    return this.detail(schoolId, id);
  }

  async close(schoolId: number, id: number): Promise<SurveyDto> {
    const survey = await this.find(schoolId, id);
    if (survey.status === 'closed') throw AppException.conflict('This form is already closed', 'SURVEY_CLOSED');
    if (survey.status === 'draft') throw AppException.conflict('This form has not been sent yet', 'SURVEY_NOT_OPEN');
    await this.surveys
      .createQueryBuilder()
      .update(Survey)
      .set({ status: 'closed', closed_at: new Date() })
      .where("id = :id AND status IN ('open', 'scheduled')", { id })
      .execute();
    this.logger.log(`Survey ${id} closed by the school`);
    return this.detail(schoolId, id);
  }

  async extend(schoolId: number, id: number, dto: ExtendSurveyDto): Promise<SurveyDto> {
    const survey = await this.find(schoolId, id);
    if (survey.status === 'closed') throw AppException.conflict('This form is closed', 'SURVEY_CLOSED');
    if (survey.status === 'draft') throw AppException.conflict('This form has not been sent yet', 'SURVEY_NOT_OPEN');
    const closesAt = new Date(dto.closes_at);
    const now = new Date();
    if (survey.closes_at && survey.closes_at <= now)
      throw AppException.conflict('This form has closed', 'SURVEY_CLOSED');
    const opensAt = survey.send_at && survey.send_at > now ? survey.send_at : now;
    const problem =
      survey.closes_at && closesAt <= survey.closes_at
        ? 'Pick a date after the current close date'
        : closesProblem(closesAt, opensAt);
    if (problem) throw AppException.validation([{ field: 'closes_at', message: problem }]);
    const rearm = closesAt.getTime() - REMINDER_LEAD_MS > now.getTime();
    await this.surveys.update(id, {
      closes_at: closesAt,
      ...(survey.reminder_sent_at && rearm ? { reminder_sent_at: null } : {}),
    });
    return this.detail(schoolId, id);
  }

  async remind(schoolId: number, id: number): Promise<RemindResultDto> {
    const survey = await this.find(schoolId, id);
    if (survey.status !== 'open') throw AppException.conflict('Only an open form can be reminded', 'SURVEY_NOT_OPEN');
    if (survey.closes_at && survey.closes_at <= new Date()) {
      throw AppException.conflict('This form is closed', 'SURVEY_CLOSED');
    }
    return { reminded: await this.remindUnanswered(survey) };
  }

  async detail(schoolId: number, id: number): Promise<SurveyDto> {
    const [presented] = await this.present([await this.find(schoolId, id)]);
    return presented!;
  }

  async results(schoolId: number, id: number, query: ResultsQueryDto): Promise<SurveyResultsDto> {
    const survey = await this.find(schoolId, id);
    const [presented] = await this.present([survey]);
    const questions = await this.questionsOf(id);
    const filter = this.recipientFilter(survey, query, 2);
    const [counts] = await this.dataSource.query(
      `SELECT COUNT(*) AS recipients, COUNT(*) FILTER (WHERE r.answered_at IS NOT NULL) AS answered
       FROM survey_recipients r WHERE r.survey_id = $1 ${filter.sql}`,
      [id, ...filter.params],
    );
    const rows: {
      question_id: number;
      value: AnswerValue;
      name: string;
      student_id: number | null;
      students: SurveyRecipient['students'];
    }[] = await this.dataSource.query(
      `SELECT a.question_id, a.value, r.name, r.student_id, r.students
         FROM survey_answers a
         JOIN survey_responses p ON p.id = a.response_id
         JOIN survey_recipients r ON r.id = p.recipient_id
         WHERE p.survey_id = $1 ${filter.sql}
         ORDER BY p.submitted_at DESC, a.id`,
      [id, ...filter.params],
    );
    const answerRows: AnswerRow[] = rows.map((row) => ({
      question_id: Number(row.question_id),
      value: row.value,
      name: survey.is_anonymous ? null : this.personName(row),
      class_section: this.classSection(row),
    }));
    const recipients = Number(counts?.recipients ?? 0);
    const answered = Number(counts?.answered ?? 0);
    return {
      survey: presented!,
      counts: { recipients, answered, response_rate: share(answered, recipients) },
      questions: summarize(questions, answerRows, { anonymous: survey.is_anonymous, search: query.search }),
    };
  }

  async notAnswered(schoolId: number, id: number, query: NotAnsweredQueryDto): Promise<Paginated<NotAnsweredDto>> {
    const survey = await this.find(schoolId, id);
    if (survey.is_anonymous) {
      throw AppException.forbidden('This form is anonymous, so names are not shown', 'SURVEY_ANONYMOUS');
    }
    const filter = this.recipientFilter(survey, query, 2);
    const params: unknown[] = [id, ...filter.params];
    let search = '';
    if (query.search) {
      params.push(`%${query.search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
      search = `AND (r.name ILIKE $${params.length} OR r.students::text ILIKE $${params.length})`;
    }
    const where = `WHERE r.survey_id = $1 AND r.answered_at IS NULL ${filter.sql} ${search}`;
    const [count] = await this.dataSource.query(`SELECT COUNT(*) AS total FROM survey_recipients r ${where}`, params);
    const rows: SurveyRecipient[] = await this.dataSource.query(
      `SELECT r.* FROM survey_recipients r ${where} ORDER BY r.name, r.id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, (query.page - 1) * query.limit],
    );
    return paginate(
      [
        rows.map((row) => ({
          id: Number(row.id),
          name: row.name,
          role: row.kind,
          student: row.student_id ? { id: Number(row.student_id), name: row.students[0]?.name ?? '' } : null,
          class_section: this.classSection(row),
          reminded_at: row.reminded_at,
        })),
        Number(count?.total ?? 0),
      ],
      query.page,
      query.limit,
    );
  }

  async exportFile(schoolId: number, id: number, query: ResultsQueryDto): Promise<StreamableFile> {
    const results = await this.results(schoolId, id, { ...query, search: undefined });
    const survey = await this.find(schoolId, id);
    const filter = this.recipientFilter(survey, query, 2);
    const responses: {
      id: number;
      submitted_at: Date;
      name: string;
      kind: string;
      student_id: number | null;
      students: SurveyRecipient['students'];
    }[] = await this.dataSource.query(
      `SELECT p.id, p.submitted_at, r.name, r.kind, r.student_id, r.students
       FROM survey_responses p JOIN survey_recipients r ON r.id = p.recipient_id
       WHERE p.survey_id = $1 ${filter.sql} ORDER BY p.submitted_at, p.id`,
      [id, ...filter.params],
    );
    const answers: { response_id: number; question_id: number; value: AnswerValue }[] = responses.length
      ? await this.dataSource.query(
          `SELECT response_id, question_id, value FROM survey_answers WHERE response_id = ANY($1)`,
          [responses.map((row) => Number(row.id))],
        )
      : [];
    const stamp = new Intl.DateTimeFormat('en-IN', {
      timeZone: this.app.timeZone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const { counts } = results;
    return surveyFile({
      title: survey.title,
      subtitle: `${results.survey.audience_label} · ${counts.answered} of ${counts.recipients} answered${
        counts.response_rate === null ? '' : ` (${counts.response_rate}%)`
      }${survey.is_anonymous ? ' · anonymous: no names' : ''}`,
      anonymous: survey.is_anonymous,
      questions: results.questions.map((question) => ({ id: question.id, text: question.text })),
      summary: results.questions,
      rows: responses.map((response) => ({
        submitted: stamp.format(new Date(response.submitted_at)),
        person: survey.is_anonymous
          ? null
          : [
              response.name,
              response.kind === 'both' ? 'Parent and staff' : response.kind === 'staff' ? 'Staff' : 'Parent',
              response.student_id ? (response.students[0]?.name ?? '') : '',
              this.classSection(response) ?? '',
            ],
        answers: new Map(
          answers
            .filter((answer) => Number(answer.response_id) === Number(response.id))
            .map((answer) => [Number(answer.question_id), answer.value]),
        ),
      })),
    });
  }

  async templates(schoolId: number, all = false): Promise<SurveyTemplateDto[]> {
    await this.seedTemplates(schoolId);
    const rows = await this.formTemplates.find({
      where: { school_id: schoolId, ...(all ? {} : { is_active: true }) },
      order: { sort_order: 'ASC', id: 'ASC' },
    });
    return rows.map((row) => this.presentTemplate(row));
  }

  async createTemplate(actor: AuthUser, schoolId: number, dto: SurveyTemplateInputDto): Promise<SurveyTemplateDto> {
    await this.seedTemplates(schoolId);
    const questions = this.checkedQuestions(dto.questions);
    const last = await this.formTemplates.findOne({ where: { school_id: schoolId }, order: { sort_order: 'DESC' } });
    const saved = await this.formTemplates.save(
      this.formTemplates.create({
        school_id: schoolId,
        key: null,
        title: dto.title,
        description: dto.description || null,
        questions,
        is_active: dto.is_active ?? true,
        sort_order: dto.sort_order ?? (last?.sort_order ?? 0) + 1,
        created_by: actor.id,
      }),
    );
    return this.presentTemplate(saved);
  }

  async updateTemplate(schoolId: number, id: number, dto: SurveyTemplateUpdateDto): Promise<SurveyTemplateDto> {
    const row = await this.findTemplate(schoolId, id);
    const changes = Object.fromEntries(
      Object.entries({
        title: dto.title,
        description: dto.description === undefined ? undefined : dto.description || null,
        questions: dto.questions ? this.checkedQuestions(dto.questions) : undefined,
        is_active: dto.is_active,
        sort_order: dto.sort_order,
      }).filter(([, value]) => value !== undefined),
    );
    return this.presentTemplate(await this.formTemplates.save(this.formTemplates.merge(row, changes)));
  }

  async removeTemplate(schoolId: number, id: number): Promise<void> {
    await this.formTemplates.softRemove(await this.findTemplate(schoolId, id));
  }

  async mine(user: AuthUser, state: 'waiting' | 'done', role?: AppRole): Promise<MySurveyItemDto[]> {
    const waiting = state === 'waiting';
    const rows: {
      id: number;
      title: string;
      closes_at: Date | null;
      answered_at: Date | null;
      student_id: number | null;
      kind: SurveyRecipient['kind'];
      students: SurveyRecipient['students'];
      question_count: string;
    }[] = await this.dataSource.query(
      `SELECT s.id, s.title, s.closes_at, r.answered_at, r.student_id, r.kind, r.students,
              (SELECT COUNT(*) FROM survey_questions q WHERE q.survey_id = s.id) AS question_count
       FROM survey_recipients r
       JOIN surveys s ON s.id = r.survey_id AND s.deleted_at IS NULL
       WHERE r.user_id = $1 AND ${
         waiting ? `r.answered_at IS NULL AND s.status = 'open' AND s.closes_at > now()` : 'r.answered_at IS NOT NULL'
       }
       ORDER BY ${waiting ? 's.closes_at ASC' : 'r.answered_at DESC'}, r.id
       LIMIT 200`,
      [user.id],
    );
    return rows
      .map((row) => ({
        id: Number(row.id),
        title: row.title,
        closes_at: row.closes_at,
        question_count: Number(row.question_count),
        student: row.student_id ? { id: Number(row.student_id), name: row.students[0]?.name ?? '' } : null,
        role: recipientRole(row.kind, row.student_id ? Number(row.student_id) : null),
        answered_at: row.answered_at,
      }))
      .filter((item) => !role || !item.role || item.role === role);
  }

  async mineOne(user: AuthUser, id: number, studentId?: number): Promise<MySurveyDto> {
    const survey = await this.surveys.findOneBy({ id });
    if (!survey) throw AppException.notFound('Form not found', 'SURVEY_NOT_FOUND');
    const recipient = await this.myRecipient(user, survey, studentId);
    if (survey.status === 'draft' || survey.status === 'scheduled') {
      throw AppException.conflict('This form is not open yet', 'SURVEY_NOT_OPEN');
    }
    return this.presentMine(survey, recipient);
  }

  async submit(user: AuthUser, id: number, dto: SubmitAnswersDto): Promise<MySurveyDto> {
    const survey = await this.surveys.findOneBy({ id });
    if (!survey) throw AppException.notFound('Form not found', 'SURVEY_NOT_FOUND');
    const recipient = await this.myRecipient(user, survey, dto.student_id);
    this.assertAnswerable(survey, recipient.answered_at);
    const now = new Date();
    try {
      await this.dataSource.transaction(async (manager) => {
        const [fresh] = await manager.query(`SELECT status, closes_at FROM surveys WHERE id = $1 FOR SHARE`, [id]);
        const [current] = await manager.query(`SELECT answered_at FROM survey_recipients WHERE id = $1 FOR UPDATE`, [
          recipient.id,
        ]);
        this.assertAnswerable({ ...survey, ...fresh }, current?.answered_at ?? null);
        const questions = await manager.find(SurveyQuestion, {
          where: { survey_id: id },
          order: { sort_order: 'ASC', id: 'ASC' },
        });
        const check = checkAnswers(questions, dto.answers);
        if (check.code) {
          throw new AppException(HttpStatus.BAD_REQUEST, check.errors[0]!.message, check.code, check.errors);
        }
        const response = await manager.save(
          manager.create(SurveyResponse, {
            school_id: survey.school_id,
            survey_id: id,
            recipient_id: recipient.id,
            submitted_at: now,
          }),
        );
        if (check.values.length) {
          await manager.insert(
            SurveyAnswer,
            check.values.map((answer) => ({
              school_id: survey.school_id,
              response_id: response.id,
              question_id: answer.question_id,
              value: answer.value,
            })),
          );
        }
        await manager.update(SurveyRecipient, recipient.id, { answered_at: now });
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw AppException.conflict('You have already answered this form', 'SURVEY_ALREADY_ANSWERED');
      }
      throw error;
    }
    this.logger.log(
      `Survey ${id}: answer from user ${user.id}${recipient.student_id ? ` for student ${recipient.student_id}` : ''}`,
    );
    return this.presentMine(survey, { ...recipient, answered_at: now });
  }

  @Interval('surveys-lifecycle', 30_000)
  async lifecycle(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.openDue();
      await this.closeDue();
      await this.remindDue();
    } catch (error) {
      this.logger.error(`Survey lifecycle round failed: ${(error as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async openDue(): Promise<void> {
    const opened = rowsOf<{ id: number }>(
      await this.dataSource.query(
        `UPDATE surveys SET status = 'open', sent_at = now(), updated_at = now()
         WHERE id IN (
           SELECT id FROM surveys WHERE status = 'scheduled' AND send_at <= now() AND deleted_at IS NULL
           ORDER BY send_at LIMIT 20 FOR UPDATE SKIP LOCKED)
         RETURNING id`,
      ),
    );
    for (const row of opened) {
      this.logger.log(`Scheduled survey ${row.id} is open`);
      this.announceInBackground(Number(row.id));
    }
  }

  private async closeDue(): Promise<void> {
    const closed = rowsOf<{ id: number }>(
      await this.dataSource.query(
        `UPDATE surveys SET status = 'closed', closed_at = closes_at, updated_at = now()
         WHERE status IN ('open', 'scheduled') AND closes_at <= now() AND deleted_at IS NULL
         RETURNING id`,
      ),
    );
    for (const row of closed) this.logger.log(`Survey ${row.id} closed at its close date`);
  }

  private async remindDue(): Promise<void> {
    const now = new Date();
    const candidates = await this.surveys
      .createQueryBuilder('s')
      .where("s.status = 'open' AND s.reminder_sent_at IS NULL")
      .andWhere(`s.closes_at > now() AND s.closes_at <= now() + interval '24 hours'`)
      .andWhere(`s.sent_at < s.closes_at - interval '24 hours'`)
      .orderBy('s.closes_at', 'ASC')
      .take(100)
      .getMany();
    for (const survey of candidates.filter((row) => reminderDue(row, now))) {
      const claimed = rowsOf<{ id: number }>(
        await this.dataSource.query(
          `UPDATE surveys SET reminder_sent_at = now(), updated_at = now()
           WHERE id = $1 AND reminder_sent_at IS NULL RETURNING id`,
          [survey.id],
        ),
      );
      if (!claimed.length) continue;
      const reminded = await this.remindUnanswered(survey);
      this.logger.log(`Survey ${survey.id}: automatic reminder to ${reminded} people`);
    }
  }

  private announceInBackground(id: number): void {
    void this.announce(id).catch((error: Error) =>
      this.logger.warn(`Survey ${id}: new form notice not sent: ${error.message}`),
    );
  }

  private async announce(id: number): Promise<void> {
    const survey = await this.surveys.findOneBy({ id });
    if (!survey) return;
    const groups = await this.usersByRole(id, 'notified_at IS NULL');
    if (!groups.size) return;
    await this.tell(survey, TEMPLATES.SURVEY_NEW, groups);
    await this.dataSource.query(
      `UPDATE survey_recipients SET notified_at = now(), updated_at = now() WHERE survey_id = $1 AND notified_at IS NULL`,
      [id],
    );
  }

  private async remindUnanswered(survey: Survey): Promise<number> {
    const groups = await this.usersByRole(survey.id, 'answered_at IS NULL');
    const people = [...groups.values()].reduce((total, ids) => total + ids.length, 0);
    if (!people) return 0;
    await this.dataSource.query(
      `UPDATE survey_recipients SET reminded_at = now(), updated_at = now() WHERE survey_id = $1 AND answered_at IS NULL`,
      [survey.id],
    );
    void this.tell(survey, TEMPLATES.SURVEY_REMINDER, groups).catch((error: Error) =>
      this.logger.warn(`Survey ${survey.id}: reminder not sent: ${error.message}`),
    );
    return people;
  }

  private async usersByRole(surveyId: number, condition: string): Promise<Map<AppRole | null, number[]>> {
    const rows: { user_id: number; kind: SurveyRecipient['kind']; student_id: number | null }[] =
      await this.dataSource.query(
        `SELECT user_id, kind, student_id FROM survey_recipients WHERE survey_id = $1 AND ${condition}`,
        [surveyId],
      );
    const rolesOf = new Map<number, (AppRole | null)[]>();
    for (const row of rows) {
      const userId = Number(row.user_id);
      const role = recipientRole(row.kind, row.student_id === null ? null : Number(row.student_id));
      rolesOf.set(userId, [...(rolesOf.get(userId) ?? []), role]);
    }
    const groups = new Map<AppRole | null, number[]>();
    for (const [userId, roles] of rolesOf) {
      const role = pushRole(roles);
      groups.set(role, [...(groups.get(role) ?? []), userId]);
    }
    return groups;
  }

  private async tell(survey: Survey, template: string, groups: Map<AppRole | null, number[]>): Promise<void> {
    for (const [role, userIds] of groups) {
      await this.notify.dispatch({
        template,
        audience: { user_ids: userIds, school_id: survey.school_id },
        data: {
          title: survey.title,
          closes: this.closesText(survey.closes_at),
          survey_id: String(survey.id),
          ...(role ? { role } : {}),
        },
      });
    }
  }

  private closesText(date: Date | null): string {
    if (!date) return '';
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: this.app.timeZone,
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  }

  private assertAnswerable(survey: Pick<Survey, 'status' | 'closes_at'>, answeredAt: Date | null): void {
    if (survey.status === 'draft' || survey.status === 'scheduled') {
      throw AppException.conflict('This form is not open yet', 'SURVEY_NOT_OPEN');
    }
    if (survey.status === 'closed' || (survey.closes_at && new Date(survey.closes_at) <= new Date())) {
      throw AppException.conflict('This form is closed. Answers are no longer taken.', 'SURVEY_CLOSED');
    }
    if (answeredAt) throw AppException.conflict('You have already answered this form', 'SURVEY_ALREADY_ANSWERED');
  }

  private async myRecipient(user: AuthUser, survey: Survey, studentId?: number): Promise<SurveyRecipient> {
    const rows = await this.recipients.find({
      where: { survey_id: survey.id, user_id: user.id },
      order: { id: 'ASC' },
    });
    if (!rows.length) throw AppException.forbidden('This form was not sent to you', 'SURVEY_NOT_FOR_YOU');
    if (studentId) {
      const row = rows.find((item) => item.student_id === studentId);
      if (!row) throw AppException.forbidden('This form was not sent to you for this child', 'SURVEY_NOT_FOR_YOU');
      return row;
    }
    const row = rows.length === 1 ? rows[0] : rows.find((item) => item.student_id === null);
    if (!row) {
      throw AppException.validation([
        { field: 'student_id', message: 'This form is answered once for each child. Choose the child.' },
      ]);
    }
    return row;
  }

  private async presentMine(survey: Survey, recipient: SurveyRecipient): Promise<MySurveyDto> {
    const answers: { question_id: number; value: AnswerValue }[] = recipient.answered_at
      ? await this.dataSource.query(
          `SELECT a.question_id, a.value FROM survey_answers a JOIN survey_responses p ON p.id = a.response_id
           WHERE p.recipient_id = $1 ORDER BY a.id`,
          [recipient.id],
        )
      : [];
    return {
      id: survey.id,
      title: survey.title,
      description: survey.description,
      status: survey.status,
      is_anonymous: survey.is_anonymous,
      closes_at: survey.closes_at,
      student: recipient.student_id ? { id: recipient.student_id, name: recipient.students[0]?.name ?? '' } : null,
      role: recipientRole(recipient.kind, recipient.student_id),
      questions: (await this.questionsOf(survey.id)).map((question) => this.presentQuestion(question)),
      answered_at: recipient.answered_at,
      my_answers: recipient.answered_at
        ? answers.map((answer) => ({ question_id: Number(answer.question_id), value: answer.value }))
        : null,
    };
  }

  private recipientFilter(
    survey: Survey,
    filter: RecipientFilter,
    firstParam: number,
  ): { sql: string; params: unknown[] } {
    const parts: string[] = [];
    const params: unknown[] = [];
    const next = (value: unknown) => {
      params.push(value);
      return `$${firstParam + params.length - 1}`;
    };
    const children = `(CASE WHEN r.student_id IS NOT NULL THEN ARRAY[r.student_id]
      ELSE ARRAY(SELECT (x->>'id')::int FROM jsonb_array_elements(r.students) x) END)`;
    const enrolled = (column: string, value: number) =>
      `EXISTS (SELECT 1 FROM student_enrollments fe WHERE fe.academic_year_id = ${next(survey.academic_year_id)}
        AND fe.student_id = ANY(${children}) AND fe.${column} = ${next(value)})`;
    if (filter.class_id) parts.push(enrolled('class_id', filter.class_id));
    if (filter.section_id) parts.push(enrolled('section_id', filter.section_id));
    if (filter.role) parts.push(`r.kind = ANY(${next(ROLE_KINDS[filter.role])})`);
    return { sql: parts.map((part) => `AND ${part}`).join(' '), params };
  }

  private personName(row: { name: string; student_id: number | null; students: SurveyRecipient['students'] }): string {
    return row.student_id && row.students[0] ? `${row.name} (for ${row.students[0].name})` : row.name;
  }

  private classSection(row: { students: SurveyRecipient['students'] }): string | null {
    const sections = [...new Set((row.students ?? []).map((student) => student.section).filter(Boolean))];
    return sections.length ? sections.join(', ') : null;
  }

  private audienceFields(
    input: Partial<CreateSurveyDto & { per_child: boolean }>,
    current: Survey | null,
  ): AudienceFields {
    const audience = input.audience ?? current?.audience ?? 'parents';
    const fields: AudienceFields = {
      audience,
      class_ids: audience === 'classes' ? (input.class_ids ?? current?.class_ids ?? []) : null,
      section_ids: audience === 'sections' ? (input.section_ids ?? current?.section_ids ?? []) : null,
      staff_groups:
        audience === 'everyone' || audience === 'staff'
          ? narrowStaffGroups(input.staff_groups ?? current?.staff_groups ?? null)
          : null,
      per_child: audience === 'staff' ? false : (input.per_child ?? current?.per_child ?? false),
    };
    const errors: FieldError[] = [];
    if (audience === 'classes' && !fields.class_ids?.length) {
      errors.push({ field: 'class_ids', message: 'Choose at least one class' });
    }
    if (audience === 'sections' && !fields.section_ids?.length) {
      errors.push({ field: 'section_ids', message: 'Choose at least one section' });
    }
    if (errors.length) throw AppException.validation(errors);
    return fields;
  }

  private audienceInput(fields: AudienceFields): AudienceInput {
    return {
      audience: fields.audience,
      class_ids: fields.class_ids,
      section_ids: fields.section_ids,
      staff_groups: fields.staff_groups,
    };
  }

  private checkedQuestions(questions: QuestionInput[]) {
    const problems = questionProblems(questions);
    if (problems.length) throw AppException.validation(problems);
    return normalizeQuestions(questions);
  }

  private async replaceQuestions(
    manager: EntityManager,
    survey: Pick<Survey, 'id' | 'school_id'>,
    questions: ReturnType<typeof normalizeQuestions>,
  ): Promise<void> {
    await manager.delete(SurveyQuestion, { survey_id: survey.id });
    if (!questions.length) return;
    await manager.insert(
      SurveyQuestion,
      questions.map((question, index) => ({
        ...question,
        school_id: survey.school_id,
        survey_id: survey.id,
        sort_order: index + 1,
      })),
    );
  }

  private async lockSurvey(manager: EntityManager, id: number): Promise<Survey> {
    const survey = await manager.findOne(Survey, { where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!survey) throw AppException.notFound('Form not found', 'SURVEY_NOT_FOUND');
    return survey;
  }

  private questionsOf(surveyId: number): Promise<SurveyQuestion[]> {
    return this.questions.find({ where: { survey_id: surveyId }, order: { sort_order: 'ASC', id: 'ASC' } });
  }

  private presentQuestion(question: SurveyQuestion): SurveyQuestionDto {
    return {
      id: question.id,
      type: question.type,
      text: question.text,
      options: question.options ?? [],
      is_required: question.is_required,
      sort_order: question.sort_order,
    };
  }

  private yearSql(schoolParam: string): string {
    return `(SELECT y.id FROM academic_years y WHERE y.school_id = ${schoolParam} AND y.deleted_at IS NULL AND ${yearClause('y')} LIMIT 1)`;
  }

  private async seedTemplates(schoolId: number): Promise<void> {
    const existing = await this.formTemplates.count({ where: { school_id: schoolId }, withDeleted: true });
    if (existing) return;
    await this.formTemplates
      .createQueryBuilder()
      .insert()
      .into(SurveyTemplate)
      .values(
        READY_FORMS.map((form, index) => ({
          school_id: schoolId,
          key: form.key,
          title: form.title,
          description: form.description,
          questions: form.questions,
          is_active: true,
          sort_order: index + 1,
        })),
      )
      .orIgnore()
      .execute();
  }

  private async findTemplate(schoolId: number, id: number): Promise<SurveyTemplate> {
    const row = await this.formTemplates.findOneBy({ id, school_id: schoolId });
    if (!row) throw AppException.notFound('Ready-made form not found', 'TEMPLATE_NOT_FOUND');
    return row;
  }

  private presentTemplate(row: SurveyTemplate): SurveyTemplateDto {
    return {
      id: row.id,
      key: row.key,
      title: row.title,
      description: row.description,
      questions: row.questions,
      is_active: row.is_active,
      sort_order: row.sort_order,
    };
  }

  private async find(schoolId: number, id: number): Promise<Survey> {
    const survey = await this.surveys.findOneBy({ id, school_id: schoolId });
    if (!survey) throw AppException.notFound('Form not found', 'SURVEY_NOT_FOUND');
    return survey;
  }

  private async present(rows: Survey[]): Promise<SurveyDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const [counts, questions, labels, users] = await Promise.all([
      this.dataSource.query(
        `SELECT survey_id, COUNT(*) AS recipients, COUNT(*) FILTER (WHERE answered_at IS NOT NULL) AS answered
         FROM survey_recipients WHERE survey_id = ANY($1) GROUP BY survey_id`,
        [ids],
      ) as Promise<{ survey_id: number; recipients: string; answered: string }[]>,
      this.questions.find({ where: { survey_id: In(ids) }, order: { sort_order: 'ASC', id: 'ASC' } }),
      this.audience.labels(rows.map((row) => ({ ...row, include_teachers: false }))),
      this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [
        [...new Set(rows.map((row) => row.created_by).filter((id): id is number => Boolean(id)))],
      ]) as Promise<{ id: number; name: string }[]>,
    ]);
    return rows.map((row) => {
      const count = counts.find((item) => Number(item.survey_id) === row.id);
      const recipients = Number(count?.recipients ?? 0);
      const answered = Number(count?.answered ?? 0);
      const creator = users.find((user) => Number(user.id) === row.created_by);
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        audience: row.audience,
        class_ids: row.class_ids ?? [],
        section_ids: row.section_ids ?? [],
        staff_groups: row.staff_groups ?? [],
        audience_label: labels.get(row.id) ?? '',
        is_anonymous: row.is_anonymous,
        per_child: row.per_child,
        send_at: row.send_at,
        closes_at: row.closes_at,
        sent_at: row.sent_at,
        closed_at: row.closed_at,
        questions: questions.filter((question) => question.survey_id === row.id).map((q) => this.presentQuestion(q)),
        counts: { recipients, answered, response_rate: share(answered, recipients) },
        locked: answered > 0,
        created_by: creator ? { id: Number(creator.id), name: creator.name } : null,
        created_at: row.created_at,
      };
    });
  }
}
