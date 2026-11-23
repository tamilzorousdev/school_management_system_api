import { Inject, Injectable, Logger, StreamableFile } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AppException, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { currentYearId } from '../../shared/academic-year';
import { yearClause } from '../../shared/year-context';
import { ROLES } from '../access/access.catalog';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { departmentHodUserId } from '../staff/department-hod';
import { AppraisalGroupsService } from './appraisal-groups.service';
import { AppraisalMetricsService } from './appraisal-metrics.service';
import { autoScore, DEFAULT_INCREMENT_BANDS, RATING_LABELS } from './appraisal.logic';
import { appraisalFile } from './appraisal-export';
import { AppraisalsService } from './appraisals.service';
import {
  CycleDto,
  CycleInputDto,
  CycleInsightsDto,
  CycleQueryDto,
  ExtendCycleDto,
  RemindResultDto,
  StageCountsDto,
  UpdateCycleDto,
} from './dto/appraisal.dto';
import {
  Appraisal,
  AppraisalCycle,
  AppraisalGroup,
  AppraisalKra,
  AppraisalScore,
  IncrementBands,
  RATINGS,
  STAGES,
} from './entities/appraisal.entity';

const CHUNK = 200;
const DAY = 86_400_000;

@Injectable()
export class AppraisalCyclesService {
  private readonly logger = new Logger('AppraisalCycles');
  private ticking = false;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(AppraisalCycle) private readonly cycles: Repository<AppraisalCycle>,
    private readonly groups: AppraisalGroupsService,
    private readonly metrics: AppraisalMetricsService,
    private readonly reviews: AppraisalsService,
    private readonly notify: NotificationsService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async list(schoolId: number, query: CycleQueryDto): Promise<Paginated<CycleDto>> {
    const qb = this.cycles
      .createQueryBuilder('c')
      .where('c.school_id = :schoolId', { schoolId })
      .andWhere(
        `c.academic_year_id = (SELECT y.id FROM academic_years y WHERE y.school_id = :schoolId AND ${yearClause('y')} AND y.deleted_at IS NULL LIMIT 1)`,
      );
    if (query.status) qb.andWhere('c.status = :status', { status: query.status });
    const page = await listQuery(qb, query, {
      searchable: ['c.title', 'c.description'],
      sortable: { created_at: 'c.created_at', title: 'c.title', self_due_at: 'c.self_due_at' },
      defaultSort: 'created_at',
    });
    return { ...page, items: await this.present(page.items) };
  }

  async get(schoolId: number, id: number): Promise<CycleDto> {
    return (await this.present([await this.find(schoolId, id)]))[0]!;
  }

  async create(schoolId: number, dto: CycleInputDto): Promise<CycleDto> {
    const yearId = await currentYearId(this.dataSource.manager, schoolId);
    await this.assertGroups(schoolId, yearId, dto.group_ids);
    const dates = this.dates(dto);
    const cycle = await this.cycles.save(
      this.cycles.create({
        school_id: schoolId,
        academic_year_id: yearId,
        title: dto.title,
        description: dto.description ?? null,
        group_ids: dto.group_ids,
        ...dates,
        appeal_days: dto.appeal_days ?? 7,
        increment_bands: this.bands(dto.increment_bands),
        status: 'draft',
      }),
    );
    return this.get(schoolId, cycle.id);
  }

  async update(schoolId: number, id: number, dto: UpdateCycleDto): Promise<CycleDto> {
    const cycle = await this.find(schoolId, id);
    if (cycle.status !== 'draft' && cycle.status !== 'scheduled') {
      throw AppException.conflict('An open or closed cycle cannot be edited; use extend', 'CYCLE_LOCKED');
    }
    if (dto.group_ids) {
      await this.assertGroups(schoolId, cycle.academic_year_id, dto.group_ids);
      cycle.group_ids = dto.group_ids;
    }
    if (dto.title !== undefined) cycle.title = dto.title;
    if (dto.description !== undefined) cycle.description = dto.description;
    if (dto.appeal_days !== undefined) cycle.appeal_days = dto.appeal_days;
    if (dto.increment_bands !== undefined) cycle.increment_bands = this.bands(dto.increment_bands);
    Object.assign(
      cycle,
      this.dates({
        self_opens_at: dto.self_opens_at !== undefined ? dto.self_opens_at : cycle.self_opens_at?.toISOString(),
        self_due_at: dto.self_due_at ?? cycle.self_due_at.toISOString(),
        hod_due_at: dto.hod_due_at ?? cycle.hod_due_at.toISOString(),
        final_due_at: dto.final_due_at ?? cycle.final_due_at.toISOString(),
      }),
    );
    await this.cycles.save(cycle);
    return this.get(schoolId, id);
  }

  async remove(schoolId: number, id: number): Promise<void> {
    const cycle = await this.find(schoolId, id);
    if (cycle.status !== 'draft') throw AppException.conflict('Only a draft cycle can be deleted', 'CYCLE_NOT_DRAFT');
    await this.cycles.softDelete({ id: cycle.id });
  }

  async open(schoolId: number, id: number): Promise<CycleDto> {
    const opened = await this.dataSource.transaction(async (manager) => {
      const cycle = await this.lock(manager, schoolId, id);
      if (cycle.status !== 'draft')
        throw AppException.conflict('This cycle is already open or closed', 'CYCLE_NOT_DRAFT');
      const problems = await this.groups.kraSetProblems(manager, cycle.group_ids);
      if (problems.length) {
        throw AppException.conflict(
          `Finish the KRAs of ${problems.join(', ')}: weights must add up to 100%`,
          'GROUP_KRAS_INCOMPLETE',
        );
      }
      if (cycle.self_due_at.getTime() <= Date.now()) {
        throw AppException.validation([{ field: 'self_due_at', message: 'The self-appraisal deadline has passed' }]);
      }
      if (cycle.self_opens_at && cycle.self_opens_at.getTime() > Date.now()) {
        cycle.status = 'scheduled';
        await manager.save(cycle);
        return null;
      }
      const created = await this.snapshot(manager, cycle);
      if (!created.length) throw AppException.badRequest('Nobody is in the chosen groups', 'NO_RECIPIENTS');
      return { cycle, created };
    });
    if (opened) await this.announce(opened.cycle, opened.created);
    return this.get(schoolId, id);
  }

  async close(schoolId: number, id: number): Promise<CycleDto> {
    const cycle = await this.find(schoolId, id);
    if (cycle.status === 'closed') throw AppException.conflict('This cycle is already closed', 'CYCLE_CLOSED');
    if (cycle.status === 'draft') throw AppException.conflict('Open the cycle first', 'CYCLE_NOT_OPEN');
    cycle.status = 'closed';
    cycle.closed_at = new Date();
    await this.cycles.save(cycle);
    return this.get(schoolId, id);
  }

  async extend(schoolId: number, id: number, dto: ExtendCycleDto): Promise<CycleDto> {
    const cycle = await this.find(schoolId, id);
    if (cycle.status === 'draft' || cycle.status === 'closed') {
      throw AppException.conflict('Only a scheduled or open cycle can be extended', 'CYCLE_NOT_OPEN');
    }
    const dates = this.dates({
      self_opens_at: cycle.self_opens_at?.toISOString() ?? null,
      self_due_at: dto.self_due_at ?? cycle.self_due_at.toISOString(),
      hod_due_at: dto.hod_due_at ?? cycle.hod_due_at.toISOString(),
      final_due_at: dto.final_due_at ?? cycle.final_due_at.toISOString(),
    });
    if (dto.self_due_at && dates.self_due_at.getTime() > cycle.self_due_at.getTime()) {
      cycle.self_reminder_sent_at = null;
      if (!cycle.self_moved_at) cycle.self_due_at = dates.self_due_at;
    }
    if (dto.hod_due_at && dates.hod_due_at.getTime() > cycle.hod_due_at.getTime()) cycle.hod_reminder_sent_at = null;
    cycle.hod_due_at = dates.hod_due_at;
    cycle.final_due_at = dates.final_due_at;
    await this.cycles.save(cycle);
    return this.get(schoolId, id);
  }

  async remind(schoolId: number, id: number): Promise<RemindResultDto> {
    const cycle = await this.find(schoolId, id);
    if (cycle.status !== 'open') throw AppException.conflict('This cycle is not open', 'CYCLE_NOT_OPEN');
    return { reminded: (await this.remindSelf(cycle)) + (await this.remindHods(cycle)) };
  }

  async insights(schoolId: number, id: number): Promise<CycleInsightsDto> {
    const cycle = await this.find(schoolId, id);
    const [counts] = (await this.counts([cycle.id])).values();
    const [summary] = await this.dataSource.query(
      `SELECT AVG(final_percent) FILTER (WHERE stage IN ('published', 'appealed', 'completed')) AS average,
              (SELECT COUNT(*) FROM appraisal_appeals ap JOIN appraisals x ON x.id = ap.appraisal_id
                 WHERE x.cycle_id = $1 AND ap.status = 'pending' AND ap.deleted_at IS NULL) AS appeals
       FROM appraisals WHERE cycle_id = $1 AND deleted_at IS NULL`,
      [cycle.id],
    );
    const ratingRows: { rating: string; count: string }[] = await this.dataSource.query(
      `SELECT rating, COUNT(*) AS count FROM appraisals
       WHERE cycle_id = $1 AND deleted_at IS NULL AND stage IN ('published', 'appealed', 'completed')
       GROUP BY rating`,
      [cycle.id],
    );
    return {
      counts: counts ?? emptyCounts(),
      average_final_percent: summary?.average === null ? null : Math.round(Number(summary.average) * 10) / 10,
      ratings: RATINGS.map((rating) => ({
        rating,
        count: Number(ratingRows.find((row) => row.rating === rating)?.count ?? 0),
      })),
      appeals_pending: Number(summary?.appeals ?? 0),
    };
  }

  async export(schoolId: number, id: number): Promise<StreamableFile> {
    const cycle = await this.find(schoolId, id);
    const rows = await this.dataSource.getRepository(Appraisal).find({ where: { cycle_id: cycle.id } });
    const presented = await this.reviews.present(rows, 'admin', true);
    return appraisalFile(cycle.title, presented as Parameters<typeof appraisalFile>[1]);
  }

  @Interval('appraisal-cycles', 60_000)
  async lifecycle(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.openDue();
      await this.selfReminders();
      await this.moveMissedSelf();
      await this.hodReminders();
    } catch (error) {
      this.logger.error(`Lifecycle failed: ${(error as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async openDue(): Promise<void> {
    const due: { id: number }[] = await this.dataSource.query(
      `SELECT id FROM appraisal_cycles WHERE status = 'scheduled' AND self_opens_at <= now() AND deleted_at IS NULL LIMIT 10`,
    );
    for (const { id } of due) {
      const opened = await this.dataSource.transaction(async (manager) => {
        const [row] = await manager.query(
          `SELECT id FROM appraisal_cycles WHERE id = $1 AND status = 'scheduled' FOR UPDATE SKIP LOCKED`,
          [id],
        );
        if (!row) return null;
        const cycle = await manager.findOneByOrFail(AppraisalCycle, { id: Number(id) });
        const created = await this.snapshot(manager, cycle);
        return { cycle, created };
      });
      if (opened) await this.announce(opened.cycle, opened.created);
    }
  }

  private async selfReminders(): Promise<void> {
    const due = await this.claim(
      `UPDATE appraisal_cycles SET self_reminder_sent_at = now()
       WHERE status = 'open' AND self_reminder_sent_at IS NULL AND self_moved_at IS NULL
         AND self_due_at > now() AND self_due_at <= now() + interval '24 hours' AND deleted_at IS NULL
       RETURNING id`,
    );
    for (const cycle of due) await this.remindSelf(cycle);
  }

  private async hodReminders(): Promise<void> {
    const due = await this.claim(
      `UPDATE appraisal_cycles SET hod_reminder_sent_at = now()
       WHERE status = 'open' AND hod_reminder_sent_at IS NULL
         AND hod_due_at > now() AND hod_due_at <= now() + interval '24 hours' AND deleted_at IS NULL
       RETURNING id`,
    );
    for (const cycle of due) await this.remindHods(cycle);
  }

  private async moveMissedSelf(): Promise<void> {
    const due = await this.claim(
      `UPDATE appraisal_cycles SET self_moved_at = now()
       WHERE status = 'open' AND self_moved_at IS NULL AND self_due_at <= now() AND deleted_at IS NULL
       RETURNING id`,
    );
    for (const cycle of due) {
      const moved: { id: number; hod_user_id: number | null; user_id: number }[] = await this.dataSource.query(
        `UPDATE appraisals SET self_missed = true, updated_at = now(),
                stage = CASE WHEN hod_user_id IS NULL THEN 'principal_pending' ELSE 'hod_pending' END
         WHERE cycle_id = $1 AND stage = 'self_pending' AND deleted_at IS NULL
         RETURNING id, hod_user_id, user_id`,
        [cycle.id],
      );
      const names = await this.names(moved.map((row) => Number(row.user_id)));
      for (const row of moved.filter((item) => item.hod_user_id)) {
        await this.send(TEMPLATES.APPRAISAL_HOD_REVIEW, [Number(row.hod_user_id)], cycle.school_id, {
          staff_name: names.get(Number(row.user_id)) ?? '',
          title: cycle.title,
          due: this.when(cycle.hod_due_at),
          appraisal_id: Number(row.id),
        });
      }
    }
  }

  private async claim(sql: string): Promise<AppraisalCycle[]> {
    const rows: { id: number }[][] | { id: number }[] = await this.dataSource.query(sql);
    const ids = (Array.isArray(rows[0]) ? (rows[0] as { id: number }[]) : (rows as { id: number }[])).map((row) =>
      Number(row.id),
    );
    return ids.length ? this.cycles.findBy({ id: In(ids) }) : [];
  }

  private async snapshot(manager: EntityManager, cycle: AppraisalCycle): Promise<Appraisal[]> {
    const placed = await this.groups.place(manager, cycle.school_id, cycle.academic_year_id);
    const already = new Set((await manager.findBy(Appraisal, { cycle_id: cycle.id })).map((row) => row.staff_id));
    const people = [...placed.values()].filter(
      (person) => cycle.group_ids.includes(person.group_id) && !already.has(person.staff_id),
    );
    const kras = await manager.find(AppraisalKra, {
      where: { group_id: In(cycle.group_ids) },
      order: { sort_order: 'ASC', id: 'ASC' },
    });
    const values = await this.metrics.forUsers(
      cycle.school_id,
      cycle.academic_year_id,
      people.map((person) => person.user_id),
    );
    const created: Appraisal[] = [];
    for (let start = 0; start < people.length; start += CHUNK) {
      const batch = people.slice(start, start + CHUNK);
      const rows: Appraisal[] = [];
      for (const person of batch) {
        const skipHod = person.roles.includes(ROLES.HOD) || person.roles.includes(ROLES.PRINCIPAL);
        const hod = skipHod
          ? null
          : await departmentHodUserId(manager, cycle.school_id, person.department, person.user_id);
        rows.push(
          manager.create(Appraisal, {
            school_id: cycle.school_id,
            cycle_id: cycle.id,
            academic_year_id: cycle.academic_year_id,
            staff_id: person.staff_id,
            user_id: person.user_id,
            group_id: person.group_id,
            hod_user_id: hod,
            stage: 'self_pending',
          }),
        );
      }
      const saved = await manager.save(rows);
      const scores = saved.flatMap((appraisal) =>
        kras
          .filter((kra) => kra.group_id === appraisal.group_id)
          .map((kra) => {
            const value = kra.auto_metric ? (values.get(appraisal.user_id)?.[kra.auto_metric] ?? null) : null;
            return manager.create(AppraisalScore, {
              school_id: cycle.school_id,
              appraisal_id: appraisal.id,
              kra_id: kra.id,
              code: kra.code,
              title: kra.title,
              description: kra.description,
              weightage_percent: kra.weightage_percent,
              max_score: kra.max_score,
              scoring_mode: kra.scoring_mode,
              auto_metric: kra.auto_metric,
              auto_target: kra.auto_target,
              sort_order: kra.sort_order,
              auto_value: kra.scoring_mode === 'auto' && value !== null ? String(value) : null,
              auto_score:
                kra.scoring_mode === 'auto'
                  ? nullable(autoScore(value, Number(kra.auto_target ?? 0), kra.max_score))
                  : null,
            });
          }),
      );
      if (scores.length) await manager.save(scores);
      created.push(...saved);
    }
    cycle.status = 'open';
    cycle.opened_at = new Date();
    await manager.save(cycle);
    return created;
  }

  private async announce(cycle: AppraisalCycle, created: Appraisal[]): Promise<void> {
    for (const appraisal of created) {
      await this.send(TEMPLATES.APPRAISAL_SELF_OPEN, [appraisal.user_id], cycle.school_id, {
        title: cycle.title,
        due: this.when(cycle.self_due_at),
        appraisal_id: appraisal.id,
      });
    }
  }

  private async remindSelf(cycle: AppraisalCycle): Promise<number> {
    const rows = await this.dataSource.getRepository(Appraisal).findBy({ cycle_id: cycle.id, stage: 'self_pending' });
    for (const row of rows) {
      await this.send(TEMPLATES.APPRAISAL_SELF_REMINDER, [row.user_id], cycle.school_id, {
        title: cycle.title,
        due: this.when(cycle.self_due_at),
        appraisal_id: row.id,
      });
    }
    return rows.length;
  }

  private async remindHods(cycle: AppraisalCycle): Promise<number> {
    const rows: { hod_user_id: number; count: string; first: number }[] = await this.dataSource.query(
      `SELECT hod_user_id, COUNT(*) AS count, MIN(id) AS first FROM appraisals
       WHERE cycle_id = $1 AND stage = 'hod_pending' AND hod_user_id IS NOT NULL AND deleted_at IS NULL
       GROUP BY hod_user_id`,
      [cycle.id],
    );
    for (const row of rows) {
      await this.send(TEMPLATES.APPRAISAL_HOD_REMINDER, [Number(row.hod_user_id)], cycle.school_id, {
        title: cycle.title,
        count: Number(row.count),
        due: this.when(cycle.hod_due_at),
        appraisal_id: Number(row.first),
      });
    }
    return rows.length;
  }

  private async present(rows: AppraisalCycle[]): Promise<CycleDto[]> {
    if (!rows.length) return [];
    const groupIds = [...new Set(rows.flatMap((row) => row.group_ids))];
    const [groups, counts] = await Promise.all([
      groupIds.length
        ? this.dataSource.getRepository(AppraisalGroup).find({ where: { id: In(groupIds) }, withDeleted: true })
        : [],
      this.counts(rows.map((row) => row.id)),
    ]);
    return rows.map((row) => ({
      id: row.id,
      academic_year_id: row.academic_year_id,
      title: row.title,
      description: row.description,
      groups: row.group_ids.map((id) => ({ id, name: groups.find((group) => group.id === id)?.name ?? '' })),
      self_opens_at: row.self_opens_at,
      self_due_at: row.self_due_at,
      hod_due_at: row.hod_due_at,
      final_due_at: row.final_due_at,
      appeal_days: row.appeal_days,
      increment_bands: row.increment_bands,
      status: row.status,
      is_legacy: row.is_legacy,
      opened_at: row.opened_at,
      closed_at: row.closed_at,
      counts: counts.get(row.id) ?? emptyCounts(),
    }));
  }

  private async counts(ids: number[]): Promise<Map<number, StageCountsDto>> {
    const rows: { cycle_id: number; stage: string; count: string; missed: string }[] = await this.dataSource.query(
      `SELECT cycle_id, stage, COUNT(*) AS count, COUNT(*) FILTER (WHERE self_missed) AS missed
       FROM appraisals WHERE cycle_id = ANY($1) AND deleted_at IS NULL GROUP BY cycle_id, stage`,
      [ids],
    );
    const result = new Map<number, StageCountsDto>();
    for (const row of rows) {
      const counts = result.get(Number(row.cycle_id)) ?? emptyCounts();
      counts[row.stage as (typeof STAGES)[number]] = Number(row.count);
      counts.total += Number(row.count);
      counts.self_missed += Number(row.missed);
      result.set(Number(row.cycle_id), counts);
    }
    return result;
  }

  private dates(input: {
    self_opens_at?: string | null;
    self_due_at: string;
    hod_due_at: string;
    final_due_at: string;
  }) {
    const self_opens_at = input.self_opens_at ? new Date(input.self_opens_at) : null;
    const self_due_at = new Date(input.self_due_at);
    const hod_due_at = new Date(input.hod_due_at);
    const final_due_at = new Date(input.final_due_at);
    const errors = [];
    if (self_opens_at && self_opens_at.getTime() >= self_due_at.getTime()) {
      errors.push({ field: 'self_due_at', message: 'The self-appraisal must close after it opens' });
    }
    if (hod_due_at.getTime() < self_due_at.getTime()) {
      errors.push({ field: 'hod_due_at', message: 'The HOD deadline comes after the self-appraisal deadline' });
    }
    if (final_due_at.getTime() < hod_due_at.getTime()) {
      errors.push({ field: 'final_due_at', message: 'The final deadline comes after the HOD deadline' });
    }
    if (final_due_at.getTime() - Date.now() > 400 * DAY) {
      errors.push({ field: 'final_due_at', message: 'Pick a date within a year' });
    }
    if (errors.length) throw AppException.validation(errors);
    return { self_opens_at, self_due_at, hod_due_at, final_due_at };
  }

  private bands(input?: IncrementBands): IncrementBands {
    const bands = { ...DEFAULT_INCREMENT_BANDS };
    for (const rating of RATINGS) {
      const value = input?.[rating];
      if (value === undefined) continue;
      if (typeof value !== 'number' || value < 0 || value > 100) {
        throw AppException.validation([
          { field: `increment_bands.${rating}`, message: `${RATING_LABELS[rating]}: a % from 0 to 100` },
        ]);
      }
      bands[rating] = value;
    }
    return bands;
  }

  private async assertGroups(schoolId: number, yearId: number, ids: number[]): Promise<void> {
    const found = await this.dataSource
      .getRepository(AppraisalGroup)
      .findBy({ id: In(ids), school_id: schoolId, academic_year_id: yearId });
    if (found.length !== ids.length) {
      throw AppException.validation([{ field: 'group_ids', message: 'Choose groups of this academic year' }]);
    }
  }

  private async names(userIds: number[]): Promise<Map<number, string>> {
    if (!userIds.length) return new Map();
    const rows: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT id, name FROM users WHERE id = ANY($1)`,
      [userIds],
    );
    return new Map(rows.map((row) => [Number(row.id), row.name]));
  }

  private async send(template: string, userIds: number[], schoolId: number, data: Record<string, string | number>) {
    await this.notify.dispatch({
      template,
      audience: { user_ids: userIds, school_id: schoolId },
      data: { ...data, appraisal_id: String(data.appraisal_id) },
    });
  }

  private when(date: Date): string {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: this.app.timeZone,
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  }

  private async lock(manager: EntityManager, schoolId: number, id: number): Promise<AppraisalCycle> {
    const cycle = await manager.findOne(AppraisalCycle, {
      where: { id, school_id: schoolId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!cycle) throw AppException.notFound('Appraisal cycle not found', 'CYCLE_NOT_FOUND');
    return cycle;
  }

  private async find(schoolId: number, id: number): Promise<AppraisalCycle> {
    const cycle = await this.cycles.findOneBy({ id, school_id: schoolId });
    if (!cycle) throw AppException.notFound('Appraisal cycle not found', 'CYCLE_NOT_FOUND');
    return cycle;
  }
}

function nullable(value: number | null): string | null {
  return value === null ? null : String(value);
}

function emptyCounts(): StageCountsDto {
  return {
    total: 0,
    self_pending: 0,
    hod_pending: 0,
    principal_pending: 0,
    published: 0,
    appealed: 0,
    completed: 0,
    self_missed: 0,
  };
}
