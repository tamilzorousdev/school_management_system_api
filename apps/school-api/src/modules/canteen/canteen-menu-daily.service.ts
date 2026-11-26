import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import {
  copyDrafts,
  CopySource,
  duplicateKey,
  effectivePrice,
  entryKey,
  entryRefusal,
  groupBySlot,
  isPastDate,
  planReplace,
  remainingQuantity,
  weekDates,
} from './canteen-menu.logic';
import {
  DailyMenuCopyDto,
  DailyMenuDayDto,
  DailyMenuEntryDto,
  DailyMenuEntryInputDto,
  DailyMenuInputDto,
} from './dto/canteen-menu.dto';
import { DailyMenuEntry, FoodItem, Meal, MealSlot } from './entities/canteen-menu.entity';

interface MenuRow {
  id: number;
  menu_date: string;
  slot: MealSlot;
  food_item_id: number | null;
  meal_id: number | null;
  price: string | null;
  quantity_limit: number | null;
  sold_quantity: number;
  active: boolean;
  item_name: string | null;
  item_price: string | null;
  is_veg: boolean | null;
  meal_name: string | null;
  meal_price: string | null;
}

const toEntryDto = (row: MenuRow): DailyMenuEntryDto => {
  const base = Number(row.food_item_id ? row.item_price : row.meal_price);
  const override = row.price === null ? null : Number(row.price);
  return {
    id: row.id,
    menu_date: row.menu_date,
    slot: row.slot,
    kind: row.food_item_id ? 'item' : 'meal',
    food_item_id: row.food_item_id,
    meal_id: row.meal_id,
    name: (row.food_item_id ? row.item_name : row.meal_name) ?? '',
    is_veg: row.food_item_id ? row.is_veg : null,
    base_price: base,
    price: override,
    effective_price: effectivePrice(override, base),
    quantity_limit: row.quantity_limit,
    sold_quantity: row.sold_quantity,
    remaining: remainingQuantity(row.quantity_limit, row.sold_quantity),
    active: row.active,
  };
};

@Injectable()
export class CanteenDailyMenuService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DailyMenuEntry) private readonly entriesRepo: Repository<DailyMenuEntry>,
    @InjectRepository(FoodItem) private readonly itemsRepo: Repository<FoodItem>,
    @InjectRepository(Meal) private readonly mealsRepo: Repository<Meal>,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  private today(): string {
    return todayIn(this.app.timeZone);
  }

  private async rows(schoolId: number, from: string, to: string, slot?: MealSlot): Promise<DailyMenuEntryDto[]> {
    const params: unknown[] = [schoolId, from, to];
    if (slot) params.push(slot);
    const rows: MenuRow[] = await this.dataSource.query(
      `SELECT e.id, to_char(e.menu_date, 'YYYY-MM-DD') AS menu_date, e.slot, e.food_item_id, e.meal_id, e.price,
              e.quantity_limit, e.sold_quantity, e.active,
              fi.name AS item_name, fi.price AS item_price, fi.is_veg,
              m.name AS meal_name, m.price AS meal_price
       FROM canteen_daily_menu e
       LEFT JOIN canteen_food_items fi ON fi.id = e.food_item_id
       LEFT JOIN canteen_meals m ON m.id = e.meal_id
       WHERE e.school_id = $1 AND e.deleted_at IS NULL AND e.menu_date >= $2 AND e.menu_date <= $3
         ${slot ? 'AND e.slot = $4' : ''}
       ORDER BY e.menu_date, e.id`,
      params,
    );
    return rows.map(toEntryDto);
  }

  private day(date: string, entries: DailyMenuEntryDto[]): DailyMenuDayDto {
    return { date, slots: groupBySlot(entries.filter((entry) => entry.menu_date === date)) };
  }

  async getDay(schoolId: number, date: string, slot?: MealSlot): Promise<DailyMenuDayDto> {
    return this.day(date, await this.rows(schoolId, date, date, slot));
  }

  async getWeek(schoolId: number, from?: string): Promise<DailyMenuDayDto[]> {
    const start = from ?? this.today();
    const dates = weekDates(start);
    const entries = await this.rows(schoolId, start, dates[6]!);
    return dates.map((date) => this.day(date, entries));
  }

  private assertEditable(date: string) {
    if (isPastDate(date, this.today())) {
      throw AppException.badRequest('Past menus cannot be changed', 'MENU_DATE_PAST');
    }
  }

  private async assertTargets(schoolId: number, entries: DailyMenuEntryInputDto[]) {
    entries.forEach((entry, index) => {
      const refusal = entryRefusal(entry);
      if (refusal) throw AppException.validation([{ field: `entries.${index}`, message: refusal }]);
    });
    const duplicate = duplicateKey(entries);
    if (duplicate) {
      throw AppException.validation([{ field: 'entries', message: `${duplicate} is listed more than once` }]);
    }
    const itemIds = entries.flatMap((entry) => (entry.food_item_id ? [entry.food_item_id] : []));
    const mealIds = entries.flatMap((entry) => (entry.meal_id ? [entry.meal_id] : []));
    if (itemIds.length) {
      const found = await this.itemsRepo.countBy({ school_id: schoolId, id: In(itemIds), active: true });
      if (found !== itemIds.length) {
        throw AppException.validation([
          { field: 'entries', message: 'One or more food items are missing or inactive' },
        ]);
      }
    }
    if (mealIds.length) {
      const found = await this.mealsRepo.countBy({ school_id: schoolId, id: In(mealIds), active: true });
      if (found !== mealIds.length) {
        throw AppException.validation([{ field: 'entries', message: 'One or more meals are missing or inactive' }]);
      }
    }
  }

  private async replaceSlot(schoolId: number, date: string, slot: MealSlot, entries: DailyMenuEntryInputDto[]) {
    const existing = await this.entriesRepo.findBy({ school_id: schoolId, menu_date: date, slot });
    const plan = planReplace(
      existing.map((row) => ({ id: row.id, key: entryKey(row) })),
      entries.map((entry) => entryKey(entry)),
    );
    const fieldsOf = (entry: DailyMenuEntryInputDto) => ({
      price: entry.price ?? null,
      quantity_limit: entry.quantity_limit ?? null,
      active: entry.active ?? true,
    });
    await this.entriesRepo.manager.transaction(async (manager) => {
      for (const { id, index } of plan.update) {
        await manager.update(DailyMenuEntry, { id, school_id: schoolId }, fieldsOf(entries[index]!));
      }
      if (plan.create.length > 0) {
        await manager.save(
          DailyMenuEntry,
          plan.create.map((index) =>
            manager.create(DailyMenuEntry, {
              ...fieldsOf(entries[index]!),
              school_id: schoolId,
              menu_date: date,
              slot,
              food_item_id: entries[index]!.food_item_id ?? null,
              meal_id: entries[index]!.meal_id ?? null,
              sold_quantity: 0,
            }),
          ),
        );
      }
      if (plan.remove.length > 0)
        await manager.softDelete(DailyMenuEntry, { school_id: schoolId, id: In(plan.remove) });
    });
  }

  async setDay(schoolId: number, dto: DailyMenuInputDto): Promise<DailyMenuDayDto> {
    this.assertEditable(dto.date);
    await this.assertTargets(schoolId, dto.entries);
    await this.replaceSlot(schoolId, dto.date, dto.slot, dto.entries);
    return this.getDay(schoolId, dto.date, dto.slot);
  }

  private async stillOnSale(schoolId: number, drafts: CopySource[]): Promise<CopySource[]> {
    const itemIds = drafts.flatMap((entry) => (entry.food_item_id ? [entry.food_item_id] : []));
    const mealIds = drafts.flatMap((entry) => (entry.meal_id ? [entry.meal_id] : []));
    const items = itemIds.length
      ? await this.itemsRepo.find({ where: { school_id: schoolId, id: In(itemIds), active: true }, select: ['id'] })
      : [];
    const meals = mealIds.length
      ? await this.mealsRepo.find({ where: { school_id: schoolId, id: In(mealIds), active: true }, select: ['id'] })
      : [];
    const liveItems = new Set(items.map((row) => row.id));
    const liveMeals = new Set(meals.map((row) => row.id));
    return drafts.filter((entry) =>
      entry.food_item_id ? liveItems.has(entry.food_item_id) : liveMeals.has(entry.meal_id!),
    );
  }

  async copyDay(schoolId: number, dto: DailyMenuCopyDto): Promise<DailyMenuDayDto> {
    if (dto.from_date === dto.to_date) {
      throw AppException.badRequest('Choose a different date to copy to', 'MENU_COPY_SAME_DATE');
    }
    this.assertEditable(dto.to_date);
    const source = await this.entriesRepo.find({
      where: { school_id: schoolId, menu_date: dto.from_date },
      order: { id: 'ASC' },
    });
    const drafts = await this.stillOnSale(schoolId, copyDrafts(source as CopySource[], dto.slot));
    if (drafts.length === 0) {
      throw AppException.notFound('There is no menu on that date to copy', 'MENU_SOURCE_EMPTY');
    }
    const slots = [...new Set(drafts.map((entry) => entry.slot))];
    for (const slot of slots) {
      const entries: DailyMenuEntryInputDto[] = drafts
        .filter((entry) => entry.slot === slot)
        .map((entry) => ({
          food_item_id: entry.food_item_id,
          meal_id: entry.meal_id,
          price: entry.price,
          quantity_limit: entry.quantity_limit,
          active: entry.active,
        }));
      await this.replaceSlot(schoolId, dto.to_date, slot, entries);
    }
    return this.getDay(schoolId, dto.to_date);
  }
}
