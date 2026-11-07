import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository, SelectQueryBuilder } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { rupees } from '../payroll/payroll.calc';
import { Student } from '../students/entities/student.entity';
import {
  CancelInvoiceDto,
  DiscountDto,
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
  FeeStatusDto,
  FeeStudentRefDto,
  FeeTotalsDto,
  GenerateInvoicesDto,
  GenerateResultDto,
  InstallmentTotalDto,
  InvoiceQueryDto,
  PaymentInputDto,
  PaymentQueryDto,
  PaymentSummaryDto,
  PaymentSummaryQueryDto,
  SectionFeesDto,
  StudentFeesDto,
  UpdateFeeHeadDto,
} from './dto/fees.dto';
import { FeeHead } from './entities/fee-head.entity';
import { FeeInvoice } from './entities/fee-invoice.entity';
import { FeeInvoiceLine } from './entities/fee-invoice-line.entity';
import { FeePayment } from './entities/fee-payment.entity';
import { FeePlan } from './entities/fee-plan.entity';
import { FeeYear, generateInvoices, recordPayment } from './fee-ledger';
import {
  applyDiscount,
  daysBetween,
  feeTotals,
  isOverdue,
  round2,
  shortDate,
  STUDENT_FEE_STATUSES,
  StudentFeeStatus,
  sumAmounts,
} from './fees.logic';
import { receiptPdf } from './receipt.pdf';

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
    const page = await listQuery(qb, query, {
      searchable: ['h.name', 'h.code'],
      sortable: { name: 'h.name', code: 'h.code', created_at: 'h.created_at' },
      defaultSort: 'created_at',
    });
    return { ...page, items: await this.presentHeads(schoolId, page.items) };
  }

  async createHead(schoolId: number, dto: FeeHeadInputDto): Promise<FeeHeadDto> {
    await this.assertHeadFree(schoolId, dto);
    const saved = await this.heads.save(
      this.heads.create({
        school_id: schoolId,
        name: dto.name,
        code: dto.code,
        is_transport: dto.is_transport ?? false,
        is_active: dto.is_active ?? true,
      }),
    );
    return (await this.presentHeads(schoolId, [saved]))[0]!;
  }

  async updateHead(schoolId: number, id: number, dto: UpdateFeeHeadDto): Promise<FeeHeadDto> {
    const head = await this.head(schoolId, id);
    const next = {
      name: dto.name ?? head.name,
      code: dto.code ?? head.code,
      is_transport: dto.is_transport ?? head.is_transport,
      is_active: dto.is_active ?? head.is_active,
    };
    await this.assertHeadFree(schoolId, next, id);
    if (next.is_transport && !head.is_transport && (await this.plans.existsBy({ fee_head_id: id }))) {
      throw AppException.conflict(
        'This head is used in fee plans. Take it out of the plans before making it the transport head.',
        'FEE_HEAD_IN_USE',
      );
    }
    const saved = await this.heads.save(Object.assign(head, next));
    return (await this.presentHeads(schoolId, [saved]))[0]!;
  }

  async removeHead(schoolId: number, id: number): Promise<void> {
    await this.head(schoolId, id);
    const used = (await this.plans.existsBy({ fee_head_id: id })) || (await this.lines.existsBy({ fee_head_id: id }));
    if (used) {
      throw AppException.conflict(
        'This head is on fee plans or invoices. Switch it off instead of deleting it.',
        'FEE_HEAD_IN_USE',
      );
    }
    await this.heads.softDelete(id);
  }

  async year(schoolId: number, yearId?: number): Promise<FeeYear> {
    const [row] = await this.dataSource.query(
      `SELECT id, name, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date
       FROM academic_years WHERE school_id = $1 AND deleted_at IS NULL AND ${yearId ? 'id = $2' : 'is_current = true'}`,
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
    const lines = await this.plans.find({ where: { school_id: schoolId, academic_year_id: year.id } });
    return classes.map((row) => {
      const own = lines.filter((line) => line.class_id === Number(row.id));
      return {
        class_id: Number(row.id),
        class_name: row.name,
        student_count: Number(row.student_count),
        installments: installmentTotals(own),
        total: sumAmounts(own.map((line) => line.amount)),
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
    return {
      class_id: classId,
      class_name: schoolClass.name,
      academic_year_id: year.id,
      academic_year: year.name,
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

  async setPlan(schoolId: number, classId: number, dto: FeePlanInputDto): Promise<FeePlanDto> {
    const year = await this.year(schoolId, dto.academic_year_id);
    await this.schoolClass(schoolId, classId);
    const heads = new Map((await this.heads.findBy({ school_id: schoolId })).map((head) => [head.id, head]));
    const seen = new Set<string>();
    const dueByInstallment = new Map<string, string>();
    dto.lines.forEach((line, index) => {
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
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(FeePlan, { school_id: schoolId, academic_year_id: year.id, class_id: classId });
      if (dto.lines.length) {
        await manager.save(
          dto.lines.map((line) =>
            manager.create(FeePlan, {
              school_id: schoolId,
              academic_year_id: year.id,
              class_id: classId,
              fee_head_id: line.fee_head_id,
              installment: line.installment,
              amount: line.amount,
              due_date: line.due_date,
            }),
          ),
        );
      }
    });
    return this.getPlan(schoolId, classId, year.id);
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
    const outcome = await this.dataSource.transaction((manager) =>
      generateInvoices(manager, {
        school_id: schoolId,
        year,
        installment: dto.installment,
        class_id: dto.class_id,
        due_date: dto.due_date,
        created_by: actor.id,
      }),
    );
    if (outcome.created.length) void this.notifyDue(outcome.created);
    return {
      installment: dto.installment,
      classes: outcome.classes,
      created: outcome.created.length,
      already_invoiced: outcome.already_invoiced,
      with_transport: outcome.with_transport,
      total_amount: outcome.total_amount,
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

  async setDiscount(schoolId: number, id: number, dto: DiscountDto): Promise<FeeInvoiceDetailDto> {
    if (dto.discount > 0 && (dto.reason ?? '').length < 3) {
      throw AppException.validation([{ field: 'reason', message: 'Give the reason for the discount' }]);
    }
    await this.dataSource.transaction(async (manager) => {
      const invoice = await manager.findOne(FeeInvoice, {
        where: { id, school_id: schoolId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!invoice) throw AppException.notFound('Invoice not found', 'INVOICE_NOT_FOUND');
      const next = applyDiscount(invoice, dto.discount);
      await manager.update(FeeInvoice, id, {
        ...next,
        discount: dto.discount,
        discount_reason: dto.discount > 0 ? (dto.reason ?? null) : null,
      });
    });
    return this.getInvoice(schoolId, id);
  }

  async cancel(schoolId: number, id: number, dto: CancelInvoiceDto, actor: AuthUser): Promise<FeeInvoiceDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      const invoice = await manager.findOne(FeeInvoice, {
        where: { id, school_id: schoolId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!invoice) throw AppException.notFound('Invoice not found', 'INVOICE_NOT_FOUND');
      if (invoice.status === 'cancelled') {
        throw AppException.conflict('This invoice is already cancelled', 'INVOICE_CANCELLED');
      }
      if (invoice.paid > 0) {
        throw AppException.conflict(
          'A payment is recorded on this invoice, so it cannot be cancelled',
          'INVOICE_HAS_PAYMENTS',
        );
      }
      await manager.update(FeeInvoice, id, {
        status: 'cancelled',
        balance: 0,
        cancelled_at: new Date(),
        cancelled_by: actor.id,
        cancel_reason: dto.reason || null,
      });
    });
    return this.getInvoice(schoolId, id);
  }

  async pay(schoolId: number, invoiceId: number, dto: PaymentInputDto, actor: AuthUser): Promise<FeePaymentDto> {
    const today = this.today();
    const paidOn = dto.paid_on ?? today;
    if (paidOn > today) {
      throw AppException.validation([{ field: 'paid_on', message: 'Payment date cannot be in the future' }]);
    }
    const payment = await this.dataSource.transaction((manager) =>
      recordPayment(manager, schoolId, invoiceId, {
        amount: dto.amount,
        mode: dto.mode,
        reference: dto.reference,
        paid_on: paidOn,
        notes: dto.notes,
        received_by: actor.id,
      }),
    );
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
      .where('p.school_id = :schoolId', { schoolId })
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
    const [lines, refs, [school], users] = await Promise.all([
      this.lines.find({ where: { invoice_id: invoice.id }, order: { sort_order: 'ASC', id: 'ASC' } }),
      this.studentRefs(schoolId, [payment.student_id]),
      this.dataSource.query(
        `SELECT name, address, city, state, pincode, logo_file_id, signature_file_id, seal_file_id FROM schools WHERE id = $1`,
        [schoolId],
      ),
      this.userNames(payment.received_by ? [payment.received_by] : []),
    ]);
    const paidToDate = sumAmounts(
      (await this.payments.find({ where: { invoice_id: invoice.id }, order: { id: 'ASC' } }))
        .filter((row) => row.id <= payment.id)
        .map((row) => row.amount),
    );
    const student = refs.get(payment.student_id)!;
    const pdf = await receiptPdf({
      school_name: school?.name ?? '',
      school_address:
        [school?.address, school?.city, school?.state, school?.pincode].filter(Boolean).join(', ') || null,
      school_logo: await this.files.readImage(school?.logo_file_id ?? null),
      school_signature: await this.files.readImage(school?.signature_file_id ?? null),
      school_seal: await this.files.readImage(school?.seal_file_id ?? null),
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
      discount: invoice.discount,
      invoice_total: invoice.total,
      paid_to_date: paidToDate,
      balance: round2(invoice.total - paidToDate),
    });
    return { name: `Receipt-${payment.receipt_no}`, pdf };
  }

  async insights(schoolId: number): Promise<FeeInsightsDto> {
    const year = await this.year(schoolId);
    const today = this.today();
    const [[totals], [collection]] = await Promise.all([
      this.dataSource.query(
        `SELECT count(*) AS invoices, coalesce(sum(total), 0) AS billed, coalesce(sum(paid), 0) AS collected,
                coalesce(sum(balance), 0) AS outstanding,
                coalesce(sum(balance) FILTER (WHERE balance > 0 AND due_date < $3), 0) AS overdue_amount,
                count(DISTINCT student_id) FILTER (WHERE balance > 0 AND due_date < $3) AS students_overdue,
                count(*) FILTER (WHERE status = 'unpaid') AS unpaid,
                count(*) FILTER (WHERE status = 'partly_paid') AS partly_paid,
                count(*) FILTER (WHERE status = 'paid') AS paid
         FROM fee_invoices WHERE school_id = $1 AND academic_year_id = $2 AND deleted_at IS NULL
           AND status <> 'cancelled'`,
        [schoolId, year.id, today],
      ),
      this.dataSource.query(
        `SELECT count(*) AS count, coalesce(sum(amount), 0) AS amount FROM fee_payments
         WHERE school_id = $1 AND paid_on = $2 AND deleted_at IS NULL`,
        [schoolId, today],
      ),
    ]);
    return {
      academic_year: year.name,
      invoices: Number(totals.invoices),
      total_billed: Number(totals.billed),
      collected: Number(totals.collected),
      outstanding: Number(totals.outstanding),
      overdue_amount: Number(totals.overdue_amount),
      students_overdue: Number(totals.students_overdue),
      todays_collection: Number(collection.amount),
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
    return { student, ...totals, invoices: details, payments };
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
           AND y.is_current = true AND y.deleted_at IS NULL)
       LEFT JOIN sections sec ON sec.id = e.section_id
       WHERE s.id = $1 AND s.school_id = $2 AND s.deleted_at IS NULL`,
      [studentId, schoolId],
    );
    if (!row) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    if (Number(row.class_teacher_user_id) !== userId) {
      throw AppException.forbidden('Only the class teacher of this student can see their fees', 'NOT_CLASS_TEACHER');
    }
    return this.summary(schoolId, studentId);
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

  @Cron('0 8 * * *', { name: 'fee-overdue', timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' })
  async dailyOverdueReminders(): Promise<void> {
    const sent = await this.sendOverdueReminders(null);
    if (sent) this.logger.log(`Sent ${sent} fee overdue reminders`);
  }

  async sendOverdueReminders(schoolId: number | null): Promise<number> {
    const today = this.today();
    const rows: { id: number; student_id: number; balance: string; due_date: string }[] = await this.dataSource.query(
      `WITH alerted AS (
         UPDATE fee_invoices SET overdue_alerted_at = now()
         WHERE deleted_at IS NULL AND status IN ('unpaid', 'partly_paid') AND balance > 0 AND due_date < $1
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
  }

  private async detailInvoices(schoolId: number, invoices: FeeInvoice[]): Promise<FeeInvoiceDetailDto[]> {
    if (!invoices.length) return [];
    const ids = invoices.map((invoice) => invoice.id);
    const [base, lines, payments] = await Promise.all([
      this.presentInvoices(schoolId, invoices),
      this.lines.find({ where: { invoice_id: In(ids) }, order: { sort_order: 'ASC', id: 'ASC' } }),
      this.payments.find({ where: { invoice_id: In(ids) }, order: { paid_on: 'DESC', id: 'DESC' } }),
    ]);
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
        due_date: invoice.due_date,
        student: refs.get(invoice.student_id) ?? missingStudent(invoice.student_id),
        class_id: invoice.class_id,
        section_id: invoice.section_id,
        gross: invoice.gross,
        discount: invoice.discount,
        discount_reason: invoice.discount_reason,
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
      this.userNames(payments.map((payment) => payment.received_by).filter((id): id is number => id !== null)),
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
        created_at: payment.created_at,
      };
    });
  }

  private async studentRefs(schoolId: number, ids: number[]): Promise<Map<number, FeeStudentRefDto>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows: StudentRow[] = await this.dataSource.query(
      `SELECT s.id, s.first_name, s.last_name, s.admission_no, c.name AS class_name, sec.name AS section_name
       FROM students s
       LEFT JOIN academic_years y ON y.school_id = s.school_id AND y.is_current = true AND y.deleted_at IS NULL
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

  private async userNames(ids: number[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT u.id, u.name FROM users u WHERE u.id = ANY($1)`,
      [unique],
    );
    return new Map(rows.map((row) => [Number(row.id), row.name]));
  }

  private async presentHeads(schoolId: number, heads: FeeHead[]): Promise<FeeHeadDto[]> {
    if (!heads.length) return [];
    const rows: { fee_head_id: number; count: string }[] = await this.dataSource.query(
      `SELECT p.fee_head_id, count(*) AS count FROM fee_plans p
       JOIN academic_years y ON y.id = p.academic_year_id AND y.is_current = true
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

function installmentTotals(lines: FeePlan[]): InstallmentTotalDto[] {
  const groups = new Map<string, InstallmentTotalDto>();
  for (const line of lines) {
    const group = groups.get(line.installment) ?? { installment: line.installment, due_date: line.due_date, amount: 0 };
    group.amount = round2(group.amount + line.amount);
    if (line.due_date > group.due_date) group.due_date = line.due_date;
    groups.set(line.installment, group);
  }
  return [...groups.values()].sort((a, b) => a.due_date.localeCompare(b.due_date));
}

function missingStudent(id: number): FeeStudentRefDto {
  return { id, full_name: 'Removed student', admission_no: '', class_section: null };
}
