import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, AuthUser, paginate, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { dailyLimitRefusal, documentNo, money } from './canteen.logic';
import { payRefusal, refundRefusal, refundRoute, walletSpendToday } from './canteen-sales.logic';
import { CanteenWalletService, loadSalesSettings, lockDiner, SalesSettings } from './canteen-wallet.service';
import {
  PaymentDto,
  PaymentLedgerDto,
  PaymentModeTotalDto,
  PaymentQueryDto,
  PaymentSummaryDto,
  PaymentSummaryQueryDto,
  PayOrderDto,
  ReceiptDto,
  RefundOrderDto,
} from './dto/canteen-sales.dto';
import {
  CanteenOrder,
  CanteenOrderItem,
  CanteenPayment,
  PaymentMode,
  PAYMENT_MODES,
} from './entities/canteen-sales.entity';

type Row = Record<string, unknown>;

export function presentPayment(row: CanteenPayment): PaymentDto {
  return {
    id: row.id,
    order_id: row.order_id,
    receipt_no: row.receipt_no,
    mode: row.mode,
    amount: row.amount,
    reference: row.reference,
    is_refund: row.is_refund,
    created_at: row.created_at,
  };
}

export async function lockDay(manager: EntityManager, schoolId: number, date: string): Promise<void> {
  await manager.query(`SELECT pg_advisory_xact_lock($1, $2)`, [schoolId, Number(date.replace(/-/g, ''))]);
}

@Injectable()
export class CanteenBillingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly wallet: CanteenWalletService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  private async nextReceipt(manager: EntityManager, schoolId: number, date: string): Promise<string> {
    const [row] = await manager.query(
      `SELECT COUNT(*) AS total FROM canteen_payments
       WHERE school_id = $1 AND (created_at AT TIME ZONE $2)::date = $3::date`,
      [schoolId, this.app.timeZone, date],
    );
    return documentNo('RCP', date, Number(row.total) + 1);
  }

  async walletSpentToday(manager: EntityManager, schoolId: number, dinerId: number, date: string): Promise<number> {
    const [row] = await manager.query(
      `SELECT COALESCE(-SUM(amount) FILTER (WHERE kind = 'purchase'), 0) AS purchases,
              COALESCE(SUM(amount) FILTER (WHERE kind = 'refund' AND order_id IS NOT NULL), 0) AS refunds
       FROM canteen_wallet_transactions
       WHERE school_id = $1 AND diner_id = $2 AND (created_at AT TIME ZONE $3)::date = $4::date`,
      [schoolId, dinerId, this.app.timeZone, date],
    );
    return walletSpendToday(Number(row.purchases), Number(row.refunds));
  }

  async settle(
    manager: EntityManager,
    schoolId: number,
    order: CanteenOrder,
    mode: PaymentMode,
    reference: string | null,
    actor: AuthUser,
    settings: SalesSettings,
  ): Promise<CanteenPayment> {
    const today = todayIn(this.app.timeZone);
    await lockDay(manager, schoolId, today);
    if (mode === 'wallet') {
      if (!settings.wallet_enabled) throw AppException.conflict('The wallet is switched off', 'WALLET_DISABLED');
      if (!order.diner_id) {
        throw AppException.badRequest('Wallet payment needs an enrolled diner', 'WALLET_NEEDS_DINER');
      }
      const diner = await lockDiner(manager, schoolId, order.diner_id);
      const spent = await this.walletSpentToday(manager, schoolId, diner.id, today);
      const limit = dailyLimitRefusal(spent, order.total_amount, diner.daily_limit);
      if (limit) throw AppException.conflict('The daily spending limit is reached', limit);
      await this.wallet.applyChange(
        manager,
        schoolId,
        {
          diner_id: diner.id,
          kind: 'purchase',
          amount: order.total_amount,
          order_id: order.id,
          note: `Order ${order.order_no}`,
          allow_negative: settings.allow_negative_balance,
        },
        actor,
      );
    }
    const payment = await manager.save(
      manager.create(CanteenPayment, {
        school_id: schoolId,
        order_id: order.id,
        receipt_no: await this.nextReceipt(manager, schoolId, today),
        mode,
        amount: order.total_amount,
        reference,
        is_refund: false,
        created_by: actor.id,
      }),
    );
    order.paid_amount = order.total_amount;
    order.payment_status = 'paid';
    await manager.update(
      CanteenOrder,
      { id: order.id, school_id: schoolId },
      { paid_amount: order.paid_amount, payment_status: 'paid' },
    );
    return payment;
  }

  async refundPaid(
    manager: EntityManager,
    schoolId: number,
    order: CanteenOrder,
    reason: string,
    actor: AuthUser,
  ): Promise<CanteenPayment> {
    const today = todayIn(this.app.timeZone);
    await lockDay(manager, schoolId, today);
    const payments = await manager.find(CanteenPayment, {
      where: { school_id: schoolId, order_id: order.id, is_refund: false },
      order: { id: 'ASC' },
    });
    const original = payments[payments.length - 1];
    const mode: PaymentMode = original?.mode ?? 'cash';
    const amount = order.paid_amount;
    if (refundRoute(mode === 'wallet') === 'wallet' && order.diner_id) {
      await this.wallet.applyChange(
        manager,
        schoolId,
        {
          diner_id: order.diner_id,
          kind: 'refund',
          amount,
          order_id: order.id,
          note: `Refund for order ${order.order_no}: ${reason}`,
          allow_negative: true,
        },
        actor,
      );
    }
    const refund = await manager.save(
      manager.create(CanteenPayment, {
        school_id: schoolId,
        order_id: order.id,
        receipt_no: await this.nextReceipt(manager, schoolId, today),
        mode,
        amount: -amount,
        reference: original?.receipt_no ?? null,
        is_refund: true,
        created_by: actor.id,
      }),
    );
    order.paid_amount = 0;
    order.payment_status = 'refunded';
    await manager.update(
      CanteenOrder,
      { id: order.id, school_id: schoolId },
      { paid_amount: 0, payment_status: 'refunded' },
    );
    return refund;
  }

  private async lockOrder(manager: EntityManager, schoolId: number, id: number): Promise<CanteenOrder> {
    const order = await manager
      .createQueryBuilder(CanteenOrder, 'o')
      .setLock('pessimistic_write')
      .where('o.school_id = :schoolId AND o.id = :id AND o.deleted_at IS NULL', { schoolId, id })
      .getOne();
    if (!order) throw AppException.notFound('Order not found', 'ORDER_NOT_FOUND');
    return order;
  }

  async pay(schoolId: number, id: number, dto: PayOrderDto, actor: AuthUser): Promise<PaymentDto> {
    const settings = await loadSalesSettings(this.dataSource.manager, schoolId);
    const payment = await this.dataSource.transaction(async (manager) => {
      const order = await this.lockOrder(manager, schoolId, id);
      const refusal = payRefusal(order, dto.amount);
      if (refusal) throw AppException.conflict(refusal.message, refusal.code);
      return this.settle(manager, schoolId, order, dto.mode, dto.reference ?? null, actor, settings);
    });
    return presentPayment(payment);
  }

  async refund(schoolId: number, id: number, dto: RefundOrderDto, actor: AuthUser): Promise<PaymentDto> {
    const payment = await this.dataSource.transaction(async (manager) => {
      const order = await this.lockOrder(manager, schoolId, id);
      const refusal = refundRefusal(order, dto.reason);
      if (refusal) throw AppException.conflict(refusal.message, refusal.code);
      return this.refundPaid(manager, schoolId, order, dto.reason, actor);
    });
    return presentPayment(payment);
  }

  async receipt(schoolId: number, id: number): Promise<ReceiptDto> {
    const manager = this.dataSource.manager;
    const order = await manager.findOneBy(CanteenOrder, { id, school_id: schoolId });
    if (!order) throw AppException.notFound('Order not found', 'ORDER_NOT_FOUND');
    const items = await manager.find(CanteenOrderItem, {
      where: { school_id: schoolId, order_id: id },
      order: { id: 'ASC' },
    });
    const payments = await manager.find(CanteenPayment, {
      where: { school_id: schoolId, order_id: id },
      order: { id: 'ASC' },
    });
    const settings = await loadSalesSettings(manager, schoolId);
    let customer = order.customer_name;
    let cardNo: string | null = null;
    if (order.diner_id) {
      const [row] = await manager.query(
        `SELECT d.card_no, COALESCE(NULLIF(TRIM(CONCAT(s.first_name, ' ', s.last_name)), ''), u.name) AS name
         FROM canteen_diners d
         LEFT JOIN students s ON s.id = d.student_id
         LEFT JOIN staff st ON st.id = d.staff_id
         LEFT JOIN users u ON u.id = st.user_id
         WHERE d.school_id = $1 AND d.id = $2`,
        [schoolId, order.diner_id],
      );
      customer = row?.name ?? customer;
      cardNo = row?.card_no ?? null;
    }
    return {
      order_no: order.order_no,
      token_label: order.token_label,
      order_date: order.order_date,
      customer,
      card_no: cardNo,
      lines: items.map((item) => ({
        name: item.name,
        unit_price: item.unit_price,
        quantity: item.quantity,
        line_total: item.line_total,
      })),
      subtotal: order.subtotal,
      discount_amount: order.discount_amount,
      tax_amount: order.tax_amount,
      total_amount: order.total_amount,
      paid_amount: order.paid_amount,
      payment_status: order.payment_status,
      payments: payments.map(presentPayment),
      footer: settings.receipt_footer,
    };
  }

  async ledger(schoolId: number, query: PaymentQueryDto): Promise<Paginated<PaymentLedgerDto>> {
    const params: unknown[] = [schoolId, this.app.timeZone];
    const where = ['p.school_id = $1'];
    const add = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    if (query.from) where.push(`(p.created_at AT TIME ZONE $2)::date >= ${add(query.from)}::date`);
    if (query.to) where.push(`(p.created_at AT TIME ZONE $2)::date <= ${add(query.to)}::date`);
    if (query.mode) where.push(`p.mode = ${add(query.mode)}`);
    if (query.is_refund !== undefined) where.push(`p.is_refund = ${add(query.is_refund)}`);
    const sorts: Record<string, string> = {
      created_at: 'p.created_at',
      amount: 'p.amount',
      receipt_no: 'p.receipt_no',
    };
    const column = sorts[query.sort ?? 'created_at'];
    if (!column) throw AppException.badRequest(`sort must be one of: ${Object.keys(sorts).join(', ')}`, 'INVALID_SORT');
    const clause = where.join(' AND ');
    const from = `FROM canteen_payments p JOIN canteen_orders o ON o.id = p.order_id`;
    const [count] = await this.dataSource.query(`SELECT COUNT(*) AS total ${from} WHERE ${clause}`, params);
    const rows: Row[] = await this.dataSource.query(
      `SELECT p.*, o.order_no, o.token_label ${from} WHERE ${clause}
       ORDER BY ${column} ${query.order === 'asc' ? 'ASC' : 'DESC'}, p.id DESC
       LIMIT ${add(query.limit)} OFFSET ${add((query.page - 1) * query.limit)}`,
      params,
    );
    const items: PaymentLedgerDto[] = rows.map((row) => ({
      id: Number(row.id),
      order_id: Number(row.order_id),
      receipt_no: String(row.receipt_no),
      mode: row.mode as PaymentMode,
      amount: Number(row.amount),
      reference: row.reference === null ? null : String(row.reference),
      is_refund: Boolean(row.is_refund),
      created_at: row.created_at as Date,
      order_no: String(row.order_no),
      token_label: String(row.token_label),
    }));
    return paginate([items, Number(count.total)], query.page, query.limit);
  }

  async summary(schoolId: number, query: PaymentSummaryQueryDto): Promise<PaymentSummaryDto> {
    const today = todayIn(this.app.timeZone);
    const from = query.from ?? today;
    const to = query.to ?? today;
    const rows: Row[] = await this.dataSource.query(
      `SELECT mode,
              COALESCE(SUM(amount) FILTER (WHERE NOT is_refund), 0) AS collections,
              COALESCE(-SUM(amount) FILTER (WHERE is_refund), 0) AS refunds
       FROM canteen_payments
       WHERE school_id = $1 AND (created_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date
       GROUP BY mode`,
      [schoolId, this.app.timeZone, from, to],
    );
    const byMode: PaymentModeTotalDto[] = PAYMENT_MODES.map((mode) => {
      const row = rows.find((candidate) => candidate.mode === mode);
      const collections = Number(row?.collections ?? 0);
      const refunds = Number(row?.refunds ?? 0);
      return { mode, collections, refunds, net: money(collections - refunds) };
    });
    const collections = money(byMode.reduce((sum, entry) => sum + entry.collections, 0));
    const refunds = money(byMode.reduce((sum, entry) => sum + entry.refunds, 0));
    return { from, to, by_mode: byMode, collections, refunds, net: money(collections - refunds) };
  }
}
