import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { yearClause } from '../../shared/year-context';
import { AssetDto, AssetQueryDto } from './dto/asset.dto';
import {
  ConsumptionRowDto,
  DepreciationRowDto,
  GroupQueryDto,
  GroupRowDto,
  InventoryDashboardDto,
  MaintenanceCostRowDto,
  ReportQueryDto,
  StockValuationRowDto,
} from './dto/operations.dto';
import { StockUnit } from './entities/operations.entity';
import { AssetsService } from './assets.service';
import { bookValue, round2 } from './inventory.logic';
import { InventoryReadService, num, param, Row, SqlFilter } from './inventory-read.service';
import { MaintenanceService } from './maintenance.service';
import { StockService } from './stock.service';

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csv = (header: string[], rows: unknown[][]) =>
  Buffer.from(`﻿${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}`, 'utf8');

@Injectable()
export class InventoryReportsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly read: InventoryReadService,
    private readonly assets: AssetsService,
    private readonly stock: StockService,
    private readonly maintenance: MaintenanceService,
  ) {}

  private async range(schoolId: number, query: ReportQueryDto): Promise<{ from: string; to: string }> {
    if (query.from && query.to) return { from: query.from, to: query.to };
    const [year]: { start_date: string }[] = await this.dataSource.query(
      `SELECT start_date::text AS start_date FROM academic_years y WHERE y.school_id = $1 AND ${yearClause('y')} AND y.deleted_at IS NULL LIMIT 1`,
      [schoolId],
    );
    const today = this.read.today();
    return { from: query.from ?? year?.start_date ?? `${today.slice(0, 4)}-01-01`, to: query.to ?? today };
  }

  private scopedFilter(query: ReportQueryDto, includeDisposed = false): SqlFilter {
    const filter: SqlFilter = { where: includeDisposed ? [] : [`a.status <> 'disposed'`], params: [] };
    if (query.category_id) {
      const key = param(filter, query.category_id);
      filter.where.push(`(a.category_id = ${key} OR cat.parent_id = ${key})`);
    }
    if (query.location_id) filter.where.push(`a.location_id = ${param(filter, query.location_id)}`);
    if (query.department_id) filter.where.push(`a.department_id = ${param(filter, query.department_id)}`);
    return filter;
  }

  async dashboard(schoolId: number): Promise<InventoryDashboardDto> {
    const context = await this.read.context(schoolId);
    const [counts]: Row[] = await this.dataSource.query(
      `SELECT (SELECT COUNT(*) FROM asset_maintenance_tickets WHERE school_id = $1 AND deleted_at IS NULL AND status IN ('open', 'in_progress'))::int AS open_tickets,
              (SELECT COUNT(*) FROM asset_maintenance_schedules ms JOIN assets a ON a.id = ms.asset_id AND a.deleted_at IS NULL
                 WHERE ms.school_id = $1 AND ms.deleted_at IS NULL AND ms.is_active AND ms.next_due_on <= $2::date + $3::int)::int AS maintenance_due,
              (SELECT COUNT(*) FROM asset_transfers WHERE school_id = $1 AND deleted_at IS NULL AND status = 'requested')::int AS pending_transfers,
              (SELECT COUNT(*) FROM asset_disposals WHERE school_id = $1 AND deleted_at IS NULL AND status = 'requested')::int AS pending_disposals`,
      [schoolId, context.today, context.settings.maintenance_alert_days],
    );
    const warrantyFilter: SqlFilter = { where: [`a.status <> 'disposed'`], params: [] };
    const today = param(warrantyFilter, context.today);
    warrantyFilter.where.push(
      `GREATEST(COALESCE(a.warranty_until, '0001-01-01'::date), COALESCE(a.amc_until, '0001-01-01'::date)) BETWEEN ${today}::date AND ${today}::date + ${Number(context.settings.warranty_alert_days)}`,
    );
    const [assets, stock, lowStock, due, dueSoon, warranty, overdue, requisitions, approved, transfers, disposals] =
      await Promise.all([
        this.assets.insights(schoolId),
        this.stock.insights(schoolId),
        this.stock.lowItems(schoolId, 8),
        this.maintenance.schedules(schoolId, { page: 1, limit: 8, order: 'asc', state: 'overdue' }),
        this.maintenance.schedules(schoolId, { page: 1, limit: 8, order: 'asc', state: 'due_soon' }),
        this.read.assets(
          schoolId,
          warrantyFilter,
          `LEAST(COALESCE(a.warranty_until, a.amc_until), COALESCE(a.amc_until, a.warranty_until)) ASC LIMIT 8`,
        ),
        this.assets.soonDue(schoolId),
        this.stock.requisitions(schoolId, { page: 1, limit: 8, order: 'asc', status: 'pending' }),
        this.stock.requisitions(schoolId, { page: 1, limit: 8, order: 'asc', status: 'approved' }),
        this.assets.transfers(schoolId, { page: 1, limit: 8, order: 'asc', status: 'requested' }),
        this.assets.disposals(schoolId, { page: 1, limit: 8, order: 'asc', status: 'requested' }),
      ]);
    return {
      assets,
      stock,
      open_tickets: num(counts?.open_tickets),
      maintenance_due: num(counts?.maintenance_due),
      pending_transfers: num(counts?.pending_transfers),
      pending_disposals: num(counts?.pending_disposals),
      low_stock: lowStock,
      maintenance_due_list: [...due.items, ...dueSoon.items].slice(0, 8),
      warranty_expiring: warranty,
      overdue_returns: overdue,
      requisitions: [...requisitions.items, ...approved.items].slice(0, 8),
      transfers: transfers.items,
      disposals: disposals.items,
    };
  }

  async grouped(schoolId: number, query: GroupQueryDto): Promise<GroupRowDto[]> {
    const assets = await this.read.assets(schoolId, this.scopedFilter(query, query.group_by === 'status'), 'a.id');
    const key = (asset: AssetDto): { id: number | null; name: string } => {
      if (query.group_by === 'category') return asset.category;
      if (query.group_by === 'location') return asset.location ?? { id: null, name: 'No location' };
      if (query.group_by === 'department') return asset.department ?? { id: null, name: 'No department' };
      if (query.group_by === 'custodian') {
        const holder = asset.current_allocation?.assignee;
        return holder
          ? { id: holder.id, name: `${holder.name}${holder.type === 'staff' ? '' : ` (${holder.type})`}` }
          : { id: null, name: 'In store' };
      }
      return { id: null, name: asset.status.replace('_', ' ') };
    };
    const groups = new Map<string, GroupRowDto>();
    for (const asset of assets) {
      const group = key(asset);
      const id = `${group.id}:${group.name}`;
      const row = groups.get(id) ?? {
        id: group.id,
        name: group.name,
        assets: 0,
        cost: 0,
        book_value: 0,
        allocated: 0,
        in_maintenance: 0,
      };
      row.assets += 1;
      row.cost = round2(row.cost + (asset.cost ?? 0));
      row.book_value = round2(row.book_value + (asset.book_value ?? 0));
      if (asset.status === 'allocated') row.allocated += 1;
      if (asset.status === 'in_maintenance') row.in_maintenance += 1;
      groups.set(id, row);
    }
    return [...groups.values()].sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));
  }

  async depreciation(schoolId: number, query: ReportQueryDto): Promise<DepreciationRowDto[]> {
    const range = await this.range(schoolId, query);
    const settings = await this.read.settings(schoolId);
    const filter = this.scopedFilter(query);
    filter.where.push(
      `a.cost IS NOT NULL`,
      `(a.purchase_date IS NULL OR a.purchase_date <= ${param(filter, range.to)}::date)`,
    );
    const scoped: SqlFilter = { where: [...filter.where], params: [...filter.params] };
    scoped.where.unshift(`a.school_id = ${param(scoped, schoolId)}`);
    const rows: Row[] = await this.dataSource.query(
      `SELECT a.cost, a.residual_value, a.purchase_date::text AS purchase_date, a.category_id, cat.name AS category_name,
              cat.depreciation_rate, cat.useful_life_years
       FROM assets a JOIN inventory_categories cat ON cat.id = a.category_id
       WHERE a.deleted_at IS NULL AND ${scoped.where.join(' AND ')}`,
      scoped.params,
    );
    const groups = new Map<number, DepreciationRowDto>();
    for (const row of rows) {
      const input = {
        cost: num(row.cost),
        residual_value: row.residual_value === null ? null : num(row.residual_value),
        purchase_date: row.purchase_date as string | null,
        rate: row.depreciation_rate === null ? null : num(row.depreciation_rate),
        useful_life_years: row.useful_life_years === null ? null : num(row.useful_life_years),
        method: settings.depreciation_method,
      };
      const purchased = input.purchase_date;
      const opening = purchased && purchased > range.from ? num(row.cost) : (bookValue(input, range.from) ?? 0);
      const closing = bookValue(input, range.to) ?? 0;
      const id = num(row.category_id);
      const group = groups.get(id) ?? {
        category: { id, name: String(row.category_name) },
        assets: 0,
        cost: 0,
        opening_value: 0,
        depreciation: 0,
        closing_value: 0,
      };
      group.assets += 1;
      group.cost = round2(group.cost + num(row.cost));
      group.opening_value = round2(group.opening_value + opening);
      group.closing_value = round2(group.closing_value + closing);
      group.depreciation = round2(group.opening_value - group.closing_value);
      groups.set(id, group);
    }
    return [...groups.values()].sort((a, b) => b.depreciation - a.depreciation);
  }

  async maintenanceCost(schoolId: number, query: ReportQueryDto): Promise<MaintenanceCostRowDto[]> {
    const range = await this.range(schoolId, query);
    const rows: Row[] = await this.dataSource.query(
      `SELECT cat.id, cat.name, COUNT(t.id)::int AS tickets,
              COUNT(t.id) FILTER (WHERE t.status = 'resolved')::int AS resolved,
              COALESCE(SUM(t.cost) FILTER (WHERE t.status = 'resolved'), 0) AS cost,
              AVG(EXTRACT(EPOCH FROM (t.resolved_at - t.opened_at)) / 86400) FILTER (WHERE t.status = 'resolved') AS downtime
       FROM asset_maintenance_tickets t JOIN assets a ON a.id = t.asset_id JOIN inventory_categories cat ON cat.id = a.category_id
       WHERE t.school_id = $1 AND t.deleted_at IS NULL
         AND (t.opened_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
         ${query.location_id ? 'AND a.location_id = $5' : ''}
       GROUP BY cat.id ORDER BY cost DESC, tickets DESC`,
      query.location_id
        ? [schoolId, range.from, range.to, this.read.zone(), query.location_id]
        : [schoolId, range.from, range.to, this.read.zone()],
    );
    return rows.map((row) => ({
      category: { id: num(row.id), name: String(row.name) },
      tickets: num(row.tickets),
      resolved: num(row.resolved),
      cost: num(row.cost),
      average_downtime_days: row.downtime === null ? null : Math.round(Number(row.downtime) * 10) / 10,
    }));
  }

  async consumption(schoolId: number, query: ReportQueryDto): Promise<ConsumptionRowDto[]> {
    const range = await this.range(schoolId, query);
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(
      `m.school_id = ${param(filter, schoolId)}`,
      `m.kind = 'issue'`,
      `m.deleted_at IS NULL`,
      `m.moved_on BETWEEN ${param(filter, range.from)}::date AND ${param(filter, range.to)}::date`,
    );
    if (query.department_id) filter.where.push(`m.department_id = ${param(filter, query.department_id)}`);
    if (query.category_id) {
      const key = param(filter, query.category_id);
      filter.where.push(
        `i.category_id IN (SELECT id FROM inventory_categories WHERE id = ${key} OR parent_id = ${key})`,
      );
    }
    const rows: Row[] = await this.dataSource.query(
      `SELECT m.department_id, d.name AS department_name, m.item_id, i.name AS item_name, i.unit,
              -SUM(m.quantity) AS quantity, -SUM(m.value) AS value
       FROM stock_movements m JOIN stock_items i ON i.id = m.item_id LEFT JOIN departments d ON d.id = m.department_id
       WHERE ${filter.where.join(' AND ')}
       GROUP BY m.department_id, d.name, m.item_id, i.name, i.unit
       ORDER BY d.name NULLS LAST, value DESC`,
      filter.params,
    );
    return rows.map((row) => ({
      department: row.department_id ? { id: num(row.department_id), name: String(row.department_name) } : null,
      item: { id: num(row.item_id), name: String(row.item_name) },
      unit: row.unit as StockUnit,
      quantity: num(row.quantity),
      value: num(row.value),
    }));
  }

  async stockValuation(schoolId: number, query: ReportQueryDto): Promise<StockValuationRowDto[]> {
    const rows: Row[] = await this.dataSource.query(
      `SELECT i.id, i.name, i.unit, i.reorder_level, c.id AS category_id, c.name AS category_name,
              COALESCE(SUM(b.quantity), 0) AS quantity, COALESCE(SUM(b.value), 0) AS value
       FROM stock_items i JOIN inventory_categories c ON c.id = i.category_id
       LEFT JOIN stock_balances b ON b.item_id = i.id
       WHERE i.school_id = $1 AND i.deleted_at IS NULL
         ${query.category_id ? 'AND (c.id = $2 OR c.parent_id = $2)' : ''}
       GROUP BY i.id, c.id ORDER BY value DESC, i.name`,
      query.category_id ? [schoolId, query.category_id] : [schoolId],
    );
    return rows.map((row) => {
      const quantity = num(row.quantity);
      const value = num(row.value);
      return {
        item: { id: num(row.id), name: String(row.name) },
        category: { id: num(row.category_id), name: String(row.category_name) },
        unit: row.unit as StockUnit,
        quantity,
        average_rate: quantity > 0 ? round2(value / quantity) : 0,
        value,
        reorder_level: num(row.reorder_level),
        low: quantity <= num(row.reorder_level),
      };
    });
  }

  async registerCsv(schoolId: number, query: AssetQueryDto): Promise<{ name: string; buffer: Buffer }> {
    const filter = await this.read.assetFilter(schoolId, query);
    const assets = await this.read.assets(schoolId, filter, 'a.asset_tag LIMIT 10000');
    const buffer = csv(
      [
        'Asset tag',
        'Name',
        'Category',
        'Make',
        'Model',
        'Serial no',
        'Status',
        'Condition',
        'Location',
        'Department',
        'With',
        'Allocated on',
        'Vendor',
        'Invoice no',
        'Purchase date',
        'Cost',
        'Book value',
        'Warranty until',
        'AMC until',
        'Funding',
      ],
      assets.map((asset) => [
        asset.asset_tag,
        asset.name,
        asset.category.name,
        asset.make,
        asset.model,
        asset.serial_no,
        asset.status,
        asset.condition,
        asset.location?.name,
        asset.department?.name,
        asset.current_allocation?.assignee.name,
        asset.current_allocation?.allocated_on,
        asset.vendor?.name,
        asset.invoice_no,
        asset.purchase_date,
        asset.cost,
        asset.book_value,
        asset.warranty_until,
        asset.amc_until,
        asset.funding_source,
      ]),
    );
    return { name: `asset-register-${this.read.today()}.csv`, buffer };
  }

  async movementsCsv(schoolId: number, query: ReportQueryDto): Promise<{ name: string; buffer: Buffer }> {
    const range = await this.range(schoolId, query);
    const page = await this.stock.movements(schoolId, {
      page: 1,
      limit: 100,
      order: 'asc',
      sort: 'moved_on',
      from: range.from,
      to: range.to,
      department_id: query.department_id,
    });
    const all = [...page.items];
    for (let next = 2; next <= Math.min(page.total_pages, 100); next += 1) {
      const more = await this.stock.movements(schoolId, {
        page: next,
        limit: 100,
        order: 'asc',
        sort: 'moved_on',
        from: range.from,
        to: range.to,
        department_id: query.department_id,
      });
      all.push(...more.items);
    }
    const buffer = csv(
      [
        'Date',
        'Item',
        'Unit',
        'Store',
        'Kind',
        'Quantity',
        'Rate',
        'Value',
        'Balance',
        'Reference',
        'Department',
        'Person',
        'Class',
        'Note',
        'By',
      ],
      all.map((row) => [
        row.moved_on,
        row.item.name,
        row.unit,
        row.store.name,
        row.kind,
        row.quantity,
        row.rate,
        row.value,
        row.balance_after,
        row.reference,
        row.department?.name,
        row.person,
        row.section?.name,
        row.note,
        row.by,
      ]),
    );
    return { name: `stock-ledger-${range.from}-to-${range.to}.csv`, buffer };
  }
}
