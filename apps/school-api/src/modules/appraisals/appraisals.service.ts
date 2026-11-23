import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, FindOptionsWhere, In, Repository } from 'typeorm';
import { AppException, AuthUser, FieldError, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { yearClause } from '../../shared/year-context';
import { currentYearId } from '../../shared/academic-year';
import { ROLES } from '../access/access.catalog';
import { FilesService } from '../files/files.service';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { Staff } from '../staff/entities/staff.entity';
import { User } from '../users/entities/user.entity';
import { AppraisalMetricsService } from './appraisal-metrics.service';
import {
  appealOpen,
  autoScore,
  finalDefault,
  kraPercent,
  overallPercent,
  RATING_LABELS,
  ratingFor,
  round2,
  stageAfterSelf,
} from './appraisal.logic';
import {
  AcknowledgeDto,
  AppealDto,
  AppealInputDto,
  AppealQueryDto,
  AppraisalDto,
  AppraisalListItemDto,
  AppraisalQueryDto,
  DecideAppealDto,
  DossierDto,
  FinalInputDto,
  FinalScoreInputDto,
  HodInputDto,
  PublishResultDto,
  ReviewsQueryDto,
  ScoreDto,
  ScoreInputDto,
  SelfInputDto,
} from './dto/appraisal.dto';
import {
  Appraisal,
  AppraisalAppeal,
  AppraisalCycle,
  AppraisalEvidence,
  AppraisalGroup,
  AppraisalScore,
  AppraisalStage,
  Recommendation,
} from './entities/appraisal.entity';

export type Viewer = 'admin' | 'hod' | 'self';

const PRIVATE_STAGES: AppraisalStage[] = ['self_pending', 'hod_pending', 'principal_pending'];
const num = (value: string | number | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);
const text = (value: number | null) => (value === null ? null : String(value));

export function selfValue(row: AppraisalScore): number | null {
  return row.scoring_mode === 'auto' ? (num(row.auto_score) ?? num(row.self_score)) : num(row.self_score);
}

export function hodValue(row: AppraisalScore): number | null {
  return num(row.hod_score) ?? (row.scoring_mode === 'auto' ? num(row.auto_score) : null);
}

export function finalValue(row: AppraisalScore): number | null {
  return (
    num(row.final_score) ?? finalDefault(num(row.hod_score), num(row.self_score), num(row.auto_score), row.scoring_mode)
  );
}

const percentOf = (rows: AppraisalScore[], pick: (row: AppraisalScore) => number | null) =>
  overallPercent(
    rows.map((row) => ({
      weightage_percent: Number(row.weightage_percent),
      max_score: row.max_score,
      score: pick(row),
    })),
  );

@Injectable()
export class AppraisalsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Appraisal) private readonly appraisals: Repository<Appraisal>,
    @InjectRepository(AppraisalScore) private readonly scores: Repository<AppraisalScore>,
    @InjectRepository(AppraisalAppeal) private readonly appeals: Repository<AppraisalAppeal>,
    private readonly metrics: AppraisalMetricsService,
    private readonly files: FilesService,
    private readonly notify: NotificationsService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async list(schoolId: number, query: AppraisalQueryDto): Promise<Paginated<AppraisalListItemDto>> {
    const qb = this.appraisals
      .createQueryBuilder('a')
      .innerJoinAndSelect(Staff, 'st', 'st.id = a.staff_id')
      .innerJoinAndSelect(User, 'u', 'u.id = a.user_id')
      .where('a.school_id = :schoolId', { schoolId })
      .andWhere(
        `a.academic_year_id = (SELECT y.id FROM academic_years y WHERE y.school_id = :schoolId AND ${yearClause('y')} AND y.deleted_at IS NULL LIMIT 1)`,
      );
    if (query.cycle_id) qb.andWhere('a.cycle_id = :cycleId', { cycleId: query.cycle_id });
    if (query.group_id) qb.andWhere('a.group_id = :groupId', { groupId: query.group_id });
    if (query.stage) qb.andWhere('a.stage = :stage', { stage: query.stage });
    if (query.rating) qb.andWhere('a.rating = :rating', { rating: query.rating });
    const page = await listQuery(qb, query, {
      searchable: ['u.name', 'st.employee_no', 'st.designation', 'st.department'],
      sortable: { name: 'u.name', final_percent: 'a.final_percent', created_at: 'a.created_at', stage: 'a.stage' },
      defaultSort: 'name',
    });
    return { ...page, items: await this.present(page.items, 'admin', false) };
  }

  async get(schoolId: number, id: number): Promise<AppraisalDto> {
    const appraisal = await this.find({ id, school_id: schoolId });
    await this.refreshAuto([appraisal]);
    return (await this.present([appraisal], 'admin', true))[0] as AppraisalDto;
  }

  async dossier(schoolId: number, staffId: number, yearId?: number): Promise<DossierDto> {
    const staff = await this.dataSource.getRepository(Staff).findOneBy({ id: staffId, school_id: schoolId });
    if (!staff) throw AppException.notFound('Staff member not found', 'STAFF_NOT_FOUND');
    const year = yearId ?? (await currentYearId(this.dataSource.manager, schoolId));
    return this.metrics.dossier(schoolId, year, staff.user_id);
  }

  async saveFinal(schoolId: number, id: number, dto: FinalInputDto): Promise<AppraisalDto> {
    await this.dataSource.transaction(async (manager) => {
      const appraisal = await this.lock(manager, { id, school_id: schoolId });
      this.assertStage(appraisal, ['principal_pending']);
      const rows = await manager.findBy(AppraisalScore, { appraisal_id: appraisal.id });
      if (dto.scores?.length) this.applyFinal(rows, dto.scores);
      await manager.save(rows);
      if (dto.recommendation !== undefined) appraisal.recommendation = dto.recommendation;
      if (dto.increment_percent !== undefined) appraisal.increment_percent = text(dto.increment_percent);
      if (dto.strengths !== undefined) appraisal.strengths = dto.strengths;
      if (dto.improvements !== undefined) appraisal.improvements = dto.improvements;
      if (dto.goals !== undefined) appraisal.goals = dto.goals;
      if (dto.principal_remarks !== undefined) appraisal.principal_remarks = dto.principal_remarks;
      this.fillFinal(appraisal, rows, await this.cycleOf(manager, appraisal));
      await manager.save(appraisal);
    });
    return this.get(schoolId, id);
  }

  async publish(schoolId: number, id: number, actor: AuthUser): Promise<AppraisalDto> {
    await this.dataSource.transaction((manager) => this.publishOne(manager, schoolId, id, actor));
    return this.get(schoolId, id);
  }

  async publishMany(schoolId: number, ids: number[], actor: AuthUser): Promise<PublishResultDto> {
    const skipped: number[] = [];
    let published = 0;
    for (const id of ids) {
      try {
        await this.dataSource.transaction((manager) => this.publishOne(manager, schoolId, id, actor));
        published += 1;
      } catch (error) {
        if (!(error instanceof AppException)) throw error;
        skipped.push(id);
      }
    }
    return { published, skipped };
  }

  async listAppeals(schoolId: number, query: AppealQueryDto): Promise<Paginated<AppealDto>> {
    const qb = this.appeals
      .createQueryBuilder('ap')
      .innerJoin(Appraisal, 'a', 'a.id = ap.appraisal_id')
      .innerJoin(User, 'u', 'u.id = a.user_id')
      .where('ap.school_id = :schoolId', { schoolId })
      .andWhere(
        `a.academic_year_id = (SELECT y.id FROM academic_years y WHERE y.school_id = :schoolId AND ${yearClause('y')} AND y.deleted_at IS NULL LIMIT 1)`,
      );
    if (query.status) qb.andWhere('ap.status = :status', { status: query.status });
    const page = await listQuery(qb, query, {
      searchable: ['u.name', 'ap.reason'],
      sortable: { created_at: 'ap.created_at' },
      defaultSort: 'created_at',
    });
    return { ...page, items: await this.presentAppeals(page.items) };
  }

  async decideAppeal(schoolId: number, appealId: number, actor: AuthUser, dto: DecideAppealDto): Promise<AppealDto> {
    const appraisalId = await this.dataSource.transaction(async (manager) => {
      const appeal = await manager.findOne(AppraisalAppeal, {
        where: { id: appealId, school_id: schoolId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!appeal) throw AppException.notFound('Appeal not found', 'APPEAL_NOT_FOUND');
      if (appeal.status !== 'pending') throw AppException.conflict('This appeal is already decided', 'APPEAL_DECIDED');
      const appraisal = await this.lock(manager, { id: appeal.appraisal_id, school_id: schoolId });
      this.assertStage(appraisal, ['appealed']);
      if (dto.decision === 'accept') {
        const rows = await manager.findBy(AppraisalScore, { appraisal_id: appraisal.id });
        if (dto.scores?.length) {
          this.applyFinal(
            rows,
            dto.scores.map((score) => ({ ...score, override_reason: score.override_reason ?? dto.note })),
          );
          await manager.save(rows);
        }
        if (dto.increment_percent !== undefined) appraisal.increment_percent = text(dto.increment_percent);
        this.fillFinal(appraisal, rows, await this.cycleOf(manager, appraisal));
      }
      appraisal.stage = 'completed';
      appeal.status = dto.decision === 'accept' ? 'accepted' : 'rejected';
      appeal.decided_by = actor.id;
      appeal.decided_at = new Date();
      appeal.decision_note = dto.note;
      await manager.save([appraisal, appeal]);
      return appraisal.id;
    });
    const appraisal = await this.find({ id: appraisalId, school_id: schoolId });
    const cycle = await this.cycleOf(this.dataSource.manager, appraisal);
    await this.send(TEMPLATES.APPRAISAL_APPEAL_DECIDED, [appraisal.user_id], schoolId, {
      title: cycle.title,
      decision: dto.decision === 'accept' ? 'accepted' : 'not accepted',
      percent: num(appraisal.final_percent) ?? '',
      appraisal_id: appraisal.id,
    });
    const appeal = await this.appeals.findOneByOrFail({ id: appealId });
    return (await this.presentAppeals([appeal]))[0]!;
  }

  async mine(user: AuthUser): Promise<AppraisalListItemDto[]> {
    const rows = await this.appraisals.find({ where: { user_id: user.id }, order: { created_at: 'DESC', id: 'DESC' } });
    const visible = await this.withoutLegacyDrafts(rows);
    return this.present(visible, 'self', false);
  }

  async mineOne(user: AuthUser, id: number): Promise<AppraisalDto> {
    const appraisal = await this.find({ id, user_id: user.id }, 'NOT_YOUR_APPRAISAL');
    if (appraisal.stage === 'self_pending') await this.refreshAuto([appraisal]);
    return (await this.present([appraisal], 'self', true))[0] as AppraisalDto;
  }

  async saveSelf(user: AuthUser, id: number, dto: SelfInputDto, submit: boolean): Promise<AppraisalDto> {
    const appraisal = await this.dataSource.transaction(async (manager) => {
      const row = await this.lock(manager, { id, user_id: user.id }, 'NOT_YOUR_APPRAISAL');
      this.assertStage(row, ['self_pending']);
      const cycle = await this.cycleOf(manager, row);
      if (cycle.status !== 'open') throw AppException.conflict('This appraisal cycle is not open', 'CYCLE_NOT_OPEN');
      const rows = await manager.findBy(AppraisalScore, { appraisal_id: row.id });
      this.applyScores(rows, dto.scores, 'self');
      if (dto.expected_increment_percent !== undefined)
        row.expected_increment_percent = text(dto.expected_increment_percent);
      if (dto.hike_justification !== undefined) row.hike_justification = dto.hike_justification;
      if (dto.file_ids !== undefined) await this.replaceEvidence(manager, row, dto.file_ids);
      row.self_percent = text(percentOf(rows, selfValue));
      if (submit) {
        this.requireAll(rows, selfValue, 'Score yourself on this KRA');
        row.stage = stageAfterSelf(row.hod_user_id);
        row.self_submitted_at = new Date();
      }
      await manager.save(rows);
      await manager.save(row);
      return { row, cycle };
    });
    if (submit && appraisal.row.hod_user_id) {
      await this.send(TEMPLATES.APPRAISAL_HOD_REVIEW, [appraisal.row.hod_user_id], appraisal.row.school_id, {
        staff_name: user.name,
        title: appraisal.cycle.title,
        due: this.when(appraisal.cycle.hod_due_at),
        appraisal_id: appraisal.row.id,
      });
    }
    return this.mineOne(user, id);
  }

  async acknowledge(user: AuthUser, id: number, dto: AcknowledgeDto): Promise<AppraisalDto> {
    await this.dataSource.transaction(async (manager) => {
      const row = await this.lock(manager, { id, user_id: user.id }, 'NOT_YOUR_APPRAISAL');
      this.assertStage(row, ['published']);
      row.stage = 'completed';
      row.acknowledged_at = new Date();
      row.staff_remarks = dto.remarks ?? row.staff_remarks;
      await manager.save(row);
    });
    return this.mineOne(user, id);
  }

  async appeal(user: AuthUser, id: number, dto: AppealInputDto): Promise<AppraisalDto> {
    const result = await this.dataSource.transaction(async (manager) => {
      const row = await this.lock(manager, { id, user_id: user.id }, 'NOT_YOUR_APPRAISAL');
      this.assertStage(row, ['published']);
      const cycle = await this.cycleOf(manager, row);
      if (!appealOpen(row.published_at, cycle.appeal_days, new Date())) {
        throw AppException.conflict('The time to appeal this result is over', 'APPEAL_WINDOW_CLOSED');
      }
      await manager.save(
        manager.create(AppraisalAppeal, {
          school_id: row.school_id,
          appraisal_id: row.id,
          reason: dto.reason,
          requested_increment: text(dto.requested_increment ?? null),
          status: 'pending',
        }),
      );
      row.stage = 'appealed';
      await manager.save(row);
      return { row, cycle };
    });
    await this.send(TEMPLATES.APPRAISAL_APPEAL_RAISED, null, result.row.school_id, {
      staff_name: user.name,
      title: result.cycle.title,
      appraisal_id: result.row.id,
    });
    return this.mineOne(user, id);
  }

  async reviews(user: AuthUser, query: ReviewsQueryDto): Promise<AppraisalListItemDto[]> {
    const done = query.state === 'done';
    const rows = await this.appraisals
      .createQueryBuilder('a')
      .where('a.hod_user_id = :userId', { userId: user.id })
      .andWhere(done ? 'a.hod_submitted_at IS NOT NULL' : `a.stage = 'hod_pending'`)
      .orderBy('a.created_at', 'DESC')
      .getMany();
    return this.present(rows, 'hod', false);
  }

  async review(user: AuthUser, id: number): Promise<AppraisalDto> {
    const appraisal = await this.find({ id, hod_user_id: user.id }, 'NOT_YOUR_REVIEW');
    if (appraisal.stage === 'hod_pending') await this.refreshAuto([appraisal]);
    return (await this.present([appraisal], 'hod', true))[0] as AppraisalDto;
  }

  async saveReview(user: AuthUser, id: number, dto: HodInputDto, submit: boolean): Promise<AppraisalDto> {
    await this.dataSource.transaction(async (manager) => {
      const row = await this.lock(manager, { id, hod_user_id: user.id }, 'NOT_YOUR_REVIEW');
      this.assertStage(row, ['hod_pending']);
      const cycle = await this.cycleOf(manager, row);
      if (cycle.status !== 'open') throw AppException.conflict('This appraisal cycle is not open', 'CYCLE_NOT_OPEN');
      const rows = await manager.findBy(AppraisalScore, { appraisal_id: row.id });
      this.applyScores(rows, dto.scores, 'hod');
      if (dto.remarks !== undefined) row.hod_remarks = dto.remarks;
      row.hod_percent = text(percentOf(rows, hodValue));
      if (submit) {
        this.requireAll(rows, hodValue, 'Give your score for this KRA');
        row.stage = 'principal_pending';
        row.hod_submitted_at = new Date();
      }
      await manager.save(rows);
      await manager.save(row);
    });
    return this.review(user, id);
  }

  async refreshAuto(appraisals: Appraisal[]): Promise<void> {
    const open = appraisals.filter((row) => PRIVATE_STAGES.includes(row.stage));
    if (!open.length) return;
    const rows = await this.scores.findBy({ appraisal_id: In(open.map((row) => row.id)), scoring_mode: 'auto' });
    if (!rows.length) return;
    for (const yearKey of new Set(open.map((row) => `${row.school_id}:${row.academic_year_id}`))) {
      const [schoolId, yearId] = yearKey.split(':').map(Number);
      const own = open.filter((row) => row.school_id === schoolId && row.academic_year_id === yearId);
      const values = await this.metrics.forUsers(
        schoolId!,
        yearId!,
        own.map((row) => row.user_id),
      );
      for (const appraisal of own) {
        const metrics = values.get(appraisal.user_id);
        for (const row of rows.filter((score) => score.appraisal_id === appraisal.id)) {
          const value = metrics && row.auto_metric ? metrics[row.auto_metric] : null;
          row.auto_value = text(value);
          row.auto_score = text(autoScore(value, Number(row.auto_target ?? 0), row.max_score));
        }
      }
    }
    await this.scores.save(rows);
  }

  async present(rows: Appraisal[], viewer: Viewer, full: boolean): Promise<(AppraisalListItemDto | AppraisalDto)[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const [cycles, groups, staff, users, scores, evidence, appeals] = await Promise.all([
      this.dataSource.getRepository(AppraisalCycle).findBy({ id: In([...new Set(rows.map((row) => row.cycle_id))]) }),
      this.dataSource.getRepository(AppraisalGroup).find({
        where: { id: In([...new Set(rows.map((row) => row.group_id))]) },
        withDeleted: true,
      }),
      this.dataSource.getRepository(Staff).find({
        where: { id: In([...new Set(rows.map((row) => row.staff_id))]) },
        withDeleted: true,
      }),
      this.dataSource.getRepository(User).find({
        where: {
          id: In([...new Set(rows.flatMap((row) => [row.user_id, ...(row.hod_user_id ? [row.hod_user_id] : [])]))]),
        },
        withDeleted: true,
      }),
      full ? this.scores.find({ where: { appraisal_id: In(ids) }, order: { sort_order: 'ASC', id: 'ASC' } }) : [],
      full ? this.dataSource.getRepository(AppraisalEvidence).findBy({ appraisal_id: In(ids) }) : [],
      full ? this.appeals.find({ where: { appraisal_id: In(ids) }, order: { created_at: 'DESC' } }) : [],
    ]);
    const files = full ? await this.files.presentMany(evidence.map((row) => row.file_id)) : new Map();
    const presentedAppeals = full ? await this.presentAppeals(appeals) : [];
    return rows.map((row) => {
      const cycle = cycles.find((item) => item.id === row.cycle_id)!;
      const person = staff.find((item) => item.id === row.staff_id);
      const user = users.find((item) => item.id === row.user_id);
      const hod = row.hod_user_id ? users.find((item) => item.id === row.hod_user_id) : null;
      const hidden = viewer === 'self' && PRIVATE_STAGES.includes(row.stage);
      const appealUntil =
        row.stage === 'published' && row.published_at
          ? new Date(row.published_at.getTime() + cycle.appeal_days * 86_400_000)
          : null;
      const item: AppraisalListItemDto = {
        id: row.id,
        cycle: { id: cycle.id, name: cycle.title },
        staff: {
          staff_id: row.staff_id,
          user_id: row.user_id,
          name: user?.name ?? '',
          employee_no: person?.employee_no ?? '',
          designation: person?.designation ?? '',
          department: person?.department ?? null,
        },
        group: { id: row.group_id, name: groups.find((group) => group.id === row.group_id)?.name ?? '' },
        hod: hod ? { id: hod.id, name: hod.name } : null,
        stage: row.stage,
        self_missed: row.self_missed,
        self_percent: num(row.self_percent),
        hod_percent: hidden ? null : num(row.hod_percent),
        final_percent: hidden ? null : num(row.final_percent),
        rating: hidden ? null : row.rating,
        increment_percent: hidden ? null : num(row.increment_percent),
        published_at: row.published_at,
        due_at:
          row.stage === 'self_pending'
            ? cycle.self_due_at
            : row.stage === 'hod_pending'
              ? cycle.hod_due_at
              : row.stage === 'principal_pending'
                ? cycle.final_due_at
                : appealUntil,
      };
      if (!full) return item;
      const detail: AppraisalDto = {
        ...item,
        academic_year_id: row.academic_year_id,
        self_due_at: cycle.self_due_at,
        hod_due_at: cycle.hod_due_at,
        final_due_at: cycle.final_due_at,
        self_submitted_at: row.self_submitted_at,
        hod_submitted_at: row.hod_submitted_at,
        acknowledged_at: row.acknowledged_at,
        appeal_until: appealUntil,
        recommendation: hidden ? null : row.recommendation,
        suggested_increment: hidden ? null : num(row.suggested_increment),
        expected_increment_percent: num(row.expected_increment_percent),
        hike_justification: row.hike_justification,
        strengths: hidden ? null : row.strengths,
        improvements: hidden ? null : row.improvements,
        goals: hidden ? null : row.goals,
        hod_remarks: hidden ? null : row.hod_remarks,
        principal_remarks: hidden ? null : row.principal_remarks,
        staff_remarks: row.staff_remarks,
        scores: scores
          .filter((score) => score.appraisal_id === row.id)
          .map((score) => this.presentScore(score, hidden)),
        evidence: evidence
          .filter((file) => file.appraisal_id === row.id)
          .map((file) => ({
            id: file.id,
            file_id: file.file_id,
            score_id: file.score_id,
            name: files.get(file.file_id)?.name ?? '',
            url: files.get(file.file_id)?.url ?? null,
          })),
        appeals: presentedAppeals.filter((appeal) => appeal.appraisal_id === row.id),
      };
      return detail;
    });
  }

  private presentScore(score: AppraisalScore, hidden: boolean): ScoreDto {
    const final = hidden ? null : finalValue(score);
    return {
      id: score.id,
      kra_id: score.kra_id,
      code: score.code,
      title: score.title,
      description: score.description,
      weightage_percent: Number(score.weightage_percent),
      max_score: score.max_score,
      scoring_mode: score.scoring_mode,
      auto_metric: score.auto_metric,
      auto_target: num(score.auto_target),
      auto_value: num(score.auto_value),
      auto_score: num(score.auto_score),
      self_score: num(score.self_score),
      self_comment: score.self_comment,
      hod_score: hidden ? null : num(score.hod_score),
      hod_comment: hidden ? null : score.hod_comment,
      final_score: final,
      override_reason: hidden ? null : score.override_reason,
      final_percent: kraPercent(final, score.max_score),
    };
  }

  private async presentAppeals(rows: AppraisalAppeal[]): Promise<AppealDto[]> {
    if (!rows.length) return [];
    const appraisals = await this.appraisals.find({
      where: { id: In([...new Set(rows.map((row) => row.appraisal_id))]) },
      withDeleted: true,
    });
    const [cycles, staff, users] = await Promise.all([
      this.dataSource.getRepository(AppraisalCycle).find({
        where: { id: In([...new Set(appraisals.map((row) => row.cycle_id))]) },
        withDeleted: true,
      }),
      this.dataSource.getRepository(Staff).find({
        where: { id: In([...new Set(appraisals.map((row) => row.staff_id))]) },
        withDeleted: true,
      }),
      this.dataSource.getRepository(User).find({
        where: {
          id: In([
            ...new Set([
              ...appraisals.map((row) => row.user_id),
              ...rows.flatMap((row) => (row.decided_by ? [row.decided_by] : [])),
            ]),
          ]),
        },
        withDeleted: true,
      }),
    ]);
    return rows.map((row) => {
      const appraisal = appraisals.find((item) => item.id === row.appraisal_id)!;
      const person = staff.find((item) => item.id === appraisal.staff_id);
      const decider = row.decided_by ? users.find((item) => item.id === row.decided_by) : null;
      return {
        id: row.id,
        appraisal_id: row.appraisal_id,
        staff: {
          staff_id: appraisal.staff_id,
          user_id: appraisal.user_id,
          name: users.find((item) => item.id === appraisal.user_id)?.name ?? '',
          employee_no: person?.employee_no ?? '',
          designation: person?.designation ?? '',
          department: person?.department ?? null,
        },
        cycle_title: cycles.find((item) => item.id === appraisal.cycle_id)?.title ?? '',
        reason: row.reason,
        requested_increment: num(row.requested_increment),
        status: row.status,
        decision_note: row.decision_note,
        decided_by: decider ? { id: decider.id, name: decider.name } : null,
        decided_at: row.decided_at,
        created_at: row.created_at,
      };
    });
  }

  private async publishOne(manager: EntityManager, schoolId: number, id: number, actor: AuthUser): Promise<void> {
    const appraisal = await this.lock(manager, { id, school_id: schoolId });
    this.assertStage(appraisal, ['principal_pending']);
    const rows = await manager.findBy(AppraisalScore, { appraisal_id: appraisal.id });
    const missing = rows.filter((row) => finalValue(row) === null);
    if (missing.length) {
      throw AppException.validation(
        missing.map((row) => ({
          field: `scores.${row.kra_id ?? row.id}`,
          message: `Give a final score for ${row.title}`,
        })),
      );
    }
    for (const row of rows) row.final_score = text(finalValue(row));
    await manager.save(rows);
    const cycle = await this.cycleOf(manager, appraisal);
    this.fillFinal(appraisal, rows, cycle);
    appraisal.increment_percent = appraisal.increment_percent ?? appraisal.suggested_increment;
    appraisal.stage = 'published';
    appraisal.published_at = new Date();
    appraisal.published_by = actor.id;
    await manager.save(appraisal);
    await this.send(TEMPLATES.APPRAISAL_PUBLISHED, [appraisal.user_id], schoolId, {
      title: cycle.title,
      percent: num(appraisal.final_percent) ?? '',
      rating: appraisal.rating ? RATING_LABELS[appraisal.rating] : '',
      appraisal_id: appraisal.id,
    });
  }

  private fillFinal(appraisal: Appraisal, rows: AppraisalScore[], cycle: AppraisalCycle): void {
    const percent = percentOf(rows, finalValue);
    appraisal.final_percent = text(percent);
    appraisal.rating = percent === null ? null : ratingFor(percent);
    appraisal.suggested_increment = appraisal.rating ? text(cycle.increment_bands[appraisal.rating] ?? null) : null;
    if (!appraisal.recommendation && appraisal.rating) {
      appraisal.recommendation = defaultRecommendation(appraisal.rating);
    }
  }

  private applyScores(rows: AppraisalScore[], inputs: ScoreInputDto[], who: 'self' | 'hod'): void {
    const errors: FieldError[] = [];
    for (const input of inputs) {
      const row = rows.find((item) => item.kra_id === input.kra_id);
      if (!row) {
        errors.push({ field: `scores.${input.kra_id}`, message: 'This KRA is not part of this appraisal' });
        continue;
      }
      if (input.score !== undefined && input.score !== null && (input.score < 1 || input.score > row.max_score)) {
        errors.push({ field: `scores.${input.kra_id}`, message: `Score between 1 and ${row.max_score}` });
        continue;
      }
      if (who === 'self') {
        if (input.score !== undefined) row.self_score = text(input.score);
        if (input.comment !== undefined) row.self_comment = input.comment;
      } else {
        if (input.score !== undefined) row.hod_score = text(input.score);
        if (input.comment !== undefined) row.hod_comment = input.comment;
      }
    }
    if (errors.length) throw AppException.validation(errors);
  }

  private applyFinal(rows: AppraisalScore[], inputs: FinalScoreInputDto[]): void {
    const errors: FieldError[] = [];
    for (const input of inputs) {
      const row = rows.find((item) => item.kra_id === input.kra_id);
      if (!row) {
        errors.push({ field: `scores.${input.kra_id}`, message: 'This KRA is not part of this appraisal' });
        continue;
      }
      if (input.score < 1 || input.score > row.max_score) {
        errors.push({ field: `scores.${input.kra_id}`, message: `Score between 1 and ${row.max_score}` });
        continue;
      }
      const proposed = finalDefault(num(row.hod_score), num(row.self_score), num(row.auto_score), row.scoring_mode);
      const changed = proposed === null || round2(proposed) !== round2(input.score);
      if (changed && proposed !== null && !input.override_reason) {
        errors.push({ field: `scores.${input.kra_id}`, message: 'Say why you changed this score' });
        continue;
      }
      row.final_score = text(input.score);
      row.override_reason = changed ? (input.override_reason ?? null) : null;
    }
    if (errors.length) throw AppException.validation(errors);
  }

  private requireAll(rows: AppraisalScore[], pick: (row: AppraisalScore) => number | null, message: string): void {
    const missing = rows.filter((row) => pick(row) === null);
    if (missing.length) {
      throw AppException.validation(missing.map((row) => ({ field: `scores.${row.kra_id ?? row.id}`, message })));
    }
  }

  private async replaceEvidence(manager: EntityManager, appraisal: Appraisal, fileIds: number[]): Promise<void> {
    for (const [index, fileId] of fileIds.entries()) {
      await this.files.assertAttachable(fileId, appraisal.school_id, `file_ids.${index}`);
    }
    await manager.delete(AppraisalEvidence, { appraisal_id: appraisal.id });
    if (fileIds.length) {
      await manager.insert(
        AppraisalEvidence,
        fileIds.map((fileId) => ({ school_id: appraisal.school_id, appraisal_id: appraisal.id, file_id: fileId })),
      );
    }
  }

  private async withoutLegacyDrafts(rows: Appraisal[]): Promise<Appraisal[]> {
    if (!rows.length) return rows;
    const legacy = await this.dataSource
      .getRepository(AppraisalCycle)
      .findBy({ id: In([...new Set(rows.map((row) => row.cycle_id))]), is_legacy: true });
    const ids = new Set(legacy.map((cycle) => cycle.id));
    return rows.filter((row) => !ids.has(row.cycle_id) || !PRIVATE_STAGES.includes(row.stage));
  }

  private assertStage(appraisal: Appraisal, allowed: AppraisalStage[]): void {
    if (!allowed.includes(appraisal.stage)) {
      throw AppException.conflict('This appraisal is not at that step', 'APPRAISAL_NOT_IN_STAGE');
    }
  }

  private async cycleOf(manager: EntityManager, appraisal: Appraisal): Promise<AppraisalCycle> {
    return manager.findOneOrFail(AppraisalCycle, { where: { id: appraisal.cycle_id }, withDeleted: true });
  }

  private async lock(
    manager: EntityManager,
    where: FindOptionsWhere<Appraisal>,
    code = 'APPRAISAL_NOT_FOUND',
  ): Promise<Appraisal> {
    const row = await manager.findOne(Appraisal, { where, lock: { mode: 'pessimistic_write' } });
    if (!row) throw this.missing(code);
    return row;
  }

  private async find(where: FindOptionsWhere<Appraisal>, code = 'APPRAISAL_NOT_FOUND'): Promise<Appraisal> {
    const row = await this.appraisals.findOneBy(where);
    if (!row) throw this.missing(code);
    return row;
  }

  private missing(code: string): AppException {
    return code === 'APPRAISAL_NOT_FOUND'
      ? AppException.notFound('Appraisal not found', code)
      : AppException.forbidden('This appraisal is not yours to open', code);
  }

  private async send(
    template: string,
    userIds: number[] | null,
    schoolId: number,
    data: Record<string, string | number>,
  ): Promise<void> {
    const audience = userIds
      ? { user_ids: userIds, school_id: schoolId }
      : { roles: [ROLES.PRINCIPAL], school_id: schoolId };
    await this.notify.dispatch({ template, audience, data: { ...data, appraisal_id: String(data.appraisal_id) } });
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
}

export function defaultRecommendation(rating: Appraisal['rating']): Recommendation {
  return rating === 'needs_improvement' || rating === 'unsatisfactory' ? 'pip' : 'increment';
}
