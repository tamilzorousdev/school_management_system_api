import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, MoreThan, Not, Repository, SelectQueryBuilder } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { rupees } from '../payroll/payroll.calc';
import { Student } from '../students/entities/student.entity';
import { User } from '../users/entities/user.entity';
import {
  CopyPlanDto,
  CopyPlanResultDto,
  CopyPlanRowDto,
  CollectionResultDto,
  CopyYearDto,
  FeeAuditLogDto,
  FeeAuditQueryDto,
  FeeHeadDto,
  FeeHeadInputDto,
  FeeHeadQueryDto,
  FeeInsightsDto,
  FeeInvoiceDetailDto,
  FeeInvoiceDto,
  FeePaymentDto,
  FeePlanDto,
  FeePlanInputDto,
  FeePlanSummaryDto,
  FeePlanVersionDto,
  FeeStatusDto,
  FeeStudentRefDto,
  FeeTotalsDto,
  GenerateInvoicesDto,
  GenerateResultDto,
  InstallmentTotalDto,
  InvoiceQueryDto,
  PreviousDuesDto,
  PaymentInputDto,
  PaymentQueryDto,
  PaymentSummaryDto,
  PaymentSummaryQueryDto,
  ReconciliationDto,
  RejectPlanDto,
  ReviewPlanDto,
  SectionFeesDto,
  StudentFeesDto,
  AdvanceReceiptDto,
  SubmitPlanDto,
  UpdateFeeHeadDto,
  UpcomingInstallmentDto,
} from './dto/fees.dto';
import { FeeAuditLog } from './entities/fee-audit-log.entity';
import { FeeHead } from './entities/fee-head.entity';
import { FeeInvoiceBenefit } from './entities/fee-invoice-benefit.entity';
import { FeeInvoice } from './entities/fee-invoice.entity';
import { FeeInvoiceLine } from './entities/fee-invoice-line.entity';
import { FeePayment } from './entities/fee-payment.entity';
import { FeePlan } from './entities/fee-plan.entity';
import { FeePlanVersion, PlanLineValue, PlanVersionStatus } from './entities/fee-plan-version.entity';
import { FeeRefund } from './entities/fee-refund.entity';
import { FeeRequest } from './entities/fee-request.entity';
import { applyCredit, collectForStudent, creditBalance } from './fee-credits';
import { pick, recordFeeAudit } from './fee-audit';
import { FeeYear, generateInvoices, recordPayment } from './fee-ledger';
import { ridersWithFee } from './transport-fee-sync.service';
import {
  daysBetween,
  DEFAULT_REMINDER_DAYS,
  dueIn,
  monthsBetween,
  previousDueDate,
  feeTotals,
  isOverdue,
  PAYMENT_MODE_NAMES,
  round2,
  shiftDate,
  shortDate,
  STUDENT_FEE_STATUSES,
  StudentFeeStatus,
  sumAmounts,
} from './fees.logic';
import { advanceReceiptPdf, invoicePdf, receiptPdf, refundPdf } from './receipt.pdf';
import { feesForTeacher } from './fee-views';
import { FeeCollection } from './entities/fee-collection.entity';
import { yearClause } from '../../shared/year-context';

interface StudentRow {
  id: number;
  first_name: string;
  last_name: string | null;
  admission_no: string;
  class_name: string | null;
  section_name: string | null;
}

const fullName = (row: { first_name: string; last_name: string | null }) =>
  [row.first_name, row.last_name].filter(Boolean).join(' ');

@Injectable()
export class FeesService {
  private readonly logger = new Logger('Fees');

  constructor(
    @InjectRepository(FeeHead) private readonly heads: Repository<FeeHead>,
    @InjectRepository(FeePlan) private readonly plans: Repository<FeePlan>,
    @InjectRepository(FeeInvoice) private readonly invoices: Repository<FeeInvoice>,
    @InjectRepository(FeeInvoiceLine) private readonly lines: Repository<FeeInvoiceLine>,
    @InjectRepository(FeePayment) private readonly payments: Repository<FeePayment>,
    @InjectRepository(FeeAuditLog) private readonly auditLogs: Repository<FeeAuditLog>,
    @InjectRepository(FeePlanVersion) private readonly versions: Repository<FeePlanVersion>,
    @InjectRepository(FeeInvoiceBenefit) private readonly invoiceBenefits: Repository<FeeInvoiceBenefit>,
    private readonly notifications: NotificationsService,
    private readonly files: FilesService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  private today(): string {
    return todayIn(this.app.timeZone);
  }

  async listHeads(schoolId: number, query: FeeHeadQueryDto): Promise<Paginated<FeeHeadDto>> {
    const qb = this.heads.createQueryBuilder('h').where('h.school_id = :schoolId', { schoolId });
    if (query.is_active !== undefined) qb.andWhere('h.is_active = :active', { active: query.is_active });
    if (query.is_mandatory !== undefined) {
      qb.andWhere('h.is_mandatory = :mandatory', { mandatory: query.is_mandatory });
    }
    if (query.frequency) qb.andWhere('h.frequency = :frequency', { frequency: query.frequency });
    if (query.fee_group) qb.andWhere('lower(h.fee_group) = lower(:group)', { group: query.fee_group });
    const page = await listQuery(qb, query, {
      searchable: ['h.name', 'h.code'],
      sortable: { name: 'h.name', code: 'h.code', created_at: 'h.created_at' },
      defaultSort: 'created_at',
    });
    return { ...page, items: await this.presentHeads(schoolId, page.items) };
  }

  async createHead(schoolId: number, dto: FeeHeadInputDto, actor: AuthUser): Promise<FeeHeadDto> {
    await this.assertHeadFree(schoolId, dto);
    await this.assertClasses(schoolId, dto.applicable_class_ids);
    const saved = await this.dataSource.transaction(async (manager) => {
      const head = await manager.save(
        manager.create(FeeHead, {
          school_id: schoolId,
          name: dto.name,
          code: dto.code,
          is_transport: dto.is_transport ?? false,
          is_active: dto.is_active ?? true,
          description: dto.description || null,
          fee_group: dto.fee_group || null,
          is_mandatory: dto.is_mandatory ?? true,
          frequency: dto.frequency ?? 'custom',
          is_refundable: dto.is_refundable ?? false,
          applicable_class_ids: dto.applicable_class_ids ?? [],
        }),
      );
      await recordFeeAudit(manager, {
        school_id: schoolId,
        entity: 'fee_head',
        entity_id: head.id,
        action: 'created',
        after: pick(head, HEAD_FIELDS),
        actor_id: actor.id,
      });
      return head;
    });
    return (await this.presentHeads(schoolId, [saved]))[0]!;
  }

  async updateHead(schoolId: number, id: number, dto: UpdateFeeHeadDto, actor: AuthUser): Promise<FeeHeadDto> {
    const head = await this.head(schoolId, id);
    const next = {
      name: dto.name ?? head.name,
      code: dto.code ?? head.code,
      is_transport: dto.is_transport ?? head.is_transport,
      is_active: dto.is_active ?? head.is_active,
      description: dto.description === undefined ? head.description : dto.description || null,
      fee_group: dto.fee_group === undefined ? head.fee_group : dto.fee_group || null,
      is_mandatory: dto.is_mandatory ?? head.is_mandatory,
      frequency: dto.frequency ?? head.frequency,
      is_refundable: dto.is_refundable ?? head.is_refundable,
      applicable_class_ids: dto.applicable_class_ids ?? head.applicable_class_ids,
    };
    await this.assertHeadFree(schoolId, next, id);
    await this.assertClasses(schoolId, dto.applicable_class_ids);
    const usedElsewhere = await this.classesPlannedOutside(schoolId, id, next.applicable_class_ids);
    if (usedElsewhere.length) {
      throw AppException.validation([
        {
          field: 'applicable_class_ids',
          message: `Fee plans of ${usedElsewhere.join(', ')} use this head. Take it off those plans first.`,
        },
      ]);
    }
    if (next.is_transport && !head.is_transport && (await this.plans.existsBy({ fee_head_id: id }))) {
      throw AppException.conflict(
        'This head is used in fee plans. Take it out of the plans before making it the transport head.',
        'FEE_HEAD_IN_USE',
      );
    }
    const before = pick(head, HEAD_FIELDS);
    const saved = await this.dataSource.transaction(async (manager) => {
      const updated = await manager.save(Object.assign(head, next));
      await recordFeeAudit(manager, {
        school_id: schoolId,
        entity: 'fee_head',
        entity_id: id,
        action: 'updated',
        before,
        after: pick(updated, HEAD_FIELDS),
        actor_id: actor.id,
      });
      return updated;
    });
    return (await this.presentHeads(schoolId, [saved]))[0]!;
  }

  async removeHead(schoolId: number, id: number, actor: AuthUser): Promise<void> {
    const head = await this.head(schoolId, id);
    const used = (await this.plans.existsBy({ fee_head_id: id })) || (await this.lines.existsBy({ fee_head_id: id }));
    if (used) {
      throw AppException.conflict(
        'This head is on fee plans or invoices. Switch it off instead of deleting it.',
        'FEE_HEAD_IN_USE',
      );
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(FeeHead, id);
      await recordFeeAudit(manager, {
        school_id: schoolId,
        entity: 'fee_head',
        entity_id: id,
        action: 'deleted',
        before: pick(head, HEAD_FIELDS),
        actor_id: actor.id,
      });
    });
  }

  async year(schoolId: number, yearId?: number): Promise<FeeYear> {
    const [row] = await this.dataSource.query(
      `SELECT id, name, status, to_char(start_date, 'YYYY-MM-DD') AS start_date,
              to_char(end_date, 'YYYY-MM-DD') AS end_date
       FROM academic_years WHERE school_id = $1 AND deleted_at IS NULL AND ${yearId ? 'id = $2' : yearClause('academic_years')}`,
      yearId ? [schoolId, yearId] : [schoolId],
    );
    if (!row) {
      throw yearId
        ? AppException.notFound('Academic year not found', 'YEAR_NOT_FOUND')
        : AppException.badRequest('Set the current academic year in school setup first', 'NO_CURRENT_YEAR');
    }
    return { ...row, id: Number(row.id) };
  }

  async planSummaries(schoolId: number, yearId?: number): Promise<FeePlanSummaryDto[]> {
    const year = await this.year(schoolId, yearId);
    const classes: { id: number; name: string; student_count: string }[] = await this.dataSource.query(
      `SELECT c.id, c.name, (SELECT count(*) FROM student_enrollments e JOIN students s ON s.id = e.student_id
         AND s.deleted_at IS NULL AND s.status = 'active'
         WHERE e.class_id = c.id AND e.academic_year_id = $2 AND e.status = 'studying') AS student_count
       FROM classes c WHERE c.school_id = $1 AND c.deleted_at IS NULL ORDER BY c.grade_level, c.name`,
      [schoolId, year.id],
    );
    const [lines, versions] = await Promise.all([
      this.plans.find({ where: { school_id: schoolId, academic_year_id: year.id } }),
      this.versions.find({
        where: {
          school_id: schoolId,
          academic_year_id: year.id,
          status: In(['draft', 'pending_approval', 'published']),
        },
        select: { id: true, class_id: true, status: true, version: true },
      }),
    ]);
    return classes.map((row) => {
      const own = lines.filter((line) => line.class_id === Number(row.id));
      const mine = versions.filter((version) => version.class_id === Number(row.id));
      const open = mine.find((version) => version.status !== 'published');
      return {
        class_id: Number(row.id),
        class_name: row.name,
        student_count: Number(row.student_count),
        installments: installmentTotals(own),
        total: sumAmounts(own.map((line) => line.amount)),
        version: mine.find((version) => version.status === 'published')?.version ?? null,
        draft_status: open ? (open.status as 'draft' | 'pending_approval') : null,
      };
    });
  }

  async getPlan(schoolId: number, classId: number, yearId?: number): Promise<FeePlanDto> {
    const year = await this.year(schoolId, yearId);
    const schoolClass = await this.schoolClass(schoolId, classId);
    const rows = await this.plans.find({
      where: { school_id: schoolId, academic_year_id: year.id, class_id: classId },
      order: { due_date: 'ASC', id: 'ASC' },
    });
    const heads = new Map((await this.heads.findBy({ school_id: schoolId })).map((head) => [head.id, head.name]));
    const versions = await this.versions.find({
      where: {
        school_id: schoolId,
        academic_year_id: year.id,
        class_id: classId,
        status: In(['draft', 'pending_approval', 'published']),
      },
    });
    const open = versions.find((version) => version.status !== 'published');
    return {
      class_id: classId,
      class_name: schoolClass.name,
      academic_year_id: year.id,
      academic_year: year.name,
      version: versions.find((version) => version.status === 'published')?.version ?? null,
      draft: open ? (await this.presentVersions(schoolId, [open]))[0]! : null,
      lines: rows.map((row) => ({
        id: row.id,
        fee_head_id: row.fee_head_id,
        head_name: heads.get(row.fee_head_id) ?? '',
        installment: row.installment,
        amount: row.amount,
        due_date: row.due_date,
      })),
      installments: installmentTotals(rows),
      total: sumAmounts(rows.map((row) => row.amount)),
    };
  }

  async setPlan(schoolId: number, classId: number, dto: FeePlanInputDto, actor: AuthUser): Promise<FeePlanDto> {
    const year = await this.writableYear(schoolId, dto.academic_year_id);
    await this.schoolClass(schoolId, classId);
    await this.validatePlanLines(schoolId, classId, year, dto.lines);
    const lines = dto.lines.map((line) => ({
      fee_head_id: line.fee_head_id,
      installment: line.installment,
      amount: line.amount,
      due_date: line.due_date,
    }));
    await this.dataSource.transaction((manager) =>
      this.writeDraft(manager, { schoolId, yearId: year.id, classId, lines, actorId: actor.id }),
    );
    return this.getPlan(schoolId, classId, year.id);
  }

  async copyPlan(schoolId: number, classId: number, dto: CopyPlanDto, actor: AuthUser): Promise<CopyPlanResultDto> {
    const year = await this.writableYear(schoolId, dto.academic_year_id);
    const source = await this.schoolClass(schoolId, classId);
    const lines = await this.plans.find({
      where: { school_id: schoolId, academic_year_id: year.id, class_id: classId },
      order: { due_date: 'ASC', id: 'ASC' },
    });
    if (!lines.length) {
      throw AppException.conflict(`Class ${source.name} has no plan in use to copy`, 'PLAN_EMPTY');
    }
    const targets = await this.classesById(
      schoolId,
      dto.to_class_ids.filter((id) => id !== classId),
      'to_class_ids',
    );
    const rows: CopyPlanRowDto[] = [];
    for (const target of targets) {
      rows.push(
        await this.copyInto(schoolId, year, target, planLineValues(lines), actor, `Copied from class ${source.name}`),
      );
    }
    return copyResult(rows);
  }

  async copyYear(schoolId: number, dto: CopyYearDto, actor: AuthUser): Promise<CopyPlanResultDto> {
    const from = await this.year(schoolId, dto.from_academic_year_id);
    const to = await this.writableYear(schoolId, dto.to_academic_year_id);
    if (from.id === to.id) {
      throw AppException.validation([
        { field: 'from_academic_year_id', message: 'Choose a different year to copy from' },
      ]);
    }
    const shift = Number(to.start_date.slice(0, 4)) - Number(from.start_date.slice(0, 4));
    const where = {
      school_id: schoolId,
      academic_year_id: from.id,
      ...(dto.class_ids?.length ? { class_id: In(dto.class_ids) } : {}),
    };
    const lines = await this.plans.find({ where, order: { due_date: 'ASC', id: 'ASC' } });
    const classIds = [...new Set(lines.map((line) => line.class_id))];
    if (!classIds.length) {
      throw AppException.conflict(`${from.name} has no fee plans to copy`, 'PLAN_EMPTY');
    }
    const targets = await this.classesById(schoolId, classIds, 'class_ids');
    const rows: CopyPlanRowDto[] = [];
    for (const target of targets) {
      const own = planLineValues(lines.filter((line) => line.class_id === target.id)).map((line) => ({
        ...line,
        due_date: shiftDate(line.due_date, shift, to.start_date, to.end_date),
      }));
      rows.push(await this.copyInto(schoolId, to, target, own, actor, `Copied from ${from.name}`));
    }
    return copyResult(rows);
  }

  async discardPlanDraft(schoolId: number, classId: number, actor: AuthUser, yearId?: number): Promise<FeePlanDto> {
    const year = await this.year(schoolId, yearId);
    await this.dataSource.transaction(async (manager) => {
      await lockPlan(manager, schoolId, year.id, classId);
      const draft = await this.openVersion(manager, schoolId, year.id, classId);
      if (draft.status === 'pending_approval') throw pendingApproval();
      await manager.softDelete(FeePlanVersion, draft.id);
      await recordFeeAudit(manager, {
        school_id: schoolId,
        entity: 'fee_plan',
        entity_id: classId,
        action: 'discarded',
        before: { academic_year_id: year.id, version: draft.version, status: draft.status, lines: draft.lines },
        actor_id: actor.id,
      });
    });
    return this.getPlan(schoolId, classId, year.id);
  }

  async submitPlan(
    schoolId: number,
    classId: number,
    dto: SubmitPlanDto,
    actor: AuthUser,
    yearId?: number,
  ): Promise<FeePlanDto> {
    const year = await this.writableYear(schoolId, yearId);
    await this.dataSource.transaction(async (manager) => {
      await lockPlan(manager, schoolId, year.id, classId);
      const draft = await this.openVersion(manager, schoolId, year.id, classId);
      if (draft.status === 'pending_approval') throw pendingApproval();
      await this.validatePlanLines(schoolId, classId, year, draft.lines);
      const change = {
        status: 'pending_approval' as const,
        note: dto.note || null,
        submitted_by: actor.id,
        submitted_at: new Date(),
        reviewed_by: null,
        reviewed_at: null,
        review_comment: null,
      };
      await manager.update(FeePlanVersion, draft.id, change);
      await recordFeeAudit(manager, {
        school_id: schoolId,
        entity: 'fee_plan',
        entity_id: classId,
        action: 'submitted',
        before: { version: draft.version, status: draft.status },
        after: { version: draft.version, status: change.status },
        reason: change.note,
        actor_id: actor.id,
      });
    });
    return this.getPlan(schoolId, classId, year.id);
  }

  async approvePlan(
    schoolId: number,
    classId: number,
    dto: ReviewPlanDto,
    actor: AuthUser,
    yearId?: number,
  ): Promise<FeePlanDto> {
    const year = await this.writableYear(schoolId, yearId);
    await this.dataSource.transaction(async (manager) => {
      await lockPlan(manager, schoolId, year.id, classId);
      const pending = await this.pendingVersion(manager, schoolId, year.id, classId);
      if (pending.submitted_by === actor.id) {
        throw AppException.forbidden(
          'You sent this change for approval, so someone else must approve it',
          'SELF_APPROVAL',
        );
      }
      await this.validatePlanLines(schoolId, classId, year, pending.lines);
      const previous = await manager.find(FeePlan, {
        where: { school_id: schoolId, academic_year_id: year.id, class_id: classId },
        order: { due_date: 'ASC', id: 'ASC' },
      });
      await manager.delete(FeePlan, { school_id: schoolId, academic_year_id: year.id, class_id: classId });
      if (pending.lines.length) {
        await manager.save(
          pending.lines.map((line) =>
            manager.create(FeePlan, {
              school_id: schoolId,
              academic_year_id: year.id,
              class_id: classId,
              fee_head_id: line.fee_head_id,
              installment: line.installment,
              amount: line.amount,
              due_date: line.due_date,
              created_by: actor.id,
            }),
          ),
        );
      }
      await manager.update(
        FeePlanVersion,
        { school_id: schoolId, academic_year_id: year.id, class_id: classId, status: 'published' },
        { status: 'superseded' },
      );
      const now = new Date();
      await manager.update(FeePlanVersion, pending.id, {
        status: 'published',
        reviewed_by: actor.id,
        reviewed_at: now,
        review_comment: dto.comment || null,
        published_at: now,
      });
      await recordFeeAudit(manager, {
        school_id: schoolId,
        entity: 'fee_plan',
        entity_id: classId,
        action: 'approved',
        before: { academic_year_id: year.id, lines: previous.map((line) => pick(line, PLAN_LINE_FIELDS)) },
        after: { academic_year_id: year.id, version: pending.version, lines: pending.lines },
        reason: dto.comment,
        actor_id: actor.id,
      });
    });
    return this.getPlan(schoolId, classId, year.id);
  }

  async rejectPlan(
    schoolId: number,
    classId: number,
    dto: RejectPlanDto,
    actor: AuthUser,
    yearId?: number,
  ): Promise<FeePlanDto> {
    const year = await this.year(schoolId, yearId);
    await this.dataSource.transaction(async (manager) => {
      await lockPlan(manager, schoolId, year.id, classId);
      const pending = await this.pendingVersion(manager, schoolId, year.id, classId);
      await manager.update(FeePlanVersion, pending.id, {
        status: 'draft',
        reviewed_by: actor.id,
        reviewed_at: new Date(),
        review_comment: dto.comment,
      });
      await recordFeeAudit(manager, {
        school_id: schoolId,
        entity: 'fee_plan',
        entity_id: classId,
        action: 'rejected',
        before: { version: pending.version, status: pending.status },
        after: { version: pending.version, status: 'draft' },
        reason: dto.comment,
        actor_id: actor.id,
      });
    });
    return this.getPlan(schoolId, classId, year.id);
  }

  async planVersions(schoolId: number, classId: number, yearId?: number): Promise<FeePlanVersionDto[]> {
    const year = await this.year(schoolId, yearId);
    await this.schoolClass(schoolId, classId);
    const versions = await this.versions.find({
      where: { school_id: schoolId, academic_year_id: year.id, class_id: classId },
      order: { version: 'DESC' },
    });
    return this.presentVersions(schoolId, versions);
  }

  async installments(schoolId: number, yearId?: number): Promise<InstallmentTotalDto[]> {
    const year = await this.year(schoolId, yearId);
    const rows: { installment: string; due_date: string; amount: string }[] = await this.dataSource.query(
      `SELECT installment, to_char(max(due_date), 'YYYY-MM-DD') AS due_date, sum(amount) AS amount FROM (
         SELECT installment, due_date, 0 AS amount FROM fee_plans
         WHERE school_id = $1 AND academic_year_id = $2 AND deleted_at IS NULL
         UNION ALL
         SELECT installment, due_date, total AS amount FROM fee_invoices
         WHERE school_id = $1 AND academic_year_id = $2 AND deleted_at IS NULL AND status <> 'cancelled'
       ) x GROUP BY installment ORDER BY max(due_date), installment`,
      [schoolId, year.id],
    );
    return rows.map((row) => ({ installment: row.installment, due_date: row.due_date, amount: Number(row.amount) }));
  }

  async generate(schoolId: number, dto: GenerateInvoicesDto, actor: AuthUser): Promise<GenerateResultDto> {
    const year = await this.year(schoolId);
    if (dto.class_id) await this.schoolClass(schoolId, dto.class_id);
    if (dto.due_date && (dto.due_date < year.start_date || dto.due_date > year.end_date)) {
      throw AppException.validation([
        { field: 'due_date', message: `Due date must be within the ${year.name} academic year` },
      ]);
    }
    const outcome = await this.dataSource.transaction(async (manager) => {
      const result = await generateInvoices(manager, {
        school_id: schoolId,
        year,
        installment: dto.installment,
        class_id: dto.class_id,
        due_date: dto.due_date,
        created_by: actor.id,
      });
      await this.useCredit(manager, schoolId, result.created, actor.id);
      return result;
    });
    const due = outcome.created.filter((invoice) => invoice.total > 0);
    if (due.length) void this.notifyDue(due);
    return {
      installment: dto.installment,
      classes: outcome.classes,
      created: outcome.created.length,
      already_invoiced: outcome.already_invoiced,
      with_transport: outcome.with_transport,
      with_benefits: outcome.with_benefits,
      benefit_amount: outcome.benefit_amount,
      total_amount: outcome.total_amount,
    };
  }

  async collect(
    schoolId: number,
    studentId: number,
    dto: PaymentInputDto,
    idempotencyKey: string | undefined,
    actor: AuthUser,
  ): Promise<CollectionResultDto> {
    const student = await this.dataSource.getRepository(Student).findOneBy({ id: studentId, school_id: schoolId });
    if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    const outcome = await this.dataSource.transaction((manager) =>
      collectForStudent(manager, schoolId, studentId, {
        amount: dto.amount,
        mode: dto.mode,
        reference: dto.reference || null,
        paid_on: dto.paid_on ?? this.today(),
        notes: dto.notes || null,
        received_by: actor.id,
        idempotency_key: paymentKey(idempotencyKey),
      }),
    );
    if (!outcome.replayed) {
      await this.notifyPaymentReceived(studentId, {
        amount: outcome.collection.amount,
        mode: dto.mode,
        paid_on: outcome.collection.paid_on,
        receipt_nos: [
          ...outcome.payments.map((payment) => payment.receipt_no),
          ...(outcome.collection.advance_receipt_no ? [outcome.collection.advance_receipt_no] : []),
        ],
      });
    }
    return this.collectionResult(studentId, outcome.payments, {
      collection_id: outcome.collection.id,
      amount: outcome.collection.amount,
      applied_amount: outcome.collection.applied_amount,
      advance_amount: outcome.collection.advance_amount,
      advance_receipt_no: outcome.collection.advance_receipt_no,
      replayed: outcome.replayed,
    });
  }

  async applyCreditNow(schoolId: number, studentId: number, actor: AuthUser): Promise<CollectionResultDto> {
    const student = await this.dataSource.getRepository(Student).findOneBy({ id: studentId, school_id: schoolId });
    if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    const payments = await this.dataSource.transaction((manager) =>
      applyCredit(manager, schoolId, studentId, actor.id, this.today()),
    );
    const applied = sumAmounts(payments.map((payment) => payment.amount));
    return this.collectionResult(studentId, payments, {
      collection_id: null,
      amount: applied,
      applied_amount: applied,
      advance_amount: 0,
      advance_receipt_no: null,
      replayed: false,
    });
  }

  private async useCredit(
    manager: EntityManager,
    schoolId: number,
    invoices: FeeInvoice[],
    actorId: number | null,
  ): Promise<void> {
    const studentIds = [
      ...new Set(invoices.filter((invoice) => invoice.total > 0).map((invoice) => invoice.student_id)),
    ];
    if (!studentIds.length) return;
    const rows: { student_id: number }[] = await manager.query(
      `SELECT student_id FROM fee_credits WHERE student_id = ANY($1) AND deleted_at IS NULL
       GROUP BY student_id HAVING sum(amount) > 0`,
      [studentIds],
    );
    for (const row of rows) {
      const own = invoices
        .filter((invoice) => invoice.student_id === Number(row.student_id))
        .map((invoice) => invoice.id);
      await applyCredit(manager, schoolId, Number(row.student_id), actorId, this.today(), own);
    }
  }

  private async collectionResult(
    studentId: number,
    payments: FeePayment[],
    head: Omit<CollectionResultDto, 'payments' | 'credit_balance'>,
  ): Promise<CollectionResultDto> {
    const invoices = payments.length
      ? await this.invoices.find({ where: { id: In(payments.map((payment) => payment.invoice_id)) } })
      : [];
    const byId = new Map(invoices.map((invoice) => [invoice.id, invoice]));
    return {
      ...head,
      credit_balance: await creditBalance(this.dataSource.manager, studentId),
      payments: payments.map((payment) => ({
        id: payment.id,
        invoice_id: payment.invoice_id,
        invoice_no: byId.get(payment.invoice_id)?.invoice_no ?? '',
        installment: byId.get(payment.invoice_id)?.installment ?? '',
        amount: payment.amount,
        receipt_no: payment.receipt_no,
        mode: payment.mode,
      })),
    };
  }

  async listInvoices(schoolId: number, query: InvoiceQueryDto): Promise<Paginated<FeeInvoiceDto>> {
    const year = await this.year(schoolId, query.academic_year_id);
    const today = this.today();
    const qb = this.invoices
      .createQueryBuilder('i')
      .innerJoin(Student, 's', 's.id = i.student_id')
      .where('i.school_id = :schoolId AND i.academic_year_id = :yearId', { schoolId, yearId: year.id });
    if (query.status) qb.andWhere('i.status = :status', { status: query.status });
    else qb.andWhere("i.status <> 'cancelled'");
    if (query.kind) qb.andWhere('i.kind = :kind', { kind: query.kind });
    if (query.class_id) qb.andWhere('i.class_id = :classId', { classId: query.class_id });
    if (query.section_id) qb.andWhere('i.section_id = :sectionId', { sectionId: query.section_id });
    if (query.student_id) qb.andWhere('i.student_id = :studentId', { studentId: query.student_id });
    if (query.installment) qb.andWhere('i.installment = :installment', { installment: query.installment });
    if (query.overdue !== undefined) {
      qb.andWhere(
        query.overdue
          ? "i.balance > 0 AND i.due_date < :today AND i.status <> 'cancelled'"
          : "NOT (i.balance > 0 AND i.due_date < :today AND i.status <> 'cancelled')",
        { today },
      );
    }
    const page = await listQuery(qb, query, {
      searchable: ['s.first_name', 's.last_name', 's.admission_no', 'i.invoice_no'],
      sortable: {
        due_date: 'i.due_date',
        invoice_no: 'i.invoice_no',
        balance: 'i.balance',
        total: 'i.total',
        student: 's.first_name',
        created_at: 'i.created_at',
      },
      defaultSort: 'due_date',
    });
    return { ...page, items: await this.presentInvoices(schoolId, page.items) };
  }

  async getInvoice(schoolId: number, id: number): Promise<FeeInvoiceDetailDto> {
    const invoice = await this.invoice(schoolId, id);
    return (await this.detailInvoices(schoolId, [invoice]))[0]!;
  }

  async pay(
    schoolId: number,
    invoiceId: number,
    dto: PaymentInputDto,
    actor: AuthUser,
    idempotencyKey?: string,
  ): Promise<FeePaymentDto> {
    const today = this.today();
    const paidOn = dto.paid_on ?? today;
    if (paidOn > today) {
      throw AppException.validation([{ field: 'paid_on', message: 'Payment date cannot be in the future' }]);
    }
    const key = paymentKey(idempotencyKey);
    const { payment, replayed } = await this.dataSource.transaction((manager) =>
      recordPayment(manager, schoolId, invoiceId, {
        amount: dto.amount,
        mode: dto.mode,
        reference: dto.reference,
        paid_on: paidOn,
        notes: dto.notes,
        received_by: actor.id,
        idempotency_key: key,
      }),
    );
    if (!replayed) {
      await this.notifyPaymentReceived(payment.student_id, {
        amount: payment.amount,
        mode: payment.mode,
        paid_on: paidOn,
        receipt_nos: [payment.receipt_no],
      });
    }
    return (await this.presentPayments(schoolId, [payment]))[0]!;
  }

  async listPayments(schoolId: number, query: PaymentQueryDto): Promise<Paginated<FeePaymentDto>> {
    const qb = this.payments
      .createQueryBuilder('p')
      .innerJoin(FeeInvoice, 'i', 'i.id = p.invoice_id')
      .innerJoin(Student, 's', 's.id = p.student_id')
      .where('p.school_id = :schoolId', { schoolId });
    this.paymentFilters(qb, query);
    if (query.student_id) qb.andWhere('p.student_id = :studentId', { studentId: query.student_id });
    if (query.status) qb.andWhere('p.status = :status', { status: query.status });
    const page = await listQuery(qb, query, {
      searchable: ['s.first_name', 's.last_name', 's.admission_no', 'p.receipt_no', 'i.invoice_no', 'p.reference'],
      sortable: { paid_on: 'p.paid_on', amount: 'p.amount', receipt_no: 'p.receipt_no', created_at: 'p.created_at' },
      defaultSort: 'paid_on',
    });
    return { ...page, items: await this.presentPayments(schoolId, page.items) };
  }

  async paymentSummary(schoolId: number, query: PaymentSummaryQueryDto): Promise<PaymentSummaryDto> {
    const qb = this.payments
      .createQueryBuilder('p')
      .innerJoin(FeeInvoice, 'i', 'i.id = p.invoice_id')
      .select('p.mode', 'mode')
      .addSelect('count(*)', 'count')
      .addSelect('coalesce(sum(p.amount), 0)', 'amount')
      .where("p.school_id = :schoolId AND p.status = 'success' AND p.mode <> 'credit'", { schoolId })
      .groupBy('p.mode')
      .orderBy('amount', 'DESC');
    this.paymentFilters(qb, query);
    const rows: { mode: FeePaymentDto['mode']; count: string; amount: string }[] = await qb.getRawMany();
    const byMode = rows.map((row) => ({ mode: row.mode, count: Number(row.count), amount: Number(row.amount) }));
    return {
      count: byMode.reduce((sum, row) => sum + row.count, 0),
      amount: sumAmounts(byMode.map((row) => row.amount)),
      by_mode: byMode,
    };
  }

  async receipt(schoolId: number, paymentId: number, studentId?: number): Promise<{ name: string; pdf: Buffer }> {
    const payment = await this.payments.findOneBy({ id: paymentId, school_id: schoolId });
    if (!payment || (studentId && payment.student_id !== studentId)) {
      throw AppException.notFound('Receipt not found', 'RECEIPT_NOT_FOUND');
    }
    const invoice = await this.invoices.findOneByOrFail({ id: payment.invoice_id });
    const [lines, refs, school, users] = await Promise.all([
      this.lines.find({ where: { invoice_id: invoice.id }, order: { sort_order: 'ASC', id: 'ASC' } }),
      this.studentRefs(schoolId, [payment.student_id]),
      this.pdfSchool(schoolId),
      this.userNames(payment.received_by ? [payment.received_by] : []),
    ]);
    const paidToDate = sumAmounts(
      (await this.payments.find({ where: { invoice_id: invoice.id }, order: { id: 'ASC' } }))
        .filter((row) => row.id <= payment.id && (row.status === 'success' || row.id === payment.id))
        .map((row) => row.amount),
    );
    const student = refs.get(payment.student_id)!;
    const pdf = await receiptPdf({
      ...school,
      receipt_no: payment.receipt_no,
      paid_on: payment.paid_on,
      student_name: student.full_name,
      admission_no: student.admission_no,
      class_section: student.class_section,
      invoice_no: invoice.invoice_no,
      installment: invoice.installment,
      due_date: invoice.due_date,
      mode: payment.mode,
      reference: payment.reference,
      received_by: payment.received_by ? (users.get(payment.received_by) ?? null) : null,
      amount: payment.amount,
      lines: lines.map((line): [string, number] => [
        line.description ? `${line.head_name} (${line.description})` : line.head_name,
        line.amount,
      ]),
      benefit: invoice.benefit,
      discount: invoice.discount,
      invoice_total: invoice.total,
      paid_to_date: paidToDate,
      balance: round2(invoice.total - paidToDate),
      reversed:
        payment.status === 'reversed'
          ? {
              on: payment.reversed_at ? todayIn(this.app.timeZone, payment.reversed_at) : null,
              reason: payment.reversal_reason,
            }
          : null,
    });
    return { name: `Receipt-${payment.receipt_no}`, pdf };
  }

  async invoiceFile(schoolId: number, invoiceId: number, studentId?: number): Promise<{ name: string; pdf: Buffer }> {
    const invoice = await this.invoices.findOneBy({ id: invoiceId, school_id: schoolId });
    if (!invoice || (studentId && invoice.student_id !== studentId)) {
      throw AppException.notFound('Invoice not found', 'INVOICE_NOT_FOUND');
    }
    const [lines, payments, refs, [year], school] = await Promise.all([
      this.lines.find({ where: { invoice_id: invoice.id }, order: { sort_order: 'ASC', id: 'ASC' } }),
      this.payments.find({
        where: { invoice_id: invoice.id, status: 'success' },
        order: { paid_on: 'ASC', id: 'ASC' },
      }),
      this.studentRefs(schoolId, [invoice.student_id]),
      this.dataSource.query(`SELECT name FROM academic_years WHERE id = $1`, [invoice.academic_year_id]),
      this.pdfSchool(schoolId),
    ]);
    const student = refs.get(invoice.student_id)!;
    const pdf = await invoicePdf({
      ...school,
      invoice_no: invoice.invoice_no,
      kind: invoice.kind,
      issued_on: todayIn(this.app.timeZone, invoice.created_at),
      student_name: student.full_name,
      admission_no: student.admission_no,
      class_section: student.class_section,
      academic_year: (year?.name as string | undefined) ?? null,
      installment: invoice.installment,
      due_date: invoice.due_date,
      status: invoice.status,
      lines: lines.map((line): [string, number] => [
        line.description ? `${line.head_name} (${line.description})` : line.head_name,
        line.amount,
      ]),
      benefit: invoice.benefit,
      discount: invoice.discount,
      total: invoice.total,
      payments: payments.map((payment) => ({
        receipt_no: payment.receipt_no,
        paid_on: payment.paid_on,
        mode: payment.mode,
        amount: payment.amount,
      })),
      refunded: invoice.refunded,
      balance: invoice.balance,
      cancel_reason: invoice.cancel_reason,
    });
    return { name: `Invoice-${invoice.invoice_no}`, pdf };
  }

  async refundFile(schoolId: number, refundId: number, studentId?: number): Promise<{ name: string; pdf: Buffer }> {
    const refunds = this.dataSource.getRepository(FeeRefund);
    const refund = await refunds.findOneBy({ id: refundId, school_id: schoolId });
    if (!refund || (studentId && refund.student_id !== studentId)) {
      throw AppException.notFound('Refund not found', 'REFUND_NOT_FOUND');
    }
    const invoice = await this.invoices.findOneByOrFail({ id: refund.invoice_id });
    const [refs, school, users, earlier] = await Promise.all([
      this.studentRefs(schoolId, [refund.student_id]),
      this.pdfSchool(schoolId),
      this.userNames(refund.approved_by ? [refund.approved_by] : []),
      refunds.find({ where: { invoice_id: invoice.id }, order: { id: 'ASC' } }),
    ]);
    const student = refs.get(refund.student_id)!;
    const pdf = await refundPdf({
      ...school,
      refund_no: refund.refund_no,
      paid_on: refund.paid_on,
      student_name: student.full_name,
      admission_no: student.admission_no,
      class_section: student.class_section,
      invoice_no: invoice.invoice_no,
      installment: invoice.installment,
      mode: refund.mode,
      reference: refund.reference,
      reason: refund.reason,
      approved_by: refund.approved_by ? (users.get(refund.approved_by) ?? null) : null,
      invoice_total: invoice.total,
      paid: invoice.paid,
      refunded_before: sumAmounts(earlier.filter((row) => row.id < refund.id).map((row) => row.amount)),
      amount: refund.amount,
    });
    return { name: `Refund-${refund.refund_no}`, pdf };
  }

  async pdfSchool(schoolId: number) {
    const [school]: {
      name: string;
      address: string | null;
      city: string | null;
      state: string | null;
      pincode: string | null;
      logo_file_id: number | null;
      signature_file_id: number | null;
      seal_file_id: number | null;
    }[] = await this.dataSource.query(
      `SELECT name, address, city, state, pincode, logo_file_id, signature_file_id, seal_file_id FROM schools WHERE id = $1`,
      [schoolId],
    );
    return {
      school_name: school?.name ?? '',
      school_address:
        [school?.address, school?.city, school?.state, school?.pincode].filter(Boolean).join(', ') || null,
      school_logo: await this.files.readImage(school?.logo_file_id ?? null),
      school_signature: await this.files.readImage(school?.signature_file_id ?? null),
      school_seal: await this.files.readImage(school?.seal_file_id ?? null),
    };
  }

  async insights(schoolId: number): Promise<FeeInsightsDto> {
    const year = await this.year(schoolId);
    const today = this.today();
    const [[totals], [collection], [waiting]] = await Promise.all([
      this.dataSource.query(
        `SELECT count(*) AS invoices, coalesce(sum(total), 0) AS billed, coalesce(sum(paid), 0) AS collected,
                coalesce(sum(balance), 0) AS outstanding,
                coalesce(sum(balance) FILTER (WHERE balance > 0 AND due_date < $3), 0) AS overdue_amount,
                count(DISTINCT student_id) FILTER (WHERE balance > 0 AND due_date < $3) AS students_overdue,
                count(*) FILTER (WHERE status = 'unpaid') AS unpaid,
                count(*) FILTER (WHERE status = 'partly_paid') AS partly_paid,
                count(*) FILTER (WHERE status = 'paid') AS paid,
                coalesce(sum(benefit), 0) AS benefit, coalesce(sum(discount), 0) AS discount,
                coalesce(sum(late_fee), 0) AS late_fee, coalesce(sum(refunded), 0) AS refunded
         FROM fee_invoices WHERE school_id = $1 AND academic_year_id = $2 AND deleted_at IS NULL
           AND status <> 'cancelled'`,
        [schoolId, year.id, today],
      ),
      this.dataSource.query(
        `SELECT count(*) AS count, coalesce(sum(amount), 0) AS amount,
                (SELECT coalesce(sum(advance_amount), 0) FROM fee_collections
                 WHERE school_id = $1 AND paid_on = $2 AND deleted_at IS NULL) AS advance
         FROM fee_payments
         WHERE school_id = $1 AND paid_on = $2 AND deleted_at IS NULL AND status = 'success' AND mode <> 'credit'`,
        [schoolId, today],
      ),
      this.dataSource.query(
        `SELECT count(*) AS count FROM fee_requests WHERE school_id = $1 AND status = 'pending' AND deleted_at IS NULL`,
        [schoolId],
      ),
    ]);
    return {
      academic_year: year.name,
      concessions: Number(totals.benefit),
      discounts: Number(totals.discount),
      late_fees: Number(totals.late_fee),
      refunded: Number(totals.refunded),
      pending_requests: Number(waiting.count),
      invoices: Number(totals.invoices),
      total_billed: Number(totals.billed),
      collected: Number(totals.collected),
      outstanding: Number(totals.outstanding),
      overdue_amount: Number(totals.overdue_amount),
      students_overdue: Number(totals.students_overdue),
      todays_collection: round2(Number(collection.amount) + Number(collection.advance)),
      todays_advance: Number(collection.advance),
      todays_payments: Number(collection.count),
      by_status: { unpaid: Number(totals.unpaid), partly_paid: Number(totals.partly_paid), paid: Number(totals.paid) },
    };
  }

  async summary(schoolId: number, studentId: number): Promise<StudentFeesDto> {
    const refs = await this.studentRefs(schoolId, [studentId]);
    const student = refs.get(studentId);
    if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    const invoices = await this.invoices.find({
      where: { school_id: schoolId, student_id: studentId },
      order: { due_date: 'DESC', id: 'DESC' },
    });
    const ordered = [
      ...invoices.filter((row) => row.status !== 'cancelled'),
      ...invoices.filter((row) => row.status === 'cancelled'),
    ];
    const details = await this.detailInvoices(schoolId, ordered);
    const payments = details
      .flatMap((invoice) => invoice.payments)
      .sort((a, b) => b.paid_on.localeCompare(a.paid_on) || b.id - a.id);
    const totals = (await this.totalsFor(schoolId, [studentId])).get(studentId)!;
    return {
      student,
      ...totals,
      credit_balance: await creditBalance(this.dataSource.manager, studentId),
      previous_dues: await this.previousDues(schoolId, ordered),
      invoices: details,
      payments,
      advances: await this.advances(schoolId, studentId),
      upcoming: await this.upcoming(schoolId, studentId, ordered),
    };
  }

  private async upcoming(
    schoolId: number,
    studentId: number,
    invoices: FeeInvoice[],
  ): Promise<UpcomingInstallmentDto[]> {
    const [year]: FeeYear[] = await this.dataSource.query(
      `SELECT id, name, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date
       FROM academic_years WHERE school_id = $1 AND deleted_at IS NULL AND ${yearClause('academic_years')}`,
      [schoolId],
    );
    if (!year) return [];
    const yearId = Number(year.id);
    const [enrollment]: { class_id: number }[] = await this.dataSource.query(
      `SELECT class_id FROM student_enrollments
       WHERE school_id = $1 AND academic_year_id = $2 AND student_id = $3 AND status = 'studying' LIMIT 1`,
      [schoolId, yearId, studentId],
    );
    if (!enrollment) return [];
    const plans = await this.plans.find({
      where: { school_id: schoolId, academic_year_id: yearId, class_id: Number(enrollment.class_id) },
      order: { due_date: 'ASC', id: 'ASC' },
    });
    const billed = new Set(
      invoices.filter((invoice) => invoice.academic_year_id === yearId).map((invoice) => invoice.installment),
    );
    const today = this.today();
    const dueOf = (installment: string) =>
      plans
        .filter((plan) => plan.installment === installment)
        .map((plan) => plan.due_date)
        .sort()
        .pop()!;
    const open = [...new Set(plans.map((plan) => plan.installment))].filter(
      (name) => !billed.has(name) && dueOf(name) >= today,
    );
    if (!open.length) return [];
    const heads = new Map((await this.heads.findBy({ school_id: schoolId })).map((head) => [head.id, head]));
    const transportHead = [...heads.values()].find((head) => head.is_transport && head.is_active) ?? null;
    const rider = transportHead
      ? ((await ridersWithFee(this.dataSource.manager, schoolId, [studentId])).get(studentId) ?? null)
      : null;
    const planDates = [...new Set(plans.map((plan) => plan.due_date))];
    return open
      .map((installment) => {
        const own = plans.filter((plan) => plan.installment === installment);
        const dueDate = dueOf(installment);
        const lines = own.map((plan) => ({
          head_name: heads.get(plan.fee_head_id)?.name ?? 'Fee',
          amount: Number(plan.amount),
        }));
        if (transportHead && rider && rider.monthly_fee > 0) {
          const months = monthsBetween(previousDueDate(planDates, dueDate, year.start_date), dueDate);
          lines.push({ head_name: transportHead.name, amount: round2(rider.monthly_fee * months) });
        }
        return {
          installment,
          due_date: dueDate,
          amount: sumAmounts(lines.map((line) => line.amount)),
          lines,
        };
      })
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
  }

  private async advances(schoolId: number, studentId: number): Promise<AdvanceReceiptDto[]> {
    const rows = await this.dataSource.getRepository(FeeCollection).find({
      where: { school_id: schoolId, student_id: studentId, advance_amount: MoreThan(0) },
      order: { paid_on: 'DESC', id: 'DESC' },
    });
    return rows
      .filter((row) => row.advance_receipt_no)
      .map((row) => ({
        collection_id: row.id,
        receipt_no: row.advance_receipt_no!,
        amount: row.advance_amount,
        collected: row.amount,
        mode: row.mode,
        paid_on: row.paid_on,
      }));
  }

  async advanceReceipt(
    schoolId: number,
    collectionId: number,
    studentId?: number,
  ): Promise<{ name: string; pdf: Buffer }> {
    const collection = await this.dataSource
      .getRepository(FeeCollection)
      .findOneBy({ id: collectionId, school_id: schoolId });
    if (
      !collection ||
      !collection.advance_receipt_no ||
      collection.advance_amount <= 0 ||
      (studentId && collection.student_id !== studentId)
    ) {
      throw AppException.notFound('Advance receipt not found', 'RECEIPT_NOT_FOUND');
    }
    const payments = await this.payments.find({
      where: { collection_id: collection.id },
      order: { id: 'ASC' },
    });
    const invoices = await this.invoices.findBy({ id: In(payments.map((row) => row.invoice_id)) });
    const invoiceById = new Map(invoices.map((row) => [row.id, row]));
    const [refs, school, users] = await Promise.all([
      this.studentRefs(schoolId, [collection.student_id]),
      this.pdfSchool(schoolId),
      this.userNames(collection.created_by ? [collection.created_by] : []),
    ]);
    const student = refs.get(collection.student_id)!;
    const pdf = await advanceReceiptPdf({
      ...school,
      receipt_no: collection.advance_receipt_no,
      paid_on: collection.paid_on,
      student_name: student.full_name,
      admission_no: student.admission_no,
      class_section: student.class_section,
      mode: collection.mode,
      reference: collection.reference,
      received_by: collection.created_by ? (users.get(collection.created_by) ?? null) : null,
      collected: collection.amount,
      applied: payments.map((payment): [string, number] => {
        const invoice = invoiceById.get(payment.invoice_id);
        return [
          invoice ? `${invoice.installment}, receipt ${payment.receipt_no}` : `receipt ${payment.receipt_no}`,
          payment.amount,
        ];
      }),
      advance: collection.advance_amount,
    });
    return { name: `Advance-receipt-${collection.advance_receipt_no}`, pdf };
  }

  private async previousDues(schoolId: number, invoices: FeeInvoice[]): Promise<PreviousDuesDto> {
    const [current] = await this.dataSource.query(
      `SELECT id, to_char(start_date, 'YYYY-MM-DD') AS start_date FROM academic_years
       WHERE school_id = $1 AND is_current = true AND deleted_at IS NULL`,
      [schoolId],
    );
    const yearIds = [...new Set(invoices.map((invoice) => invoice.academic_year_id))];
    const years: { id: number; name: string; start_date: string }[] = yearIds.length
      ? await this.dataSource.query(
          `SELECT id, name, to_char(start_date, 'YYYY-MM-DD') AS start_date FROM academic_years WHERE id = ANY($1)`,
          [yearIds],
        )
      : [];
    const earlier = new Map(
      years
        .filter((year) => current && Number(year.id) !== Number(current.id) && year.start_date < current.start_date)
        .map((year) => [Number(year.id), year]),
    );
    const open = invoices.filter(
      (invoice) => earlier.has(invoice.academic_year_id) && invoice.status !== 'cancelled' && invoice.balance > 0,
    );
    return {
      amount: sumAmounts(open.map((invoice) => invoice.balance)),
      invoices: open.length,
      academic_years: [...new Set(open.map((invoice) => invoice.academic_year_id))]
        .map((id) => earlier.get(id)!)
        .sort((a, b) => a.start_date.localeCompare(b.start_date))
        .map((year) => year.name),
    };
  }

  async statusFor(schoolId: number, studentIds: number[]): Promise<Map<number, FeeStatusDto>> {
    const totals = await this.totalsFor(schoolId, studentIds);
    return new Map(
      [...totals].map(([id, row]) => [
        id,
        {
          status: row.status,
          balance: row.balance,
          next_due_date: row.next_due_date,
          overdue_amount: row.overdue_amount,
        },
      ]),
    );
  }

  async totalsFor(schoolId: number, studentIds: number[]): Promise<Map<number, FeeTotalsDto>> {
    const ids = [...new Set(studentIds)];
    const result = new Map<number, FeeTotalsDto>();
    if (!ids.length) return result;
    const today = this.today();
    const [invoices, lastPayments] = await Promise.all([
      this.invoices.find({
        where: { school_id: schoolId, student_id: In(ids), status: Not('cancelled') },
        select: { id: true, student_id: true, total: true, paid: true, balance: true, due_date: true, status: true },
      }),
      this.dataSource.query(
        `SELECT DISTINCT ON (student_id) student_id, to_char(paid_on, 'YYYY-MM-DD') AS paid_on, amount
         FROM fee_payments WHERE school_id = $1 AND student_id = ANY($2) AND deleted_at IS NULL
           AND status = 'success'
         ORDER BY student_id, paid_on DESC, id DESC`,
        [schoolId, ids],
      ) as Promise<{ student_id: number; paid_on: string; amount: string }[]>,
    ]);
    const last = new Map(lastPayments.map((row) => [Number(row.student_id), row]));
    for (const id of ids) {
      const totals = feeTotals(
        invoices.filter((invoice) => invoice.student_id === id),
        today,
      );
      const payment = last.get(id);
      result.set(id, {
        ...totals,
        last_payment: payment ? { date: payment.paid_on, amount: Number(payment.amount) } : null,
      });
    }
    return result;
  }

  async sectionFees(schoolId: number, sectionId: number, userId: number): Promise<SectionFeesDto> {
    const [section] = await this.dataSource.query(
      `SELECT sec.id, sec.name, sec.class_teacher_user_id, c.name AS class_name FROM sections sec
       JOIN classes c ON c.id = sec.class_id WHERE sec.id = $1 AND sec.school_id = $2 AND sec.deleted_at IS NULL`,
      [sectionId, schoolId],
    );
    if (!section) throw AppException.notFound('Section not found', 'SECTION_NOT_FOUND');
    if (Number(section.class_teacher_user_id) !== userId) {
      throw AppException.forbidden('Only the class teacher of this section can see its fees', 'NOT_CLASS_TEACHER');
    }
    const students: {
      id: number;
      first_name: string;
      last_name: string | null;
      admission_no: string;
      roll_no: number | null;
      photo_file_id: number | null;
    }[] = await this.dataSource.query(
      `SELECT s.id, s.first_name, s.last_name, s.admission_no, e.roll_no, s.photo_file_id
       FROM student_enrollments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       WHERE e.section_id = $1 AND e.status = 'studying'
       ORDER BY e.roll_no NULLS LAST, s.first_name`,
      [sectionId],
    );
    const totals = await this.totalsFor(
      schoolId,
      students.map((row) => Number(row.id)),
    );
    const counts = Object.fromEntries(STUDENT_FEE_STATUSES.map((status) => [status, 0])) as Record<
      StudentFeeStatus,
      number
    >;
    const rows = students.map((row) => {
      const total = totals.get(Number(row.id))!;
      counts[total.status] += 1;
      return {
        student_id: Number(row.id),
        full_name: fullName(row),
        admission_no: row.admission_no,
        roll_no: row.roll_no === null ? null : Number(row.roll_no),
        photo_file_id: row.photo_file_id === null ? null : Number(row.photo_file_id),
        ...total,
      };
    });
    return {
      section_id: sectionId,
      class_section: `${section.class_name} - ${section.name}`,
      counts,
      overdue_amount: sumAmounts(rows.map((row) => row.overdue_amount)),
      students: rows,
    };
  }

  async teacherStudentFees(schoolId: number, studentId: number, userId: number): Promise<StudentFeesDto> {
    const [row] = await this.dataSource.query(
      `SELECT s.id, sec.class_teacher_user_id FROM students s
       LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.status = 'studying'
         AND e.academic_year_id = (SELECT id FROM academic_years y WHERE y.school_id = s.school_id
           AND ${yearClause('y')} AND y.deleted_at IS NULL)
       LEFT JOIN sections sec ON sec.id = e.section_id
       WHERE s.id = $1 AND s.school_id = $2 AND s.deleted_at IS NULL`,
      [studentId, schoolId],
    );
    if (!row) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    if (Number(row.class_teacher_user_id) !== userId) {
      throw AppException.forbidden('Only the class teacher of this student can see their fees', 'NOT_CLASS_TEACHER');
    }
    return feesForTeacher(await this.summary(schoolId, studentId));
  }

  async childSchool(userId: number, studentId: number): Promise<number> {
    const [row] = await this.dataSource.query(
      `SELECT s.school_id FROM student_guardians sg
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
       JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       WHERE g.user_id = $1 AND sg.student_id = $2 LIMIT 1`,
      [userId, studentId],
    );
    if (!row) throw AppException.notFound('This child is not linked to your mobile number', 'CHILD_NOT_FOUND');
    return Number(row.school_id);
  }

  async listAuditLogs(schoolId: number, query: FeeAuditQueryDto): Promise<Paginated<FeeAuditLogDto>> {
    const qb = this.auditLogs
      .createQueryBuilder('a')
      .leftJoin(User, 'u', 'u.id = a.created_by')
      .where('a.school_id = :schoolId', { schoolId });
    if (query.entity) qb.andWhere('a.entity = :entity', { entity: query.entity });
    if (query.entity_id) qb.andWhere('a.entity_id = :entityId', { entityId: query.entity_id });
    if (query.action) qb.andWhere('a.action = :action', { action: query.action });
    if (query.user_id) qb.andWhere('a.created_by = :userId', { userId: query.user_id });
    if (query.from) {
      qb.andWhere('a.created_at >= timezone(:zone, CAST(:from AS timestamp))', {
        from: query.from,
        zone: this.app.timeZone,
      });
    }
    if (query.to) {
      qb.andWhere(`a.created_at < timezone(:zone, CAST(:to AS timestamp) + interval '1 day')`, {
        to: query.to,
        zone: this.app.timeZone,
      });
    }
    const page = await listQuery(qb, query, {
      searchable: ['a.reason', 'u.name'],
      sortable: { created_at: 'a.created_at' },
      defaultSort: 'created_at',
    });
    const users = await this.userNames(page.items.map((row) => row.created_by).filter((id): id is number => !!id));
    return {
      ...page,
      items: page.items.map((row) => ({
        id: row.id,
        entity: row.entity,
        entity_id: row.entity_id,
        action: row.action,
        before: row.before,
        after: row.after,
        reason: row.reason,
        user: row.created_by ? { id: row.created_by, name: users.get(row.created_by) ?? '' } : null,
        created_at: row.created_at,
      })),
    };
  }

  async reconciliation(schoolId: number): Promise<ReconciliationDto> {
    const [rows, [{ checked }]] = await Promise.all([
      this.dataSource.query(MISMATCH_SQL + ` AND i.school_id = $1 ORDER BY i.id`, [schoolId]) as Promise<MismatchRow[]>,
      this.dataSource.query(
        `SELECT count(*) AS checked FROM fee_invoices WHERE school_id = $1 AND deleted_at IS NULL`,
        [schoolId],
      ) as Promise<{ checked: string }[]>,
    ]);
    return {
      invoices_checked: Number(checked),
      mismatches: rows.map((row) => ({
        invoice_id: Number(row.id),
        invoice_no: row.invoice_no,
        student_id: Number(row.student_id),
        status: row.status,
        gross: Number(row.gross),
        benefit: Number(row.benefit),
        discount: Number(row.discount),
        total: Number(row.total),
        paid: Number(row.paid),
        balance: Number(row.balance),
        payments_total: Number(row.payments_total),
      })),
    };
  }

  @Cron('30 2 * * *', { name: 'fee-reconciliation', timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' })
  async nightlyReconciliation(): Promise<void> {
    const rows: { school_id: number; count: string }[] = await this.dataSource.query(
      `SELECT school_id, count(*) AS count FROM (${MISMATCH_SQL}) m GROUP BY school_id`,
    );
    for (const row of rows) {
      this.logger.warn(`School ${row.school_id}: ${row.count} fee invoices do not match their payments`);
    }
  }

  @Cron('0 8 * * *', { name: 'fee-overdue', timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' })
  async dailyOverdueReminders(): Promise<void> {
    const sent = await this.sendOverdueReminders(null);
    if (sent) this.logger.log(`Sent ${sent} fee overdue reminders`);
    const soon = await this.sendDueSoonReminders(null);
    if (soon) this.logger.log(`Sent ${soon} fee due-soon reminders`);
  }

  async sendDueSoonReminders(schoolId: number | null): Promise<number> {
    const today = this.today();
    const reminderDays = `coalesce((SELECT fs.reminder_days FROM fee_settings fs
                             WHERE fs.school_id = fee_invoices.school_id AND fs.deleted_at IS NULL), ${DEFAULT_REMINDER_DAYS})`;
    const rows: { student_id: number; balance: string; due_date: string; installment: string }[] =
      await this.dataSource.query(
        `WITH reminded AS (
           UPDATE fee_invoices SET due_reminded_at = now()
           WHERE deleted_at IS NULL AND status IN ('unpaid', 'partly_paid') AND balance > 0
             AND due_reminded_at IS NULL AND created_at < now() - interval '1 day'
             AND ${reminderDays} > 0
             AND due_date >= $1::date AND due_date <= $1::date + ${reminderDays}
             ${schoolId ? 'AND school_id = $2' : ''}
           RETURNING student_id, balance, due_date, installment
         ) SELECT student_id, balance, to_char(due_date, 'YYYY-MM-DD') AS due_date, installment FROM reminded`,
        schoolId ? [today, schoolId] : [today],
      );
    await this.notifyGuardians(
      'FEE_DUE_SOON',
      rows.map((row) => {
        const days = daysBetween(today, row.due_date);
        return {
          student_id: Number(row.student_id),
          data: {
            amount: rupees(Number(row.balance)),
            due_date: shortDate(row.due_date),
            installment: row.installment,
            days: String(days),
            ...dueIn(days),
          },
        };
      }),
    );
    return rows.length;
  }

  async sendOverdueReminders(schoolId: number | null): Promise<number> {
    const today = this.today();
    const rows: { id: number; student_id: number; balance: string; due_date: string }[] = await this.dataSource.query(
      `WITH alerted AS (
         UPDATE fee_invoices SET overdue_alerted_at = now()
         WHERE deleted_at IS NULL AND status IN ('unpaid', 'partly_paid') AND balance > 0
           AND due_date + coalesce((SELECT fs.grace_days FROM fee_settings fs
                                    WHERE fs.school_id = fee_invoices.school_id AND fs.deleted_at IS NULL), 0) < $1
           AND (overdue_alerted_at IS NULL OR overdue_alerted_at < now() - interval '7 days')
           ${schoolId ? 'AND school_id = $2' : ''}
         RETURNING id, student_id, balance, due_date
       ) SELECT id, student_id, balance, to_char(due_date, 'YYYY-MM-DD') AS due_date FROM alerted`,
      schoolId ? [today, schoolId] : [today],
    );
    return this.notifyParents(
      'FEE_OVERDUE',
      rows.map((row) => ({
        student_id: Number(row.student_id),
        amount: Number(row.balance),
        due_date: row.due_date,
        days: daysBetween(row.due_date, today),
      })),
    );
  }

  private async notifyDue(invoices: FeeInvoice[]): Promise<void> {
    await this.notifyParents(
      'FEE_DUE',
      invoices.map((invoice) => ({
        student_id: invoice.student_id,
        amount: invoice.total,
        due_date: invoice.due_date,
        installment: invoice.installment,
      })),
    );
  }

  async notifyPaymentReceived(
    studentId: number,
    paid: { amount: number; mode: string; paid_on: string; receipt_nos: string[] },
  ): Promise<void> {
    if (!paid.receipt_nos.length || Number(paid.amount) <= 0) return;
    try {
      const [due]: { balance: string }[] = await this.dataSource.query(
        `SELECT coalesce(sum(balance), 0) AS balance FROM fee_invoices
         WHERE student_id = $1 AND deleted_at IS NULL AND status <> 'cancelled' AND balance > 0`,
        [studentId],
      );
      await this.notifyGuardians('FEE_PAYMENT_RECEIVED', [
        {
          student_id: studentId,
          data: {
            amount: rupees(Number(paid.amount)),
            date: shortDate(paid.paid_on),
            mode: PAYMENT_MODE_NAMES[paid.mode] ?? paid.mode,
            receipt_no: paid.receipt_nos.join(', '),
            balance: rupees(Number(due?.balance ?? 0)),
          },
        },
      ]);
    } catch (error) {
      this.logger.warn(`Payment notice for student ${studentId} not sent: ${(error as Error).message}`);
    }
  }

  async notifyGuardians(
    template: string,
    items: { student_id: number; data: Record<string, string> }[],
  ): Promise<void> {
    if (!items.length) return;
    const rows: { student_id: number; first_name: string; last_name: string | null; user_ids: number[] }[] =
      await this.dataSource.query(
        `SELECT s.id AS student_id, s.first_name, s.last_name,
                array_remove(array_agg(DISTINCT g.user_id), NULL) AS user_ids
         FROM students s
         LEFT JOIN student_guardians sg ON sg.student_id = s.id AND sg.receives_alerts = true
         LEFT JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
         WHERE s.id = ANY($1) GROUP BY s.id`,
        [[...new Set(items.map((item) => item.student_id))]],
      );
    const byStudent = new Map(rows.map((row) => [Number(row.student_id), row]));
    for (const item of items) {
      const row = byStudent.get(item.student_id);
      if (!row?.user_ids.length) continue;
      await this.notifications
        .dispatch({
          template,
          audience: { user_ids: row.user_ids.map(Number) },
          data: { student: fullName(row), student_id: String(item.student_id), ...item.data },
        })
        .catch((error: Error) =>
          this.logger.warn(`${template} for student ${item.student_id} not sent: ${error.message}`),
        );
    }
  }

  private async notifyParents(
    template: 'FEE_DUE' | 'FEE_OVERDUE',
    items: { student_id: number; amount: number; due_date: string; installment?: string; days?: number }[],
  ): Promise<number> {
    if (!items.length) return 0;
    const parents: { student_id: number; first_name: string; last_name: string | null; user_ids: number[] }[] =
      await this.dataSource.query(
        `SELECT s.id AS student_id, s.first_name, s.last_name,
                array_remove(array_agg(DISTINCT g.user_id), NULL) AS user_ids
         FROM students s
         LEFT JOIN student_guardians sg ON sg.student_id = s.id AND sg.receives_alerts = true
         LEFT JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
         WHERE s.id = ANY($1) GROUP BY s.id`,
        [[...new Set(items.map((item) => item.student_id))]],
      );
    const byStudent = new Map(parents.map((row) => [Number(row.student_id), row]));
    let sent = 0;
    for (const item of items) {
      const parent = byStudent.get(item.student_id);
      if (!parent?.user_ids.length) continue;
      await this.notifications
        .dispatch({
          template,
          audience: { user_ids: parent.user_ids.map(Number) },
          data: {
            student: fullName(parent),
            amount: rupees(item.amount),
            due_date: shortDate(item.due_date),
            installment: item.installment ?? '',
            days: String(item.days ?? 0),
            student_id: String(item.student_id),
          },
        })
        .then(() => (sent += 1))
        .catch((error: Error) =>
          this.logger.warn(`${template} for student ${item.student_id} not sent: ${error.message}`),
        );
    }
    return sent;
  }

  private paymentFilters(qb: SelectQueryBuilder<FeePayment>, query: PaymentSummaryQueryDto): void {
    if (query.from) qb.andWhere('p.paid_on >= :from', { from: query.from });
    if (query.to) qb.andWhere('p.paid_on <= :to', { to: query.to });
    if (query.mode) qb.andWhere('p.mode = :mode', { mode: query.mode });
    if (query.class_id) qb.andWhere('i.class_id = :classId', { classId: query.class_id });
    if (query.received_by) qb.andWhere('p.received_by = :receivedBy', { receivedBy: query.received_by });
  }

  private async detailInvoices(schoolId: number, invoices: FeeInvoice[]): Promise<FeeInvoiceDetailDto[]> {
    if (!invoices.length) return [];
    const ids = invoices.map((invoice) => invoice.id);
    const [base, lines, payments, benefits, refunds, pending] = await Promise.all([
      this.presentInvoices(schoolId, invoices),
      this.lines.find({ where: { invoice_id: In(ids) }, order: { sort_order: 'ASC', id: 'ASC' } }),
      this.payments.find({ where: { invoice_id: In(ids) }, order: { paid_on: 'DESC', id: 'DESC' } }),
      this.invoiceBenefits.find({ where: { invoice_id: In(ids) }, order: { id: 'ASC' } }),
      this.dataSource
        .getRepository(FeeRefund)
        .find({ where: { invoice_id: In(ids) }, order: { paid_on: 'DESC', id: 'DESC' } }),
      this.dataSource
        .getRepository(FeeRequest)
        .find({ where: { invoice_id: In(ids), status: 'pending' }, order: { created_at: 'ASC' } }),
    ]);
    const requesters = await this.userNames(pending.map((row) => row.created_by).filter((id): id is number => !!id));
    const presented = await this.presentPayments(schoolId, payments, invoices);
    return base.map((invoice) => ({
      ...invoice,
      lines: lines
        .filter((line) => line.invoice_id === invoice.id)
        .map((line) => ({
          id: line.id,
          fee_head_id: line.fee_head_id,
          head_name: line.head_name,
          description: line.description,
          amount: line.amount,
        })),
      benefits: benefits
        .filter((benefit) => benefit.invoice_id === invoice.id)
        .map((benefit) => ({
          benefit_id: benefit.benefit_id,
          kind: benefit.kind,
          name: benefit.name,
          fee_head_id: benefit.fee_head_id,
          amount: benefit.amount,
        })),
      refunds: refunds
        .filter((refund) => refund.invoice_id === invoice.id)
        .map((refund) => ({
          id: refund.id,
          refund_no: refund.refund_no,
          amount: refund.amount,
          mode: refund.mode,
          reference: refund.reference,
          paid_on: refund.paid_on,
          reason: refund.reason,
        })),
      pending_requests: pending
        .filter((request) => request.invoice_id === invoice.id)
        .map((request) => ({
          id: request.id,
          kind: request.kind,
          amount: request.amount,
          details: request.details as Record<string, unknown>,
          payment_id: request.payment_id || null,
          reason: request.reason,
          requested_by: request.created_by
            ? { id: request.created_by, name: requesters.get(request.created_by) ?? '' }
            : null,
          requested_at: request.created_at,
        })),
      payments: presented.filter((payment) => payment.invoice_id === invoice.id),
    }));
  }

  private async presentInvoices(schoolId: number, invoices: FeeInvoice[]): Promise<FeeInvoiceDto[]> {
    const today = this.today();
    const refs = await this.studentRefs(
      schoolId,
      invoices.map((invoice) => invoice.student_id),
    );
    return invoices.map((invoice) => {
      const overdue = isOverdue(invoice, today);
      return {
        id: invoice.id,
        invoice_no: invoice.invoice_no,
        academic_year_id: invoice.academic_year_id,
        installment: invoice.installment,
        kind: invoice.kind,
        due_date: invoice.due_date,
        student: refs.get(invoice.student_id) ?? missingStudent(invoice.student_id),
        class_id: invoice.class_id,
        section_id: invoice.section_id,
        gross: invoice.gross,
        benefit: invoice.benefit,
        discount: invoice.discount,
        discount_reason: invoice.discount_reason,
        original_due_date: invoice.original_due_date,
        late_fee: invoice.late_fee,
        refunded: invoice.refunded,
        total: invoice.total,
        paid: invoice.paid,
        balance: invoice.balance,
        status: invoice.status,
        is_overdue: overdue,
        days_overdue: overdue ? daysBetween(invoice.due_date, today) : 0,
        cancel_reason: invoice.cancel_reason,
        created_at: invoice.created_at,
      };
    });
  }

  private async presentPayments(
    schoolId: number,
    payments: FeePayment[],
    knownInvoices: FeeInvoice[] = [],
  ): Promise<FeePaymentDto[]> {
    if (!payments.length) return [];
    const known = new Map(knownInvoices.map((invoice) => [invoice.id, invoice]));
    const missing = [...new Set(payments.map((payment) => payment.invoice_id))].filter((id) => !known.has(id));
    if (missing.length) {
      for (const invoice of await this.invoices.findBy({ id: In(missing) })) known.set(invoice.id, invoice);
    }
    const [refs, users] = await Promise.all([
      this.studentRefs(
        schoolId,
        payments.map((payment) => payment.student_id),
      ),
      this.userNames(
        payments
          .flatMap((payment) => [payment.received_by, payment.reversed_by])
          .filter((id): id is number => id !== null),
      ),
    ]);
    return payments.map((payment) => {
      const invoice = known.get(payment.invoice_id);
      return {
        id: payment.id,
        receipt_no: payment.receipt_no,
        invoice_id: payment.invoice_id,
        invoice_no: invoice?.invoice_no ?? '',
        installment: invoice?.installment ?? '',
        student: refs.get(payment.student_id) ?? missingStudent(payment.student_id),
        amount: payment.amount,
        mode: payment.mode,
        reference: payment.reference,
        paid_on: payment.paid_on,
        received_by: payment.received_by ? (users.get(payment.received_by) ?? null) : null,
        notes: payment.notes,
        invoice_balance: invoice?.balance ?? 0,
        status: payment.status,
        reversed_at: payment.reversed_at,
        reversed_by: payment.reversed_by ? (users.get(payment.reversed_by) ?? null) : null,
        reversal_reason: payment.reversal_reason,
        created_at: payment.created_at,
      };
    });
  }

  async studentRefs(schoolId: number, ids: number[]): Promise<Map<number, FeeStudentRefDto>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows: StudentRow[] = await this.dataSource.query(
      `SELECT s.id, s.first_name, s.last_name, s.admission_no, c.name AS class_name, sec.name AS section_name
       FROM students s
       LEFT JOIN academic_years y ON y.school_id = s.school_id AND ${yearClause('y')} AND y.deleted_at IS NULL
       LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = y.id
       LEFT JOIN classes c ON c.id = e.class_id
       LEFT JOIN sections sec ON sec.id = e.section_id
       WHERE s.school_id = $1 AND s.id = ANY($2) AND s.deleted_at IS NULL`,
      [schoolId, unique],
    );
    return new Map(
      rows.map((row) => [
        Number(row.id),
        {
          id: Number(row.id),
          full_name: fullName(row),
          admission_no: row.admission_no,
          class_section: row.class_name
            ? row.section_name
              ? `${row.class_name} - ${row.section_name}`
              : row.class_name
            : null,
        },
      ]),
    );
  }

  async userNames(ids: number[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT u.id, u.name FROM users u WHERE u.id = ANY($1)`,
      [unique],
    );
    return new Map(rows.map((row) => [Number(row.id), row.name]));
  }

  private async writeDraft(
    manager: EntityManager,
    input: {
      schoolId: number;
      yearId: number;
      classId: number;
      lines: PlanLineValue[];
      actorId: number | null;
      reason?: string;
      onlyIfFree?: boolean;
    },
  ): Promise<{ version: number } | { busy: PlanVersionStatus }> {
    const { schoolId, yearId, classId, lines } = input;
    await lockPlan(manager, schoolId, yearId, classId);
    const open = await manager.findOneBy(FeePlanVersion, {
      school_id: schoolId,
      academic_year_id: yearId,
      class_id: classId,
      status: In(['draft', 'pending_approval']),
    });
    if (open?.status === 'pending_approval' && !input.onlyIfFree) throw pendingApproval();
    if (open && input.onlyIfFree) return { busy: open.status };
    let version = open?.version ?? 0;
    if (open) {
      await manager.update(FeePlanVersion, open.id, { lines });
    } else {
      const [{ max }] = await manager.query(
        `SELECT coalesce(max(version), 0) AS max FROM fee_plan_versions
         WHERE school_id = $1 AND academic_year_id = $2 AND class_id = $3`,
        [schoolId, yearId, classId],
      );
      version = Number(max) + 1;
      await manager.save(
        manager.create(FeePlanVersion, {
          school_id: schoolId,
          academic_year_id: yearId,
          class_id: classId,
          version,
          status: 'draft',
          lines,
          created_by: input.actorId,
        }),
      );
    }
    await recordFeeAudit(manager, {
      school_id: schoolId,
      entity: 'fee_plan',
      entity_id: classId,
      action: 'updated',
      before: open ? { academic_year_id: yearId, version, status: 'draft', lines: open.lines } : null,
      after: { academic_year_id: yearId, version, status: 'draft', lines },
      reason: input.reason,
      actor_id: input.actorId,
    });
    return { version };
  }

  private async copyInto(
    schoolId: number,
    year: FeeYear,
    target: { id: number; name: string },
    source: PlanLineValue[],
    actor: AuthUser,
    reason: string,
  ): Promise<CopyPlanRowDto> {
    const heads = new Map((await this.heads.findBy({ school_id: schoolId })).map((head) => [head.id, head]));
    const lines = source.filter((line) => {
      const head = heads.get(line.fee_head_id);
      return (
        head &&
        head.is_active &&
        !head.is_transport &&
        (!head.applicable_class_ids.length || head.applicable_class_ids.includes(target.id))
      );
    });
    const row = { class_id: target.id, class_name: target.name, lines: lines.length };
    const skipped = (why: string): CopyPlanRowDto => ({
      ...row,
      status: 'skipped',
      version: null,
      left_out: source.length - lines.length,
      reason: why,
    });
    if (!lines.length) return skipped('None of the fee heads apply to this class');
    try {
      await this.validatePlanLines(schoolId, target.id, year, lines);
    } catch (error) {
      return skipped(error instanceof AppException ? copyError(error) : 'The lines are not valid for this class');
    }
    const outcome = await this.dataSource.transaction((manager) =>
      this.writeDraft(manager, {
        schoolId,
        yearId: year.id,
        classId: target.id,
        lines,
        actorId: actor.id,
        reason,
        onlyIfFree: true,
      }),
    );
    if ('busy' in outcome) {
      return skipped(
        outcome.busy === 'pending_approval' ? 'A change is waiting for approval' : 'It already has a draft',
      );
    }
    return {
      ...row,
      status: 'drafted',
      version: outcome.version,
      left_out: source.length - lines.length,
      reason: null,
    };
  }

  private async classesById(schoolId: number, ids: number[], field: string): Promise<{ id: number; name: string }[]> {
    if (!ids.length) return [];
    const rows: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT id, name FROM classes WHERE school_id = $1 AND id = ANY($2) AND deleted_at IS NULL
       ORDER BY grade_level, name`,
      [schoolId, ids],
    );
    if (rows.length !== new Set(ids).size) {
      throw AppException.validation([{ field, message: 'Class not found in this school' }]);
    }
    return rows.map((row) => ({ id: Number(row.id), name: row.name }));
  }

  private async writableYear(schoolId: number, yearId?: number): Promise<FeeYear> {
    const year = await this.year(schoolId, yearId);
    if (year.status === 'closed' || year.status === 'archived') {
      throw AppException.conflict(`${year.name} is ${year.status}. Its fee plans cannot change.`, 'YEAR_CLOSED');
    }
    return year;
  }

  private async validatePlanLines(
    schoolId: number,
    classId: number,
    year: FeeYear,
    lines: PlanLineValue[],
  ): Promise<void> {
    const heads = new Map((await this.heads.findBy({ school_id: schoolId })).map((head) => [head.id, head]));
    const seen = new Set<string>();
    const dueByInstallment = new Map<string, string>();
    lines.forEach((line, index) => {
      const head = heads.get(line.fee_head_id);
      const field = (name: string) => `lines.${index}.${name}`;
      if (!head) throw AppException.validation([{ field: field('fee_head_id'), message: 'Fee head not found' }]);
      if (!head.is_active) {
        throw AppException.validation([
          {
            field: field('fee_head_id'),
            message: `${head.name} is switched off. Switch it on or take it off the plan.`,
          },
        ]);
      }
      if (head.applicable_class_ids.length && !head.applicable_class_ids.includes(classId)) {
        throw AppException.validation([{ field: field('fee_head_id'), message: `${head.name} is not for this class` }]);
      }
      if (head.is_transport) {
        throw AppException.validation([
          {
            field: field('fee_head_id'),
            message: `${head.name} is charged from the bus stop fee and cannot be on the plan`,
          },
        ]);
      }
      const key = `${line.fee_head_id}|${line.installment.toLowerCase()}`;
      if (seen.has(key)) {
        throw AppException.validation([
          { field: field('installment'), message: `${head.name} is listed twice for ${line.installment}` },
        ]);
      }
      seen.add(key);
      if (line.due_date < year.start_date || line.due_date > year.end_date) {
        throw AppException.validation([
          { field: field('due_date'), message: `Due date must be within the ${year.name} academic year` },
        ]);
      }
      const due = dueByInstallment.get(line.installment);
      if (due && due !== line.due_date) {
        throw AppException.validation([
          { field: field('due_date'), message: `Every line of ${line.installment} must have the same due date` },
        ]);
      }
      dueByInstallment.set(line.installment, line.due_date);
    });
  }

  private async openVersion(
    manager: EntityManager,
    schoolId: number,
    yearId: number,
    classId: number,
  ): Promise<FeePlanVersion> {
    const open = await manager.findOneBy(FeePlanVersion, {
      school_id: schoolId,
      academic_year_id: yearId,
      class_id: classId,
      status: In(['draft', 'pending_approval']),
    });
    if (!open) throw AppException.notFound('This class has no draft fee plan', 'PLAN_DRAFT_NOT_FOUND');
    return open;
  }

  private async pendingVersion(
    manager: EntityManager,
    schoolId: number,
    yearId: number,
    classId: number,
  ): Promise<FeePlanVersion> {
    const pending = await manager.findOneBy(FeePlanVersion, {
      school_id: schoolId,
      academic_year_id: yearId,
      class_id: classId,
      status: 'pending_approval',
    });
    if (!pending) {
      throw AppException.conflict('No change to this fee plan is waiting for approval', 'PLAN_NOT_PENDING');
    }
    return pending;
  }

  private async presentVersions(schoolId: number, versions: FeePlanVersion[]): Promise<FeePlanVersionDto[]> {
    if (!versions.length) return [];
    const [heads, users] = await Promise.all([
      this.heads.findBy({ school_id: schoolId }),
      this.userNames(
        versions.flatMap((version) =>
          [version.created_by, version.submitted_by, version.reviewed_by].filter((id): id is number => id !== null),
        ),
      ),
    ]);
    const names = new Map(heads.map((head) => [head.id, head.name]));
    const user = (id: number | null) => (id ? { id, name: users.get(id) ?? '' } : null);
    return versions.map((version) => {
      const lines = [...version.lines].sort(
        (a, b) => a.due_date.localeCompare(b.due_date) || a.installment.localeCompare(b.installment),
      );
      return {
        id: version.id,
        version: version.version,
        status: version.status,
        lines: lines.map((line) => ({ ...line, head_name: names.get(line.fee_head_id) ?? '' })),
        installments: installmentTotals(lines),
        total: sumAmounts(lines.map((line) => line.amount)),
        note: version.note,
        created_by: user(version.created_by),
        submitted_by: user(version.submitted_by),
        submitted_at: version.submitted_at,
        reviewed_by: user(version.reviewed_by),
        reviewed_at: version.reviewed_at,
        review_comment: version.review_comment,
        published_at: version.published_at,
        updated_at: version.updated_at,
      };
    });
  }

  private async presentHeads(schoolId: number, heads: FeeHead[]): Promise<FeeHeadDto[]> {
    if (!heads.length) return [];
    const rows: { fee_head_id: number; count: string }[] = await this.dataSource.query(
      `SELECT p.fee_head_id, count(*) AS count FROM fee_plans p
       JOIN academic_years y ON y.id = p.academic_year_id AND ${yearClause('y')}
       WHERE p.school_id = $1 AND p.deleted_at IS NULL AND p.fee_head_id = ANY($2) GROUP BY p.fee_head_id`,
      [schoolId, heads.map((head) => head.id)],
    );
    const counts = new Map(rows.map((row) => [Number(row.fee_head_id), Number(row.count)]));
    return heads.map((head) => ({
      id: head.id,
      name: head.name,
      code: head.code,
      is_transport: head.is_transport,
      is_active: head.is_active,
      description: head.description,
      fee_group: head.fee_group,
      is_mandatory: head.is_mandatory,
      frequency: head.frequency,
      is_refundable: head.is_refundable,
      applicable_class_ids: head.applicable_class_ids,
      plan_lines: counts.get(head.id) ?? 0,
      created_at: head.created_at,
    }));
  }

  private async assertHeadFree(
    schoolId: number,
    head: { code: string; is_transport?: boolean; is_active?: boolean },
    id?: number,
  ): Promise<void> {
    const clash = await this.heads.findOneBy({ school_id: schoolId, code: head.code });
    if (clash && clash.id !== id) throw AppException.conflict(`${head.code} is already used`, 'FEE_HEAD_EXISTS');
    if (head.is_transport && head.is_active !== false) {
      const transport = await this.heads.findOneBy({ school_id: schoolId, is_transport: true, is_active: true });
      if (transport && transport.id !== id) {
        throw AppException.conflict(`${transport.name} is already the transport head`, 'TRANSPORT_HEAD_EXISTS');
      }
    }
  }

  private async assertClasses(schoolId: number, ids: number[] | undefined): Promise<void> {
    if (!ids?.length) return;
    const rows: { id: number }[] = await this.dataSource.query(
      `SELECT id FROM classes WHERE school_id = $1 AND id = ANY($2) AND deleted_at IS NULL`,
      [schoolId, ids],
    );
    const found = new Set(rows.map((row) => Number(row.id)));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length) {
      throw AppException.validation([
        { field: 'applicable_class_ids', message: `Class ${missing.join(', ')} not found in this school` },
      ]);
    }
  }

  private async classesPlannedOutside(schoolId: number, headId: number, allowed: number[]): Promise<string[]> {
    if (!allowed.length) return [];
    const rows: { name: string }[] = await this.dataSource.query(
      `SELECT DISTINCT c.name, c.grade_level FROM fee_plans p
       JOIN academic_years y ON y.id = p.academic_year_id AND y.status IN ('draft', 'active') AND y.deleted_at IS NULL
       JOIN classes c ON c.id = p.class_id
       WHERE p.school_id = $1 AND p.fee_head_id = $2 AND p.deleted_at IS NULL AND NOT (p.class_id = ANY($3))
       ORDER BY c.grade_level, c.name`,
      [schoolId, headId, allowed],
    );
    return rows.map((row) => `class ${row.name}`);
  }

  private async head(schoolId: number, id: number): Promise<FeeHead> {
    const head = await this.heads.findOneBy({ id, school_id: schoolId });
    if (!head) throw AppException.notFound('Fee head not found', 'FEE_HEAD_NOT_FOUND');
    return head;
  }

  private async invoice(schoolId: number, id: number): Promise<FeeInvoice> {
    const invoice = await this.invoices.findOneBy({ id, school_id: schoolId });
    if (!invoice) throw AppException.notFound('Invoice not found', 'INVOICE_NOT_FOUND');
    return invoice;
  }

  private async schoolClass(schoolId: number, classId: number): Promise<{ id: number; name: string }> {
    const [row] = await this.dataSource.query(
      `SELECT id, name FROM classes WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [classId, schoolId],
    );
    if (!row) throw AppException.notFound('Class not found', 'CLASS_NOT_FOUND');
    return { id: Number(row.id), name: row.name };
  }
}

const HEAD_FIELDS = [
  'name',
  'code',
  'is_transport',
  'is_active',
  'description',
  'fee_group',
  'is_mandatory',
  'frequency',
  'is_refundable',
  'applicable_class_ids',
] as const;
const PLAN_LINE_FIELDS = ['fee_head_id', 'installment', 'amount', 'due_date'] as const;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,80}$/;

interface MismatchRow {
  id: number;
  invoice_no: string;
  student_id: number;
  status: FeeInvoice['status'];
  gross: string;
  benefit: string;
  discount: string;
  total: string;
  paid: string;
  balance: string;
  payments_total: string;
}

const MISMATCH_SQL = `SELECT i.id, i.school_id, i.invoice_no, i.student_id, i.status, i.gross, i.benefit, i.discount,
    i.total,
    i.paid, i.balance, coalesce(p.amount, 0) AS payments_total
  FROM fee_invoices i
  LEFT JOIN (SELECT invoice_id, sum(amount) AS amount FROM fee_payments
             WHERE deleted_at IS NULL AND status = 'success' GROUP BY invoice_id) p ON p.invoice_id = i.id
  WHERE i.deleted_at IS NULL
    AND (i.paid <> coalesce(p.amount, 0)
      OR i.total <> i.gross - i.benefit - i.discount
      OR (i.status <> 'cancelled' AND i.balance <> i.total - i.paid))`;

function paymentKey(value: string | undefined): string | null {
  const key = value?.trim();
  if (!key) return null;
  if (!IDEMPOTENCY_KEY.test(key)) {
    throw AppException.validation([
      { field: 'Idempotency-Key', message: 'Idempotency-Key must be 8 to 80 letters, digits, _ . : or -' },
    ]);
  }
  return key;
}

function installmentTotals(lines: Pick<FeePlan, 'installment' | 'due_date' | 'amount'>[]): InstallmentTotalDto[] {
  const groups = new Map<string, InstallmentTotalDto>();
  for (const line of lines) {
    const group = groups.get(line.installment) ?? { installment: line.installment, due_date: line.due_date, amount: 0 };
    group.amount = round2(group.amount + line.amount);
    if (line.due_date > group.due_date) group.due_date = line.due_date;
    groups.set(line.installment, group);
  }
  return [...groups.values()].sort((a, b) => a.due_date.localeCompare(b.due_date));
}

async function lockPlan(manager: EntityManager, schoolId: number, yearId: number, classId: number): Promise<void> {
  await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fee_plan:${schoolId}:${yearId}:${classId}`]);
}

function pendingApproval(): AppException {
  return AppException.conflict(
    'This fee plan change is waiting for approval. The approver must approve it or send it back first.',
    'PLAN_PENDING_APPROVAL',
  );
}

function planLineValues(lines: FeePlan[]): PlanLineValue[] {
  return lines.map((line) => ({
    fee_head_id: line.fee_head_id,
    installment: line.installment,
    amount: line.amount,
    due_date: line.due_date,
  }));
}

function copyError(error: AppException): string {
  const body = error.getResponse() as { message?: string; errors?: { message: string }[] };
  return body.errors?.[0]?.message ?? body.message ?? 'The lines are not valid for this class';
}

function copyResult(rows: CopyPlanRowDto[]): CopyPlanResultDto {
  return {
    drafted: rows.filter((row) => row.status === 'drafted').length,
    skipped: rows.filter((row) => row.status === 'skipped').length,
    classes: rows,
  };
}

function missingStudent(id: number): FeeStudentRefDto {
  return { id, full_name: 'Removed student', admission_no: '', class_section: null };
}
