import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { canMoveBatch, round3, suggestedBatchQuantity } from './canteen-supply.logic';
import { CanteenStockService } from './canteen-stock.service';
import {
  CanteenKitchenBatchCompleteDto,
  CanteenKitchenBatchDto,
  CanteenKitchenBatchInputDto,
  CanteenKitchenBatchQueryDto,
  CanteenKitchenBatchUpdateDto,
  CanteenKitchenInsightsDto,
  CanteenKitchenPlanQueryDto,
  CanteenKitchenPlanRowDto,
  CanteenKitchenQueueDto,
  CanteenKitchenQueueItemDto,
} from './dto/canteen-supply.dto';
import { DailyMenuEntry, FoodItem, MealItem, MealSlot, RecipeLine } from './entities/canteen-menu.entity';
import { CanteenStaff } from './entities/canteen-people.entity';
import { CanteenOrder } from './entities/canteen-sales.entity';
import { KitchenBatch } from './entities/canteen-supply.entity';

const BATCH_SORTS = { batch_date: 'b.batch_date', created_at: 'b.created_at', planned_quantity: 'b.planned_quantity' };
const SLOT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'snacks', 'dinner'];

@Injectable()
export class CanteenKitchenService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly stock: CanteenStockService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
    @InjectRepository(KitchenBatch) private readonly batches: Repository<KitchenBatch>,
    @InjectRepository(FoodItem) private readonly foods: Repository<FoodItem>,
    @InjectRepository(CanteenStaff) private readonly cooks: Repository<CanteenStaff>,
  ) {}

  private today(): string {
    return todayIn(this.app.timeZone);
  }

  async queue(schoolId: number, date?: string): Promise<CanteenKitchenQueueDto> {
    const day = date ?? this.today();
    const rows: {
      food_item_id: number | null;
      meal_id: number | null;
      quantity: number;
      order_id: number;
      token_label: string;
    }[] = await this.dataSource.query(
      `SELECT oi.food_item_id, oi.meal_id, oi.quantity::int AS quantity, o.id AS order_id, o.token_label
         FROM canteen_order_items oi
         JOIN canteen_orders o ON o.id = oi.order_id
         WHERE o.school_id = $1 AND o.order_date = $2 AND o.status IN ('placed', 'preparing') AND o.deleted_at IS NULL
         ORDER BY o.token_no`,
      [schoolId, day],
    );
    const mealIds = [...new Set(rows.map((row) => row.meal_id).filter((id): id is number => !!id))];
    const mealItems = mealIds.length
      ? await this.dataSource.getRepository(MealItem).find({ where: { school_id: schoolId, meal_id: In(mealIds) } })
      : [];
    const parts = new Map<number, MealItem[]>();
    for (const item of mealItems) parts.set(item.meal_id, [...(parts.get(item.meal_id) ?? []), item]);
    const totals = new Map<number, { quantity: number; orders: Set<number>; tokens: Set<string> }>();
    const add = (foodId: number, quantity: number, row: { order_id: number; token_label: string }) => {
      const entry = totals.get(foodId) ?? { quantity: 0, orders: new Set<number>(), tokens: new Set<string>() };
      entry.quantity += quantity;
      entry.orders.add(row.order_id);
      entry.tokens.add(row.token_label);
      totals.set(foodId, entry);
    };
    for (const row of rows) {
      if (row.food_item_id) add(row.food_item_id, row.quantity, row);
      else if (row.meal_id) {
        for (const part of parts.get(row.meal_id) ?? []) add(part.food_item_id, row.quantity * part.quantity, row);
      }
    }
    const foodRows = totals.size
      ? await this.foods.find({ where: { school_id: schoolId, id: In([...totals.keys()]) }, withDeleted: true })
      : [];
    const foodById = new Map(foodRows.map((food) => [food.id, food]));
    const items: CanteenKitchenQueueItemDto[] = [...totals.entries()]
      .map(([foodId, entry]) => ({
        food_item_id: foodId,
        name: foodById.get(foodId)?.name ?? '',
        total_quantity: entry.quantity,
        order_count: entry.orders.size,
        tokens: [...entry.tokens],
        prep_minutes: foodById.get(foodId)?.prep_minutes ?? 0,
      }))
      .sort((a, b) => b.total_quantity - a.total_quantity || a.name.localeCompare(b.name));
    return { date: day, open_orders: new Set(rows.map((row) => row.order_id)).size, items };
  }

  async plan(schoolId: number, query: CanteenKitchenPlanQueryDto): Promise<CanteenKitchenPlanRowDto[]> {
    const day = query.date ?? this.today();
    const menuQb = this.dataSource
      .getRepository(DailyMenuEntry)
      .createQueryBuilder('d')
      .where('d.school_id = :schoolId AND d.menu_date = :day AND d.active = true', { schoolId, day });
    if (query.slot) menuQb.andWhere('d.slot = :slot', { slot: query.slot });
    const entries = await menuQb.getMany();
    const mealIds = [...new Set(entries.map((entry) => entry.meal_id).filter((id): id is number => !!id))];
    const mealItems = mealIds.length
      ? await this.dataSource.getRepository(MealItem).find({ where: { school_id: schoolId, meal_id: In(mealIds) } })
      : [];
    const wanted = new Map<string, { slot: MealSlot; food_item_id: number; limit: number | null; sold: number }>();
    const accumulate = (slot: MealSlot, foodId: number, limit: number | null, sold: number) => {
      const key = `${slot}:${foodId}`;
      const current = wanted.get(key) ?? { slot, food_item_id: foodId, limit: null, sold: 0 };
      current.sold += sold;
      if (limit !== null) current.limit = (current.limit ?? 0) + limit;
      wanted.set(key, current);
    };
    for (const entry of entries) {
      if (entry.food_item_id) accumulate(entry.slot, entry.food_item_id, entry.quantity_limit, entry.sold_quantity);
      else if (entry.meal_id) {
        for (const part of mealItems.filter((item) => item.meal_id === entry.meal_id)) {
          accumulate(
            entry.slot,
            part.food_item_id,
            entry.quantity_limit === null ? null : entry.quantity_limit * part.quantity,
            entry.sold_quantity * part.quantity,
          );
        }
      }
    }
    const planned = await this.batches
      .createQueryBuilder('b')
      .select('b.slot', 'slot')
      .addSelect('b.food_item_id', 'food_item_id')
      .addSelect('SUM(b.planned_quantity)::int', 'planned')
      .where("b.school_id = :schoolId AND b.batch_date = :day AND b.status <> 'cancelled'", { schoolId, day })
      .groupBy('b.slot')
      .addGroupBy('b.food_item_id')
      .getRawMany<{ slot: string; food_item_id: number; planned: number }>();
    const plannedBy = new Map(planned.map((row) => [`${row.slot}:${row.food_item_id}`, Number(row.planned)]));
    const foodRows = wanted.size
      ? await this.foods.find({
          where: { school_id: schoolId, id: In([...new Set([...wanted.values()].map((entry) => entry.food_item_id))]) },
          withDeleted: true,
        })
      : [];
    const names = new Map(foodRows.map((food) => [food.id, food.name]));
    return [...wanted.entries()]
      .map(([key, entry]) => ({
        slot: entry.slot,
        food_item_id: entry.food_item_id,
        name: names.get(entry.food_item_id) ?? '',
        quantity_limit: entry.limit,
        sold_quantity: entry.sold,
        planned_quantity: plannedBy.get(key) ?? 0,
        suggested_quantity: suggestedBatchQuantity(entry.limit, entry.sold, plannedBy.get(key) ?? 0),
      }))
      .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot) || a.name.localeCompare(b.name));
  }

  private async findBatch(schoolId: number, id: number): Promise<KitchenBatch> {
    const batch = await this.batches.findOne({ where: { id, school_id: schoolId } });
    if (!batch) throw AppException.notFound('Batch not found', 'BATCH_NOT_FOUND');
    return batch;
  }

  private async toDtos(schoolId: number, rows: KitchenBatch[]): Promise<CanteenKitchenBatchDto[]> {
    if (!rows.length) return [];
    const foodRows = await this.foods.find({
      where: { school_id: schoolId, id: In([...new Set(rows.map((row) => row.food_item_id))]) },
      withDeleted: true,
    });
    const cookIds = [...new Set(rows.map((row) => row.cook_id).filter((id): id is number => !!id))];
    const cookRows = cookIds.length
      ? await this.cooks.find({ where: { school_id: schoolId, id: In(cookIds) }, withDeleted: true })
      : [];
    const foods = new Map(foodRows.map((food) => [food.id, food.name]));
    const cooks = new Map(cookRows.map((cook) => [cook.id, cook.name]));
    return rows.map((row) => ({
      id: row.id,
      batch_date: row.batch_date,
      slot: row.slot,
      food_item_id: row.food_item_id,
      food_item_name: foods.get(row.food_item_id) ?? '',
      planned_quantity: row.planned_quantity,
      prepared_quantity: row.prepared_quantity,
      status: row.status,
      cook: row.cook_id ? { id: row.cook_id, name: cooks.get(row.cook_id) ?? '' } : null,
      started_at: row.started_at,
      completed_at: row.completed_at,
      note: row.note,
    }));
  }

  async get(schoolId: number, id: number): Promise<CanteenKitchenBatchDto> {
    const [dto] = await this.toDtos(schoolId, [await this.findBatch(schoolId, id)]);
    return dto!;
  }

  async list(schoolId: number, query: CanteenKitchenBatchQueryDto): Promise<Paginated<CanteenKitchenBatchDto>> {
    const qb = this.batches
      .createQueryBuilder('b')
      .leftJoin(FoodItem, 'f', 'f.id = b.food_item_id')
      .where('b.school_id = :schoolId', { schoolId });
    if (query.date) qb.andWhere('b.batch_date = :date', { date: query.date });
    if (query.slot) qb.andWhere('b.slot = :slot', { slot: query.slot });
    if (query.status) qb.andWhere('b.status = :status', { status: query.status });
    const page = await listQuery(qb, query, {
      searchable: ['f.name', 'b.note'],
      sortable: BATCH_SORTS,
      defaultSort: 'batch_date',
    });
    return { ...page, items: await this.toDtos(schoolId, page.items) };
  }

  private async assertFoodAndCook(schoolId: number, foodId: number | undefined, cookId: number | null | undefined) {
    if (foodId !== undefined) {
      const food = await this.foods.exists({ where: { id: foodId, school_id: schoolId } });
      if (!food) throw AppException.badRequest('Food item not found', 'FOOD_ITEM_NOT_FOUND');
    }
    if (cookId) {
      const cook = await this.cooks.exists({ where: { id: cookId, school_id: schoolId } });
      if (!cook) throw AppException.badRequest('Canteen staff member not found', 'CANTEEN_STAFF_NOT_FOUND');
    }
  }

  async create(schoolId: number, dto: CanteenKitchenBatchInputDto): Promise<CanteenKitchenBatchDto> {
    await this.assertFoodAndCook(schoolId, dto.food_item_id, dto.cook_id);
    const saved = await this.batches.save(
      this.batches.create({
        school_id: schoolId,
        batch_date: dto.batch_date,
        slot: dto.slot,
        food_item_id: dto.food_item_id,
        planned_quantity: dto.planned_quantity,
        prepared_quantity: 0,
        status: 'planned',
        cook_id: dto.cook_id ?? null,
        note: dto.note ?? null,
      }),
    );
    return this.get(schoolId, saved.id);
  }

  async update(schoolId: number, id: number, dto: CanteenKitchenBatchUpdateDto): Promise<CanteenKitchenBatchDto> {
    const batch = await this.findBatch(schoolId, id);
    if (batch.status !== 'planned' && batch.status !== 'cooking') {
      throw AppException.conflict('A finished batch cannot be changed', 'BATCH_STATE_INVALID');
    }
    await this.assertFoodAndCook(schoolId, undefined, dto.cook_id);
    const changes = Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined));
    await this.batches.update({ id, school_id: schoolId }, changes);
    return this.get(schoolId, id);
  }

  async start(schoolId: number, id: number): Promise<CanteenKitchenBatchDto> {
    const batch = await this.findBatch(schoolId, id);
    if (!canMoveBatch(batch.status, 'cooking')) {
      throw AppException.conflict('Only a planned batch can be started', 'BATCH_STATE_INVALID');
    }
    await this.batches.update({ id, school_id: schoolId }, { status: 'cooking', started_at: new Date() });
    return this.get(schoolId, id);
  }

  async complete(
    schoolId: number,
    id: number,
    dto: CanteenKitchenBatchCompleteDto,
    actorId: number,
  ): Promise<CanteenKitchenBatchDto> {
    await this.dataSource.transaction(async (manager) => {
      const batch = await manager.findOne(KitchenBatch, {
        where: { id, school_id: schoolId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!batch) throw AppException.notFound('Batch not found', 'BATCH_NOT_FOUND');
      if (!canMoveBatch(batch.status, 'done')) {
        throw AppException.conflict('Only a batch that is cooking can be completed', 'BATCH_STATE_INVALID');
      }
      const recipe = await manager.find(RecipeLine, {
        where: { school_id: schoolId, food_item_id: batch.food_item_id },
        order: { id: 'ASC' },
      });
      for (const line of recipe) {
        const quantity = round3(line.quantity * dto.prepared_quantity);
        if (quantity <= 0) continue;
        await this.stock.move(manager, {
          school_id: schoolId,
          stock_item_id: line.stock_item_id,
          kind: 'issue',
          quantity,
          reference_type: 'kitchen_batch',
          reference_id: batch.id,
          note: 'Kitchen batch',
          actor_id: actorId,
        });
      }
      await manager.update(KitchenBatch, batch.id, {
        status: 'done',
        prepared_quantity: dto.prepared_quantity,
        completed_at: new Date(),
      });
    });
    return this.get(schoolId, id);
  }

  async cancel(schoolId: number, id: number): Promise<CanteenKitchenBatchDto> {
    const batch = await this.findBatch(schoolId, id);
    if (!canMoveBatch(batch.status, 'cancelled')) {
      throw AppException.conflict('A finished batch cannot be cancelled', 'BATCH_STATE_INVALID');
    }
    await this.batches.update({ id, school_id: schoolId }, { status: 'cancelled' });
    return this.get(schoolId, id);
  }

  async insights(schoolId: number, date?: string): Promise<CanteenKitchenInsightsDto> {
    const day = date ?? this.today();
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS batches,
        COUNT(*) FILTER (WHERE status = 'planned')::int AS planned,
        COUNT(*) FILTER (WHERE status = 'cooking')::int AS cooking,
        COUNT(*) FILTER (WHERE status = 'done')::int AS done,
        COALESCE(SUM(planned_quantity) FILTER (WHERE status <> 'cancelled'), 0)::int AS planned_portions,
        COALESCE(SUM(prepared_quantity) FILTER (WHERE status = 'done'), 0)::int AS prepared_portions
       FROM canteen_kitchen_batches WHERE school_id = $1 AND batch_date = $2 AND deleted_at IS NULL`,
      [schoolId, day],
    );
    const open = await this.dataSource
      .getRepository(CanteenOrder)
      .createQueryBuilder('o')
      .where("o.school_id = :schoolId AND o.order_date = :day AND o.status IN ('placed', 'preparing')", {
        schoolId,
        day,
      })
      .getCount();
    return { date: day, ...row, open_orders: open };
  }
}
