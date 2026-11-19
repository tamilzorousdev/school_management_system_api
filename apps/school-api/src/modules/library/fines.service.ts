import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException, AuthUser, paginate, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { monthStartIn } from '../../shared/dates';
import { LIBRARY_TEMPLATES } from '../notifications/library-templates.catalog';
import { rupees } from '../payroll/payroll.calc';
import { SequencesService } from '../schools/sequences.service';
import { schoolInfo } from './copy-events';
import {
  FineDto,
  FineInsightsDto,
  FinePaymentDto,
  FinePaymentInputDto,
  FinePaymentQueryDto,
  FinePaymentResultDto,
  FineQueryDto,
  FineWaiveDto,
} from './dto/desk.dto';
import { PaymentMode } from '../fees/entities/fee-payment.entity';
import { LibraryFine, LibraryFinePayment } from './entities/library-fine.entity';
import { fineAmounts, round2 } from './library.logic';
import { fineReceiptPdf } from './library-pdf';
import { LibraryNotifyService } from './library-notify.service';
import {
  addSearch,
  LibraryReadService,
  MEMBER_COLUMNS,
  MEMBER_JOINS,
  MEMBER_NAME,
  param,
  Row,
  SqlFilter,
} from './library-read.service';

const FINE_SORTS: Record<string, string> = { created_at: 'f.created_at', balance: 'f.balance', amount: 'f.amount' };
const PAYMENT_SORTS: Record<string, string> = { paid_on: 'p.paid_on', amount: 'p.amount', created_at: 'p.created_at' };

@Injectable()
export class FinesService {
  private readonly sequences = new SequencesService();

  constructor(
    private readonly dataSource: DataSource,
    private readonly read: LibraryReadService,
    private readonly notify: LibraryNotifyService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async list(schoolId: number, query: FineQueryDto): Promise<Paginated<FineDto>> {
    const filter: SqlFilter = { where: [], params: [] };
    if (query.status) filter.where.push(`f.status = ${param(filter, query.status)}`);
    if (query.kind) filter.where.push(`f.kind = ${param(filter, query.kind)}`);
    if (query.member_id) filter.where.push(`f.member_id = ${param(filter, query.member_id)}`);
    if (query.member_type) filter.where.push(`m.member_type = ${param(filter, query.member_type)}`);
    if (query.class_id) filter.where.push(`mme.class_id = ${param(filter, query.class_id)}`);
    if (query.outstanding !== undefined) filter.where.push(query.outstanding ? 'f.balance > 0' : 'f.balance = 0');
    addSearch(filter, query.search, [MEMBER_NAME('m', 'mm'), 'm.card_no', 'b.title', 'f.reason']);
    const column = FINE_SORTS[query.sort ?? 'created_at'];
    if (!column) {
      throw AppException.badRequest(`sort must be one of: ${Object.keys(FINE_SORTS).join(', ')}`, 'INVALID_SORT');
    }
    return this.read.finePage(
      schoolId,
      filter,
      `${column} ${query.order === 'asc' ? 'ASC' : 'DESC'}, f.id DESC`,
      query.page,
      query.limit,
    );
  }

  async insights(schoolId: number): Promise<FineInsightsDto> {
    const monthStart = monthStartIn(this.app.timeZone);
    const today = this.read.today();
    const [row]: Row[] = await this.dataSource.query(
      `SELECT
         (SELECT COALESCE(SUM(balance), 0) FROM library_fines WHERE school_id = $1 AND deleted_at IS NULL) AS outstanding,
         (SELECT COUNT(*) FROM library_fines WHERE school_id = $1 AND deleted_at IS NULL AND balance > 0)::int AS outstanding_count,
         (SELECT COALESCE(SUM(amount), 0) FROM library_fine_payments WHERE school_id = $1 AND deleted_at IS NULL AND paid_on >= $2::date) AS collected_this_month,
         (SELECT COALESCE(SUM(amount), 0) FROM library_fine_payments WHERE school_id = $1 AND deleted_at IS NULL AND paid_on = $3::date) AS collected_today,
         (SELECT COALESCE(SUM(waived), 0) FROM library_fines WHERE school_id = $1 AND deleted_at IS NULL AND waived_at >= $2::date) AS waived_this_month,
         (SELECT COALESCE(SUM(amount), 0) FROM library_fines WHERE school_id = $1 AND deleted_at IS NULL AND created_at >= $2::date) AS raised_this_month`,
      [schoolId, monthStart, today],
    );
    return {
      outstanding: Number(row?.outstanding ?? 0),
      outstanding_count: Number(row?.outstanding_count ?? 0),
      collected_this_month: Number(row?.collected_this_month ?? 0),
      waived_this_month: Number(row?.waived_this_month ?? 0),
      raised_this_month: Number(row?.raised_this_month ?? 0),
      collected_today: Number(row?.collected_today ?? 0),
    };
  }

  async fine(schoolId: number, id: number): Promise<FineDto> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`f.id = ${param(filter, id)}`);
    const [fine] = await this.read.fines(schoolId, filter);
    if (!fine) throw AppException.notFound('Fine not found', 'FINE_NOT_FOUND');
    return fine;
  }

  async pay(schoolId: number, id: number, dto: FinePaymentInputDto, actor: AuthUser): Promise<FinePaymentResultDto> {
    const today = this.read.today();
    const paidOn = dto.paid_on ?? today;
    if (paidOn > today)
      throw AppException.validation([{ field: 'paid_on', message: 'The date cannot be in the future' }]);
    const paymentId = await this.dataSource.transaction(async (manager) => {
      const fine = await manager.findOne(LibraryFine, {
        where: { id, school_id: schoolId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!fine || fine.deleted_at) throw AppException.notFound('Fine not found', 'FINE_NOT_FOUND');
      if (Number(fine.balance) <= 0) throw AppException.conflict('Nothing is left to pay on this fine', 'FINE_SETTLED');
      const amount = round2(dto.amount);
      if (amount > Number(fine.balance)) {
        throw AppException.badRequest(
          `The amount is more than the balance of ${rupees(Number(fine.balance))}`,
          'PAYMENT_EXCEEDS_BALANCE',
        );
      }
      const paid = round2(Number(fine.paid) + amount);
      await manager.update(LibraryFine, fine.id, fineAmounts(Number(fine.amount), Number(fine.waived), paid));
      const school = await schoolInfo(manager, schoolId);
      const year = paidOn.slice(0, 4);
      const value = await this.sequences.next(manager, schoolId, `library_receipt:${year}`);
      const payment = await manager.save(
        manager.create(LibraryFinePayment, {
          school_id: schoolId,
          fine_id: fine.id,
          member_id: fine.member_id,
          amount,
          mode: dto.mode,
          reference: dto.reference ?? null,
          receipt_no: SequencesService.format(`${school.code}-LIB`, year, value),
          paid_on: paidOn,
          received_by: actor.id,
          notes: dto.notes ?? null,
          created_by: actor.id,
        }),
      );
      return payment.id;
    });
    const payment = await this.payment(schoolId, paymentId);
    await this.notify.tell(payment.member.id, LIBRARY_TEMPLATES.LIBRARY_FINE_PAID, {
      amount: rupees(payment.amount),
      receipt_no: payment.receipt_no,
      fine_id: String(payment.fine_id),
      payment_id: String(payment.id),
    });
    return { fine: await this.fine(schoolId, id), payment };
  }

  async waive(schoolId: number, id: number, dto: FineWaiveDto, actor: AuthUser): Promise<FineDto> {
    await this.dataSource.transaction(async (manager) => {
      const fine = await manager.findOne(LibraryFine, {
        where: { id, school_id: schoolId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!fine || fine.deleted_at) throw AppException.notFound('Fine not found', 'FINE_NOT_FOUND');
      const balance = Number(fine.balance);
      if (balance <= 0) throw AppException.conflict('Nothing is left to waive on this fine', 'FINE_SETTLED');
      const amount = round2(dto.amount ?? balance);
      if (amount > balance) {
        throw AppException.badRequest(`You can waive at most ${rupees(balance)}`, 'WAIVE_EXCEEDS_BALANCE');
      }
      const waived = round2(Number(fine.waived) + amount);
      await manager.update(LibraryFine, fine.id, {
        ...fineAmounts(Number(fine.amount), waived, Number(fine.paid)),
        waived_by: actor.id,
        waived_at: new Date(),
        waive_reason: dto.reason,
      });
    });
    return this.fine(schoolId, id);
  }

  private paymentSql(filter: SqlFilter, tail: string): string {
    return `
      SELECT p.id, p.receipt_no, p.amount, p.mode, p.reference, p.paid_on::text AS paid_on, p.notes, p.created_at,
             p.fine_id, f.reason AS fine_reason, ru.name AS received_by_name,
             ${MEMBER_COLUMNS('m', 'mm')}
      FROM library_fine_payments p
      JOIN library_fines f ON f.id = p.fine_id
      JOIN library_members m ON m.id = p.member_id
      ${MEMBER_JOINS('m', 'mm')}
      LEFT JOIN users ru ON ru.id = p.received_by
      WHERE p.deleted_at IS NULL ${filter.where.length ? `AND ${filter.where.join(' AND ')}` : ''}
      ${tail}`;
  }

  private presentPayment(row: Row): FinePaymentDto {
    return {
      id: Number(row.id),
      receipt_no: String(row.receipt_no),
      amount: Number(row.amount),
      mode: row.mode as PaymentMode,
      reference: (row.reference as string | null) ?? null,
      paid_on: String(row.paid_on),
      notes: (row.notes as string | null) ?? null,
      received_by: (row.received_by_name as string | null) ?? null,
      fine_id: Number(row.fine_id),
      fine_reason: String(row.fine_reason),
      member: this.read.memberRef(row, 'mm'),
      created_at: row.created_at as Date,
    };
  }

  async payment(schoolId: number, id: number): Promise<FinePaymentDto> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`p.school_id = ${param(filter, schoolId)}`, `p.id = ${param(filter, id)}`);
    const [row]: Row[] = await this.dataSource.query(this.paymentSql(filter, ''), filter.params);
    if (!row) throw AppException.notFound('Payment not found', 'PAYMENT_NOT_FOUND');
    return this.presentPayment(row);
  }

  async payments(schoolId: number, query: FinePaymentQueryDto): Promise<Paginated<FinePaymentDto>> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`p.school_id = ${param(filter, schoolId)}`);
    if (query.mode) filter.where.push(`p.mode = ${param(filter, query.mode)}`);
    if (query.member_id) filter.where.push(`p.member_id = ${param(filter, query.member_id)}`);
    if (query.from) filter.where.push(`p.paid_on >= ${param(filter, query.from)}::date`);
    if (query.to) filter.where.push(`p.paid_on <= ${param(filter, query.to)}::date`);
    addSearch(filter, query.search, ['p.receipt_no', MEMBER_NAME('m', 'mm'), 'm.card_no']);
    const column = PAYMENT_SORTS[query.sort ?? 'paid_on'];
    if (!column) {
      throw AppException.badRequest(`sort must be one of: ${Object.keys(PAYMENT_SORTS).join(', ')}`, 'INVALID_SORT');
    }
    const order = `${column} ${query.order === 'asc' ? 'ASC' : 'DESC'}, p.id DESC`;
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM (${this.paymentSql(filter, '')}) counted`,
      filter.params,
    );
    const rows: Row[] = await this.dataSource.query(
      this.paymentSql(filter, `ORDER BY ${order} LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`),
      filter.params,
    );
    return paginate([rows.map((row) => this.presentPayment(row)), Number(total)], query.page, query.limit);
  }

  async receipt(schoolId: number, id: number): Promise<{ name: string; pdf: Buffer }> {
    const payment = await this.payment(schoolId, id);
    const fine = await this.fine(schoolId, payment.fine_id);
    const [before]: { paid: string }[] = await this.dataSource.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid FROM library_fine_payments
       WHERE fine_id = $1 AND deleted_at IS NULL AND (created_at < $2 OR (created_at = $2 AND id < $3))`,
      [fine.id, payment.created_at, payment.id],
    );
    const [after]: { paid: string }[] = await this.dataSource.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid FROM library_fine_payments
       WHERE fine_id = $1 AND deleted_at IS NULL AND (created_at < $2 OR (created_at = $2 AND id <= $3))`,
      [fine.id, payment.created_at, payment.id],
    );
    const school = await schoolInfo(this.dataSource.manager, schoolId);
    const pdf = await fineReceiptPdf({
      school_name: school.name,
      school_address: school.address,
      receipt_no: payment.receipt_no,
      paid_on: payment.paid_on,
      member_name: payment.member.name,
      member_detail: payment.member.detail,
      card_no: payment.member.card_no,
      reason: fine.reason,
      fine_amount: fine.amount,
      waived: fine.waived,
      paid_before: Number(before?.paid ?? 0),
      amount: payment.amount,
      balance: round2(Math.max(0, fine.amount - fine.waived - Number(after?.paid ?? 0))),
      mode: payment.mode,
      reference: payment.reference,
      received_by: payment.received_by,
    });
    return { name: `library-receipt-${payment.receipt_no}`, pdf };
  }
}
