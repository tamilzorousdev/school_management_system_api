import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { billFor, canMoveOrder, documentNo, isWithinHours, slotAt, tokenLabel } from './canteen.logic';
import {
  allergenWarnings,
  cancelRefusal,
  dietWarning,
  lineTotal,
  mergeLines,
  nextNumber,
  slotAllowed,
  soldOut,
  stampsFor,
  counterBoard,
  unitPrice,
  cardRefusal,
} from './canteen-sales.logic';
import { CanteenBillingService, lockDay, presentPayment } from './canteen-billing.service';
import { loadSalesSettings, lockDiner } from './canteen-wallet.service';
import {
  DinerPersonDto,
  OrderDateQueryDto,
  OrderDetailDto,
  OrderDto,
  OrderInputDto,
  OrderInsightsDto,
  OrderItemDto,
  OrderPlacedDto,
  OrderQueryDto,
  OrderStatusDto,
  TokenBoardDto,
} from './dto/canteen-sales.dto';
import { DailyMenuEntry, FoodItem, Meal, MealItem } from './entities/canteen-menu.entity';
import { CanteenDiner, CanteenOrder, CanteenOrderItem, CanteenPayment } from './entities/canteen-sales.entity';

interface PricedLine {
  food_item_id: number | null;
  meal_id: number | null;
  name: string;
  unit_price: number;
  quantity: number;
}

const ORDER_SORTS = {
  created_at: 'o.created_at',
  token_no: 'o.token_no',
  total_amount: 'o.total_amount',
  status: 'o.status',
};

function clockIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
}

function presentOrder(order: CanteenOrder, itemCount: number): OrderDto {
  return {
    id: order.id,
    order_no: order.order_no,
    token_no: order.token_no,
    token_label: order.token_label,
    order_date: order.order_date,
    slot: order.slot,
    diner_id: order.diner_id,
    customer_name: order.customer_name,
    channel: order.channel,
    status: order.status,
    subtotal: order.subtotal,
    tax_amount: order.tax_amount,
    discount_amount: order.discount_amount,
    total_amount: order.total_amount,
    paid_amount: order.paid_amount,
    payment_status: order.payment_status,
    counter_id: order.counter_id,
    table_id: order.table_id,
    note: order.note,
    ready_at: order.ready_at,
    served_at: order.served_at,
    cancelled_at: order.cancelled_at,
    cancel_reason: order.cancel_reason,
    created_at: order.created_at,
    item_count: itemCount,
  };
}

@Injectable()
export class CanteenOrdersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly billing: CanteenBillingService,
    @InjectRepository(CanteenOrder) private readonly orders: Repository<CanteenOrder>,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async create(schoolId: number, dto: OrderInputDto, actor: AuthUser): Promise<OrderPlacedDto> {
    const settings = await loadSalesSettings(this.dataSource.manager, schoolId);
    const now = new Date();
    const today = todayIn(this.app.timeZone, now);
    const clock = clockIn(this.app.timeZone, now);
    if (!settings.accepts_orders || !isWithinHours(clock, settings.opens_at, settings.closes_at)) {
      throw AppException.badRequest(
        `The canteen takes orders between ${settings.opens_at} and ${settings.closes_at}`,
        'CANTEEN_CLOSED',
      );
    }
    if (!dto.diner_id && !settings.allow_walk_in) {
      throw AppException.badRequest('Walk-in orders are not allowed', 'WALK_IN_NOT_ALLOWED');
    }
    if (!dto.diner_id && dto.payment_mode === 'wallet') {
      throw AppException.badRequest('Wallet payment needs an enrolled diner', 'WALLET_NEEDS_DINER');
    }
    const slot = dto.slot ?? slotAt(clock);
    const warnings: string[] = [];
    const orderId = await this.dataSource.transaction(async (manager) => {
      await lockDay(manager, schoolId, today);
      let diner: CanteenDiner | null = null;
      if (dto.diner_id) {
        diner = await lockDiner(manager, schoolId, dto.diner_id);
        const refusal = cardRefusal(diner.card_status, diner.status);
        if (refusal) throw AppException.conflict(refusal.message, refusal.code);
        if (!slotAllowed(diner.meal_slots, slot)) {
          throw AppException.conflict(`This diner is not set up for ${slot}`, 'SLOT_NOT_ALLOWED');
        }
      }
      await this.assertCounterAndTable(manager, schoolId, dto);
      const lines = await this.priceLines(manager, schoolId, dto, today, slot, diner, warnings);
      const bill = billFor(lines, settings.tax_percent, dto.discount_amount ?? 0);
      if (bill.total_amount <= 0)
        throw AppException.badRequest('The order total must be above zero', 'ORDER_TOTAL_INVALID');
      const [counts] = await manager.query(
        `SELECT COUNT(*) AS total, COALESCE(MAX(token_no), 0) AS token FROM canteen_orders
         WHERE school_id = $1 AND order_date = $2::date`,
        [schoolId, today],
      );
      const tokenNo = nextNumber(Number(counts.token));
      const order = await manager.save(
        manager.create(CanteenOrder, {
          school_id: schoolId,
          order_no: documentNo('ORD', today, Number(counts.total) + 1),
          token_no: tokenNo,
          token_label: tokenLabel(settings.token_prefix, tokenNo),
          order_date: today,
          slot,
          diner_id: diner?.id ?? null,
          customer_name: dto.customer_name ?? null,
          channel: dto.channel ?? 'counter',
          status: 'placed',
          subtotal: bill.subtotal,
          tax_amount: bill.tax_amount,
          discount_amount: bill.discount_amount,
          total_amount: bill.total_amount,
          paid_amount: 0,
          payment_status: 'unpaid',
          counter_id: dto.counter_id ?? null,
          table_id: dto.table_id ?? null,
          note: dto.note ?? null,
          created_by: actor.id,
        }),
      );
      await manager.save(
        lines.map((line) =>
          manager.create(CanteenOrderItem, {
            school_id: schoolId,
            order_id: order.id,
            food_item_id: line.food_item_id,
            meal_id: line.meal_id,
            name: line.name,
            unit_price: line.unit_price,
            quantity: line.quantity,
            line_total: lineTotal(line.unit_price, line.quantity),
            created_by: actor.id,
          }),
        ),
      );
      if (dto.payment_mode) {
        await this.billing.settle(manager, schoolId, order, dto.payment_mode, null, actor, settings);
      }
      return order.id;
    });
    const detail = await this.get(schoolId, orderId);
    return { ...detail, warnings };
  }

  private async assertCounterAndTable(manager: EntityManager, schoolId: number, dto: OrderInputDto): Promise<void> {
    if (dto.counter_id) {
      const [counter] = await manager.query(
        `SELECT id FROM canteen_counters WHERE school_id = $1 AND id = $2 AND active = true AND deleted_at IS NULL`,
        [schoolId, dto.counter_id],
      );
      if (!counter) throw AppException.notFound('Counter not found', 'COUNTER_NOT_FOUND');
    }
  }

  private async priceLines(
    manager: EntityManager,
    schoolId: number,
    dto: OrderInputDto,
    date: string,
    slot: string,
    diner: CanteenDiner | null,
    warnings: string[],
  ): Promise<PricedLine[]> {
    const entries = await manager
      .createQueryBuilder(DailyMenuEntry, 'e')
      .setLock('pessimistic_write')
      .where('e.school_id = :schoolId AND e.menu_date = :date AND e.slot = :slot AND e.deleted_at IS NULL', {
        schoolId,
        date,
        slot,
      })
      .getMany();
    const activeEntries = entries.filter((entry) => entry.active);
    const lines: PricedLine[] = [];
    for (const requested of mergeLines(dto.items)) {
      const isMeal = Boolean(requested.meal_id);
      const item = isMeal
        ? await manager.findOneBy(Meal, { school_id: schoolId, id: requested.meal_id })
        : await manager.findOneBy(FoodItem, { school_id: schoolId, id: requested.food_item_id });
      if (!item) throw AppException.notFound('Menu item not found', 'ITEM_NOT_FOUND');
      const available = isMeal ? (item as Meal).active : (item as FoodItem).active && (item as FoodItem).available;
      if (!available) throw AppException.conflict(`${item.name} is not available`, 'ITEM_UNAVAILABLE');
      const entry = activeEntries.find((candidate) =>
        isMeal ? candidate.meal_id === item.id : candidate.food_item_id === item.id,
      );
      if (activeEntries.length > 0) {
        if (!entry) throw AppException.conflict(`${item.name} is not on today's menu`, 'ITEM_NOT_ON_MENU');
        if (soldOut(entry.quantity_limit, entry.sold_quantity, requested.quantity)) {
          throw AppException.conflict(`${item.name} is sold out`, 'ITEM_SOLD_OUT');
        }
      }
      if (entry) {
        entry.sold_quantity += requested.quantity;
        await manager.update(DailyMenuEntry, { id: entry.id }, { sold_quantity: entry.sold_quantity });
      }
      if (diner) await this.collectWarnings(manager, schoolId, diner, item, isMeal, warnings);
      lines.push({
        food_item_id: isMeal ? null : item.id,
        meal_id: isMeal ? item.id : null,
        name: item.name,
        unit_price: unitPrice(entry?.price ?? null, item.price),
        quantity: requested.quantity,
      });
    }
    return lines;
  }

  private async collectWarnings(
    manager: EntityManager,
    schoolId: number,
    diner: CanteenDiner,
    item: FoodItem | Meal,
    isMeal: boolean,
    warnings: string[],
  ): Promise<void> {
    let foods: FoodItem[] = [];
    if (isMeal) {
      const parts = await manager.findBy(MealItem, { school_id: schoolId, meal_id: item.id });
      foods = parts.length
        ? await manager
            .createQueryBuilder(FoodItem, 'f')
            .where('f.school_id = :schoolId AND f.id IN (:...ids)', { schoolId, ids: parts.map((p) => p.food_item_id) })
            .getMany()
        : [];
    } else {
      foods = [item as FoodItem];
    }
    for (const food of foods) {
      warnings.push(...allergenWarnings(diner.allergies, food.name, food.allergens));
      const diet = dietWarning(diner.diet, food.name, food.is_veg);
      if (diet) warnings.push(diet);
    }
  }

  async list(schoolId: number, query: OrderQueryDto): Promise<Paginated<OrderDto>> {
    const qb = this.orders.createQueryBuilder('o').where('o.school_id = :schoolId', { schoolId });
    if (query.date) qb.andWhere('o.order_date = :date', { date: query.date });
    if (query.status) qb.andWhere('o.status = :status', { status: query.status });
    if (query.slot) qb.andWhere('o.slot = :slot', { slot: query.slot });
    if (query.payment_status) qb.andWhere('o.payment_status = :paymentStatus', { paymentStatus: query.payment_status });
    if (query.diner_id) qb.andWhere('o.diner_id = :dinerId', { dinerId: query.diner_id });
    if (query.counter_id) qb.andWhere('o.counter_id = :counterId', { counterId: query.counter_id });
    const page = await listQuery(qb, query, {
      searchable: ['o.token_label', 'o.order_no', 'o.customer_name'],
      sortable: ORDER_SORTS,
      defaultSort: 'created_at',
    });
    const counts: Record<string, unknown>[] = page.items.length
      ? await this.dataSource.query(
          `SELECT order_id, COUNT(*) AS total FROM canteen_order_items
           WHERE school_id = $1 AND order_id = ANY($2::int[]) GROUP BY order_id`,
          [schoolId, page.items.map((order) => order.id)],
        )
      : [];
    const byOrder = new Map(counts.map((row) => [Number(row.order_id), Number(row.total)]));
    return { ...page, items: page.items.map((order) => presentOrder(order, byOrder.get(order.id) ?? 0)) };
  }

  async get(schoolId: number, id: number): Promise<OrderDetailDto> {
    const order = await this.orders.findOneBy({ id, school_id: schoolId });
    if (!order) throw AppException.notFound('Order not found', 'ORDER_NOT_FOUND');
    return this.detail(schoolId, order);
  }

  private async detail(schoolId: number, order: CanteenOrder): Promise<OrderDetailDto> {
    const manager = this.dataSource.manager;
    const items = await manager.find(CanteenOrderItem, {
      where: { school_id: schoolId, order_id: order.id },
      order: { id: 'ASC' },
    });
    const payments = await manager.find(CanteenPayment, {
      where: { school_id: schoolId, order_id: order.id },
      order: { id: 'ASC' },
    });
    let person: DinerPersonDto | null = null;
    let cardNo: string | null = null;
    if (order.diner_id) {
      const [row] = await manager.query(
        `SELECT d.card_no, d.student_id, d.staff_id, s.admission_no, st.employee_no,
                COALESCE(NULLIF(TRIM(CONCAT(s.first_name, ' ', s.last_name)), ''), u.name) AS name
         FROM canteen_diners d
         LEFT JOIN students s ON s.id = d.student_id
         LEFT JOIN staff st ON st.id = d.staff_id
         LEFT JOIN users u ON u.id = st.user_id
         WHERE d.school_id = $1 AND d.id = $2`,
        [schoolId, order.diner_id],
      );
      if (row) {
        cardNo = row.card_no;
        person = {
          id: Number(row.student_id ?? row.staff_id),
          name: String(row.name ?? ''),
          admission_no: row.admission_no ?? null,
          employee_no: row.employee_no ?? null,
          class_name: null,
          section_name: null,
        };
      }
    }
    const lines: OrderItemDto[] = items.map((item) => ({
      id: item.id,
      food_item_id: item.food_item_id,
      meal_id: item.meal_id,
      name: item.name,
      unit_price: item.unit_price,
      quantity: item.quantity,
      line_total: item.line_total,
    }));
    return {
      ...presentOrder(order, lines.length),
      items: lines,
      payments: payments.map(presentPayment),
      person,
      card_no: cardNo,
    };
  }

  async changeStatus(schoolId: number, id: number, dto: OrderStatusDto, actor: AuthUser): Promise<OrderDetailDto> {
    const now = new Date();
    await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(CanteenOrder, 'o')
        .setLock('pessimistic_write')
        .where('o.school_id = :schoolId AND o.id = :id AND o.deleted_at IS NULL', { schoolId, id })
        .getOne();
      if (!order) throw AppException.notFound('Order not found', 'ORDER_NOT_FOUND');
      if (!canMoveOrder(order.status, dto.status)) {
        throw AppException.conflict(
          `An order that is ${order.status} cannot become ${dto.status}`,
          'ORDER_STATUS_INVALID',
        );
      }
      const changes: Partial<CanteenOrder> = { status: dto.status, ...stampsFor(dto.status, now) };
      if (dto.status === 'cancelled') {
        const refusal = cancelRefusal(dto.reason);
        if (refusal) throw AppException.badRequest(refusal.message, refusal.code);
        changes.cancel_reason = dto.reason!;
        await this.restoreMenu(manager, schoolId, order);
        if (order.payment_status === 'paid') {
          await this.billing.refundPaid(manager, schoolId, order, dto.reason!, actor);
        }
      }
      await manager.update(CanteenOrder, { id: order.id, school_id: schoolId }, changes);
    });
    return this.get(schoolId, id);
  }

  private async restoreMenu(manager: EntityManager, schoolId: number, order: CanteenOrder): Promise<void> {
    if (!order.slot) return;
    const items = await manager.findBy(CanteenOrderItem, { school_id: schoolId, order_id: order.id });
    for (const item of items) {
      await manager.query(
        `UPDATE canteen_daily_menu SET sold_quantity = GREATEST(0, sold_quantity - $1)
         WHERE school_id = $2 AND menu_date = $3::date AND slot = $4 AND active = true AND deleted_at IS NULL
           AND (($5::int IS NOT NULL AND food_item_id = $5) OR ($6::int IS NOT NULL AND meal_id = $6))`,
        [item.quantity, schoolId, order.order_date, order.slot, item.food_item_id, item.meal_id],
      );
    }
  }

  async board(schoolId: number, query: OrderDateQueryDto): Promise<TokenBoardDto> {
    const date = query.date ?? todayIn(this.app.timeZone);
    const rows = await this.orders
      .createQueryBuilder('o')
      .where('o.school_id = :schoolId AND o.order_date = :date AND o.status IN (:...statuses)', {
        schoolId,
        date,
        statuses: ['placed', 'preparing', 'ready'],
      })
      .orderBy('o.token_no', 'ASC')
      .getMany();
    return { date, ...counterBoard(rows) };
  }

  async insights(schoolId: number, query: OrderDateQueryDto): Promise<OrderInsightsDto> {
    const date = query.date ?? todayIn(this.app.timeZone);
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE status = 'placed') AS placed,
              COUNT(*) FILTER (WHERE status = 'preparing') AS preparing,
              COUNT(*) FILTER (WHERE status = 'ready') AS ready,
              COUNT(*) FILTER (WHERE status = 'served') AS served,
              COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
              COALESCE(SUM(paid_amount) FILTER (WHERE status <> 'cancelled'), 0) AS revenue,
              COALESCE(SUM(total_amount) FILTER (WHERE status <> 'cancelled' AND payment_status = 'unpaid'), 0) AS unpaid
       FROM canteen_orders WHERE school_id = $1 AND order_date = $2::date AND deleted_at IS NULL`,
      [schoolId, date],
    );
    return {
      date,
      total: Number(row.total),
      placed: Number(row.placed),
      preparing: Number(row.preparing),
      ready: Number(row.ready),
      served: Number(row.served),
      cancelled: Number(row.cancelled),
      revenue: Number(row.revenue),
      unpaid_amount: Number(row.unpaid),
    };
  }
}
