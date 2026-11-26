import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AppException, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { stockStatus } from './canteen.logic';
import { addDays, daysUntil, round3, stockDelta, stockRefusal } from './canteen-supply.logic';
import {
  ADJUST_KINDS,
  CanteenStockAdjustDto,
  CanteenStockInsightsDto,
  CanteenStockItemDto,
  CanteenStockItemInputDto,
  CanteenStockItemQueryDto,
  CanteenStockItemUpdateDto,
  CanteenStockMovementDto,
  CanteenStockMovementQueryDto,
} from './dto/canteen-supply.dto';
import { RecipeLine } from './entities/canteen-menu.entity';
import {
  CanteenStockItem,
  CanteenStockMovement,
  PurchaseLine,
  PurchaseOrder,
  StockMovementKind,
  Supplier,
} from './entities/canteen-supply.entity';

export interface StockMoveInput {
  school_id: number;
  stock_item_id: number;
  kind: StockMovementKind;
  quantity: number;
  unit_cost?: number | null;
  reference_type?: string | null;
  reference_id?: number | null;
  note?: string | null;
  actor_id?: number | null;
}

const ITEM_SORTS = {
  name: 's.name',
  quantity: 's.quantity_on_hand',
  expiry_date: 's.expiry_date',
  cost_per_unit: 's.cost_per_unit',
  created_at: 's.created_at',
};

const EXPIRING_DAYS = 7;

@Injectable()
export class CanteenStockService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
    @InjectRepository(CanteenStockItem) private readonly items: Repository<CanteenStockItem>,
    @InjectRepository(CanteenStockMovement) private readonly movements: Repository<CanteenStockMovement>,
    @InjectRepository(Supplier) private readonly suppliers: Repository<Supplier>,
  ) {}

  private today(): string {
    return todayIn(this.app.timeZone);
  }

  async move(manager: EntityManager, input: StockMoveInput): Promise<CanteenStockMovement> {
    const delta = stockDelta(input.kind, input.quantity);
    if (delta === null)
      throw AppException.badRequest('Quantity is not valid for this movement', 'STOCK_QUANTITY_INVALID');
    const item = await manager.findOne(CanteenStockItem, {
      where: { id: input.stock_item_id, school_id: input.school_id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!item) throw AppException.notFound('Stock item not found', 'STOCK_ITEM_NOT_FOUND');
    if (stockRefusal(item.quantity_on_hand, delta)) {
      throw AppException.conflict(
        `Not enough ${item.name} in stock: ${item.quantity_on_hand} ${item.unit} available`,
        'STOCK_INSUFFICIENT',
      );
    }
    const balance = round3(item.quantity_on_hand + delta);
    await manager.update(CanteenStockItem, item.id, { quantity_on_hand: balance });
    return manager.save(
      manager.create(CanteenStockMovement, {
        school_id: input.school_id,
        stock_item_id: item.id,
        kind: input.kind,
        quantity: delta,
        balance_after: balance,
        unit_cost: input.unit_cost ?? null,
        reference_type: input.reference_type ?? null,
        reference_id: input.reference_id ?? null,
        note: input.note ?? null,
        created_by: input.actor_id ?? null,
      }),
    );
  }

  async find(schoolId: number, id: number): Promise<CanteenStockItem> {
    const item = await this.items.findOne({ where: { id, school_id: schoolId } });
    if (!item) throw AppException.notFound('Stock item not found', 'STOCK_ITEM_NOT_FOUND');
    return item;
  }

  private async assertSupplier(schoolId: number, supplierId: number | null | undefined): Promise<void> {
    if (!supplierId) return;
    const found = await this.suppliers.exists({ where: { id: supplierId, school_id: schoolId } });
    if (!found) throw AppException.badRequest('Supplier not found', 'SUPPLIER_NOT_FOUND');
  }

  private async assertUniqueName(schoolId: number, name: string, exceptId?: number): Promise<void> {
    const clash = await this.items
      .createQueryBuilder('s')
      .where('s.school_id = :schoolId', { schoolId })
      .andWhere('LOWER(s.name) = LOWER(:name)', { name })
      .andWhere(exceptId ? 's.id <> :exceptId' : '1=1', { exceptId })
      .getExists();
    if (clash) throw AppException.conflict('A stock item with this name already exists', 'STOCK_ITEM_EXISTS');
  }

  private async toDtos(schoolId: number, rows: CanteenStockItem[]): Promise<CanteenStockItemDto[]> {
    const ids = [...new Set(rows.map((row) => row.supplier_id).filter((id): id is number => !!id))];
    const suppliers = ids.length ? await this.suppliers.find({ where: { school_id: schoolId, id: In(ids) } }) : [];
    const names = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
    const today = this.today();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      unit: row.unit,
      quantity_on_hand: row.quantity_on_hand,
      reorder_level: row.reorder_level,
      cost_per_unit: row.cost_per_unit,
      stock_value: Math.round(row.quantity_on_hand * row.cost_per_unit * 100) / 100,
      expiry_date: row.expiry_date,
      days_to_expiry: row.expiry_date ? daysUntil(row.expiry_date, today) : null,
      status: stockStatus(row.quantity_on_hand, row.reorder_level),
      supplier: row.supplier_id ? { id: row.supplier_id, name: names.get(row.supplier_id) ?? '' } : null,
      active: row.active,
      created_at: row.created_at,
    }));
  }

  private filtered(schoolId: number, query: CanteenStockItemQueryDto) {
    const qb = this.items.createQueryBuilder('s').where('s.school_id = :schoolId', { schoolId });
    if (query.status === 'out') qb.andWhere('s.quantity_on_hand <= 0');
    if (query.status === 'low') qb.andWhere('s.quantity_on_hand > 0 AND s.quantity_on_hand <= s.reorder_level');
    if (query.status === 'ok') qb.andWhere('s.quantity_on_hand > s.reorder_level');
    if (query.expiring_within_days !== undefined) {
      qb.andWhere('s.expiry_date IS NOT NULL AND s.expiry_date <= :limit', {
        limit: addDays(this.today(), query.expiring_within_days),
      });
    }
    if (query.supplier_id) qb.andWhere('s.supplier_id = :supplierId', { supplierId: query.supplier_id });
    if (query.active !== undefined) qb.andWhere('s.active = :active', { active: query.active });
    return qb;
  }

  async list(schoolId: number, query: CanteenStockItemQueryDto): Promise<Paginated<CanteenStockItemDto>> {
    const page = await listQuery(this.filtered(schoolId, query), query, {
      searchable: ['s.name', 's.code'],
      sortable: ITEM_SORTS,
      defaultSort: 'name',
    });
    return { ...page, items: await this.toDtos(schoolId, page.items) };
  }

  async lowStock(schoolId: number, query: CanteenStockItemQueryDto): Promise<Paginated<CanteenStockItemDto>> {
    const qb = this.filtered(schoolId, { ...query, status: undefined }).andWhere(
      's.active = true AND s.quantity_on_hand <= s.reorder_level',
    );
    const page = await listQuery(qb, query, {
      searchable: ['s.name', 's.code'],
      sortable: ITEM_SORTS,
      defaultSort: 'quantity',
    });
    return { ...page, items: await this.toDtos(schoolId, page.items) };
  }

  async get(schoolId: number, id: number): Promise<CanteenStockItemDto> {
    const item = await this.find(schoolId, id);
    const [dto] = await this.toDtos(schoolId, [item]);
    return dto!;
  }

  async create(schoolId: number, dto: CanteenStockItemInputDto, actorId: number): Promise<CanteenStockItemDto> {
    await this.assertUniqueName(schoolId, dto.name);
    await this.assertSupplier(schoolId, dto.supplier_id);
    const id = await this.dataSource.transaction(async (manager) => {
      const item = await manager.save(
        manager.create(CanteenStockItem, {
          school_id: schoolId,
          name: dto.name,
          code: dto.code ?? null,
          unit: dto.unit,
          reorder_level: dto.reorder_level ?? 0,
          cost_per_unit: dto.cost_per_unit ?? 0,
          expiry_date: dto.expiry_date ?? null,
          supplier_id: dto.supplier_id ?? null,
          active: dto.active ?? true,
          quantity_on_hand: 0,
        }),
      );
      if (dto.opening_quantity && dto.opening_quantity > 0) {
        await this.move(manager, {
          school_id: schoolId,
          stock_item_id: item.id,
          kind: 'adjustment',
          quantity: dto.opening_quantity,
          unit_cost: dto.cost_per_unit ?? null,
          note: 'Opening stock',
          actor_id: actorId,
        });
      }
      return item.id;
    });
    return this.get(schoolId, id);
  }

  async update(schoolId: number, id: number, dto: CanteenStockItemUpdateDto): Promise<CanteenStockItemDto> {
    const item = await this.find(schoolId, id);
    if (dto.name !== undefined) await this.assertUniqueName(schoolId, dto.name, id);
    if (dto.supplier_id !== undefined) await this.assertSupplier(schoolId, dto.supplier_id);
    const changes = Object.fromEntries(
      Object.entries(dto).filter(([key, value]) => key !== 'opening_quantity' && value !== undefined),
    );
    await this.items.update({ id: item.id, school_id: schoolId }, changes);
    return this.get(schoolId, id);
  }

  async remove(schoolId: number, id: number): Promise<void> {
    const item = await this.find(schoolId, id);
    const inRecipe = await this.dataSource
      .getRepository(RecipeLine)
      .exists({ where: { school_id: schoolId, stock_item_id: id } });
    const onOrder = await this.dataSource
      .getRepository(PurchaseLine)
      .createQueryBuilder('l')
      .innerJoin(PurchaseOrder, 'p', 'p.id = l.purchase_order_id')
      .where('l.school_id = :schoolId AND l.stock_item_id = :id', { schoolId, id })
      .andWhere("p.status IN ('draft', 'ordered', 'partial')")
      .getExists();
    if (inRecipe || onOrder) {
      throw AppException.conflict('This stock item is used in a recipe or an open purchase order', 'STOCK_ITEM_IN_USE');
    }
    await this.items.softDelete({ id: item.id, school_id: schoolId });
  }

  async adjust(
    schoolId: number,
    id: number,
    dto: CanteenStockAdjustDto,
    actorId: number,
  ): Promise<CanteenStockMovementDto> {
    if (!ADJUST_KINDS.includes(dto.kind))
      throw AppException.badRequest('Unknown adjustment kind', 'STOCK_KIND_INVALID');
    return this.dataSource.transaction((manager) =>
      this.move(manager, {
        school_id: schoolId,
        stock_item_id: id,
        kind: dto.kind,
        quantity: dto.quantity,
        note: dto.note ?? null,
        actor_id: actorId,
      }),
    );
  }

  async movementsOf(
    schoolId: number,
    id: number,
    query: CanteenStockMovementQueryDto,
  ): Promise<Paginated<CanteenStockMovementDto>> {
    await this.find(schoolId, id);
    const qb = this.movements
      .createQueryBuilder('m')
      .where('m.school_id = :schoolId AND m.stock_item_id = :id', { schoolId, id });
    if (query.kind) qb.andWhere('m.kind = :kind', { kind: query.kind });
    return listQuery(qb, query, {
      searchable: ['m.note'],
      sortable: { created_at: 'm.created_at', quantity: 'm.quantity' },
      defaultSort: 'created_at',
    });
  }

  async insights(schoolId: number): Promise<CanteenStockInsightsDto> {
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total_items,
        COUNT(*) FILTER (WHERE quantity_on_hand <= 0)::int AS out_of_stock,
        COUNT(*) FILTER (WHERE quantity_on_hand > 0 AND quantity_on_hand <= reorder_level)::int AS low_stock,
        COUNT(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date <= $2::date)::int AS expiring_soon,
        COALESCE(SUM(quantity_on_hand * cost_per_unit), 0)::float AS stock_value
       FROM canteen_stock_items WHERE school_id = $1 AND deleted_at IS NULL AND active = true`,
      [schoolId, addDays(this.today(), EXPIRING_DAYS)],
    );
    return { ...row, stock_value: Math.round(Number(row.stock_value) * 100) / 100 };
  }
}
