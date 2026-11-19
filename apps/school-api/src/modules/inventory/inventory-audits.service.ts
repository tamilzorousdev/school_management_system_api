import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { AppException, AuthUser, paginate, Paginated } from '@app/common';
import {
  AuditCloseDto,
  AuditDto,
  AuditInputDto,
  AuditItemDto,
  AuditItemsQueryDto,
  AuditScanDto,
  AuditScanResultDto,
  CountInputDto,
  CountLineDto,
} from './dto/operations.dto';
import { Asset } from './entities/asset.entity';
import { InventoryCategory, InventoryLocation, InventoryStore, Department } from './entities/master.entity';
import { AssetAuditItem, AuditFinding, InventoryAudit, StockCountLine, StockUnit } from './entities/operations.entity';
import { round2 } from './inventory.logic';
import { InventoryReadService, num, numOrNull, param, ref, Row, SqlFilter, str } from './inventory-read.service';
import { StockService } from './stock.service';

const MESSAGES: Record<AuditFinding, string> = {
  found: 'Found where it belongs',
  misplaced: 'Found, but it belongs somewhere else',
  not_available: 'Found, but the records show it lost, disposed or under maintenance',
  unknown: 'This code is not in the asset register',
};

@Injectable()
export class InventoryAuditsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly read: InventoryReadService,
    private readonly stock: StockService,
  ) {}

  private scope(audit: InventoryAudit, filter: SqlFilter) {
    if (audit.location_id) filter.where.push(`a.location_id = ${param(filter, audit.location_id)}`);
    if (audit.department_id) filter.where.push(`a.department_id = ${param(filter, audit.department_id)}`);
    if (audit.category_id) {
      const key = param(filter, audit.category_id);
      filter.where.push(
        `a.category_id IN (SELECT id FROM inventory_categories WHERE id = ${key} OR parent_id = ${key})`,
      );
    }
  }

  private expectedSql(audit: InventoryAudit, filter: SqlFilter): string {
    this.scope(audit, filter);
    return `SELECT a.id FROM assets a WHERE a.school_id = ${param(filter, audit.school_id)} AND a.deleted_at IS NULL
            AND a.status IN ('in_store', 'allocated') ${filter.where.length ? `AND ${filter.where.join(' AND ')}` : ''}`;
  }

  private async present(audit: InventoryAudit): Promise<AuditDto> {
    const [names]: Row[] = await this.dataSource.query(
      `SELECT l.name AS location_name, c.name AS category_name, d.name AS department_name, s.name AS store_name, u.name AS started_by
       FROM inventory_audits x
       LEFT JOIN inventory_locations l ON l.id = x.location_id LEFT JOIN inventory_categories c ON c.id = x.category_id
       LEFT JOIN departments d ON d.id = x.department_id LEFT JOIN inventory_stores s ON s.id = x.store_id
       LEFT JOIN users u ON u.id = x.created_by WHERE x.id = $1`,
      [audit.id],
    );
    const base = {
      id: audit.id,
      name: audit.name,
      kind: audit.kind,
      status: audit.status,
      location: ref(audit.location_id, names?.location_name),
      category: ref(audit.category_id, names?.category_name),
      department: ref(audit.department_id, names?.department_name),
      store: ref(audit.store_id, names?.store_name),
      notes: audit.notes,
      started_by: str(names?.started_by),
      created_at: audit.created_at,
      closed_at: audit.closed_at,
    };
    if (audit.kind === 'stock') {
      const [counts]: Row[] = await this.dataSource.query(
        `SELECT COUNT(*)::int AS expected, COUNT(counted_quantity)::int AS checked,
                COUNT(*) FILTER (WHERE counted_quantity IS NOT NULL AND counted_quantity = system_quantity)::int AS found,
                COUNT(*) FILTER (WHERE counted_quantity IS NOT NULL AND counted_quantity <> system_quantity)::int AS differences
         FROM stock_count_lines WHERE audit_id = $1`,
        [audit.id],
      );
      return {
        ...base,
        expected: num(counts?.expected),
        checked: num(counts?.checked),
        found: num(counts?.found),
        misplaced: 0,
        not_available: 0,
        unknown: 0,
        missing: num(counts?.expected) - num(counts?.checked),
        differences: num(counts?.differences),
      };
    }
    const filter: SqlFilter = { where: [], params: [] };
    const expected = this.expectedSql(audit, filter);
    const auditParam = param(filter, audit.id);
    const [counts]: Row[] = await this.dataSource.query(
      `SELECT (SELECT COUNT(*) FROM (${expected}) e)::int AS expected,
              (SELECT COUNT(*) FROM asset_audit_items WHERE audit_id = ${auditParam})::int AS checked,
              (SELECT COUNT(*) FROM asset_audit_items WHERE audit_id = ${auditParam} AND finding = 'found')::int AS found,
              (SELECT COUNT(*) FROM asset_audit_items WHERE audit_id = ${auditParam} AND finding = 'misplaced')::int AS misplaced,
              (SELECT COUNT(*) FROM asset_audit_items WHERE audit_id = ${auditParam} AND finding = 'not_available')::int AS not_available,
              (SELECT COUNT(*) FROM asset_audit_items WHERE audit_id = ${auditParam} AND finding = 'unknown')::int AS unknown,
              (SELECT COUNT(*) FROM (${expected}) e WHERE NOT EXISTS (
                 SELECT 1 FROM asset_audit_items x WHERE x.audit_id = ${auditParam} AND x.asset_id = e.id))::int AS missing`,
      filter.params,
    );
    const closed = audit.status === 'closed';
    return {
      ...base,
      expected: closed ? audit.expected_count : num(counts?.expected),
      checked: num(counts?.checked),
      found: closed ? audit.found_count : num(counts?.found),
      misplaced: num(counts?.misplaced),
      not_available: num(counts?.not_available),
      unknown: num(counts?.unknown),
      missing: closed ? audit.missing_count : num(counts?.missing),
      differences: 0,
    };
  }

  private async find(schoolId: number, id: number): Promise<InventoryAudit> {
    const audit = await this.dataSource.getRepository(InventoryAudit).findOneBy({ id, school_id: schoolId });
    if (!audit) throw AppException.notFound('Audit not found', 'AUDIT_NOT_FOUND');
    return audit;
  }

  async list(schoolId: number): Promise<AuditDto[]> {
    const audits = await this.dataSource
      .getRepository(InventoryAudit)
      .find({ where: { school_id: schoolId }, order: { created_at: 'DESC' }, take: 50 });
    return Promise.all(audits.map((audit) => this.present(audit)));
  }

  async get(schoolId: number, id: number): Promise<AuditDto> {
    return this.present(await this.find(schoolId, id));
  }

  async create(schoolId: number, dto: AuditInputDto): Promise<AuditDto> {
    const repo = this.dataSource.getRepository(InventoryAudit);
    if (await repo.existsBy({ school_id: schoolId, kind: dto.kind, status: 'open', deleted_at: IsNull() })) {
      throw AppException.conflict(
        `Close the open ${dto.kind === 'asset' ? 'asset verification' : 'stock count'} first`,
        'AUDIT_OPEN',
      );
    }
    const checks: [keyof AuditInputDto, new () => object, string][] = [
      ['location_id', InventoryLocation, 'Location not found'],
      ['category_id', InventoryCategory, 'Category not found'],
      ['department_id', Department, 'Department not found'],
      ['store_id', InventoryStore, 'Store not found'],
    ];
    for (const [field, entity, message] of checks) {
      const value = dto[field] as number | undefined;
      if (value && !(await this.dataSource.manager.existsBy(entity, { id: value, school_id: schoolId } as never))) {
        throw AppException.validation([{ field, message }]);
      }
    }
    if (dto.kind === 'stock' && !dto.store_id) {
      throw AppException.validation([{ field: 'store_id', message: 'Choose the store to count' }]);
    }
    const audit = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(
        manager.create(InventoryAudit, {
          school_id: schoolId,
          name: dto.name,
          kind: dto.kind,
          status: 'open',
          location_id: dto.kind === 'asset' ? (dto.location_id ?? null) : null,
          department_id: dto.kind === 'asset' ? (dto.department_id ?? null) : null,
          category_id: dto.category_id ?? null,
          store_id: dto.kind === 'stock' ? dto.store_id! : null,
          notes: dto.notes ?? null,
        }),
      );
      if (dto.kind === 'stock') {
        await manager.query(
          `INSERT INTO stock_count_lines (school_id, audit_id, item_id, system_quantity)
           SELECT $1, $2, i.id, COALESCE(b.quantity, 0)
           FROM stock_items i
           LEFT JOIN stock_balances b ON b.item_id = i.id AND b.store_id = $3
           WHERE i.school_id = $1 AND i.deleted_at IS NULL AND i.is_active
             AND (COALESCE(b.quantity, 0) > 0 OR b.id IS NOT NULL)
             ${dto.category_id ? 'AND i.category_id IN (SELECT id FROM inventory_categories WHERE id = $4 OR parent_id = $4)' : ''}`,
          dto.category_id ? [schoolId, saved.id, dto.store_id, dto.category_id] : [schoolId, saved.id, dto.store_id],
        );
      }
      return saved;
    });
    return this.present(audit);
  }

  async scan(schoolId: number, id: number, dto: AuditScanDto, actor: AuthUser): Promise<AuditScanResultDto> {
    const audit = await this.find(schoolId, id);
    if (audit.kind !== 'asset') throw AppException.conflict('Scan assets in an asset verification', 'AUDIT_KIND');
    if (audit.status !== 'open') throw AppException.conflict('This audit is closed', 'AUDIT_CLOSED');
    if (
      dto.location_id &&
      !(await this.dataSource.getRepository(InventoryLocation).existsBy({ id: dto.location_id, school_id: schoolId }))
    ) {
      throw AppException.validation([{ field: 'location_id', message: 'Location not found' }]);
    }
    const filter: SqlFilter = { where: [], params: [] };
    const key = param(filter, dto.code.trim());
    filter.where.push(`(upper(a.asset_tag) = upper(${key}) OR upper(a.serial_no) = upper(${key}))`);
    const [asset] = await this.read.assets(schoolId, filter, 'a.id');
    let finding: AuditFinding = 'unknown';
    const foundAt = dto.location_id ?? audit.location_id ?? null;
    if (asset) {
      if (!['in_store', 'allocated'].includes(asset.status)) {
        finding = 'not_available';
      } else {
        const inScope =
          (!audit.location_id || asset.location?.id === audit.location_id) &&
          (!audit.department_id || asset.department?.id === audit.department_id) &&
          (!dto.location_id || !asset.location || asset.location.id === dto.location_id);
        let categoryOk = true;
        if (audit.category_id) {
          const [row] = await this.dataSource.query(`SELECT id, parent_id FROM inventory_categories WHERE id = $1`, [
            asset.category.id,
          ]);
          categoryOk = Number(row?.id) === audit.category_id || Number(row?.parent_id) === audit.category_id;
        }
        finding = inScope && categoryOk ? 'found' : 'misplaced';
      }
    }
    const inserted = await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(AssetAuditItem)
      .values({
        school_id: schoolId,
        audit_id: audit.id,
        asset_id: asset?.id ?? null,
        code: asset?.asset_tag ?? dto.code.trim().slice(0, 60),
        finding,
        found_location_id: foundAt,
        scanned_by: actor.id,
      })
      .orIgnore()
      .execute();
    const repeated = !(inserted.raw as unknown[]).length;
    if (!repeated && asset) {
      await this.read.logEvents(this.dataSource.manager, [
        {
          school_id: schoolId,
          asset_id: asset.id,
          kind: 'audited',
          note: `${audit.name}: ${MESSAGES[finding]}`,
          ref_type: 'audit',
          ref_id: audit.id,
          actor_id: actor.id,
        },
      ]);
    }
    return {
      finding,
      message: repeated ? `Already scanned. ${MESSAGES[finding]}` : MESSAGES[finding],
      repeated,
      asset: asset ?? null,
      audit: await this.present(audit),
    };
  }

  async items(schoolId: number, id: number, query: AuditItemsQueryDto): Promise<Paginated<AuditItemDto>> {
    const audit = await this.find(schoolId, id);
    if (audit.kind !== 'asset')
      throw AppException.conflict('This is a stock count; open its count sheet', 'AUDIT_KIND');
    if (query.finding === 'missing') {
      const filter: SqlFilter = { where: [`a.status IN ('in_store', 'allocated')`], params: [] };
      this.scope(audit, filter);
      filter.where.push(
        `NOT EXISTS (SELECT 1 FROM asset_audit_items x WHERE x.audit_id = ${param(filter, audit.id)} AND x.asset_id = a.id)`,
      );
      const page = await this.read.assetPage(schoolId, filter, 'a.asset_tag', query.page, query.limit);
      return paginate(
        [
          page.items.map((asset) => ({
            id: asset.id,
            code: asset.asset_tag,
            finding: 'missing' as const,
            asset,
            found_location: null,
            scanned_at: null,
          })),
          page.total,
        ],
        query.page,
        query.limit,
      );
    }
    const rows: Row[] = await this.dataSource.query(
      `SELECT x.*, l.name AS location_name, COUNT(*) OVER() AS total FROM asset_audit_items x
       LEFT JOIN inventory_locations l ON l.id = x.found_location_id
       WHERE x.audit_id = $1 ${query.finding ? 'AND x.finding = $2' : ''}
       ORDER BY x.scanned_at DESC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      query.finding ? [audit.id, query.finding] : [audit.id],
    );
    const ids = rows.map((row) => numOrNull(row.asset_id)).filter((value): value is number => value !== null);
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`a.id = ANY(${param(filter, ids)})`);
    const assets = ids.length ? await this.read.assets(schoolId, filter) : [];
    return paginate(
      [
        rows.map((row) => ({
          id: num(row.id),
          code: String(row.code),
          finding: row.finding as AuditFinding,
          asset: assets.find((asset) => asset.id === Number(row.asset_id)) ?? null,
          found_location: ref(row.found_location_id, row.location_name),
          scanned_at: row.scanned_at as Date,
        })),
        num(rows[0]?.total),
      ],
      query.page,
      query.limit,
    );
  }

  async countSheet(schoolId: number, id: number): Promise<CountLineDto[]> {
    const audit = await this.find(schoolId, id);
    if (audit.kind !== 'stock') throw AppException.conflict('This is an asset verification', 'AUDIT_KIND');
    const rows: Row[] = await this.dataSource.query(
      `SELECT l.*, i.name AS item_name, i.unit FROM stock_count_lines l JOIN stock_items i ON i.id = l.item_id
       WHERE l.audit_id = $1 ORDER BY i.name`,
      [id],
    );
    return rows.map((row) => {
      const counted = numOrNull(row.counted_quantity);
      return {
        id: num(row.id),
        item: { id: num(row.item_id), name: String(row.item_name) },
        unit: row.unit as StockUnit,
        system_quantity: num(row.system_quantity),
        counted_quantity: counted,
        difference: counted === null ? null : round2(counted - num(row.system_quantity)),
        note: str(row.note),
      };
    });
  }

  async saveCount(schoolId: number, id: number, dto: CountInputDto): Promise<CountLineDto[]> {
    const audit = await this.find(schoolId, id);
    if (audit.kind !== 'stock') throw AppException.conflict('This is an asset verification', 'AUDIT_KIND');
    if (audit.status !== 'open') throw AppException.conflict('This audit is closed', 'AUDIT_CLOSED');
    await this.dataSource.transaction(async (manager) => {
      for (const line of dto.lines) {
        const existing = await manager.findOneBy(StockCountLine, { audit_id: id, item_id: line.item_id });
        if (existing) {
          await manager.update(StockCountLine, existing.id, {
            counted_quantity: line.counted_quantity,
            note: line.note ?? existing.note,
          });
          continue;
        }
        const [item] = await manager.query(
          `SELECT id FROM stock_items WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
          [line.item_id, schoolId],
        );
        if (!item) throw AppException.validation([{ field: 'lines', message: `Stock item ${line.item_id} not found` }]);
        const [balance] = await manager.query(
          `SELECT quantity FROM stock_balances WHERE item_id = $1 AND store_id = $2`,
          [line.item_id, audit.store_id],
        );
        await manager.insert(StockCountLine, {
          school_id: schoolId,
          audit_id: id,
          item_id: line.item_id,
          system_quantity: Number(balance?.quantity ?? 0),
          counted_quantity: line.counted_quantity,
          note: line.note ?? null,
        });
      }
    });
    return this.countSheet(schoolId, id);
  }

  async close(schoolId: number, id: number, dto: AuditCloseDto, actor: AuthUser): Promise<AuditDto> {
    const audit = await this.find(schoolId, id);
    if (audit.status !== 'open') throw AppException.conflict('This audit is already closed', 'AUDIT_CLOSED');
    const summary = await this.present(audit);
    await this.dataSource.transaction(async (manager) => {
      if (audit.kind === 'asset' && dto.mark_missing_lost) {
        const filter: SqlFilter = { where: [], params: [] };
        const sql = this.expectedSql(audit, filter);
        const missing: { id: number }[] = await manager.query(
          `SELECT e.id FROM (${sql}) e WHERE NOT EXISTS (
             SELECT 1 FROM asset_audit_items x WHERE x.audit_id = ${param(filter, audit.id)} AND x.asset_id = e.id)`,
          filter.params,
        );
        for (const { id: assetId } of missing) {
          await manager.query(
            `UPDATE asset_allocations SET status = 'returned', returned_on = $2::date, returned_by = $3,
               remarks = LEFT(CONCAT_WS(' · ', remarks, 'Not found in verification'), 255)
             WHERE asset_id = $1 AND status = 'active' AND deleted_at IS NULL`,
            [assetId, this.read.today(), actor.id],
          );
          await manager.update(Asset, assetId, { status: 'lost', custodian_user_id: null });
        }
        await this.read.logEvents(
          manager,
          missing.map((row) => ({
            school_id: schoolId,
            asset_id: Number(row.id),
            kind: 'marked_lost' as const,
            note: `Not found in verification "${audit.name}"`,
            ref_type: 'audit',
            ref_id: audit.id,
            actor_id: actor.id,
          })),
        );
      }
      if (audit.kind === 'stock' && dto.post_adjustments) {
        const lines = await manager.findBy(StockCountLine, { audit_id: id });
        for (const line of lines) {
          if (line.counted_quantity === null) continue;
          const [balance] = await manager.query(
            `SELECT quantity FROM stock_balances WHERE item_id = $1 AND store_id = $2`,
            [line.item_id, audit.store_id],
          );
          const difference = round2(Number(line.counted_quantity) - Number(balance?.quantity ?? 0));
          if (!difference) continue;
          await this.stock.move(manager, {
            school_id: schoolId,
            item_id: line.item_id,
            store_id: audit.store_id!,
            kind: 'adjustment',
            quantity: difference,
            ref_type: 'stock_count',
            ref_id: audit.id,
            note: `count correction: ${audit.name}`,
            moved_on: this.read.today(),
            actor_id: actor.id,
          });
        }
      }
      await manager.update(InventoryAudit, audit.id, {
        status: 'closed',
        closed_at: new Date(),
        closed_by: actor.id,
        expected_count: summary.expected,
        found_count: summary.found,
        missing_count: summary.missing,
      });
    });
    return this.get(schoolId, id);
  }
}
