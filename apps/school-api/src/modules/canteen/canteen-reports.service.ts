import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import {
  averageResolutionHours,
  DateRange,
  datesInRange,
  percent,
  profitOf,
  resolveRange,
  toCsv,
  wageEstimate,
  withShare,
} from './canteen-people.logic';
import { attendanceRate, money, stockStatus } from './canteen.logic';
import {
  CategoriesReportDto,
  FeedbackReportDto,
  ItemSalesRowDto,
  ItemsReportDto,
  PaymentModesReportDto,
  PeakHoursReportDto,
  ProfitSummaryDto,
  PurchasesReportDto,
  SalesDayDto,
  SalesReportDto,
  SlotsReportDto,
  StaffReportDto,
  StockReportDto,
  WalletReportDto,
  WasteReportDto,
} from './dto/canteen-reports.dto';

type Row = Record<string, unknown>;

const n = (value: unknown): number => Number(value ?? 0);
const TOP = 10;
const LIVE = `o.school_id = $1 AND o.deleted_at IS NULL AND o.status <> 'cancelled' AND o.order_date BETWEEN $2 AND $3`;

@Injectable()
export class CanteenReportsService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  private rows(sql: string, params: unknown[]): Promise<Row[]> {
    return this.dataSource.query(sql, params);
  }

  private async one(sql: string, params: unknown[]): Promise<Row> {
    const [row] = await this.rows(sql, params);
    return row ?? {};
  }

  range(from?: string, to?: string): DateRange {
    return resolveRange(from, to, todayIn(this.app.timeZone));
  }

  async sales(schoolId: number, from?: string, to?: string): Promise<SalesReportDto> {
    const range = this.range(from, to);
    const rows = await this.rows(
      `SELECT CAST(o.order_date AS text) AS date,
              COUNT(*)::int AS orders,
              COALESCE(SUM(o.total_amount) FILTER (WHERE o.payment_status = 'paid'), 0) AS revenue,
              COALESCE(SUM(o.tax_amount) FILTER (WHERE o.payment_status = 'paid'), 0) AS tax,
              COALESCE(SUM(o.discount_amount) FILTER (WHERE o.payment_status = 'paid'), 0) AS discount,
              COALESCE((SELECT -SUM(p.amount) FROM canteen_payments p
                        WHERE p.order_id = o.id AND p.is_refund = true AND p.deleted_at IS NULL), 0) AS refunds
       FROM canteen_orders o
       WHERE ${LIVE}
       GROUP BY o.order_date, o.id`,
      [schoolId, range.from, range.to],
    );
    const byDate = new Map<string, SalesDayDto>();
    for (const row of rows) {
      const date = String(row.date);
      const day = byDate.get(date) ?? { date, orders: 0, revenue: 0, tax: 0, discount: 0, refunds: 0 };
      day.orders += n(row.orders);
      day.revenue += n(row.revenue);
      day.tax += n(row.tax);
      day.discount += n(row.discount);
      day.refunds += n(row.refunds);
      byDate.set(date, day);
    }
    const empty = (date: string): SalesDayDto => ({ date, orders: 0, revenue: 0, tax: 0, discount: 0, refunds: 0 });
    const daily = datesInRange(range).map((date) => {
      const day = byDate.get(date) ?? empty(date);
      return {
        date,
        orders: day.orders,
        revenue: money(day.revenue),
        tax: money(day.tax),
        discount: money(day.discount),
        refunds: money(day.refunds),
      };
    });
    const totals = daily.reduce(
      (sum, day) => ({
        date: range.to,
        orders: sum.orders + day.orders,
        revenue: money(sum.revenue + day.revenue),
        tax: money(sum.tax + day.tax),
        discount: money(sum.discount + day.discount),
        refunds: money(sum.refunds + day.refunds),
      }),
      empty(range.to),
    );
    return { ...range, totals, daily };
  }

  async salesCsv(schoolId: number, from?: string, to?: string): Promise<{ name: string; buffer: Buffer }> {
    const report = await this.sales(schoolId, from, to);
    const csv = toCsv(
      ['date', 'orders', 'revenue', 'tax', 'discount', 'refunds'],
      report.daily.map((day) => [day.date, day.orders, day.revenue, day.tax, day.discount, day.refunds]),
    );
    return { name: `canteen-sales-${report.from}-to-${report.to}.csv`, buffer: Buffer.from(csv, 'utf8') };
  }

  private async itemRows(schoolId: number, range: DateRange, orderBy: string, limit: number) {
    const rows = await this.rows(
      `SELECT oi.food_item_id, oi.name, COALESCE(c.name, 'Meals and combos') AS category,
              SUM(oi.quantity)::int AS quantity, COALESCE(SUM(oi.line_total), 0) AS revenue
       FROM canteen_order_items oi
       JOIN canteen_orders o ON o.id = oi.order_id AND o.school_id = oi.school_id
       LEFT JOIN canteen_food_items f ON f.id = oi.food_item_id AND f.school_id = oi.school_id
       LEFT JOIN canteen_food_categories c ON c.id = f.category_id AND c.school_id = oi.school_id
       WHERE oi.deleted_at IS NULL AND ${LIVE}
       GROUP BY oi.food_item_id, oi.name, c.name
       ORDER BY ${orderBy}, oi.name
       LIMIT ${limit}`,
      [schoolId, range.from, range.to],
    );
    return rows.map((row): ItemSalesRowDto => ({
      food_item_id: row.food_item_id === null ? null : n(row.food_item_id),
      name: String(row.name),
      category: String(row.category),
      quantity: n(row.quantity),
      revenue: money(n(row.revenue)),
    }));
  }

  async items(schoolId: number, from?: string, to?: string): Promise<ItemsReportDto> {
    const range = this.range(from, to);
    const [byQuantity, byRevenue, bottom] = await Promise.all([
      this.itemRows(schoolId, range, 'quantity DESC, revenue DESC', TOP),
      this.itemRows(schoolId, range, 'revenue DESC, quantity DESC', TOP),
      this.itemRows(schoolId, range, 'quantity ASC, revenue ASC', TOP),
    ]);
    return { ...range, top_by_quantity: byQuantity, top_by_revenue: byRevenue, bottom_by_quantity: bottom };
  }

  async categories(schoolId: number, from?: string, to?: string): Promise<CategoriesReportDto> {
    const range = this.range(from, to);
    const rows = await this.rows(
      `SELECT COALESCE(c.name, 'Meals and combos') AS category,
              SUM(oi.quantity)::int AS quantity, COALESCE(SUM(oi.line_total), 0) AS revenue
       FROM canteen_order_items oi
       JOIN canteen_orders o ON o.id = oi.order_id AND o.school_id = oi.school_id
       LEFT JOIN canteen_food_items f ON f.id = oi.food_item_id AND f.school_id = oi.school_id
       LEFT JOIN canteen_food_categories c ON c.id = f.category_id AND c.school_id = oi.school_id
       WHERE oi.deleted_at IS NULL AND ${LIVE}
       GROUP BY c.name
       ORDER BY revenue DESC, category`,
      [schoolId, range.from, range.to],
    );
    const items = rows.map((row) => ({
      category: String(row.category),
      quantity: n(row.quantity),
      revenue: money(n(row.revenue)),
    }));
    return {
      ...range,
      rows: withShare(items, (item) => item.revenue),
    };
  }

  async paymentModes(schoolId: number, from?: string, to?: string): Promise<PaymentModesReportDto> {
    const range = this.range(from, to);
    const rows = await this.rows(
      `SELECT p.mode,
              COUNT(*) FILTER (WHERE p.is_refund = false)::int AS payments,
              COALESCE(SUM(p.amount) FILTER (WHERE p.is_refund = false), 0) AS collected,
              COALESCE(-SUM(p.amount) FILTER (WHERE p.is_refund = true), 0) AS refunded
       FROM canteen_payments p
       JOIN canteen_orders o ON o.id = p.order_id AND o.school_id = p.school_id
       WHERE p.deleted_at IS NULL AND o.school_id = $1 AND o.deleted_at IS NULL AND o.order_date BETWEEN $2 AND $3
       GROUP BY p.mode
       ORDER BY collected DESC, p.mode`,
      [schoolId, range.from, range.to],
    );
    const items = rows.map((row) => ({
      mode: String(row.mode),
      payments: n(row.payments),
      collected: money(n(row.collected)),
      refunded: money(n(row.refunded)),
      net: money(n(row.collected) - n(row.refunded)),
    }));
    const shared = withShare(items, (item) => item.net);
    const net = (wallet: boolean) =>
      money(items.filter((item) => (item.mode === 'wallet') === wallet).reduce((sum, item) => sum + item.net, 0));
    return {
      ...range,
      rows: shared,
      wallet_vs_cash: { wallet: net(true), cash_and_other: net(false) },
    };
  }

  async slots(schoolId: number, from?: string, to?: string): Promise<SlotsReportDto> {
    const range = this.range(from, to);
    const rows = await this.rows(
      `SELECT COALESCE(o.slot, 'unspecified') AS slot, COUNT(*)::int AS orders,
              COALESCE(SUM(o.total_amount) FILTER (WHERE o.payment_status = 'paid'), 0) AS revenue,
              COUNT(*) FILTER (WHERE o.payment_status = 'paid')::int AS paid_orders
       FROM canteen_orders o
       WHERE ${LIVE}
       GROUP BY COALESCE(o.slot, 'unspecified')
       ORDER BY revenue DESC, slot`,
      [schoolId, range.from, range.to],
    );
    return {
      ...range,
      rows: rows.map((row) => ({
        slot: String(row.slot),
        orders: n(row.orders),
        revenue: money(n(row.revenue)),
        average_order_value: n(row.paid_orders) ? money(n(row.revenue) / n(row.paid_orders)) : 0,
      })),
    };
  }

  async peakHours(schoolId: number, from?: string, to?: string): Promise<PeakHoursReportDto> {
    const range = this.range(from, to);
    const rows = await this.rows(
      `SELECT EXTRACT(HOUR FROM o.created_at AT TIME ZONE $4)::int AS hour, COUNT(*)::int AS orders,
              COALESCE(SUM(o.total_amount) FILTER (WHERE o.payment_status = 'paid'), 0) AS revenue
       FROM canteen_orders o
       WHERE ${LIVE}
       GROUP BY 1`,
      [schoolId, range.from, range.to, this.app.timeZone],
    );
    const byHour = new Map(rows.map((row) => [n(row.hour), row]));
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      orders: n(byHour.get(hour)?.orders),
      revenue: money(n(byHour.get(hour)?.revenue)),
    }));
    const busiest = hours.reduce((best, hour) => (hour.orders > best.orders ? hour : best), hours[0]!);
    return { ...range, peak_hour: busiest.orders > 0 ? busiest.hour : null, rows: hours };
  }

  async wallet(schoolId: number, from?: string, to?: string): Promise<WalletReportDto> {
    const range = this.range(from, to);
    const day = 'CAST(t.created_at AT TIME ZONE $4 AS date)';
    const params = [schoolId, range.from, range.to, this.app.timeZone];
    const person = `COALESCE(NULLIF(TRIM(st.first_name || ' ' || COALESCE(st.last_name, '')), ''), u.name, d.card_no)`;
    const joins = `LEFT JOIN students st ON st.id = d.student_id
                   LEFT JOIN staff sf ON sf.id = d.staff_id
                   LEFT JOIN users u ON u.id = sf.user_id`;
    const [totals, spenders, low] = await Promise.all([
      this.one(
        `SELECT COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'topup'), 0) AS topups,
                COALESCE(ABS(SUM(t.amount) FILTER (WHERE t.kind = 'purchase')), 0) AS spend,
                COALESCE(ABS(SUM(t.amount) FILTER (WHERE t.kind = 'refund')), 0) AS refunds,
                COALESCE((SELECT SUM(d.wallet_balance) FROM canteen_diners d
                          WHERE d.school_id = $1 AND d.deleted_at IS NULL AND d.status <> 'left' AND d.wallet_balance > 0), 0) AS liability
         FROM canteen_wallet_transactions t
         WHERE t.school_id = $1 AND t.deleted_at IS NULL AND ${day} BETWEEN $2 AND $3`,
        params,
      ),
      this.rows(
        `SELECT d.id AS diner_id, d.card_no, ${person} AS name, ABS(SUM(t.amount)) AS amount
         FROM canteen_wallet_transactions t
         JOIN canteen_diners d ON d.id = t.diner_id AND d.school_id = t.school_id
         ${joins}
         WHERE t.school_id = $1 AND t.deleted_at IS NULL AND t.kind = 'purchase' AND ${day} BETWEEN $2 AND $3
         GROUP BY d.id, d.card_no, st.first_name, st.last_name, u.name
         ORDER BY amount DESC, d.id
         LIMIT ${TOP}`,
        params,
      ),
      this.rows(
        `SELECT d.id AS diner_id, d.card_no, ${person} AS name, d.wallet_balance AS amount
         FROM canteen_diners d
         ${joins}
         WHERE d.school_id = $1 AND d.deleted_at IS NULL AND d.status = 'active'
           AND d.wallet_balance < COALESCE((SELECT s.low_balance_limit FROM canteen_settings s
                                            WHERE s.school_id = $1 AND s.deleted_at IS NULL), 50)
         ORDER BY d.wallet_balance ASC, d.id
         LIMIT 50`,
        [schoolId],
      ),
    ]);
    const mapPerson = (row: Row) => ({
      diner_id: n(row.diner_id),
      card_no: String(row.card_no),
      name: String(row.name),
      amount: money(n(row.amount)),
    });
    return {
      ...range,
      topups: money(n(totals.topups)),
      spend: money(n(totals.spend)),
      refunds: money(n(totals.refunds)),
      liability: money(n(totals.liability)),
      top_spenders: spenders.map(mapPerson),
      low_balance: low.map(mapPerson),
    };
  }

  async stock(schoolId: number, from?: string, to?: string): Promise<StockReportDto> {
    const range = this.range(from, to);
    const day = 'CAST(m.created_at AT TIME ZONE $4 AS date)';
    const [items, consumption] = await Promise.all([
      this.rows(
        `SELECT i.id, i.name, i.unit, i.quantity_on_hand, i.reorder_level, i.cost_per_unit
         FROM canteen_stock_items i
         WHERE i.school_id = $1 AND i.deleted_at IS NULL AND i.active = true
         ORDER BY i.name, i.id`,
        [schoolId],
      ),
      this.rows(
        `SELECT i.id, i.name, i.unit,
                COALESCE(SUM(ABS(m.quantity)) FILTER (WHERE m.kind = 'issue'), 0) AS issued,
                COALESCE(SUM(ABS(m.quantity)) FILTER (WHERE m.kind = 'wastage'), 0) AS wasted,
                COALESCE(SUM(ABS(m.quantity) * COALESCE(m.unit_cost, i.cost_per_unit)), 0) AS cost
         FROM canteen_stock_movements m
         JOIN canteen_stock_items i ON i.id = m.stock_item_id AND i.school_id = m.school_id
         WHERE m.school_id = $1 AND m.deleted_at IS NULL AND m.kind IN ('issue', 'wastage')
           AND ${day} BETWEEN $2 AND $3
         GROUP BY i.id, i.name, i.unit
         ORDER BY cost DESC, i.name
         LIMIT 50`,
        [schoolId, range.from, range.to, this.app.timeZone],
      ),
    ]);
    const valued = items.map((row) => ({
      stock_item_id: n(row.id),
      name: String(row.name),
      unit: String(row.unit),
      quantity_on_hand: n(row.quantity_on_hand),
      reorder_level: n(row.reorder_level),
      cost_per_unit: n(row.cost_per_unit),
      value: money(n(row.quantity_on_hand) * n(row.cost_per_unit)),
      status: stockStatus(n(row.quantity_on_hand), n(row.reorder_level)),
    }));
    return {
      ...range,
      valuation: money(valued.reduce((sum, item) => sum + Math.max(item.value, 0), 0)),
      low_items: valued.filter((item) => item.status === 'low').length,
      out_items: valued.filter((item) => item.status === 'out').length,
      attention_items: valued.filter((item) => item.status !== 'ok'),
      consumption: consumption.map((row) => ({
        stock_item_id: n(row.id),
        name: String(row.name),
        unit: String(row.unit),
        issued: n(row.issued),
        wasted: n(row.wasted),
        cost: money(n(row.cost)),
      })),
    };
  }

  private receivedFrom(join = ''): string {
    return `FROM canteen_purchase_lines l
       JOIN canteen_purchase_orders po ON po.id = l.purchase_order_id AND po.school_id = l.school_id
       ${join}
       WHERE l.school_id = $1 AND l.deleted_at IS NULL AND po.deleted_at IS NULL
         AND po.status IN ('partial', 'received')
         AND COALESCE(CAST(po.received_at AT TIME ZONE $4 AS date), po.order_date) BETWEEN $2 AND $3`;
  }

  async purchases(schoolId: number, from?: string, to?: string): Promise<PurchasesReportDto> {
    const range = this.range(from, to);
    const params = [schoolId, range.from, range.to, this.app.timeZone];
    const [suppliers, days] = await Promise.all([
      this.rows(
        `SELECT po.supplier_id, COALESCE(s.name, 'Unknown supplier') AS name,
                COUNT(DISTINCT po.id)::int AS orders, COALESCE(SUM(l.received_quantity * l.unit_cost), 0) AS spend
         ${this.receivedFrom('LEFT JOIN canteen_suppliers s ON s.id = po.supplier_id AND s.school_id = po.school_id')}
         GROUP BY po.supplier_id, s.name
         ORDER BY spend DESC, name`,
        params,
      ),
      this.rows(
        `SELECT CAST(COALESCE(CAST(po.received_at AT TIME ZONE $4 AS date), po.order_date) AS text) AS date,
                COUNT(DISTINCT po.id)::int AS orders, COALESCE(SUM(l.received_quantity * l.unit_cost), 0) AS spend
         ${this.receivedFrom()}
         GROUP BY 1
         ORDER BY 1`,
        params,
      ),
    ]);
    return {
      ...range,
      total_spend: money(days.reduce((sum, row) => sum + n(row.spend), 0)),
      by_supplier: suppliers.map((row) => ({
        supplier_id: n(row.supplier_id),
        name: String(row.name),
        orders: n(row.orders),
        spend: money(n(row.spend)),
      })),
      by_day: days.map((row) => ({ date: String(row.date), orders: n(row.orders), spend: money(n(row.spend)) })),
    };
  }

  private async revenue(schoolId: number, range: DateRange): Promise<number> {
    const row = await this.one(
      `SELECT COALESCE(SUM(o.total_amount), 0) AS revenue
       FROM canteen_orders o
       WHERE ${LIVE} AND o.payment_status = 'paid'`,
      [schoolId, range.from, range.to],
    );
    return money(n(row.revenue));
  }

  private async wasteCost(schoolId: number, range: DateRange): Promise<number> {
    const row = await this.one(
      `SELECT COALESCE(SUM(w.cost), 0) AS cost
       FROM canteen_waste_logs w
       WHERE w.school_id = $1 AND w.deleted_at IS NULL AND w.waste_date BETWEEN $2 AND $3`,
      [schoolId, range.from, range.to],
    );
    return money(n(row.cost));
  }

  async waste(schoolId: number, from?: string, to?: string): Promise<WasteReportDto> {
    const range = this.range(from, to);
    const params = [schoolId, range.from, range.to];
    const [reasons, items, revenue] = await Promise.all([
      this.rows(
        `SELECT w.reason, COUNT(*)::int AS entries, COALESCE(SUM(w.cost), 0) AS cost
         FROM canteen_waste_logs w
         WHERE w.school_id = $1 AND w.deleted_at IS NULL AND w.waste_date BETWEEN $2 AND $3
         GROUP BY w.reason ORDER BY cost DESC, w.reason`,
        params,
      ),
      this.rows(
        `SELECT w.item_name, COALESCE(SUM(w.quantity), 0) AS quantity, COALESCE(SUM(w.cost), 0) AS cost
         FROM canteen_waste_logs w
         WHERE w.school_id = $1 AND w.deleted_at IS NULL AND w.waste_date BETWEEN $2 AND $3
         GROUP BY w.item_name ORDER BY cost DESC, w.item_name LIMIT ${TOP}`,
        params,
      ),
      this.revenue(schoolId, range),
    ]);
    const total = money(reasons.reduce((sum, row) => sum + n(row.cost), 0));
    return {
      ...range,
      total_cost: total,
      waste_percent_of_sales: percent(total, revenue),
      by_reason: reasons.map((row) => ({
        reason: String(row.reason),
        entries: n(row.entries),
        cost: money(n(row.cost)),
      })),
      by_item: items.map((row) => ({
        item_name: String(row.item_name),
        quantity: n(row.quantity),
        cost: money(n(row.cost)),
      })),
    };
  }

  async staff(schoolId: number, from?: string, to?: string): Promise<StaffReportDto> {
    const range = this.range(from, to);
    const rows = await this.rows(
      `SELECT s.id, s.name, s.role, s.daily_wage,
              COUNT(*) FILTER (WHERE a.status = 'present')::int AS present,
              COUNT(*) FILTER (WHERE a.status = 'half_day')::int AS half_day,
              COUNT(*) FILTER (WHERE a.status = 'absent')::int AS absent,
              COUNT(*) FILTER (WHERE a.status = 'leave')::int AS leave
       FROM canteen_staff s
       LEFT JOIN canteen_staff_attendance a
         ON a.canteen_staff_id = s.id AND a.school_id = s.school_id AND a.deleted_at IS NULL
        AND a.attendance_date BETWEEN $2 AND $3
       WHERE s.school_id = $1 AND s.deleted_at IS NULL AND s.status = 'active'
       GROUP BY s.id, s.name, s.role, s.daily_wage
       ORDER BY s.name, s.id`,
      [schoolId, range.from, range.to],
    );
    const items = rows.map((row) => {
      const present = n(row.present);
      const half = n(row.half_day);
      const absent = n(row.absent);
      const leave = n(row.leave);
      return {
        canteen_staff_id: n(row.id),
        name: String(row.name),
        role: String(row.role),
        present,
        half_day: half,
        absent,
        leave,
        attendance_rate: attendanceRate(present, half, present + half + absent + leave),
        wage_cost: wageEstimate({
          present,
          half_day: half,
          daily_wage: row.daily_wage === null ? null : n(row.daily_wage),
        }),
      };
    });
    return { ...range, wage_cost: money(items.reduce((sum, item) => sum + item.wage_cost, 0)), rows: items };
  }

  async feedback(schoolId: number, from?: string, to?: string): Promise<FeedbackReportDto> {
    const range = this.range(from, to);
    const day = 'CAST(f.created_at AT TIME ZONE $4 AS date)';
    const params = [schoolId, range.from, range.to, this.app.timeZone];
    const [trend, complaints, categories] = await Promise.all([
      this.rows(
        `SELECT CAST(${day} AS text) AS date, COUNT(*)::int AS count, ROUND(AVG(f.rating), 2) AS average_rating
         FROM canteen_feedback f
         WHERE f.school_id = $1 AND f.deleted_at IS NULL AND f.rating IS NOT NULL AND ${day} BETWEEN $2 AND $3
         GROUP BY 1 ORDER BY 1`,
        params,
      ),
      this.rows(
        `SELECT f.created_at, f.resolved_at
         FROM canteen_feedback f
         WHERE f.school_id = $1 AND f.deleted_at IS NULL AND f.kind = 'complaint' AND ${day} BETWEEN $2 AND $3`,
        params,
      ),
      this.rows(
        `SELECT f.category AS key, COUNT(*)::int AS count
         FROM canteen_feedback f
         WHERE f.school_id = $1 AND f.deleted_at IS NULL AND ${day} BETWEEN $2 AND $3
         GROUP BY f.category ORDER BY count DESC, key`,
        params,
      ),
    ]);
    const spans = complaints.map((row) => ({
      created_at: new Date(row.created_at as string | Date),
      resolved_at: row.resolved_at ? new Date(row.resolved_at as string | Date) : null,
    }));
    const resolved = spans.filter((span) => span.resolved_at !== null).length;
    const counted = trend.reduce((sum, row) => sum + n(row.count), 0);
    const weighted = trend.reduce((sum, row) => sum + n(row.count) * n(row.average_rating), 0);
    return {
      ...range,
      average_rating: counted ? money(weighted / counted) : null,
      ratings_trend: trend.map((row) => ({
        date: String(row.date),
        count: n(row.count),
        average_rating: row.average_rating === null ? null : n(row.average_rating),
      })),
      complaints: {
        total: spans.length,
        resolved,
        unresolved: spans.length - resolved,
        average_resolution_hours: averageResolutionHours(spans),
      },
      by_category: categories.map((row) => ({ key: String(row.key), count: n(row.count) })),
    };
  }

  async profit(schoolId: number, from?: string, to?: string): Promise<ProfitSummaryDto> {
    const range = this.range(from, to);
    const [revenue, purchases, waste, staff] = await Promise.all([
      this.revenue(schoolId, range),
      this.purchases(schoolId, range.from, range.to),
      this.wasteCost(schoolId, range),
      this.staff(schoolId, range.from, range.to),
    ]);
    return {
      ...range,
      revenue,
      purchases: purchases.total_spend,
      waste,
      wages: staff.wage_cost,
      profit: profitOf(revenue, purchases.total_spend, waste, staff.wage_cost),
    };
  }
}
