import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { monthStartIn, todayIn } from '../../shared/dates';
import { isSameDay, wasteCost } from './canteen-supply.logic';
import { CanteenStockService } from './canteen-stock.service';
import {
  CanteenWasteDto,
  CanteenWasteInputDto,
  CanteenWasteQueryDto,
  CanteenWasteSummaryDto,
  CanteenWasteSummaryQueryDto,
} from './dto/canteen-supply.dto';
import { FoodItem, RecipeLine } from './entities/canteen-menu.entity';
import { CanteenStockItem, WasteLog } from './entities/canteen-supply.entity';

const WASTE_SORTS = { waste_date: 'w.waste_date', cost: 'w.cost', quantity: 'w.quantity', created_at: 'w.created_at' };

@Injectable()
export class CanteenWasteService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly stock: CanteenStockService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
    @InjectRepository(WasteLog) private readonly waste: Repository<WasteLog>,
  ) {}

  private today(): string {
    return todayIn(this.app.timeZone);
  }

  private async recipeCost(schoolId: number, foodId: number): Promise<number> {
    const [row] = await this.dataSource
      .getRepository(RecipeLine)
      .createQueryBuilder('r')
      .innerJoin(CanteenStockItem, 's', 's.id = r.stock_item_id')
      .select('COALESCE(SUM(r.quantity * s.cost_per_unit), 0)', 'cost')
      .where('r.school_id = :schoolId AND r.food_item_id = :foodId', { schoolId, foodId })
      .getRawMany<{ cost: string }>();
    return Number(row?.cost ?? 0);
  }

  async create(schoolId: number, dto: CanteenWasteInputDto, actorId: number): Promise<CanteenWasteDto> {
    if (!dto.food_item_id && !dto.stock_item_id && !dto.item_name) {
      throw AppException.badRequest('Give a food item, a stock item or an item name', 'WASTE_ITEM_REQUIRED');
    }
    const food = dto.food_item_id
      ? await this.dataSource.getRepository(FoodItem).findOneBy({ id: dto.food_item_id, school_id: schoolId })
      : null;
    if (dto.food_item_id && !food) throw AppException.badRequest('Food item not found', 'FOOD_ITEM_NOT_FOUND');
    const stockItem = dto.stock_item_id ? await this.stock.find(schoolId, dto.stock_item_id) : null;
    const cost = wasteCost({
      quantity: dto.quantity,
      given_cost: dto.cost,
      stock_cost_per_unit: stockItem?.cost_per_unit,
      recipe_cost_per_portion: food && !stockItem ? await this.recipeCost(schoolId, food.id) : 0,
    });
    const id = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(
        manager.create(WasteLog, {
          school_id: schoolId,
          waste_date: dto.waste_date,
          food_item_id: food?.id ?? null,
          stock_item_id: stockItem?.id ?? null,
          item_name: stockItem?.name ?? food?.name ?? dto.item_name ?? '',
          quantity: dto.quantity,
          unit: stockItem?.unit ?? dto.unit,
          reason: dto.reason,
          cost,
          note: dto.note ?? null,
        }),
      );
      if (stockItem) {
        await this.stock.move(manager, {
          school_id: schoolId,
          stock_item_id: stockItem.id,
          kind: 'wastage',
          quantity: dto.quantity,
          unit_cost: stockItem.cost_per_unit,
          reference_type: 'waste',
          reference_id: saved.id,
          note: dto.reason,
          actor_id: actorId,
        });
      }
      return saved.id;
    });
    return this.waste.findOneByOrFail({ id, school_id: schoolId });
  }

  async list(schoolId: number, query: CanteenWasteQueryDto): Promise<Paginated<CanteenWasteDto>> {
    const qb = this.waste.createQueryBuilder('w').where('w.school_id = :schoolId', { schoolId });
    if (query.from) qb.andWhere('w.waste_date >= :from', { from: query.from });
    if (query.to) qb.andWhere('w.waste_date <= :to', { to: query.to });
    if (query.reason) qb.andWhere('w.reason = :reason', { reason: query.reason });
    if (query.food_item_id) qb.andWhere('w.food_item_id = :foodId', { foodId: query.food_item_id });
    if (query.stock_item_id) qb.andWhere('w.stock_item_id = :stockId', { stockId: query.stock_item_id });
    return listQuery(qb, query, {
      searchable: ['w.item_name', 'w.note'],
      sortable: WASTE_SORTS,
      defaultSort: 'waste_date',
    });
  }

  async remove(schoolId: number, id: number, actorId: number): Promise<void> {
    const entry = await this.waste.findOneBy({ id, school_id: schoolId });
    if (!entry) throw AppException.notFound('Waste entry not found', 'WASTE_NOT_FOUND');
    if (!isSameDay(entry.waste_date, this.today())) {
      throw AppException.conflict('Only waste entries of today can be deleted', 'WASTE_LOCKED');
    }
    await this.dataSource.transaction(async (manager) => {
      if (entry.stock_item_id) {
        await this.stock.move(manager, {
          school_id: schoolId,
          stock_item_id: entry.stock_item_id,
          kind: 'return',
          quantity: entry.quantity,
          reference_type: 'waste',
          reference_id: entry.id,
          note: 'Waste entry deleted',
          actor_id: actorId,
        });
      }
      await manager.softDelete(WasteLog, { id: entry.id, school_id: schoolId });
    });
  }

  async summary(schoolId: number, query: CanteenWasteSummaryQueryDto): Promise<CanteenWasteSummaryDto> {
    const from = query.from ?? monthStartIn(this.app.timeZone);
    const to = query.to ?? this.today();
    if (from > to) throw AppException.badRequest('from must not be after to', 'DATE_RANGE_INVALID');
    const scope =
      'FROM canteen_waste_logs WHERE school_id = $1 AND deleted_at IS NULL AND waste_date BETWEEN $2 AND $3';
    const args = [schoolId, from, to];
    const byReason = await this.dataSource.query(
      `SELECT reason, COUNT(*)::int AS entries, COALESCE(SUM(cost), 0)::float AS cost ${scope} GROUP BY reason ORDER BY cost DESC`,
      args,
    );
    const byDay = await this.dataSource.query(
      `SELECT to_char(waste_date, 'YYYY-MM-DD') AS date, COUNT(*)::int AS entries, COALESCE(SUM(cost), 0)::float AS cost ${scope} GROUP BY waste_date ORDER BY waste_date`,
      args,
    );
    const top = await this.dataSource.query(
      `SELECT item_name, SUM(quantity)::float AS quantity, COALESCE(SUM(cost), 0)::float AS cost ${scope} GROUP BY item_name ORDER BY cost DESC, quantity DESC LIMIT 10`,
      args,
    );
    const totalCost = byReason.reduce((sum: number, row: { cost: number }) => sum + Number(row.cost), 0);
    const entries = byReason.reduce((sum: number, row: { entries: number }) => sum + row.entries, 0);
    return {
      from,
      to,
      entries,
      total_cost: Math.round(totalCost * 100) / 100,
      by_reason: byReason,
      by_day: byDay,
      top_items: top,
    };
  }
}
