import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { AppException, AuthUser, paginate, Paginated } from '@app/common';
import { monthStartIn } from '../../shared/dates';
import { INVENTORY_TEMPLATES } from '../notifications/inventory-templates.catalog';
import { SequencesService } from '../schools/sequences.service';
import { RejectDto } from './dto/asset.dto';
import {
  AdjustmentInputDto,
  DirectIssueDto,
  MovementDto,
  MovementQueryDto,
  ReceiptDto,
  ReceiptInputDto,
  ReceiptQueryDto,
  RequisitionApproveDto,
  RequisitionDto,
  RequisitionInputDto,
  RequisitionIssueDto,
  RequisitionQueryDto,
  StockInsightsDto,
  StockItemDetailDto,
  StockItemDto,
  StockItemInputDto,
  StockItemQueryDto,
  StockItemUpdateDto,
} from './dto/operations.dto';
import { Department, InventoryCategory, InventoryStore, InventoryVendor } from './entities/master.entity';
import {
  MovementKind,
  Requisition,
  RequisitionLine,
  StockBalance,
  StockItem,
  StockMovement,
  StockReceipt,
  StockReceiptLine,
  StockUnit,
} from './entities/operations.entity';
import {
  averageRate,
  codeFrom,
  documentNumber,
  receive,
  requisitionStatusAfterIssue,
  round2,
  stockRefusal,
  withdraw,
} from './inventory.logic';
import { INVENTORY_APPROVER_ROLES, InventoryNotifyService } from './inventory-notify.service';
import {
  addSearch,
  InventoryReadService,
  num,
  numOrNull,
  orderBy,
  param,
  ref,
  Row,
  SqlFilter,
  str,
} from './inventory-read.service';

const ITEM_SORTS: Record<string, string> = { name: 'i.name', code: 'i.code', quantity: 'k.quantity', value: 'k.value' };
const MOVEMENT_SORTS: Record<string, string> = { created_at: 'm.created_at', moved_on: 'm.moved_on' };
const RECEIPT_SORTS: Record<string, string> = {
  received_on: 'r.received_on',
  receipt_no: 'r.receipt_no',
  total: 'r.total',
  vendor: 'v.name',
};
const REQUISITION_SORTS: Record<string, string> = { created_at: 'r.created_at', needed_by: 'r.needed_by' };

interface MoveInput {
  school_id: number;
  item_id: number;
  store_id: number;
  kind: MovementKind;
  quantity: number;
  rate?: number;
  ref_type?: StockMovement['ref_type'];
  ref_id?: number | null;
  department_id?: number | null;
  user_id?: number | null;
  section_id?: number | null;
  note?: string | null;
  moved_on: string;
  actor_id: number | null;
}

@Injectable()
export class StockService {
  private readonly sequences = new SequencesService();

  constructor(
    private readonly dataSource: DataSource,
    private readonly read: InventoryReadService,
    private readonly notify: InventoryNotifyService,
  ) {}

  async move(manager: EntityManager, input: MoveInput): Promise<StockMovement> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(StockBalance)
      .values({ school_id: input.school_id, item_id: input.item_id, store_id: input.store_id, quantity: 0, value: 0 })
      .orIgnore()
      .execute();
    const balance = await manager.findOneOrFail(StockBalance, {
      where: { item_id: input.item_id, store_id: input.store_id },
      lock: { mode: 'pessimistic_write' },
    });
    const position = { quantity: Number(balance.quantity), value: Number(balance.value) };
    let next = position;
    let rate = 0;
    let value = 0;
    if (input.quantity > 0) {
      rate = round2(input.rate ?? averageRate(position));
      value = round2(input.quantity * rate);
      next = receive(position, input.quantity, rate);
    } else {
      const wanted = round2(-input.quantity);
      const item = await manager.findOneByOrFail(StockItem, { id: input.item_id });
      const refusal = stockRefusal(position.quantity, wanted, item.name);
      if (refusal) throw AppException.conflict(refusal.message, refusal.code);
      const out = withdraw(position, wanted);
      next = out.position;
      rate = out.rate;
      value = -out.value;
    }
    await manager.update(StockBalance, balance.id, { quantity: next.quantity, value: next.value });
    return manager.save(
      manager.create(StockMovement, {
        school_id: input.school_id,
        item_id: input.item_id,
        store_id: input.store_id,
        kind: input.kind,
        quantity: round2(input.quantity),
        rate,
        value,
        balance_after: next.quantity,
        ref_type: input.ref_type ?? null,
        ref_id: input.ref_id ?? null,
        department_id: input.department_id ?? null,
        user_id: input.user_id ?? null,
        section_id: input.section_id ?? null,
        note: input.note ?? null,
        moved_on: input.moved_on,
        created_by: input.actor_id,
      }),
    );
  }

  async insights(schoolId: number): Promise<StockInsightsDto> {
    const monthStart = monthStartIn(this.read.zone());
    const [row]: Row[] = await this.dataSource.query(
      `SELECT (SELECT COUNT(*) FROM stock_items WHERE school_id = $1 AND deleted_at IS NULL AND is_active)::int AS items,
              (SELECT COALESCE(SUM(value), 0) FROM stock_balances WHERE school_id = $1) AS stock_value,
              (SELECT COUNT(*) FROM stock_items i WHERE i.school_id = $1 AND i.deleted_at IS NULL AND i.is_active
                 AND (SELECT COALESCE(SUM(b.quantity), 0) FROM stock_balances b WHERE b.item_id = i.id) <= i.reorder_level
                 AND (SELECT COALESCE(SUM(b.quantity), 0) FROM stock_balances b WHERE b.item_id = i.id) > 0)::int AS low_stock,
              (SELECT COUNT(*) FROM stock_items i WHERE i.school_id = $1 AND i.deleted_at IS NULL AND i.is_active
                 AND (SELECT COALESCE(SUM(b.quantity), 0) FROM stock_balances b WHERE b.item_id = i.id) <= 0)::int AS out_of_stock,
              (SELECT COUNT(*) FROM requisitions WHERE school_id = $1 AND deleted_at IS NULL AND status = 'pending')::int AS pending,
              (SELECT COUNT(*) FROM requisitions WHERE school_id = $1 AND deleted_at IS NULL AND status IN ('approved', 'partly_issued'))::int AS to_issue,
              (SELECT COALESCE(SUM(value), 0) FROM stock_movements WHERE school_id = $1 AND deleted_at IS NULL AND kind = 'receipt' AND moved_on >= $2::date) AS received,
              (SELECT COALESCE(-SUM(value), 0) FROM stock_movements WHERE school_id = $1 AND deleted_at IS NULL AND kind = 'issue' AND moved_on >= $2::date) AS issued`,
      [schoolId, monthStart],
    );
    return {
      items: num(row?.items),
      stock_value: num(row?.stock_value),
      low_stock: num(row?.low_stock),
      out_of_stock: num(row?.out_of_stock),
      pending_requisitions: num(row?.pending),
      to_issue: num(row?.to_issue),
      received_this_month: num(row?.received),
      issued_this_month: num(row?.issued),
    };
  }

  private itemSql(filter: SqlFilter, storeParam: string | null, tail: string) {
    return `
      SELECT i.*, c.name AS category_name, k.quantity, k.value
      FROM stock_items i
      JOIN inventory_categories c ON c.id = i.category_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(b.quantity), 0) AS quantity, COALESCE(SUM(b.value), 0) AS value
        FROM stock_balances b WHERE b.item_id = i.id ${storeParam ? `AND b.store_id = ${storeParam}` : ''}
      ) k ON true
      WHERE i.deleted_at IS NULL ${filter.where.length ? `AND ${filter.where.join(' AND ')}` : ''} ${tail}`;
  }

  private presentItem(row: Row): StockItemDto {
    const quantity = num(row.quantity);
    const value = num(row.value);
    return {
      id: num(row.id),
      name: String(row.name),
      code: String(row.code),
      category: { id: num(row.category_id), name: String(row.category_name) },
      unit: row.unit as StockUnit,
      reorder_level: num(row.reorder_level),
      description: str(row.description),
      is_active: Boolean(row.is_active),
      quantity,
      value,
      average_rate: quantity > 0 ? round2(value / quantity) : 0,
      low: quantity <= num(row.reorder_level),
    };
  }

  async items(schoolId: number, query: StockItemQueryDto): Promise<Paginated<StockItemDto>> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`i.school_id = ${param(filter, schoolId)}`);
    const storeParam = query.store_id ? param(filter, query.store_id) : null;
    if (query.category_id) {
      const key = param(filter, query.category_id);
      filter.where.push(`(i.category_id = ${key} OR c.parent_id = ${key})`);
    }
    if (query.is_active !== undefined) filter.where.push(`i.is_active = ${param(filter, query.is_active)}`);
    if (query.low !== undefined)
      filter.where.push(query.low ? 'k.quantity <= i.reorder_level' : 'k.quantity > i.reorder_level');
    addSearch(filter, query.search, ['i.name', 'i.code']);
    const order = orderBy(ITEM_SORTS, query.sort, 'name', query.sort ? query.order : 'asc', 'i.id');
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM (${this.itemSql(filter, storeParam, '')}) counted`,
      filter.params,
    );
    const rows: Row[] = await this.dataSource.query(
      this.itemSql(
        filter,
        storeParam,
        `ORDER BY ${order} LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      ),
      filter.params,
    );
    return paginate([rows.map((row) => this.presentItem(row)), Number(total)], query.page, query.limit);
  }

  async item(schoolId: number, id: number): Promise<StockItemDetailDto> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`i.school_id = ${param(filter, schoolId)}`, `i.id = ${param(filter, id)}`);
    const [row]: Row[] = await this.dataSource.query(this.itemSql(filter, null, ''), filter.params);
    if (!row) throw AppException.notFound('Stock item not found', 'ITEM_NOT_FOUND');
    const balances: Row[] = await this.dataSource.query(
      `SELECT b.store_id, s.name AS store_name, b.quantity, b.value FROM stock_balances b
       JOIN inventory_stores s ON s.id = b.store_id WHERE b.item_id = $1 ORDER BY s.name`,
      [id],
    );
    return {
      ...this.presentItem(row),
      balances: balances.map((balance) => ({
        store: { id: num(balance.store_id), name: String(balance.store_name) },
        quantity: num(balance.quantity),
        value: num(balance.value),
      })),
    };
  }

  private async checkItem(schoolId: number, dto: Partial<StockItemInputDto>, exceptId?: number) {
    if (dto.category_id !== undefined) {
      const category = await this.dataSource
        .getRepository(InventoryCategory)
        .findOneBy({ id: dto.category_id, school_id: schoolId });
      if (!category) throw AppException.validation([{ field: 'category_id', message: 'Category not found' }]);
      if (category.kind !== 'stock') {
        throw AppException.validation([{ field: 'category_id', message: 'Choose a stock category, not an asset one' }]);
      }
    }
    if (dto.code) {
      const clash = await this.dataSource
        .getRepository(StockItem)
        .findOneBy({ school_id: schoolId, code: dto.code, deleted_at: IsNull() });
      if (clash && clash.id !== exceptId)
        throw AppException.conflict(`Code ${dto.code} is already used`, 'ITEM_EXISTS');
    }
  }

  async createItem(schoolId: number, dto: StockItemInputDto): Promise<StockItemDto> {
    await this.checkItem(schoolId, dto);
    const repo = this.dataSource.getRepository(StockItem);
    let code = dto.code;
    if (!code) {
      const base = codeFrom(dto.name, 'ITEM');
      for (let index = 0; index < 100 && !code; index += 1) {
        const candidate = index ? `${base}-${index}` : base;
        if (!(await repo.existsBy({ school_id: schoolId, code: candidate, deleted_at: IsNull() }))) code = candidate;
      }
    }
    const saved = await repo.save(repo.create({ ...dto, code: code!, school_id: schoolId }));
    return this.item(schoolId, saved.id);
  }

  async updateItem(schoolId: number, id: number, dto: StockItemUpdateDto): Promise<StockItemDto> {
    await this.item(schoolId, id);
    await this.checkItem(schoolId, dto, id);
    const fields = Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined));
    if (Object.keys(fields).length) await this.dataSource.getRepository(StockItem).update(id, fields);
    return this.item(schoolId, id);
  }

  async removeItem(schoolId: number, id: number): Promise<void> {
    await this.item(schoolId, id);
    const [used] = await this.dataSource.query(
      `SELECT (SELECT COUNT(*) FROM stock_movements WHERE item_id = $1)
            + (SELECT COUNT(*) FROM requisition_lines WHERE item_id = $1) AS count`,
      [id],
    );
    if (Number(used.count)) {
      throw AppException.conflict('This item has stock history; mark it inactive instead', 'ITEM_IN_USE');
    }
    await this.dataSource.getRepository(StockItem).softDelete({ id, school_id: schoolId });
  }

  private async store(manager: EntityManager, schoolId: number, id: number): Promise<InventoryStore> {
    const store = await manager.findOneBy(InventoryStore, { id, school_id: schoolId });
    if (!store) throw AppException.validation([{ field: 'store_id', message: 'Store not found' }]);
    return store;
  }

  private async itemMap(manager: EntityManager, schoolId: number, ids: number[]): Promise<Map<number, StockItem>> {
    const items = await manager.findBy(
      StockItem,
      ids.map((id) => ({ id, school_id: schoolId })),
    );
    const map = new Map(items.map((item) => [item.id, item]));
    const missing = ids.find((id) => !map.has(id));
    if (missing) throw AppException.validation([{ field: 'lines', message: `Stock item ${missing} not found` }]);
    return map;
  }

  async receipts(schoolId: number, query: ReceiptQueryDto): Promise<Paginated<ReceiptDto>> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`r.school_id = ${param(filter, schoolId)}`);
    if (query.store_id) filter.where.push(`r.store_id = ${param(filter, query.store_id)}`);
    if (query.vendor_id) filter.where.push(`r.vendor_id = ${param(filter, query.vendor_id)}`);
    if (query.from) filter.where.push(`r.received_on >= ${param(filter, query.from)}::date`);
    if (query.to) filter.where.push(`r.received_on <= ${param(filter, query.to)}::date`);
    addSearch(filter, query.search, ['r.receipt_no', 'r.invoice_no', 'v.name']);
    const sql = (tail: string) => `
      SELECT r.id FROM stock_receipts r LEFT JOIN inventory_vendors v ON v.id = r.vendor_id
      WHERE r.deleted_at IS NULL AND ${filter.where.join(' AND ')} ${tail}`;
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM (${sql('')}) c`,
      filter.params,
    );
    const ids: { id: number }[] = await this.dataSource.query(
      sql(
        `ORDER BY ${orderBy(RECEIPT_SORTS, query.sort, 'received_on', query.order, 'r.id DESC')} LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      ),
      filter.params,
    );
    const receipts = await this.receiptsByIds(
      schoolId,
      ids.map((row) => Number(row.id)),
    );
    return paginate([receipts, Number(total)], query.page, query.limit);
  }

  private async receiptsByIds(schoolId: number, ids: number[]): Promise<ReceiptDto[]> {
    if (!ids.length) return [];
    const rows: Row[] = await this.dataSource.query(
      `SELECT r.*, r.invoice_date::text AS invoice_date_text, r.received_on::text AS received_text, s.name AS store_name,
              v.name AS vendor_name, u.name AS received_by_name
       FROM stock_receipts r JOIN inventory_stores s ON s.id = r.store_id
       LEFT JOIN inventory_vendors v ON v.id = r.vendor_id LEFT JOIN users u ON u.id = r.created_by
       WHERE r.school_id = $1 AND r.id = ANY($2)`,
      [schoolId, ids],
    );
    const lines: Row[] = await this.dataSource.query(
      `SELECT l.*, i.name AS item_name, i.unit FROM stock_receipt_lines l JOIN stock_items i ON i.id = l.item_id
       WHERE l.receipt_id = ANY($1) ORDER BY l.id`,
      [ids],
    );
    return ids
      .map((id) => rows.find((row) => Number(row.id) === id))
      .filter((row): row is Row => Boolean(row))
      .map((row) => ({
        id: num(row.id),
        receipt_no: String(row.receipt_no),
        store: { id: num(row.store_id), name: String(row.store_name) },
        vendor: ref(row.vendor_id, row.vendor_name),
        invoice_no: str(row.invoice_no),
        invoice_date: str(row.invoice_date_text),
        received_on: String(row.received_text),
        total: num(row.total),
        notes: str(row.notes),
        received_by: str(row.received_by_name),
        lines: lines
          .filter((line) => Number(line.receipt_id) === Number(row.id))
          .map((line) => ({
            item: { id: num(line.item_id), name: String(line.item_name) },
            unit: line.unit as StockUnit,
            quantity: num(line.quantity),
            rate: num(line.rate),
            amount: num(line.amount),
          })),
        created_at: row.created_at as Date,
      }));
  }

  async receipt(schoolId: number, id: number): Promise<ReceiptDto> {
    const [receipt] = await this.receiptsByIds(schoolId, [id]);
    if (!receipt) throw AppException.notFound('Receipt not found', 'RECEIPT_NOT_FOUND');
    return receipt;
  }

  async receive(schoolId: number, dto: ReceiptInputDto, actor: AuthUser): Promise<ReceiptDto> {
    const today = this.read.today();
    const receivedOn = dto.received_on ?? today;
    if (receivedOn > today)
      throw AppException.validation([{ field: 'received_on', message: 'The date cannot be in the future' }]);
    const id = await this.dataSource.transaction(async (manager) => {
      await this.store(manager, schoolId, dto.store_id);
      if (dto.vendor_id && !(await manager.existsBy(InventoryVendor, { id: dto.vendor_id, school_id: schoolId }))) {
        throw AppException.validation([{ field: 'vendor_id', message: 'Vendor not found' }]);
      }
      const items = await this.itemMap(
        manager,
        schoolId,
        dto.lines.map((line) => line.item_id),
      );
      const school = await this.read.schoolInfo(manager, schoolId);
      const year = receivedOn.slice(0, 4);
      const receipt = await manager.save(
        manager.create(StockReceipt, {
          school_id: schoolId,
          receipt_no: documentNumber(
            school.code,
            'GRN',
            year,
            await this.sequences.next(manager, schoolId, `inventory_grn:${year}`),
          ),
          store_id: dto.store_id,
          vendor_id: dto.vendor_id ?? null,
          invoice_no: dto.invoice_no ?? null,
          invoice_date: dto.invoice_date ?? null,
          received_on: receivedOn,
          total: round2(dto.lines.reduce((sum, line) => sum + line.quantity * line.rate, 0)),
          notes: dto.notes ?? null,
          created_by: actor.id,
        }),
      );
      for (const line of dto.lines) {
        await manager.insert(StockReceiptLine, {
          school_id: schoolId,
          receipt_id: receipt.id,
          item_id: line.item_id,
          quantity: line.quantity,
          rate: line.rate,
          amount: round2(line.quantity * line.rate),
        });
        await this.move(manager, {
          school_id: schoolId,
          item_id: line.item_id,
          store_id: dto.store_id,
          kind: 'receipt',
          quantity: line.quantity,
          rate: line.rate,
          ref_type: 'receipt',
          ref_id: receipt.id,
          note: `${receipt.receipt_no}${dto.invoice_no ? ` · invoice ${dto.invoice_no}` : ''} · ${items.get(line.item_id)!.name}`,
          moved_on: receivedOn,
          actor_id: actor.id,
        });
      }
      return receipt.id;
    });
    return this.receipt(schoolId, id);
  }

  async adjust(schoolId: number, dto: AdjustmentInputDto, actor: AuthUser): Promise<MovementDto> {
    if (!dto.quantity)
      throw AppException.validation([{ field: 'quantity', message: 'Enter how much to add or remove' }]);
    const id = await this.dataSource.transaction(async (manager) => {
      await this.store(manager, schoolId, dto.store_id);
      await this.itemMap(manager, schoolId, [dto.item_id]);
      const movement = await this.move(manager, {
        school_id: schoolId,
        item_id: dto.item_id,
        store_id: dto.store_id,
        kind: dto.reason === 'returned' ? 'return' : 'adjustment',
        quantity: dto.quantity,
        rate: dto.rate,
        note: `${dto.reason.replace('_', ' ')}${dto.note ? `: ${dto.note}` : ''}`,
        moved_on: this.read.today(),
        actor_id: actor.id,
      });
      return movement.id;
    });
    const [movement] = await this.movementsByIds(schoolId, [id]);
    return movement!;
  }

  private async checkRecipient(
    manager: EntityManager,
    schoolId: number,
    dto: { department_id?: number; user_id?: number; requested_for_user_id?: number; section_id?: number },
  ) {
    const userId = dto.user_id ?? dto.requested_for_user_id;
    if (!dto.department_id && !userId && !dto.section_id) {
      throw AppException.validation([
        { field: 'department_id', message: 'Choose a department, a staff member or a class' },
      ]);
    }
    if (dto.department_id && !(await manager.existsBy(Department, { id: dto.department_id, school_id: schoolId }))) {
      throw AppException.validation([{ field: 'department_id', message: 'Department not found' }]);
    }
    if (userId) {
      const [staff] = await manager.query(
        `SELECT id FROM staff WHERE user_id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [userId, schoolId],
      );
      if (!staff) throw AppException.validation([{ field: 'user_id', message: 'Staff member not found' }]);
    }
    if (dto.section_id) {
      const [section] = await manager.query(`SELECT id FROM sections WHERE id = $1 AND school_id = $2`, [
        dto.section_id,
        schoolId,
      ]);
      if (!section) throw AppException.validation([{ field: 'section_id', message: 'Section not found' }]);
    }
  }

  async directIssue(schoolId: number, dto: DirectIssueDto, actor: AuthUser): Promise<MovementDto[]> {
    const ids = await this.dataSource.transaction(async (manager) => {
      await this.store(manager, schoolId, dto.store_id);
      await this.checkRecipient(manager, schoolId, dto);
      await this.itemMap(
        manager,
        schoolId,
        dto.lines.map((line) => line.item_id),
      );
      const result: number[] = [];
      for (const line of dto.lines) {
        const movement = await this.move(manager, {
          school_id: schoolId,
          item_id: line.item_id,
          store_id: dto.store_id,
          kind: 'issue',
          quantity: -line.quantity,
          department_id: dto.department_id ?? null,
          user_id: dto.user_id ?? null,
          section_id: dto.section_id ?? null,
          note: dto.purpose,
          moved_on: this.read.today(),
          actor_id: actor.id,
        });
        result.push(movement.id);
      }
      return result;
    });
    return this.movementsByIds(schoolId, ids);
  }

  private movementSql(filter: SqlFilter, tail: string) {
    return `
      SELECT m.*, m.moved_on::text AS moved_text, i.name AS item_name, i.code AS item_code, i.unit, s.name AS store_name,
             d.name AS department_name, pu.name AS person_name, sec.id AS sec_id, c.name || ' - ' || sec.name AS sec_name,
             bu.name AS by_name,
             CASE m.ref_type WHEN 'receipt' THEN (SELECT receipt_no FROM stock_receipts WHERE id = m.ref_id)
                             WHEN 'requisition' THEN (SELECT requisition_no FROM requisitions WHERE id = m.ref_id)
                             WHEN 'stock_count' THEN (SELECT name FROM inventory_audits WHERE id = m.ref_id) END AS reference
      FROM stock_movements m
      JOIN stock_items i ON i.id = m.item_id
      JOIN inventory_stores s ON s.id = m.store_id
      LEFT JOIN departments d ON d.id = m.department_id
      LEFT JOIN users pu ON pu.id = m.user_id
      LEFT JOIN sections sec ON sec.id = m.section_id
      LEFT JOIN classes c ON c.id = sec.class_id
      LEFT JOIN users bu ON bu.id = m.created_by
      WHERE m.deleted_at IS NULL ${filter.where.length ? `AND ${filter.where.join(' AND ')}` : ''} ${tail}`;
  }

  private presentMovement(row: Row): MovementDto {
    return {
      id: num(row.id),
      item: { id: num(row.item_id), name: String(row.item_name) },
      unit: row.unit as StockUnit,
      store: { id: num(row.store_id), name: String(row.store_name) },
      kind: row.kind as MovementKind,
      quantity: num(row.quantity),
      rate: num(row.rate),
      value: num(row.value),
      balance_after: num(row.balance_after),
      reference: str(row.reference),
      department: ref(row.department_id, row.department_name),
      person: str(row.person_name),
      section: ref(row.sec_id, row.sec_name),
      note: str(row.note),
      moved_on: String(row.moved_text),
      by: str(row.by_name),
      created_at: row.created_at as Date,
    };
  }

  private async movementsByIds(schoolId: number, ids: number[]): Promise<MovementDto[]> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`m.school_id = ${param(filter, schoolId)}`, `m.id = ANY(${param(filter, ids)})`);
    const rows: Row[] = await this.dataSource.query(this.movementSql(filter, 'ORDER BY m.id'), filter.params);
    return rows.map((row) => this.presentMovement(row));
  }

  async movements(schoolId: number, query: MovementQueryDto): Promise<Paginated<MovementDto>> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`m.school_id = ${param(filter, schoolId)}`);
    if (query.item_id) filter.where.push(`m.item_id = ${param(filter, query.item_id)}`);
    if (query.store_id) filter.where.push(`m.store_id = ${param(filter, query.store_id)}`);
    if (query.kind) filter.where.push(`m.kind = ${param(filter, query.kind)}`);
    if (query.department_id) filter.where.push(`m.department_id = ${param(filter, query.department_id)}`);
    if (query.from) filter.where.push(`m.moved_on >= ${param(filter, query.from)}::date`);
    if (query.to) filter.where.push(`m.moved_on <= ${param(filter, query.to)}::date`);
    addSearch(filter, query.search, ['i.name', 'i.code', 'm.note']);
    const order = orderBy(MOVEMENT_SORTS, query.sort, 'created_at', query.order, 'm.id DESC');
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM (${this.movementSql(filter, '')}) c`,
      filter.params,
    );
    const rows: Row[] = await this.dataSource.query(
      this.movementSql(filter, `ORDER BY ${order} LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`),
      filter.params,
    );
    return paginate([rows.map((row) => this.presentMovement(row)), Number(total)], query.page, query.limit);
  }

  private async requisitionsByIds(schoolId: number, ids: number[]): Promise<RequisitionDto[]> {
    if (!ids.length) return [];
    const rows: Row[] = await this.dataSource.query(
      `SELECT r.*, r.needed_by::text AS needed_text, s.name AS store_name, d.name AS department_name, fu.name AS for_name,
              fst.designation AS for_detail, sec.id AS sec_id, c.name || ' - ' || sec.name AS sec_name,
              cu.name AS raised_by_name, du.name AS decided_by_name
       FROM requisitions r
       JOIN inventory_stores s ON s.id = r.store_id
       LEFT JOIN departments d ON d.id = r.department_id
       LEFT JOIN users fu ON fu.id = r.requested_for_user_id
       LEFT JOIN staff fst ON fst.user_id = r.requested_for_user_id AND fst.school_id = r.school_id AND fst.deleted_at IS NULL
       LEFT JOIN sections sec ON sec.id = r.section_id
       LEFT JOIN classes c ON c.id = sec.class_id
       LEFT JOIN users cu ON cu.id = r.created_by
       LEFT JOIN users du ON du.id = r.decided_by
       WHERE r.school_id = $1 AND r.id = ANY($2)`,
      [schoolId, ids],
    );
    const lines: Row[] = await this.dataSource.query(
      `SELECT l.*, l.requisition_id, i.name AS item_name, i.unit,
              COALESCE((SELECT b.quantity FROM stock_balances b WHERE b.item_id = l.item_id AND b.store_id = r.store_id), 0) AS available
       FROM requisition_lines l JOIN requisitions r ON r.id = l.requisition_id JOIN stock_items i ON i.id = l.item_id
       WHERE l.requisition_id = ANY($1) ORDER BY l.id`,
      [ids],
    );
    return ids
      .map((id) => rows.find((row) => Number(row.id) === id))
      .filter((row): row is Row => Boolean(row))
      .map((row) => ({
        id: num(row.id),
        requisition_no: String(row.requisition_no),
        store: { id: num(row.store_id), name: String(row.store_name) },
        department: ref(row.department_id, row.department_name),
        requested_for: row.requested_for_user_id
          ? { id: num(row.requested_for_user_id), name: String(row.for_name ?? ''), detail: str(row.for_detail) }
          : null,
        section: ref(row.sec_id, row.sec_name),
        purpose: String(row.purpose),
        needed_by: str(row.needed_text),
        status: row.status as RequisitionDto['status'],
        raised_by: str(row.raised_by_name),
        decided_by: str(row.decided_by_name),
        decided_at: (row.decided_at as Date | null) ?? null,
        decision_note: str(row.decision_note),
        issued_at: (row.issued_at as Date | null) ?? null,
        lines: lines
          .filter((line) => Number(line.requisition_id) === Number(row.id))
          .map((line) => ({
            item: { id: num(line.item_id), name: String(line.item_name) },
            unit: line.unit as StockUnit,
            quantity: num(line.quantity),
            approved_quantity: numOrNull(line.approved_quantity),
            issued_quantity: num(line.issued_quantity),
            available: num(line.available),
          })),
        created_at: row.created_at as Date,
      }));
  }

  async requisitions(schoolId: number, query: RequisitionQueryDto): Promise<Paginated<RequisitionDto>> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`r.school_id = ${param(filter, schoolId)}`);
    if (query.status) filter.where.push(`r.status = ${param(filter, query.status)}`);
    if (query.department_id) filter.where.push(`r.department_id = ${param(filter, query.department_id)}`);
    if (query.store_id) filter.where.push(`r.store_id = ${param(filter, query.store_id)}`);
    addSearch(filter, query.search, ['r.requisition_no', 'r.purpose']);
    const order = orderBy(REQUISITION_SORTS, query.sort, 'created_at', query.order, 'r.id DESC');
    const sql = (tail: string) =>
      `SELECT r.id FROM requisitions r WHERE r.deleted_at IS NULL AND ${filter.where.join(' AND ')} ${tail}`;
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM (${sql('')}) c`,
      filter.params,
    );
    const ids: { id: number }[] = await this.dataSource.query(
      sql(`ORDER BY ${order} LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`),
      filter.params,
    );
    return paginate(
      [
        await this.requisitionsByIds(
          schoolId,
          ids.map((row) => Number(row.id)),
        ),
        Number(total),
      ],
      query.page,
      query.limit,
    );
  }

  async requisition(schoolId: number, id: number): Promise<RequisitionDto> {
    const [row] = await this.requisitionsByIds(schoolId, [id]);
    if (!row) throw AppException.notFound('Requisition not found', 'REQUISITION_NOT_FOUND');
    return row;
  }

  async raise(schoolId: number, dto: RequisitionInputDto, actor: AuthUser): Promise<RequisitionDto> {
    const settings = await this.read.settings(schoolId);
    if (new Set(dto.lines.map((line) => line.item_id)).size !== dto.lines.length) {
      throw AppException.validation([{ field: 'lines', message: 'An item is listed twice' }]);
    }
    const id = await this.dataSource.transaction(async (manager) => {
      await this.store(manager, schoolId, dto.store_id);
      await this.checkRecipient(manager, schoolId, dto);
      await this.itemMap(
        manager,
        schoolId,
        dto.lines.map((line) => line.item_id),
      );
      const school = await this.read.schoolInfo(manager, schoolId);
      const year = this.read.today().slice(0, 4);
      const requisition = await manager.save(
        manager.create(Requisition, {
          school_id: schoolId,
          requisition_no: documentNumber(
            school.code,
            'REQ',
            year,
            await this.sequences.next(manager, schoolId, `inventory_requisition:${year}`),
          ),
          store_id: dto.store_id,
          department_id: dto.department_id ?? null,
          requested_for_user_id: dto.requested_for_user_id ?? null,
          section_id: dto.section_id ?? null,
          purpose: dto.purpose,
          needed_by: dto.needed_by ?? null,
          status: settings.approve_requisitions ? 'pending' : 'approved',
          ...(settings.approve_requisitions
            ? {}
            : { decided_by: actor.id, decided_at: new Date(), decision_note: 'Approval not needed' }),
          created_by: actor.id,
        }),
      );
      await manager.insert(
        RequisitionLine,
        dto.lines.map((line) => ({
          school_id: schoolId,
          requisition_id: requisition.id,
          item_id: line.item_id,
          quantity: line.quantity,
          approved_quantity: settings.approve_requisitions ? null : line.quantity,
          issued_quantity: 0,
        })),
      );
      return requisition.id;
    });
    const result = await this.requisition(schoolId, id);
    if (settings.approve_requisitions) {
      await this.notify.roles(schoolId, INVENTORY_APPROVER_ROLES, INVENTORY_TEMPLATES.INVENTORY_APPROVAL_NEEDED, {
        kind: 'Stock requisition',
        number: result.requisition_no,
        summary: `${result.lines.length} ${result.lines.length === 1 ? 'item' : 'items'} for ${result.department?.name ?? result.requested_for?.name ?? result.section?.name ?? 'the school'}`,
        by: actor.name,
        requisition_id: String(result.id),
      });
    }
    return result;
  }

  private async lockRequisition(manager: EntityManager, schoolId: number, id: number): Promise<Requisition> {
    const requisition = await manager.findOne(Requisition, {
      where: { id, school_id: schoolId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!requisition) throw AppException.notFound('Requisition not found', 'REQUISITION_NOT_FOUND');
    return requisition;
  }

  private async tellRaiser(
    requisition: RequisitionDto,
    raisedBy: number | null,
    forUser: number | null,
    actorId: number,
    status: string,
    note?: string | null,
  ) {
    const userIds = [raisedBy, forUser].filter((id): id is number => Boolean(id) && id !== actorId);
    if (!userIds.length) return;
    await this.notify.users(userIds, INVENTORY_TEMPLATES.INVENTORY_REQUEST_UPDATE, {
      kind: 'Stock requisition',
      number: requisition.requisition_no,
      summary: requisition.purpose,
      status,
      note: note ? ` Note: ${note}` : '',
      requisition_id: String(requisition.id),
    });
  }

  async approve(schoolId: number, id: number, dto: RequisitionApproveDto, actor: AuthUser): Promise<RequisitionDto> {
    const people = await this.dataSource.transaction(async (manager) => {
      const requisition = await this.lockRequisition(manager, schoolId, id);
      if (requisition.status !== 'pending')
        throw AppException.conflict(`This requisition is ${requisition.status}`, 'REQUISITION_CLOSED');
      const lines = await manager.findBy(RequisitionLine, { requisition_id: id });
      for (const line of lines) {
        const change = dto.lines?.find((item) => item.item_id === line.item_id);
        if (change && change.approved_quantity > Number(line.quantity)) {
          throw AppException.validation([{ field: 'lines', message: 'Approve at most the quantity asked' }]);
        }
        await manager.update(RequisitionLine, line.id, {
          approved_quantity: change ? change.approved_quantity : Number(line.quantity),
        });
      }
      const extra = dto.lines?.find((item) => !lines.some((line) => line.item_id === item.item_id));
      if (extra)
        throw AppException.validation([
          { field: 'lines', message: `Item ${extra.item_id} is not on this requisition` },
        ]);
      const anything = await manager.query(
        `SELECT 1 FROM requisition_lines WHERE requisition_id = $1 AND approved_quantity > 0 LIMIT 1`,
        [id],
      );
      await manager.update(Requisition, id, {
        status: anything.length ? 'approved' : 'rejected',
        decided_by: actor.id,
        decided_at: new Date(),
        decision_note: dto.note ?? (anything.length ? null : 'Nothing approved'),
      });
      return { raisedBy: requisition.created_by, forUser: requisition.requested_for_user_id };
    });
    const result = await this.requisition(schoolId, id);
    await this.tellRaiser(result, people.raisedBy, people.forUser, actor.id, result.status, dto.note);
    return result;
  }

  async reject(schoolId: number, id: number, dto: RejectDto, actor: AuthUser): Promise<RequisitionDto> {
    const people = await this.dataSource.transaction(async (manager) => {
      const requisition = await this.lockRequisition(manager, schoolId, id);
      if (requisition.status !== 'pending')
        throw AppException.conflict(`This requisition is ${requisition.status}`, 'REQUISITION_CLOSED');
      await manager.update(Requisition, id, {
        status: 'rejected',
        decided_by: actor.id,
        decided_at: new Date(),
        decision_note: dto.note,
      });
      return { raisedBy: requisition.created_by, forUser: requisition.requested_for_user_id };
    });
    const result = await this.requisition(schoolId, id);
    await this.tellRaiser(result, people.raisedBy, people.forUser, actor.id, 'rejected', dto.note);
    return result;
  }

  async issueRequisition(
    schoolId: number,
    id: number,
    dto: RequisitionIssueDto,
    actor: AuthUser,
  ): Promise<RequisitionDto> {
    const people = await this.dataSource.transaction(async (manager) => {
      const requisition = await this.lockRequisition(manager, schoolId, id);
      if (!['approved', 'partly_issued'].includes(requisition.status)) {
        throw AppException.conflict(
          requisition.status === 'pending'
            ? 'Approve the requisition first'
            : `This requisition is ${requisition.status}`,
          'REQUISITION_NOT_APPROVED',
        );
      }
      const lines = await manager.findBy(RequisitionLine, { requisition_id: id });
      const items = await this.itemMap(
        manager,
        schoolId,
        lines.map((line) => line.item_id),
      );
      let issuedNow = 0;
      for (const line of lines) {
        const remaining = round2(Number(line.approved_quantity ?? 0) - Number(line.issued_quantity));
        const asked = dto.lines?.find((item) => item.item_id === line.item_id);
        const quantity = asked ? asked.quantity : remaining;
        if (quantity > remaining) {
          throw AppException.validation([
            { field: 'lines', message: `Only ${remaining} of ${items.get(line.item_id)!.name} is left to issue` },
          ]);
        }
        if (quantity <= 0) continue;
        await this.move(manager, {
          school_id: schoolId,
          item_id: line.item_id,
          store_id: requisition.store_id,
          kind: 'issue',
          quantity: -quantity,
          ref_type: 'requisition',
          ref_id: requisition.id,
          department_id: requisition.department_id,
          user_id: requisition.requested_for_user_id,
          section_id: requisition.section_id,
          note: `${requisition.requisition_no}: ${requisition.purpose}`,
          moved_on: this.read.today(),
          actor_id: actor.id,
        });
        line.issued_quantity = round2(Number(line.issued_quantity) + quantity);
        await manager.update(RequisitionLine, line.id, { issued_quantity: line.issued_quantity });
        issuedNow += 1;
      }
      if (!issuedNow) throw AppException.validation([{ field: 'lines', message: 'Nothing to issue' }]);
      const status = requisitionStatusAfterIssue(
        lines.map((line) => ({ approved: Number(line.approved_quantity ?? 0), issued: Number(line.issued_quantity) })),
      );
      await manager.update(Requisition, id, { status, issued_at: new Date(), issued_by: actor.id });
      return { raisedBy: requisition.created_by, forUser: requisition.requested_for_user_id };
    });
    const result = await this.requisition(schoolId, id);
    await this.tellRaiser(
      result,
      people.raisedBy,
      people.forUser,
      actor.id,
      result.status === 'issued' ? 'issued' : 'partly issued',
    );
    return result;
  }

  async cancel(schoolId: number, id: number, actor: AuthUser): Promise<RequisitionDto> {
    await this.dataSource.transaction(async (manager) => {
      const requisition = await this.lockRequisition(manager, schoolId, id);
      if (!['pending', 'approved'].includes(requisition.status)) {
        throw AppException.conflict(
          `A ${requisition.status.replace('_', ' ')} requisition cannot be cancelled`,
          'REQUISITION_CLOSED',
        );
      }
      await manager.update(Requisition, id, { status: 'cancelled', decided_by: actor.id, decided_at: new Date() });
    });
    return this.requisition(schoolId, id);
  }

  async lowItems(schoolId: number, limit: number): Promise<StockItemDto[]> {
    const page = await this.items(schoolId, {
      page: 1,
      limit,
      low: true,
      is_active: true,
      order: 'asc',
      sort: 'quantity',
    });
    return page.items;
  }
}
