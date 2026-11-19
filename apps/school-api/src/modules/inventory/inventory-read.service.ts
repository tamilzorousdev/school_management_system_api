import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AppException, escapeLike, paginate, Paginated, searchTerms } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { FilesService } from '../files/files.service';
import { AllocationDto, AssetDto, AssetQueryDto, AssigneeDto, WarrantyState } from './dto/asset.dto';
import { InventorySettingsDto } from './dto/master.dto';
import {
  AssetCondition,
  AssetEvent,
  AssetEventKind,
  AssetStatus,
  AssigneeType,
  FundingSource,
} from './entities/asset.entity';
import { InventorySettings } from './entities/master.entity';
import { bookValue, daysBetween } from './inventory.logic';

export interface SqlFilter {
  where: string[];
  params: unknown[];
}

export type Row = Record<string, unknown>;

export const param = (filter: SqlFilter, value: unknown): string => {
  filter.params.push(value);
  return `$${filter.params.length}`;
};

export function addSearch(filter: SqlFilter, search: string | undefined, columns: string[]): void {
  for (const term of searchTerms(search)) {
    const key = param(filter, `%${escapeLike(term)}%`);
    filter.where.push(`(${columns.map((column) => `${column} ILIKE ${key}`).join(' OR ')})`);
  }
}

export function orderBy(
  sorts: Record<string, string>,
  sort: string | undefined,
  fallback: string,
  order: string | undefined,
  tie: string,
): string {
  const column = sorts[sort ?? fallback];
  if (!column) {
    throw AppException.badRequest(`sort must be one of: ${Object.keys(sorts).join(', ')}`, 'INVALID_SORT');
  }
  return `${column} ${order === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, ${tie}`;
}

export const num = (value: unknown): number => Number(value ?? 0);
export const numOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);
export const str = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
export const ref = (id: unknown, name: unknown) =>
  id === null || id === undefined ? null : { id: num(id), name: String(name ?? '') };

export const ASSIGNEE_JOINS = (al: string, p: string) => `
  LEFT JOIN users ${p}u ON ${p}u.id = ${al}.user_id
  LEFT JOIN staff ${p}st ON ${p}st.user_id = ${al}.user_id AND ${p}st.school_id = ${al}.school_id AND ${p}st.deleted_at IS NULL
  LEFT JOIN departments ${p}d ON ${p}d.id = ${al}.department_id
  LEFT JOIN inventory_locations ${p}loc ON ${p}loc.id = ${al}.location_id`;

export const ASSIGNEE_COLUMNS = (al: string, p: string) => `
  ${al}.assignee_type AS ${p}_type, ${al}.user_id AS ${p}_user_id, ${al}.department_id AS ${p}_department_id,
  ${al}.location_id AS ${p}_location_id, ${p}u.name AS ${p}_user_name, ${p}st.designation AS ${p}_user_detail,
  ${p}st.department AS ${p}_user_department, ${p}d.name AS ${p}_department_name,
  ${p}loc.name AS ${p}_location_name, ${p}loc.building AS ${p}_location_building`;

export interface InventoryContext {
  today: string;
  settings: InventorySettingsDto;
}

const SETTINGS_DEFAULTS: InventorySettingsDto = {
  approve_transfers: true,
  approve_requisitions: true,
  approve_disposals: true,
  depreciation_method: 'straight_line',
  warranty_alert_days: 30,
  maintenance_alert_days: 7,
};

@Injectable()
export class InventoryReadService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly files: FilesService,
    @InjectRepository(InventorySettings) private readonly settingsRepo: Repository<InventorySettings>,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  today(): string {
    return todayIn(this.app.timeZone);
  }

  zone(): string {
    return this.app.timeZone;
  }

  link(fileId: unknown): string | null {
    return this.files.linkFor(fileId === null || fileId === undefined ? null : Number(fileId));
  }

  async settings(schoolId: number): Promise<InventorySettingsDto> {
    const row = await this.settingsRepo.findOneBy({ school_id: schoolId });
    if (!row) return { ...SETTINGS_DEFAULTS };
    return {
      approve_transfers: row.approve_transfers,
      approve_requisitions: row.approve_requisitions,
      approve_disposals: row.approve_disposals,
      depreciation_method: row.depreciation_method,
      warranty_alert_days: row.warranty_alert_days,
      maintenance_alert_days: row.maintenance_alert_days,
    };
  }

  async assetFilter(schoolId: number, query: AssetQueryDto): Promise<SqlFilter> {
    const filter: SqlFilter = { where: [], params: [] };
    if (query.status?.length) filter.where.push(`a.status = ANY(${param(filter, query.status)}::text[])`);
    if (query.condition) filter.where.push(`a.condition = ${param(filter, query.condition)}`);
    if (query.category_id) {
      const key = param(filter, query.category_id);
      filter.where.push(`(a.category_id = ${key} OR cat.parent_id = ${key})`);
    }
    if (query.location_id) filter.where.push(`a.location_id = ${param(filter, query.location_id)}`);
    if (query.department_id) filter.where.push(`a.department_id = ${param(filter, query.department_id)}`);
    if (query.vendor_id) filter.where.push(`a.vendor_id = ${param(filter, query.vendor_id)}`);
    if (query.funding_source) filter.where.push(`a.funding_source = ${param(filter, query.funding_source)}`);
    if (query.custodian_user_id) {
      const key = param(filter, query.custodian_user_id);
      filter.where.push(`(a.custodian_user_id = ${key} OR al.user_id = ${key})`);
    }
    if (query.warranty) {
      const settings = await this.settings(schoolId);
      filter.where.push(this.warrantySql(filter, query.warranty, settings.warranty_alert_days));
    }
    addSearch(filter, query.search, ['a.asset_tag', 'a.name', 'a.serial_no', 'a.make', 'a.model']);
    return filter;
  }

  private warrantySql(filter: SqlFilter, state: WarrantyState, days: number): string {
    const today = param(filter, this.today());
    const latest = `GREATEST(COALESCE(a.warranty_until, '0001-01-01'::date), COALESCE(a.amc_until, '0001-01-01'::date))`;
    if (state === 'none') return 'a.warranty_until IS NULL AND a.amc_until IS NULL';
    if (state === 'expired')
      return `(a.warranty_until IS NOT NULL OR a.amc_until IS NOT NULL) AND ${latest} < ${today}::date`;
    if (state === 'expiring') return `${latest} >= ${today}::date AND ${latest} <= ${today}::date + ${Number(days)}`;
    return `${latest} > ${today}::date + ${Number(days)}`;
  }

  async context(schoolId: number): Promise<InventoryContext> {
    return { today: this.today(), settings: await this.settings(schoolId) };
  }

  assignee(row: Row, p: string): AssigneeDto {
    const type = row[`${p}_type`] as AssigneeType;
    if (type === 'staff') {
      return {
        type,
        id: num(row[`${p}_user_id`]),
        name: String(row[`${p}_user_name`] ?? ''),
        detail: str(row[`${p}_user_detail`]) ?? str(row[`${p}_user_department`]),
      };
    }
    if (type === 'department') {
      return {
        type,
        id: num(row[`${p}_department_id`]),
        name: String(row[`${p}_department_name`] ?? ''),
        detail: null,
      };
    }
    return {
      type,
      id: num(row[`${p}_location_id`]),
      name: String(row[`${p}_location_name`] ?? ''),
      detail: str(row[`${p}_location_building`]),
    };
  }

  warrantyState(
    row: { warranty_until: string | null; amc_until: string | null },
    context: InventoryContext,
  ): WarrantyState {
    const ends = [row.warranty_until, row.amc_until].filter((date): date is string => Boolean(date)).sort();
    const latest = ends[ends.length - 1];
    if (!latest) return 'none';
    if (latest < context.today) return 'expired';
    return daysBetween(context.today, latest) <= context.settings.warranty_alert_days ? 'expiring' : 'active';
  }

  assetSql(filter: SqlFilter, tail: string): string {
    return `
      SELECT a.id, a.asset_tag, a.name, a.category_id, cat.name AS category_name, cat.depreciation_rate,
             cat.useful_life_years, a.make, a.model, a.serial_no, a.description, a.vendor_id, v.name AS vendor_name,
             a.invoice_no, a.invoice_file_id, a.purchase_date::text AS purchase_date, a.cost, a.residual_value,
             a.warranty_until::text AS warranty_until, a.amc_until::text AS amc_until, a.amc_vendor_id,
             av.name AS amc_vendor_name, a.funding_source, a.condition, a.status, a.location_id,
             l.name AS location_name, a.department_id, d.name AS department_name, a.custodian_user_id,
             cu.name AS custodian_name, cst.designation AS custodian_detail, a.store_id, s.name AS store_name,
             a.photo_file_id, a.notes, a.created_at,
             al.id AS al_id, al.allocated_on::text AS al_allocated_on, al.expected_return_on::text AS al_expected,
             al.acknowledged_at AS al_acknowledged_at, ${ASSIGNEE_COLUMNS('al', 'al')},
             (SELECT COUNT(*) FROM asset_maintenance_tickets t WHERE t.asset_id = a.id AND t.deleted_at IS NULL
                AND t.status IN ('open', 'in_progress'))::int AS open_tickets,
             (SELECT MIN(ms.next_due_on)::text FROM asset_maintenance_schedules ms WHERE ms.asset_id = a.id
                AND ms.is_active AND ms.deleted_at IS NULL) AS next_maintenance_on
      FROM assets a
      JOIN inventory_categories cat ON cat.id = a.category_id
      LEFT JOIN inventory_vendors v ON v.id = a.vendor_id
      LEFT JOIN inventory_vendors av ON av.id = a.amc_vendor_id
      LEFT JOIN inventory_locations l ON l.id = a.location_id
      LEFT JOIN departments d ON d.id = a.department_id
      LEFT JOIN users cu ON cu.id = a.custodian_user_id
      LEFT JOIN staff cst ON cst.user_id = a.custodian_user_id AND cst.school_id = a.school_id AND cst.deleted_at IS NULL
      LEFT JOIN inventory_stores s ON s.id = a.store_id
      LEFT JOIN asset_allocations al ON al.asset_id = a.id AND al.status = 'active' AND al.deleted_at IS NULL
      ${ASSIGNEE_JOINS('al', 'al')}
      WHERE a.deleted_at IS NULL ${filter.where.length ? `AND ${filter.where.join(' AND ')}` : ''}
      ${tail}`;
  }

  presentAsset(row: Row, context: InventoryContext): AssetDto {
    const purchaseDate = str(row.purchase_date);
    const cost = numOrNull(row.cost);
    const warranty = { warranty_until: str(row.warranty_until), amc_until: str(row.amc_until) };
    const expected = str(row.al_expected);
    return {
      id: num(row.id),
      asset_tag: String(row.asset_tag),
      name: String(row.name),
      category: { id: num(row.category_id), name: String(row.category_name) },
      make: str(row.make),
      model: str(row.model),
      serial_no: str(row.serial_no),
      description: str(row.description),
      vendor: ref(row.vendor_id, row.vendor_name),
      invoice_no: str(row.invoice_no),
      invoice_file_id: numOrNull(row.invoice_file_id),
      invoice_url: this.link(row.invoice_file_id),
      purchase_date: purchaseDate,
      cost,
      residual_value: numOrNull(row.residual_value),
      book_value:
        row.status === 'disposed'
          ? 0
          : bookValue(
              {
                cost,
                residual_value: numOrNull(row.residual_value),
                purchase_date: purchaseDate,
                rate: numOrNull(row.depreciation_rate),
                useful_life_years: numOrNull(row.useful_life_years),
                method: context.settings.depreciation_method,
              },
              context.today,
            ),
      warranty_until: warranty.warranty_until,
      warranty_state: this.warrantyState(warranty, context),
      amc_until: warranty.amc_until,
      amc_vendor: ref(row.amc_vendor_id, row.amc_vendor_name),
      funding_source: row.funding_source as FundingSource,
      condition: row.condition as AssetCondition,
      status: row.status as AssetStatus,
      location: ref(row.location_id, row.location_name),
      department: ref(row.department_id, row.department_name),
      custodian: row.custodian_user_id
        ? { id: num(row.custodian_user_id), name: String(row.custodian_name ?? ''), detail: str(row.custodian_detail) }
        : null,
      store: ref(row.store_id, row.store_name),
      current_allocation: row.al_id
        ? {
            id: num(row.al_id),
            assignee: this.assignee(row, 'al'),
            allocated_on: String(row.al_allocated_on),
            expected_return_on: expected,
            acknowledged_at: (row.al_acknowledged_at as Date | null) ?? null,
            overdue: Boolean(expected && expected < context.today),
          }
        : null,
      photo_file_id: numOrNull(row.photo_file_id),
      photo_url: this.link(row.photo_file_id),
      notes: str(row.notes),
      open_tickets: num(row.open_tickets),
      next_maintenance_on: str(row.next_maintenance_on),
      created_at: row.created_at as Date,
    };
  }

  async assets(
    schoolId: number,
    filter: SqlFilter,
    order = 'a.asset_tag',
    manager?: EntityManager,
  ): Promise<AssetDto[]> {
    const scoped: SqlFilter = { where: [...filter.where], params: [...filter.params] };
    scoped.where.unshift(`a.school_id = ${param(scoped, schoolId)}`);
    const rows: Row[] = await (manager ?? this.dataSource.manager).query(
      this.assetSql(scoped, `ORDER BY ${order}`),
      scoped.params,
    );
    const context = await this.context(schoolId);
    return rows.map((row) => this.presentAsset(row, context));
  }

  async assetPage(
    schoolId: number,
    filter: SqlFilter,
    order: string,
    page: number,
    limit: number,
  ): Promise<Paginated<AssetDto>> {
    const scoped: SqlFilter = { where: [...filter.where], params: [...filter.params] };
    scoped.where.unshift(`a.school_id = ${param(scoped, schoolId)}`);
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM (${this.assetSql(scoped, '')}) counted`,
      scoped.params,
    );
    const rows: Row[] = await this.dataSource.query(
      this.assetSql(scoped, `ORDER BY ${order} LIMIT ${Number(limit)} OFFSET ${(page - 1) * limit}`),
      scoped.params,
    );
    const context = await this.context(schoolId);
    return paginate([rows.map((row) => this.presentAsset(row, context)), Number(total)], page, limit);
  }

  allocationSql(filter: SqlFilter, tail: string): string {
    return `
      SELECT al.id, al.asset_id, a.asset_tag, a.name AS asset_name, al.allocated_on::text AS allocated_on,
             al.expected_return_on::text AS expected_return_on, al.acknowledged_at, al.returned_on::text AS returned_on,
             al.return_condition, al.status, al.remarks, ab.name AS allocated_by_name, rb.name AS returned_by_name,
             ${ASSIGNEE_COLUMNS('al', 'al')}
      FROM asset_allocations al
      JOIN assets a ON a.id = al.asset_id
      ${ASSIGNEE_JOINS('al', 'al')}
      LEFT JOIN users ab ON ab.id = al.allocated_by
      LEFT JOIN users rb ON rb.id = al.returned_by
      WHERE al.deleted_at IS NULL ${filter.where.length ? `AND ${filter.where.join(' AND ')}` : ''}
      ${tail}`;
  }

  presentAllocation(row: Row, today: string): AllocationDto {
    const expected = str(row.expected_return_on);
    return {
      id: num(row.id),
      asset: { id: num(row.asset_id), name: `${row.asset_tag} · ${row.asset_name}` },
      asset_tag: String(row.asset_tag),
      assignee: this.assignee(row, 'al'),
      allocated_on: String(row.allocated_on),
      expected_return_on: expected,
      acknowledged_at: (row.acknowledged_at as Date | null) ?? null,
      returned_on: str(row.returned_on),
      return_condition: (row.return_condition as AssetCondition | null) ?? null,
      status: row.status as 'active' | 'returned',
      overdue: row.status === 'active' && Boolean(expected && expected < today),
      allocated_by: str(row.allocated_by_name),
      returned_by: str(row.returned_by_name),
      remarks: str(row.remarks),
    };
  }

  async allocations(
    schoolId: number,
    filter: SqlFilter,
    order = 'al.allocated_on DESC, al.id DESC',
    limit?: number,
    manager?: EntityManager,
  ): Promise<AllocationDto[]> {
    const scoped: SqlFilter = { where: [...filter.where], params: [...filter.params] };
    scoped.where.unshift(`al.school_id = ${param(scoped, schoolId)}`);
    const rows: Row[] = await (manager ?? this.dataSource.manager).query(
      this.allocationSql(scoped, `ORDER BY ${order}${limit ? ` LIMIT ${Number(limit)}` : ''}`),
      scoped.params,
    );
    const today = this.today();
    return rows.map((row) => this.presentAllocation(row, today));
  }

  async allocationPage(schoolId: number, filter: SqlFilter, order: string, page: number, limit: number) {
    const scoped: SqlFilter = { where: [...filter.where], params: [...filter.params] };
    scoped.where.unshift(`al.school_id = ${param(scoped, schoolId)}`);
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM (${this.allocationSql(scoped, '')}) counted`,
      scoped.params,
    );
    const rows: Row[] = await this.dataSource.query(
      this.allocationSql(scoped, `ORDER BY ${order} LIMIT ${Number(limit)} OFFSET ${(page - 1) * limit}`),
      scoped.params,
    );
    const today = this.today();
    return paginate([rows.map((row) => this.presentAllocation(row, today)), Number(total)], page, limit);
  }

  async logEvents(
    manager: EntityManager,
    events: {
      school_id: number;
      asset_id: number;
      kind: AssetEventKind;
      note?: string | null;
      ref_type?: string | null;
      ref_id?: number | null;
      actor_id?: number | null;
    }[],
  ): Promise<void> {
    if (!events.length) return;
    await manager.insert(
      AssetEvent,
      events.map((event) => ({
        school_id: event.school_id,
        asset_id: event.asset_id,
        kind: event.kind,
        note: event.note ? event.note.slice(0, 500) : null,
        ref_type: event.ref_type ?? null,
        ref_id: event.ref_id ?? null,
        actor_id: event.actor_id ?? null,
      })),
    );
  }

  async schoolInfo(
    manager: EntityManager,
    schoolId: number,
  ): Promise<{ code: string; name: string; address: string | null }> {
    const [row]: { code: string; name: string; address: string | null }[] = await manager.query(
      `SELECT code, name, NULLIF(CONCAT_WS(', ', address, city, pincode), '') AS address FROM schools WHERE id = $1`,
      [schoolId],
    );
    return row ?? { code: 'SCH', name: 'School', address: null };
  }
}
