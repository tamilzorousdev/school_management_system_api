import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { monthStartIn, todayIn } from '../../shared/dates';
import { documentNo, receiveStatus } from './canteen.logic';
import { canCancelPurchase, linesTotal, receiveRefusal, round3 } from './canteen-supply.logic';
import { CanteenStockService } from './canteen-stock.service';
import {
  CanteenPurchaseDto,
  CanteenPurchaseInputDto,
  CanteenPurchaseInsightsDto,
  CanteenPurchaseLineDto,
  CanteenPurchaseQueryDto,
  CanteenReceiveDto,
  CanteenSupplierDetailDto,
  CanteenSupplierDto,
  CanteenSupplierInputDto,
  CanteenSupplierQueryDto,
  CanteenSupplierUpdateDto,
} from './dto/canteen-supply.dto';
import { CanteenStockItem, PurchaseLine, PurchaseOrder, Supplier } from './entities/canteen-supply.entity';

const SUPPLIER_SORTS = { name: 's.name', created_at: 's.created_at' };
const PURCHASE_SORTS = {
  order_date: 'p.order_date',
  total_amount: 'p.total_amount',
  po_no: 'p.po_no',
  created_at: 'p.created_at',
};
const OPEN_STATUSES = ['draft', 'ordered', 'partial'];

const supplierDto = (row: Supplier): CanteenSupplierDto => ({
  id: row.id,
  name: row.name,
  contact_person: row.contact_person,
  mobile: row.mobile,
  email: row.email,
  address: row.address,
  gstin: row.gstin,
  supplies: row.supplies,
  active: row.active,
  created_at: row.created_at,
});

@Injectable()
export class CanteenPurchaseService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly stock: CanteenStockService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
    @InjectRepository(Supplier) private readonly suppliers: Repository<Supplier>,
    @InjectRepository(PurchaseOrder) private readonly orders: Repository<PurchaseOrder>,
    @InjectRepository(PurchaseLine) private readonly lines: Repository<PurchaseLine>,
  ) {}

  private today(): string {
    return todayIn(this.app.timeZone);
  }

  private async findSupplier(schoolId: number, id: number): Promise<Supplier> {
    const supplier = await this.suppliers.findOne({ where: { id, school_id: schoolId } });
    if (!supplier) throw AppException.notFound('Supplier not found', 'SUPPLIER_NOT_FOUND');
    return supplier;
  }

  private async assertSupplierName(schoolId: number, name: string, exceptId?: number): Promise<void> {
    const clash = await this.suppliers
      .createQueryBuilder('s')
      .where('s.school_id = :schoolId AND LOWER(s.name) = LOWER(:name)', { schoolId, name })
      .andWhere(exceptId ? 's.id <> :exceptId' : '1=1', { exceptId })
      .getExists();
    if (clash) throw AppException.conflict('A supplier with this name already exists', 'SUPPLIER_EXISTS');
  }

  async listSuppliers(schoolId: number, query: CanteenSupplierQueryDto): Promise<Paginated<CanteenSupplierDto>> {
    const qb = this.suppliers.createQueryBuilder('s').where('s.school_id = :schoolId', { schoolId });
    if (query.active !== undefined) qb.andWhere('s.active = :active', { active: query.active });
    const page = await listQuery(qb, query, {
      searchable: ['s.name', 's.contact_person', 's.mobile', 's.supplies'],
      sortable: SUPPLIER_SORTS,
      defaultSort: 'name',
    });
    return { ...page, items: page.items.map(supplierDto) };
  }

  async getSupplier(schoolId: number, id: number): Promise<CanteenSupplierDetailDto> {
    const supplier = await this.findSupplier(schoolId, id);
    const [totals] = await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE status <> 'cancelled')::int AS purchase_count,
        COUNT(*) FILTER (WHERE status IN ('draft', 'ordered', 'partial'))::int AS open_purchase_count,
        COALESCE(SUM(total_amount) FILTER (WHERE status <> 'cancelled'), 0)::float AS purchase_total,
        MAX(order_date) FILTER (WHERE status <> 'cancelled') AS last_order_date
       FROM canteen_purchase_orders WHERE school_id = $1 AND supplier_id = $2`,
      [schoolId, id],
    );
    return {
      ...supplierDto(supplier),
      purchase_count: totals.purchase_count,
      open_purchase_count: totals.open_purchase_count,
      purchase_total: Number(totals.purchase_total),
      last_order_date: totals.last_order_date ?? null,
    };
  }

  async createSupplier(schoolId: number, dto: CanteenSupplierInputDto): Promise<CanteenSupplierDto> {
    await this.assertSupplierName(schoolId, dto.name);
    const saved = await this.suppliers.save(
      this.suppliers.create({
        school_id: schoolId,
        name: dto.name,
        contact_person: dto.contact_person ?? null,
        mobile: dto.mobile,
        email: dto.email ?? null,
        address: dto.address ?? null,
        gstin: dto.gstin ?? null,
        supplies: dto.supplies ?? null,
        active: dto.active ?? true,
      }),
    );
    return supplierDto(saved);
  }

  async updateSupplier(schoolId: number, id: number, dto: CanteenSupplierUpdateDto): Promise<CanteenSupplierDto> {
    await this.findSupplier(schoolId, id);
    if (dto.name !== undefined) await this.assertSupplierName(schoolId, dto.name, id);
    const changes = Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined));
    await this.suppliers.update({ id, school_id: schoolId }, changes);
    return supplierDto(await this.findSupplier(schoolId, id));
  }

  async removeSupplier(schoolId: number, id: number): Promise<void> {
    await this.findSupplier(schoolId, id);
    const open = await this.orders.exists({
      where: { school_id: schoolId, supplier_id: id, status: In(OPEN_STATUSES) },
    });
    if (open) throw AppException.conflict('This supplier has open purchase orders', 'SUPPLIER_IN_USE');
    await this.suppliers.softDelete({ id, school_id: schoolId });
  }

  private async findOrder(schoolId: number, id: number): Promise<PurchaseOrder> {
    const order = await this.orders.findOne({ where: { id, school_id: schoolId } });
    if (!order) throw AppException.notFound('Purchase order not found', 'PURCHASE_NOT_FOUND');
    return order;
  }

  private async toDtos(schoolId: number, rows: PurchaseOrder[]): Promise<CanteenPurchaseDto[]> {
    if (!rows.length) return [];
    const supplierIds = [...new Set(rows.map((row) => row.supplier_id))];
    const suppliers = await this.suppliers.find({
      where: { school_id: schoolId, id: In(supplierIds) },
      withDeleted: true,
    });
    const names = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
    const lineRows = await this.lines.find({
      where: { school_id: schoolId, purchase_order_id: In(rows.map((row) => row.id)) },
      order: { id: 'ASC' },
    });
    const stockItems = await this.dataSource.getRepository(CanteenStockItem).find({
      where: { school_id: schoolId, id: In([...new Set(lineRows.map((line) => line.stock_item_id))]) },
      withDeleted: true,
    });
    const itemById = new Map(stockItems.map((item) => [item.id, item]));
    const byOrder = new Map<number, CanteenPurchaseLineDto[]>();
    for (const line of lineRows) {
      const item = itemById.get(line.stock_item_id);
      const entry: CanteenPurchaseLineDto = {
        id: line.id,
        stock_item_id: line.stock_item_id,
        stock_item_name: item?.name ?? '',
        unit: item?.unit ?? 'kg',
        quantity: line.quantity,
        unit_cost: line.unit_cost,
        received_quantity: line.received_quantity,
        line_total: Math.round(line.quantity * line.unit_cost * 100) / 100,
      };
      byOrder.set(line.purchase_order_id, [...(byOrder.get(line.purchase_order_id) ?? []), entry]);
    }
    return rows.map((row) => {
      const lines = byOrder.get(row.id) ?? [];
      return {
        id: row.id,
        po_no: row.po_no,
        supplier: { id: row.supplier_id, name: names.get(row.supplier_id) ?? '' },
        order_date: row.order_date,
        expected_date: row.expected_date,
        status: row.status,
        total_amount: row.total_amount,
        note: row.note,
        received_at: row.received_at,
        line_count: lines.length,
        lines,
        created_at: row.created_at,
      };
    });
  }

  async get(schoolId: number, id: number): Promise<CanteenPurchaseDto> {
    const [dto] = await this.toDtos(schoolId, [await this.findOrder(schoolId, id)]);
    return dto!;
  }

  async list(schoolId: number, query: CanteenPurchaseQueryDto): Promise<Paginated<CanteenPurchaseDto>> {
    const qb = this.orders.createQueryBuilder('p').where('p.school_id = :schoolId', { schoolId });
    if (query.status) qb.andWhere('p.status = :status', { status: query.status });
    if (query.supplier_id) qb.andWhere('p.supplier_id = :supplierId', { supplierId: query.supplier_id });
    if (query.from) qb.andWhere('p.order_date >= :from', { from: query.from });
    if (query.to) qb.andWhere('p.order_date <= :to', { to: query.to });
    const page = await listQuery(qb, query, {
      searchable: ['p.po_no', 'p.note'],
      sortable: PURCHASE_SORTS,
      defaultSort: 'created_at',
    });
    return { ...page, items: await this.toDtos(schoolId, page.items) };
  }

  async create(schoolId: number, dto: CanteenPurchaseInputDto): Promise<CanteenPurchaseDto> {
    const supplier = await this.findSupplier(schoolId, dto.supplier_id);
    if (!supplier.active) throw AppException.conflict('This supplier is inactive', 'SUPPLIER_INACTIVE');
    const itemIds = [...new Set(dto.lines.map((line) => line.stock_item_id))];
    if (itemIds.length !== dto.lines.length) {
      throw AppException.badRequest('A stock item can appear only once in an order', 'PURCHASE_DUPLICATE_ITEM');
    }
    const found = await this.dataSource
      .getRepository(CanteenStockItem)
      .count({ where: { school_id: schoolId, id: In(itemIds) } });
    if (found !== itemIds.length) throw AppException.badRequest('Stock item not found', 'STOCK_ITEM_NOT_FOUND');
    const orderDate = dto.order_date ?? this.today();
    if (dto.expected_date && dto.expected_date < orderDate) {
      throw AppException.badRequest('Expected date is before the order date', 'PURCHASE_DATE_INVALID');
    }
    const id = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [schoolId, Number(orderDate.replace(/-/g, ''))]);
      const serial =
        (await manager.count(PurchaseOrder, { where: { school_id: schoolId, order_date: orderDate } })) + 1;
      const order = await manager.save(
        manager.create(PurchaseOrder, {
          school_id: schoolId,
          po_no: documentNo('PO', orderDate, serial),
          supplier_id: supplier.id,
          order_date: orderDate,
          expected_date: dto.expected_date ?? null,
          status: 'draft',
          total_amount: linesTotal(dto.lines),
          note: dto.note ?? null,
        }),
      );
      await manager.save(
        dto.lines.map((line) =>
          manager.create(PurchaseLine, {
            school_id: schoolId,
            purchase_order_id: order.id,
            stock_item_id: line.stock_item_id,
            quantity: line.quantity,
            unit_cost: line.unit_cost,
            received_quantity: 0,
          }),
        ),
      );
      return order.id;
    });
    return this.get(schoolId, id);
  }

  async place(schoolId: number, id: number): Promise<CanteenPurchaseDto> {
    const order = await this.findOrder(schoolId, id);
    if (order.status !== 'draft') {
      throw AppException.conflict('Only a draft purchase order can be placed', 'PURCHASE_STATE_INVALID');
    }
    await this.orders.update({ id, school_id: schoolId }, { status: 'ordered' });
    return this.get(schoolId, id);
  }

  async cancel(schoolId: number, id: number): Promise<CanteenPurchaseDto> {
    const order = await this.findOrder(schoolId, id);
    const lines = await this.lines.find({ where: { school_id: schoolId, purchase_order_id: id } });
    const received = lines.reduce((sum, line) => sum + line.received_quantity, 0);
    if (!canCancelPurchase(order.status, received)) {
      throw AppException.conflict(
        'Only a draft or ordered purchase with nothing received can be cancelled',
        'PURCHASE_STATE_INVALID',
      );
    }
    await this.orders.update({ id, school_id: schoolId }, { status: 'cancelled' });
    return this.get(schoolId, id);
  }

  async receive(schoolId: number, id: number, dto: CanteenReceiveDto, actorId: number): Promise<CanteenPurchaseDto> {
    await this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(PurchaseOrder, {
        where: { id, school_id: schoolId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw AppException.notFound('Purchase order not found', 'PURCHASE_NOT_FOUND');
      if (order.status !== 'ordered' && order.status !== 'partial') {
        throw AppException.conflict('Only an ordered purchase can receive stock', 'PURCHASE_STATE_INVALID');
      }
      const lines = await manager.find(PurchaseLine, {
        where: { school_id: schoolId, purchase_order_id: id },
        order: { id: 'ASC' },
      });
      const byId = new Map(lines.map((line) => [line.id, line]));
      for (const entry of dto.lines) {
        const line = byId.get(entry.line_id);
        if (!line)
          throw AppException.badRequest('Line does not belong to this purchase order', 'PURCHASE_LINE_NOT_FOUND');
        const refusal = receiveRefusal(line, entry.quantity);
        if (refusal) {
          throw AppException.badRequest(
            refusal === 'RECEIVE_EXCEEDS_ORDERED'
              ? 'Cannot receive more than was ordered'
              : 'Received quantity must be greater than zero',
            refusal,
          );
        }
        await this.stock.move(manager, {
          school_id: schoolId,
          stock_item_id: line.stock_item_id,
          kind: 'purchase',
          quantity: entry.quantity,
          unit_cost: line.unit_cost,
          reference_type: 'purchase',
          reference_id: id,
          note: order.po_no,
          actor_id: actorId,
        });
        await manager.update(CanteenStockItem, line.stock_item_id, { cost_per_unit: line.unit_cost });
        line.received_quantity = round3(line.received_quantity + entry.quantity);
        await manager.update(PurchaseLine, line.id, { received_quantity: line.received_quantity });
      }
      const status = receiveStatus(lines);
      await manager.update(PurchaseOrder, id, {
        status,
        received_at: status === 'received' ? new Date() : null,
      });
    });
    return this.get(schoolId, id);
  }

  async insights(schoolId: number): Promise<CanteenPurchaseInsightsDto> {
    const today = this.today();
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
        COUNT(*) FILTER (WHERE status = 'ordered')::int AS ordered,
        COUNT(*) FILTER (WHERE status = 'partial')::int AS partial,
        COUNT(*) FILTER (WHERE status = 'received')::int AS received,
        COALESCE(SUM(total_amount) FILTER (WHERE status <> 'cancelled' AND order_date >= $2::date), 0)::float AS month_total,
        COUNT(*) FILTER (WHERE status IN ('ordered', 'partial') AND expected_date IS NOT NULL AND expected_date < $3::date)::int AS overdue
       FROM canteen_purchase_orders WHERE school_id = $1`,
      [schoolId, monthStartIn(this.app.timeZone), today],
    );
    return { ...row, open_orders: row.draft + row.ordered + row.partial, month_total: Number(row.month_total) };
  }
}
