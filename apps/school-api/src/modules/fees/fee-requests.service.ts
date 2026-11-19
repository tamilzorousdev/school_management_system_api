import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { Student } from '../students/entities/student.entity';
import {
  CancelInvoiceDto,
  DecideRequestDto,
  DiscountDto,
  FeeRequestDto,
  FeeRequestQueryDto,
  RefundInputDto,
  RejectRequestDto,
  RescheduleInputDto,
  ReversePaymentDto,
} from './dto/fees.dto';
import { FeeInvoice } from './entities/fee-invoice.entity';
import { FeePayment } from './entities/fee-payment.entity';
import { FeeRequest, FeeRequestKind } from './entities/fee-request.entity';
import { recordFeeAudit } from './fee-audit';
import {
  assertCancellable,
  assertReschedulable,
  assertWriteOff,
  rescheduleInvoice,
  writeOffInvoice,
  assertRefund,
  cancelInvoice,
  changeDiscount,
  lockedInvoice,
  recordRefund,
} from './fee-adjustments';
import { reversePayment } from './fee-ledger';
import { applyDiscount, PAYMENT_MODE_NAMES, shortDate } from './fees.logic';
import { NotificationsService } from '../notifications/notifications.service';
import { rupees } from '../payroll/payroll.calc';
import { FeesService } from './fees.service';

interface NewRequest {
  kind: FeeRequestKind;
  invoice_id: number;
  payment_id?: number;
  amount: number | null;
  details: FeeRequest['details'];
  reason: string;
}

const KIND_LABEL: Record<FeeRequestKind, string> = {
  discount: 'discount',
  cancel: 'cancellation',
  reversal: 'payment reversal',
  refund: 'refund',
  reschedule: 'new due date',
  write_off: 'write-off',
};

@Injectable()
export class FeeRequestsService {
  constructor(
    @InjectRepository(FeeRequest) private readonly requests: Repository<FeeRequest>,
    private readonly fees: FeesService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
    private readonly notifications: NotificationsService,
  ) {}

  requestWriteOff(schoolId: number, invoiceId: number, dto: CancelInvoiceDto, actor: AuthUser): Promise<FeeRequestDto> {
    return this.create(
      schoolId,
      { kind: 'write_off', invoice_id: invoiceId, amount: null, details: {}, reason: dto.reason },
      actor,
    );
  }

  requestReschedule(
    schoolId: number,
    invoiceId: number,
    dto: RescheduleInputDto,
    actor: AuthUser,
  ): Promise<FeeRequestDto> {
    return this.create(
      schoolId,
      {
        kind: 'reschedule',
        invoice_id: invoiceId,
        amount: null,
        details: { due_date: dto.due_date },
        reason: dto.reason,
      },
      actor,
    );
  }

  requestDiscount(schoolId: number, invoiceId: number, dto: DiscountDto, actor: AuthUser): Promise<FeeRequestDto> {
    return this.create(
      schoolId,
      {
        kind: 'discount',
        invoice_id: invoiceId,
        amount: dto.discount,
        details: { discount: dto.discount },
        reason: dto.reason,
      },
      actor,
    );
  }

  requestCancel(schoolId: number, invoiceId: number, dto: CancelInvoiceDto, actor: AuthUser): Promise<FeeRequestDto> {
    return this.create(
      schoolId,
      { kind: 'cancel', invoice_id: invoiceId, amount: null, details: {}, reason: dto.reason },
      actor,
    );
  }

  async requestReversal(
    schoolId: number,
    paymentId: number,
    dto: ReversePaymentDto,
    actor: AuthUser,
  ): Promise<FeeRequestDto> {
    const payment = await this.dataSource.getRepository(FeePayment).findOneBy({ id: paymentId, school_id: schoolId });
    if (!payment) throw AppException.notFound('Payment not found', 'PAYMENT_NOT_FOUND');
    return this.create(
      schoolId,
      {
        kind: 'reversal',
        invoice_id: payment.invoice_id,
        payment_id: payment.id,
        amount: payment.amount,
        details: {},
        reason: dto.reason,
      },
      actor,
    );
  }

  requestRefund(schoolId: number, invoiceId: number, dto: RefundInputDto, actor: AuthUser): Promise<FeeRequestDto> {
    return this.create(
      schoolId,
      {
        kind: 'refund',
        invoice_id: invoiceId,
        amount: dto.amount,
        details: { mode: dto.mode, reference: dto.reference || null, paid_on: dto.paid_on ?? this.today() },
        reason: dto.reason,
      },
      actor,
    );
  }

  async list(schoolId: number, query: FeeRequestQueryDto): Promise<Paginated<FeeRequestDto>> {
    const qb = this.requests
      .createQueryBuilder('r')
      .innerJoin(Student, 's', 's.id = r.student_id')
      .innerJoin(FeeInvoice, 'i', 'i.id = r.invoice_id')
      .where('r.school_id = :schoolId', { schoolId });
    if (query.status) qb.andWhere('r.status = :status', { status: query.status });
    if (query.kind) qb.andWhere('r.kind = :kind', { kind: query.kind });
    if (query.invoice_id) qb.andWhere('r.invoice_id = :invoiceId', { invoiceId: query.invoice_id });
    if (query.student_id) qb.andWhere('r.student_id = :studentId', { studentId: query.student_id });
    const page = await listQuery(qb, query, {
      searchable: ['s.first_name', 's.last_name', 's.admission_no', 'i.invoice_no', 'r.reason'],
      sortable: { created_at: 'r.created_at', decided_at: 'r.decided_at' },
      defaultSort: 'created_at',
    });
    return { ...page, items: await this.present(schoolId, page.items) };
  }

  async approve(schoolId: number, id: number, dto: DecideRequestDto, actor: AuthUser): Promise<FeeRequestDto> {
    await this.dataSource.transaction(async (manager) => {
      const request = await this.pending(manager, schoolId, id);
      if (request.created_by === actor.id) {
        throw AppException.forbidden(
          `You asked for this ${KIND_LABEL[request.kind]}, so someone else must approve it`,
          'SELF_APPROVAL',
        );
      }
      const invoice = await lockedInvoice(manager, schoolId, request.invoice_id);
      const note = [request.reason, dto.comment && `approved: ${dto.comment}`].filter(Boolean).join(' · ');
      if (request.kind === 'discount') {
        await changeDiscount(manager, invoice, Number(request.details.discount ?? request.amount ?? 0), note, actor.id);
      } else if (request.kind === 'cancel') {
        await cancelInvoice(manager, invoice, request.reason, actor.id);
      } else if (request.kind === 'reversal') {
        await reversePayment(manager, schoolId, request.payment_id, { reason: request.reason, reversed_by: actor.id });
      } else if (request.kind === 'write_off') {
        await writeOffInvoice(manager, invoice, request.reason, actor.id);
      } else if (request.kind === 'reschedule') {
        const year = await this.fees.year(schoolId, invoice.academic_year_id);
        assertReschedulable(invoice, request.details.due_date!, year);
        await rescheduleInvoice(manager, invoice, request.details.due_date!, request.reason, actor.id);
      } else {
        await recordRefund(
          manager,
          invoice,
          {
            amount: Number(request.amount),
            mode: request.details.mode as never,
            reference: request.details.reference ?? null,
            paid_on: request.details.paid_on ?? this.today(),
            reason: request.reason,
            request_id: request.id,
            requested_by: request.created_by,
          },
          actor.id,
        );
      }
      await this.decide(manager, request, 'approved', actor, dto.comment || null);
    });
    const result = await this.get(schoolId, id);
    void this.afterDecision(result, actor).catch(() => undefined);
    return result;
  }

  async reject(schoolId: number, id: number, dto: RejectRequestDto, actor: AuthUser): Promise<FeeRequestDto> {
    await this.dataSource.transaction(async (manager) => {
      const request = await this.pending(manager, schoolId, id);
      await this.decide(manager, request, 'rejected', actor, dto.comment);
    });
    const result = await this.get(schoolId, id);
    void this.afterDecision(result, actor).catch(() => undefined);
    return result;
  }

  async withdraw(schoolId: number, id: number, actor: AuthUser): Promise<FeeRequestDto> {
    await this.dataSource.transaction(async (manager) => {
      const request = await this.pending(manager, schoolId, id);
      if (request.created_by !== actor.id) {
        throw AppException.forbidden('Only the person who asked can withdraw it', 'NOT_REQUESTER');
      }
      await this.decide(manager, request, 'withdrawn', actor, null);
    });
    return this.get(schoolId, id);
  }

  async get(schoolId: number, id: number): Promise<FeeRequestDto> {
    const request = await this.requests.findOneBy({ id, school_id: schoolId });
    if (!request) throw AppException.notFound('Request not found', 'REQUEST_NOT_FOUND');
    return (await this.present(schoolId, [request]))[0]!;
  }

  private today(): string {
    return todayIn(this.app.timeZone);
  }

  private async create(schoolId: number, input: NewRequest, actor: AuthUser): Promise<FeeRequestDto> {
    const saved = await this.dataSource.transaction(async (manager) => {
      const invoice = await lockedInvoice(manager, schoolId, input.invoice_id);
      await this.check(manager, invoice, input);
      const open = await manager.findOneBy(FeeRequest, {
        school_id: schoolId,
        kind: input.kind,
        invoice_id: invoice.id,
        payment_id: input.payment_id ?? 0,
        status: 'pending',
      });
      if (open) {
        throw AppException.conflict(
          `A ${KIND_LABEL[input.kind]} for this ${input.kind === 'reversal' ? 'payment' : 'invoice'} is already waiting for approval`,
          'REQUEST_PENDING',
        );
      }
      const request = await manager.save(
        manager.create(FeeRequest, {
          school_id: schoolId,
          kind: input.kind,
          status: 'pending',
          invoice_id: invoice.id,
          payment_id: input.payment_id ?? 0,
          student_id: invoice.student_id,
          amount: input.amount,
          details: input.details,
          reason: input.reason,
          created_by: actor.id,
        }),
      );
      await recordFeeAudit(manager, {
        school_id: schoolId,
        entity: 'fee_request',
        entity_id: request.id,
        action: 'requested',
        after: {
          kind: request.kind,
          invoice_id: request.invoice_id,
          payment_id: request.payment_id || null,
          amount: request.amount,
          ...request.details,
        },
        reason: request.reason,
        actor_id: actor.id,
      });
      return request;
    });
    const result = await this.get(schoolId, saved.id);
    void this.notifyApprovers(schoolId, result, actor).catch(() => undefined);
    return result;
  }

  private async notifyApprovers(schoolId: number, request: FeeRequestDto, actor: AuthUser): Promise<void> {
    const rows: { id: number }[] = await this.dataSource.query(
      `SELECT DISTINCT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id AND p.code = 'fees.approve'
       WHERE u.school_id = $1 AND u.deleted_at IS NULL AND u.status = 'active' AND u.id <> $2`,
      [schoolId, actor.id],
    );
    if (!rows.length) return;
    await this.notifications.dispatch({
      template: 'FEE_APPROVAL_NEEDED',
      audience: { user_ids: rows.map((row) => Number(row.id)) },
      data: {
        name: request.requested_by?.name ?? '',
        what: describe(request),
        invoice: request.invoice.invoice_no,
        student: request.student.full_name,
        reason: request.reason,
        request_id: String(request.id),
        invoice_id: String(request.invoice.id),
      },
    });
  }

  private async afterDecision(request: FeeRequestDto, actor: AuthUser): Promise<void> {
    const common = {
      what: describe(request),
      invoice: request.invoice.invoice_no,
      student: request.student.full_name,
      name: actor.name ?? request.decided_by?.name ?? '',
      request_id: String(request.id),
      invoice_id: String(request.invoice.id),
    };
    if (request.requested_by && request.requested_by.id !== actor.id) {
      await this.notifications
        .dispatch({
          template: request.status === 'approved' ? 'FEE_REQUEST_APPROVED' : 'FEE_REQUEST_REJECTED',
          audience: { user_ids: [request.requested_by.id] },
          data: { ...common, comment: request.decision_comment ?? '' },
        })
        .catch(() => undefined);
    }
    if (request.status !== 'approved') return;
    const invoice = await this.dataSource.getRepository(FeeInvoice).findOneByOrFail({ id: request.invoice.id });
    if (request.kind === 'refund') {
      const [refund] = await this.dataSource.query(
        `SELECT refund_no, to_char(paid_on, 'YYYY-MM-DD') AS paid_on FROM fee_refunds WHERE request_id = $1`,
        [request.id],
      );
      await this.fees.notifyGuardians('FEE_REFUND_PAID', [
        {
          student_id: request.student.id,
          data: {
            amount: rupees(Number(request.amount)),
            date: shortDate(refund?.paid_on ?? this.today()),
            mode: PAYMENT_MODE_NAMES[request.details.mode as string] ?? String(request.details.mode ?? ''),
            refund_no: refund?.refund_no ?? '',
          },
        },
      ]);
    } else if (request.kind === 'reversal' && request.payment) {
      await this.fees.notifyGuardians('FEE_PAYMENT_REVERSED', [
        {
          student_id: request.student.id,
          data: {
            amount: rupees(request.payment.amount),
            receipt_no: request.payment.receipt_no,
            reason: request.reason,
            balance: rupees(invoice.balance),
          },
        },
      ]);
    } else if (request.kind === 'reschedule') {
      await this.fees.notifyGuardians('FEE_DUE_DATE_CHANGED', [
        {
          student_id: request.student.id,
          data: {
            installment: invoice.installment,
            due_date: shortDate(invoice.due_date),
            old_date: shortDate(String(request.details.old_due_date ?? invoice.original_due_date ?? invoice.due_date)),
          },
        },
      ]);
    }
  }

  private async check(manager: EntityManager, invoice: FeeInvoice, input: NewRequest): Promise<void> {
    if (input.kind === 'discount') {
      applyDiscount(invoice, Number(input.amount));
      if (Number(input.amount) === invoice.discount) {
        throw AppException.badRequest('The invoice already has this discount', 'NO_CHANGE');
      }
    } else if (input.kind === 'cancel') {
      assertCancellable(invoice);
    } else if (input.kind === 'reversal') {
      const payment = await manager.findOneBy(FeePayment, { id: input.payment_id });
      if (payment?.status === 'reversed') {
        throw AppException.conflict('This payment is already reversed', 'PAYMENT_ALREADY_REVERSED');
      }
    } else if (input.kind === 'write_off') {
      assertWriteOff(invoice);
      input.amount = invoice.balance;
    } else if (input.kind === 'reschedule') {
      const year = await this.fees.year(invoice.school_id, invoice.academic_year_id);
      assertReschedulable(invoice, input.details.due_date!, year);
      input.details.old_due_date = invoice.due_date;
    } else {
      await assertRefund(manager, invoice, Number(input.amount));
    }
  }

  private async pending(manager: EntityManager, schoolId: number, id: number): Promise<FeeRequest> {
    const request = await manager.findOne(FeeRequest, {
      where: { id, school_id: schoolId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!request) throw AppException.notFound('Request not found', 'REQUEST_NOT_FOUND');
    if (request.status !== 'pending') {
      throw AppException.conflict(`This request is already ${request.status}`, 'REQUEST_NOT_PENDING');
    }
    return request;
  }

  private async decide(
    manager: EntityManager,
    request: FeeRequest,
    status: 'approved' | 'rejected' | 'withdrawn',
    actor: AuthUser,
    comment: string | null,
  ): Promise<void> {
    await manager.update(FeeRequest, request.id, {
      status,
      decided_by: actor.id,
      decided_at: new Date(),
      decision_comment: comment,
    });
    await recordFeeAudit(manager, {
      school_id: request.school_id,
      entity: 'fee_request',
      entity_id: request.id,
      action: status,
      before: { kind: request.kind, status: request.status },
      after: { kind: request.kind, status, invoice_id: request.invoice_id },
      reason: comment,
      actor_id: actor.id,
    });
  }

  private async present(schoolId: number, requests: FeeRequest[]): Promise<FeeRequestDto[]> {
    if (!requests.length) return [];
    const [invoices, payments, students, users] = await Promise.all([
      this.dataSource
        .getRepository(FeeInvoice)
        .find({ where: { id: In(requests.map((row) => row.invoice_id)) }, withDeleted: true }),
      this.dataSource.getRepository(FeePayment).find({
        where: { id: In(requests.map((row) => row.payment_id).filter(Boolean)) },
        withDeleted: true,
      }),
      this.fees.studentRefs(
        schoolId,
        requests.map((row) => row.student_id),
      ),
      this.fees.userNames(
        requests.flatMap((row) => [row.created_by, row.decided_by]).filter((id): id is number => !!id),
      ),
    ]);
    const invoiceById = new Map(invoices.map((row) => [row.id, row]));
    const paymentById = new Map(payments.map((row) => [row.id, row]));
    const user = (id: number | null) => (id ? { id, name: users.get(id) ?? '' } : null);
    return requests.map((row) => {
      const invoice = invoiceById.get(row.invoice_id)!;
      const payment = row.payment_id ? paymentById.get(row.payment_id) : undefined;
      return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        invoice: {
          id: invoice.id,
          invoice_no: invoice.invoice_no,
          installment: invoice.installment,
          gross: invoice.gross,
          total: invoice.total,
          paid: invoice.paid,
          balance: invoice.balance,
          status: invoice.status,
        },
        payment: payment
          ? {
              id: payment.id,
              receipt_no: payment.receipt_no,
              amount: payment.amount,
              mode: payment.mode,
              paid_on: payment.paid_on,
            }
          : null,
        student: students.get(row.student_id) ?? {
          id: row.student_id,
          full_name: 'Removed student',
          admission_no: '',
          class_section: null,
        },
        amount: row.amount,
        details: row.details as Record<string, unknown>,
        reason: row.reason,
        requested_by: user(row.created_by),
        requested_at: row.created_at,
        decided_by: user(row.decided_by),
        decided_at: row.decided_at,
        decision_comment: row.decision_comment,
      };
    });
  }
}

function describe(request: Pick<FeeRequestDto, 'kind' | 'amount' | 'payment' | 'details'>): string {
  if (request.kind === 'discount') {
    return Number(request.amount) > 0 ? `a discount of ${rupees(Number(request.amount))}` : 'removing the discount';
  }
  if (request.kind === 'cancel') return 'cancelling the invoice';
  if (request.kind === 'write_off') return `writing off ${rupees(Number(request.amount))}`;
  if (request.kind === 'reversal') return `reversing ${request.payment?.receipt_no ?? 'a payment'}`;
  if (request.kind === 'reschedule') {
    return `a new due date of ${shortDate(String(request.details.due_date ?? ''))}`;
  }
  return `a refund of ${rupees(Number(request.amount))}`;
}
