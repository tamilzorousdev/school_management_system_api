import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { weekday } from '../../shared/school-days';
import { INVENTORY_TEMPLATES } from '../notifications/inventory-templates.catalog';
import { daysBetween } from './inventory.logic';
import { INVENTORY_OFFICE_ROLES, InventoryNotifyService } from './inventory-notify.service';
import { InventoryReadService } from './inventory-read.service';

export interface InventoryAlertResult {
  overdue_returns: number;
  maintenance_due: number;
  warranty_expiring: number;
  low_stock: number;
}

const list = (names: string[], max = 6) =>
  names.length > max ? `${names.slice(0, max).join(', ')} and ${names.length - max} more` : names.join(', ');

@Injectable()
export class InventoryAlertsService {
  private readonly logger = new Logger('InventoryAlerts');
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly read: InventoryReadService,
    private readonly notify: InventoryNotifyService,
  ) {}

  @Cron('15 8 * * *', { name: 'inventory-alerts', timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' })
  async daily(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const schools: { school_id: number }[] = await this.dataSource.query(
        `SELECT DISTINCT school_id FROM assets WHERE deleted_at IS NULL
         UNION SELECT DISTINCT school_id FROM stock_items WHERE deleted_at IS NULL`,
      );
      for (const { school_id: schoolId } of schools) {
        const result = await this.runSchool(Number(schoolId));
        const total = Object.values(result).reduce((sum, value) => sum + value, 0);
        if (total) this.logger.log(`School ${schoolId}: ${JSON.stringify(result)}`);
      }
    } catch (error) {
      this.logger.error(`Inventory alert round failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async runSchool(schoolId: number, force = false): Promise<InventoryAlertResult> {
    const context = await this.read.context(schoolId);
    const today = context.today;
    const result: InventoryAlertResult = { overdue_returns: 0, maintenance_due: 0, warranty_expiring: 0, low_stock: 0 };

    const overdue: { id: number; user_id: number; expected: string; tag: string; name: string }[] =
      await this.dataSource.query(
        `SELECT al.id, al.user_id, al.expected_return_on::text AS expected, a.asset_tag AS tag, a.name
       FROM asset_allocations al JOIN assets a ON a.id = al.asset_id
       WHERE al.school_id = $1 AND al.status = 'active' AND al.deleted_at IS NULL AND al.assignee_type = 'staff'
         AND al.expected_return_on < $2::date`,
        [schoolId, today],
      );
    for (const row of overdue) {
      const late = daysBetween(row.expected, today);
      if (!force && late % 7 !== 1) continue;
      await this.notify.users([Number(row.user_id)], INVENTORY_TEMPLATES.INVENTORY_RETURN_DUE, {
        asset: row.name,
        tag: row.tag,
        due_date: row.expected,
        allocation_id: String(row.id),
      });
      result.overdue_returns += 1;
    }

    const alertDays = context.settings.maintenance_alert_days;
    const due: { title: string; tag: string; next_due: string }[] = await this.dataSource.query(
      `SELECT ms.title, a.asset_tag AS tag, ms.next_due_on::text AS next_due
       FROM asset_maintenance_schedules ms JOIN assets a ON a.id = ms.asset_id AND a.deleted_at IS NULL AND a.status <> 'disposed'
       WHERE ms.school_id = $1 AND ms.deleted_at IS NULL AND ms.is_active
         AND ${force ? `ms.next_due_on <= $2::date + $3::int` : `(ms.next_due_on = $2::date + $3::int OR ms.next_due_on = $2::date)`}
         AND NOT EXISTS (SELECT 1 FROM asset_maintenance_tickets t WHERE t.schedule_id = ms.id AND t.status IN ('open', 'in_progress') AND t.deleted_at IS NULL)
       ORDER BY ms.next_due_on`,
      [schoolId, today, alertDays],
    );
    if (due.length) {
      await this.notify.roles(schoolId, INVENTORY_OFFICE_ROLES, INVENTORY_TEMPLATES.INVENTORY_MAINTENANCE_DUE, {
        count: String(due.length),
        date: due[due.length - 1]!.next_due,
        list: list(due.map((row) => `${row.title} (${row.tag}, ${row.next_due})`)),
      });
      result.maintenance_due = due.length;
    }

    const warrantyDays = context.settings.warranty_alert_days;
    const expiring: { tag: string; name: string; ends: string }[] = await this.dataSource.query(
      `SELECT a.asset_tag AS tag, a.name,
              GREATEST(COALESCE(a.warranty_until, '0001-01-01'::date), COALESCE(a.amc_until, '0001-01-01'::date))::text AS ends
       FROM assets a WHERE a.school_id = $1 AND a.deleted_at IS NULL AND a.status <> 'disposed'
         AND GREATEST(COALESCE(a.warranty_until, '0001-01-01'::date), COALESCE(a.amc_until, '0001-01-01'::date))
             ${force ? 'BETWEEN $2::date AND $2::date + $3::int' : '= $2::date + $3::int'}
       ORDER BY ends`,
      [schoolId, today, warrantyDays],
    );
    if (expiring.length) {
      await this.notify.roles(schoolId, INVENTORY_OFFICE_ROLES, INVENTORY_TEMPLATES.INVENTORY_WARRANTY_EXPIRING, {
        count: String(expiring.length),
        days: String(warrantyDays),
        list: list(expiring.map((row) => `${row.name} (${row.tag}, ${row.ends})`)),
      });
      result.warranty_expiring = expiring.length;
    }

    if (force || weekday(today) === 1) {
      const low: { name: string; quantity: string; unit: string }[] = await this.dataSource.query(
        `SELECT i.name, i.unit, COALESCE(SUM(b.quantity), 0) AS quantity FROM stock_items i
         LEFT JOIN stock_balances b ON b.item_id = i.id
         WHERE i.school_id = $1 AND i.deleted_at IS NULL AND i.is_active
         GROUP BY i.id HAVING COALESCE(SUM(b.quantity), 0) <= i.reorder_level ORDER BY i.name`,
        [schoolId],
      );
      if (low.length) {
        await this.notify.roles(schoolId, INVENTORY_OFFICE_ROLES, INVENTORY_TEMPLATES.INVENTORY_LOW_STOCK, {
          count: String(low.length),
          list: list(low.map((row) => `${row.name} (${Number(row.quantity)} ${row.unit})`)),
        });
        result.low_stock = low.length;
      }
    }
    return result;
  }
}
