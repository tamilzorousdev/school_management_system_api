import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AppException, listQuery, Paginated } from '@app/common';
import { mealPricing } from './canteen-menu.logic';
import { MealDto, MealInputDto, MealQueryDto, MealUpdateDto } from './dto/canteen-menu.dto';
import { FoodItem, Meal, MealItem } from './entities/canteen-menu.entity';

const defined = <T extends object>(dto: T) =>
  Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)) as Partial<T>;

@Injectable()
export class CanteenMealsService {
  constructor(
    @InjectRepository(Meal) private readonly mealsRepo: Repository<Meal>,
    @InjectRepository(MealItem) private readonly mealItemsRepo: Repository<MealItem>,
    @InjectRepository(FoodItem) private readonly itemsRepo: Repository<FoodItem>,
  ) {}

  private async toDtos(schoolId: number, meals: Meal[]): Promise<MealDto[]> {
    if (meals.length === 0) return [];
    const parts = await this.mealItemsRepo.find({
      where: { school_id: schoolId, meal_id: In(meals.map((meal) => meal.id)) },
      order: { id: 'ASC' },
    });
    const items = parts.length
      ? await this.itemsRepo.find({
          where: { school_id: schoolId, id: In([...new Set(parts.map((part) => part.food_item_id))]) },
          withDeleted: true,
        })
      : [];
    const byId = new Map(items.map((item) => [item.id, item]));
    return meals.map((meal) => {
      const components = parts
        .filter((part) => part.meal_id === meal.id)
        .map((part) => ({
          food_item_id: part.food_item_id,
          name: byId.get(part.food_item_id)?.name ?? '',
          price: byId.get(part.food_item_id)?.price ?? 0,
          quantity: part.quantity,
        }));
      return {
        id: meal.id,
        name: meal.name,
        code: meal.code,
        kind: meal.kind,
        description: meal.description,
        price: meal.price,
        active: meal.active,
        items: components,
        ...mealPricing(components, meal.price),
      };
    });
  }

  async list(schoolId: number, query: MealQueryDto): Promise<Paginated<MealDto>> {
    const qb = this.mealsRepo.createQueryBuilder('m').where('m.school_id = :schoolId', { schoolId });
    if (query.kind) qb.andWhere('m.kind = :kind', { kind: query.kind });
    if (query.active !== undefined) qb.andWhere('m.active = :active', { active: query.active });
    const page = await listQuery(qb, query, {
      searchable: ['m.name', 'm.code'],
      sortable: { name: 'm.name', price: 'm.price', created_at: 'm.created_at' },
      defaultSort: 'name',
    });
    return { ...page, items: await this.toDtos(schoolId, page.items) };
  }

  private async meal(schoolId: number, id: number): Promise<Meal> {
    const row = await this.mealsRepo.findOneBy({ id, school_id: schoolId });
    if (!row) throw AppException.notFound('Meal not found', 'MEAL_NOT_FOUND');
    return row;
  }

  async get(schoolId: number, id: number): Promise<MealDto> {
    const [dto] = await this.toDtos(schoolId, [await this.meal(schoolId, id)]);
    return dto!;
  }

  private async check(schoolId: number, dto: MealUpdateDto, exceptId?: number) {
    if (dto.name !== undefined) {
      const clash = await this.mealsRepo
        .createQueryBuilder('m')
        .where('m.school_id = :schoolId AND LOWER(m.name) = LOWER(:name)', { schoolId, name: dto.name })
        .getOne();
      if (clash && clash.id !== exceptId) {
        throw AppException.conflict(`Meal ${dto.name} already exists`, 'MEAL_EXISTS');
      }
    }
    if (dto.code) {
      const clash = await this.mealsRepo.findOneBy({ school_id: schoolId, code: dto.code });
      if (clash && clash.id !== exceptId) {
        throw AppException.conflict(`Code ${dto.code} is already used`, 'MEAL_CODE_EXISTS');
      }
    }
    if (dto.items) {
      const ids = dto.items.map((part) => part.food_item_id);
      if (new Set(ids).size !== ids.length) {
        throw AppException.validation([{ field: 'items', message: 'Each food item can appear only once' }]);
      }
      const found = await this.itemsRepo.countBy({ school_id: schoolId, id: In(ids) });
      if (found !== ids.length) {
        throw AppException.validation([{ field: 'items', message: 'One or more food items were not found' }]);
      }
    }
  }

  private async saveItems(schoolId: number, mealId: number, items: MealInputDto['items']) {
    await this.mealItemsRepo.manager.transaction(async (manager) => {
      await manager.delete(MealItem, { school_id: schoolId, meal_id: mealId });
      await manager.save(
        MealItem,
        items.map((part) =>
          manager.create(MealItem, {
            school_id: schoolId,
            meal_id: mealId,
            food_item_id: part.food_item_id,
            quantity: part.quantity,
          }),
        ),
      );
    });
  }

  async create(schoolId: number, dto: MealInputDto): Promise<MealDto> {
    await this.check(schoolId, dto);
    const { items, ...fields } = dto;
    const saved = await this.mealsRepo.save(this.mealsRepo.create({ ...fields, school_id: schoolId }));
    await this.saveItems(schoolId, saved.id, items);
    return this.get(schoolId, saved.id);
  }

  async update(schoolId: number, id: number, dto: MealUpdateDto): Promise<MealDto> {
    const row = await this.meal(schoolId, id);
    await this.check(schoolId, dto, id);
    const { items, ...fields } = dto;
    await this.mealsRepo.save(Object.assign(row, defined(fields)));
    if (items) await this.saveItems(schoolId, id, items);
    return this.get(schoolId, id);
  }

  async remove(schoolId: number, id: number): Promise<void> {
    await this.meal(schoolId, id);
    await this.mealsRepo.softDelete({ id, school_id: schoolId });
  }
}
