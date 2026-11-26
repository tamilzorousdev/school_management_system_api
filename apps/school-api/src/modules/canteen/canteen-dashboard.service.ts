import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { addDays } from './canteen-people.logic';
import { money } from './canteen.logic';
import { CanteenDashboardDto } from './dto/canteen-reports.dto';

type Row = Record<string, unknown>;

const n = (value: unknown): number => Number(value ?? 0);

@Injectable()
export class CanteenDashboardService {
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

  async dashboard(schoolId: number, date = todayIn(this.app.timeZone)): Promise<CanteenDashboardDto> {
    const zone = this.app.timeZone;
    const from = addDays(date, -6);
    const [orders, sales, topItems, slots, wallet, stock, waste, complaints, staff, tables, series] = await Promise.all(
      [
        this.one(
          `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE o.status = 'placed')::int AS placed,
                COUNT(*) FILTER (WHERE o.status = 'preparing')::int AS preparing,
                COUNT(*) FILTER (WHERE o.status = 'ready')::int AS ready,
                COUNT(*) FILTER (WHERE o.status = 'served')::int AS served,
                COUNT(*) FILTER (WHERE o.status = 'cancelled')::int AS cancelled
         FROM canteen_orders o
         WHERE o.school_id = $1 AND o.deleted_at IS NULL AND o.order_date = $2`,
          [schoolId, date],
        ),
        this.one(
          `SELECT COALESCE(SUM(o.total_amount) FILTER (WHERE o.payment_status = 'paid'), 0) AS revenue,
                COUNT(*) FILTER (WHERE o.payment_status = 'paid')::int AS paid_orders,
                COALESCE(SUM(o.total_amount) FILTER (WHERE o.payment_status = 'unpaid'), 0) AS unpaid
         FROM canteen_orders o
         WHERE o.school_id = $1 AND o.deleted_at IS NULL AND o.order_date = $2 AND o.status <> 'cancelled'`,
          [schoolId, date],
        ),
        this.rows(
          `SELECT oi.name, SUM(oi.quantity)::int AS quantity, COALESCE(SUM(oi.line_total), 0) AS revenue
         FROM canteen_order_items oi
         JOIN canteen_orders o ON o.id = oi.order_id AND o.school_id = oi.school_id
         WHERE oi.school_id = $1 AND oi.deleted_at IS NULL AND o.deleted_at IS NULL
           AND o.order_date = $2 AND o.status <> 'cancelled'
         GROUP BY oi.name
         ORDER BY quantity DESC, revenue DESC, oi.name
         LIMIT 5`,
          [schoolId, date],
        ),
        this.rows(
          `SELECT COALESCE(o.slot, 'unspecified') AS slot, COUNT(*)::int AS orders,
                COALESCE(SUM(o.total_amount) FILTER (WHERE o.payment_status = 'paid'), 0) AS revenue
         FROM canteen_orders o
         WHERE o.school_id = $1 AND o.deleted_at IS NULL AND o.order_date = $2 AND o.status <> 'cancelled'
         GROUP BY COALESCE(o.slot, 'unspecified')
         ORDER BY revenue DESC, slot`,
          [schoolId, date],
        ),
        this.one(
          `SELECT
           COALESCE((SELECT SUM(d.wallet_balance) FROM canteen_diners d
                     WHERE d.school_id = $1 AND d.deleted_at IS NULL AND d.status <> 'left' AND d.wallet_balance > 0), 0) AS liability,
           COALESCE((SELECT SUM(t.amount) FROM canteen_wallet_transactions t
                     WHERE t.school_id = $1 AND t.deleted_at IS NULL AND t.kind = 'topup'
                       AND CAST(t.created_at AT TIME ZONE $3 AS date) = $2), 0) AS topups_today,
           (SELECT COUNT(*) FROM canteen_diners d
            WHERE d.school_id = $1 AND d.deleted_at IS NULL AND d.status = 'active'
              AND d.wallet_balance < COALESCE((SELECT s.low_balance_limit FROM canteen_settings s
                                               WHERE s.school_id = $1 AND s.deleted_at IS NULL), 50))::int AS low_balance`,
          [schoolId, date, zone],
        ),
        this.one(
          `SELECT COUNT(*) FILTER (WHERE i.quantity_on_hand <= i.reorder_level)::int AS low_or_out,
                COUNT(*) FILTER (WHERE i.quantity_on_hand <= 0)::int AS out_items,
                COUNT(*) FILTER (WHERE i.expiry_date IS NOT NULL AND i.quantity_on_hand > 0
                                   AND i.expiry_date BETWEEN $2::date AND $2::date + 7)::int AS expiring
         FROM canteen_stock_items i
         WHERE i.school_id = $1 AND i.deleted_at IS NULL AND i.active = true`,
          [schoolId, date],
        ),
        this.one(
          `SELECT COALESCE(SUM(w.cost), 0) AS cost
         FROM canteen_waste_logs w
         WHERE w.school_id = $1 AND w.deleted_at IS NULL AND w.waste_date = $2`,
          [schoolId, date],
        ),
        this.one(
          `SELECT COUNT(*)::int AS open_complaints
         FROM canteen_feedback f
         WHERE f.school_id = $1 AND f.deleted_at IS NULL AND f.kind = 'complaint' AND f.status IN ('open', 'in_progress')`,
          [schoolId],
        ),
        this.one(
          `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE a.status IN ('present', 'half_day'))::int AS present,
                COUNT(*) FILTER (WHERE a.status = 'absent')::int AS absent,
                COUNT(*) FILTER (WHERE a.id IS NULL)::int AS unmarked
         FROM canteen_staff s
         LEFT JOIN canteen_staff_attendance a
           ON a.canteen_staff_id = s.id AND a.school_id = s.school_id AND a.attendance_date = $2 AND a.deleted_at IS NULL
         WHERE s.school_id = $1 AND s.deleted_at IS NULL AND s.status = 'active'`,
          [schoolId, date],
        ),
        this.one(
          `SELECT COUNT(*)::int AS occupied
         FROM canteen_tables t
         WHERE t.school_id = $1 AND t.deleted_at IS NULL AND t.active = true AND t.status = 'occupied'`,
          [schoolId],
        ),
        this.rows(
          `SELECT CAST(o.order_date AS text) AS date, COUNT(*)::int AS orders,
                COALESCE(SUM(o.total_amount) FILTER (WHERE o.payment_status = 'paid'), 0) AS revenue
         FROM canteen_orders o
         WHERE o.school_id = $1 AND o.deleted_at IS NULL AND o.status <> 'cancelled'
           AND o.order_date BETWEEN $2 AND $3
         GROUP BY o.order_date`,
          [schoolId, from, date],
        ),
      ],
    );

    const byDate = new Map(series.map((row) => [String(row.date), row]));
    const paidOrders = n(sales.paid_orders);
    return {
      date,
      orders: {
        total: n(orders.total),
        placed: n(orders.placed),
        preparing: n(orders.preparing),
        ready: n(orders.ready),
        served: n(orders.served),
        cancelled: n(orders.cancelled),
      },
      sales: {
        revenue: money(n(sales.revenue)),
        average_order_value: paidOrders ? money(n(sales.revenue) / paidOrders) : 0,
        unpaid_amount: money(n(sales.unpaid)),
      },
      tokens_waiting: n(orders.placed) + n(orders.preparing) + n(orders.ready),
      top_items: topItems.map((row) => ({
        name: String(row.name),
        quantity: n(row.quantity),
        revenue: money(n(row.revenue)),
      })),
      sales_by_slot: slots.map((row) => ({
        slot: String(row.slot),
        orders: n(row.orders),
        revenue: money(n(row.revenue)),
      })),
      wallet: {
        liability: money(n(wallet.liability)),
        topups_today: money(n(wallet.topups_today)),
        low_balance_diners: n(wallet.low_balance),
      },
      stock: {
        low_or_out_items: n(stock.low_or_out),
        out_of_stock_items: n(stock.out_items),
        expiring_items: n(stock.expiring),
      },
      waste_cost: money(n(waste.cost)),
      open_complaints: n(complaints.open_complaints),
      staff: {
        total: n(staff.total),
        present: n(staff.present),
        absent: n(staff.absent),
        unmarked: n(staff.unmarked),
      },
      tables_occupied: n(tables.occupied),
      revenue_last_7_days: Array.from({ length: 7 }, (_, index) => {
        const day = addDays(from, index);
        const row = byDate.get(day);
        return { date: day, revenue: money(n(row?.revenue)), orders: n(row?.orders) };
      }),
    };
  }
}
