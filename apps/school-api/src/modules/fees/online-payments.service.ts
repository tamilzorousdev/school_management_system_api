import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { User } from '../users/entities/user.entity';
import {
  CollectionResultDto,
  OnlineOrderDto,
  OnlineOrderQueryDto,
  OnlinePaymentStartDto,
  OnlinePaymentVerifyDto,
  StartedOrderDto,
} from './dto/fees.dto';
import { FeeInvoice } from './entities/fee-invoice.entity';
import { FeePayment } from './entities/fee-payment.entity';
import { FeePaymentOrder } from './entities/fee-payment-order.entity';
import { collectForStudent, creditBalance } from './fee-credits';
import { round2 } from './fees.logic';
import { FeesService } from './fees.service';
import { RazorpayClient } from './razorpay.client';

interface RazorpayEvent {
  event?: string;
  payload?: {
    payment?: {
      entity?: { id?: string; order_id?: string; amount?: number; error_description?: string | null };
    };
  };
}

@Injectable()
export class OnlinePaymentsService {
  private readonly logger = new Logger('OnlinePayments');

  constructor(
    @InjectRepository(FeePaymentOrder) private readonly orders: Repository<FeePaymentOrder>,
    private readonly razorpay: RazorpayClient,
    private readonly fees: FeesService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async start(
    userId: number,
    studentId: number,
    invoiceId: number,
    dto: OnlinePaymentStartDto,
  ): Promise<StartedOrderDto> {
    this.razorpay.assertEnabled();
    const schoolId = await this.fees.childSchool(userId, studentId);
    const invoice = await this.dataSource
      .getRepository(FeeInvoice)
      .findOneBy({ id: invoiceId, school_id: schoolId, student_id: studentId });
    if (!invoice) throw AppException.notFound('Invoice not found', 'INVOICE_NOT_FOUND');
    if (invoice.status === 'cancelled') throw AppException.conflict('This invoice is cancelled', 'INVOICE_CANCELLED');
    if (invoice.balance <= 0) throw AppException.conflict('This invoice is already paid', 'INVOICE_PAID');
    const amount = round2(dto.amount ?? invoice.balance);
    if (amount > invoice.balance) {
      throw AppException.badRequest('The amount is more than the balance', 'PAYMENT_EXCEEDS_BALANCE');
    }
    const order = await this.razorpay.createOrder(Math.round(amount * 100), `inv${invoice.id}-${Date.now()}`, {
      school_id: String(schoolId),
      student_id: String(studentId),
      invoice_id: String(invoice.id),
      invoice_no: invoice.invoice_no,
    });
    await this.orders.save(
      this.orders.create({
        school_id: schoolId,
        invoice_id: invoice.id,
        student_id: studentId,
        amount,
        gateway: 'razorpay',
        gateway_order_id: order.id,
        status: 'created',
        created_by: userId,
      }),
    );
    const [school] = await this.dataSource.query(`SELECT name FROM schools WHERE id = $1`, [schoolId]);
    const user = await this.dataSource.getRepository(User).findOneBy({ id: userId });
    return {
      gateway: 'razorpay',
      key_id: this.razorpay.keyId,
      order_id: order.id,
      amount_paise: order.amount,
      amount,
      currency: 'INR',
      name: school?.name ?? 'School',
      description: `${invoice.installment} fee · ${invoice.invoice_no}`,
      prefill: { name: user?.name ?? '', contact: user?.mobile ?? '' },
    };
  }

  async verify(userId: number, studentId: number, dto: OnlinePaymentVerifyDto): Promise<CollectionResultDto> {
    const schoolId = await this.fees.childSchool(userId, studentId);
    const order = await this.orders.findOneBy({
      gateway_order_id: dto.razorpay_order_id,
      school_id: schoolId,
      student_id: studentId,
    });
    if (!order) throw AppException.notFound('Payment not found', 'ORDER_NOT_FOUND');
    if (!this.razorpay.paymentSignatureValid(dto.razorpay_order_id, dto.razorpay_payment_id, dto.razorpay_signature)) {
      throw AppException.badRequest('The payment could not be confirmed', 'INVALID_PAYMENT_SIGNATURE');
    }
    return this.settle(order.id, dto.razorpay_payment_id);
  }

  async webhook(raw: Buffer | undefined, signature: string | undefined): Promise<{ handled: boolean }> {
    if (!this.razorpay.webhookSignatureValid(raw, signature)) {
      throw AppException.unauthorized('Invalid webhook signature', 'INVALID_SIGNATURE');
    }
    const event = JSON.parse(raw!.toString('utf8')) as RazorpayEvent;
    const payment = event.payload?.payment?.entity;
    if (!payment?.order_id || !payment.id) return { handled: false };
    const order = await this.orders.findOneBy({ gateway_order_id: payment.order_id });
    if (!order) return { handled: false };
    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      if (payment.amount !== undefined && payment.amount !== Math.round(order.amount * 100)) {
        this.logger.warn(`Order ${order.gateway_order_id}: paid ${payment.amount} paise, expected ${order.amount}`);
      }
      await this.settle(order.id, payment.id);
      return { handled: true };
    }
    if (event.event === 'payment.failed' && order.status === 'created') {
      await this.orders.update(order.id, {
        status: 'failed',
        gateway_payment_id: payment.id,
        failure_reason: (payment.error_description ?? 'Payment failed').slice(0, 300),
      });
      return { handled: true };
    }
    return { handled: false };
  }

  async list(schoolId: number, query: OnlineOrderQueryDto): Promise<Paginated<OnlineOrderDto>> {
    const qb = this.orders
      .createQueryBuilder('o')
      .innerJoin(FeeInvoice, 'i', 'i.id = o.invoice_id')
      .where('o.school_id = :schoolId', { schoolId });
    if (query.status) qb.andWhere('o.status = :status', { status: query.status });
    const page = await listQuery(qb, query, {
      searchable: ['i.invoice_no', 'o.gateway_order_id', 'o.gateway_payment_id'],
      sortable: { created_at: 'o.created_at' },
      defaultSort: 'created_at',
    });
    const [students, invoices] = await Promise.all([
      this.fees.studentRefs(
        schoolId,
        page.items.map((row) => row.student_id),
      ),
      this.dataSource.getRepository(FeeInvoice).findBy({ id: In(page.items.map((row) => row.invoice_id)) }),
    ]);
    const invoiceById = new Map(invoices.map((row) => [row.id, row]));
    return {
      ...page,
      items: page.items.map((row) => ({
        id: row.id,
        gateway: row.gateway,
        gateway_order_id: row.gateway_order_id,
        gateway_payment_id: row.gateway_payment_id,
        status: row.status,
        amount: row.amount,
        invoice_id: row.invoice_id,
        invoice_no: invoiceById.get(row.invoice_id)?.invoice_no ?? '',
        student: students.get(row.student_id) ?? {
          id: row.student_id,
          full_name: 'Removed student',
          admission_no: '',
          class_section: null,
        },
        failure_reason: row.failure_reason,
        paid_at: row.paid_at,
        created_at: row.created_at,
      })),
    };
  }

  private async settle(orderId: number, gatewayPaymentId: string): Promise<CollectionResultDto> {
    const outcome = await this.dataSource.transaction(async (manager) => {
      const order = await manager.findOneOrFail(FeePaymentOrder, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (order.status === 'paid' && order.collection_id) {
        const payments = await manager.find(FeePayment, {
          where: { collection_id: order.collection_id },
          order: { id: 'ASC' },
        });
        return { order, payments, replayed: true };
      }
      const result = await collectForStudent(manager, order.school_id, order.student_id, {
        amount: order.amount,
        mode: 'online',
        reference: gatewayPaymentId,
        paid_on: todayIn(this.app.timeZone),
        notes: `Paid online (Razorpay ${order.gateway_order_id})`,
        received_by: null,
        idempotency_key: `rzp_${gatewayPaymentId}`,
        prefer_invoice_id: order.invoice_id,
      });
      await manager.update(FeePaymentOrder, order.id, {
        status: 'paid',
        gateway_payment_id: gatewayPaymentId,
        collection_id: result.collection.id,
        paid_at: new Date(),
        failure_reason: null,
      });
      return { order: { ...order, collection_id: result.collection.id }, payments: result.payments, replayed: false };
    });
    const collection = outcome.order.collection_id
      ? await this.dataSource.query(
          `SELECT amount, applied_amount, advance_amount, advance_receipt_no FROM fee_collections WHERE id = $1`,
          [outcome.order.collection_id],
        )
      : [];
    const head = collection[0];
    const invoices = await this.dataSource
      .getRepository(FeeInvoice)
      .findBy({ id: In(outcome.payments.map((payment) => payment.invoice_id)) });
    const byId = new Map(invoices.map((row) => [row.id, row]));
    if (!outcome.replayed) {
      await this.fees.notifyPaymentReceived(outcome.order.student_id, {
        amount: Number(outcome.order.amount),
        mode: 'online',
        paid_on: todayIn(this.app.timeZone),
        receipt_nos: [
          ...outcome.payments.map((payment) => payment.receipt_no),
          ...(head?.advance_receipt_no ? [head.advance_receipt_no as string] : []),
        ],
      });
    }
    return {
      collection_id: outcome.order.collection_id,
      amount: Number(head?.amount ?? outcome.order.amount),
      applied_amount: Number(head?.applied_amount ?? 0),
      advance_amount: Number(head?.advance_amount ?? 0),
      advance_receipt_no: head?.advance_receipt_no ?? null,
      credit_balance: await creditBalance(this.dataSource.manager, outcome.order.student_id),
      replayed: outcome.replayed,
      payments: outcome.payments.map((payment) => ({
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
}
