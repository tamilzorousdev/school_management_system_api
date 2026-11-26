import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AppException, listQuery, Paginated } from '@app/common';
import {
  FoodCategoryDto,
  FoodCategoryInputDto,
  FoodCategoryQueryDto,
  FoodCategoryUpdateDto,
  FoodItemDto,
  FoodItemInputDto,
  FoodItemInsightsDto,
  FoodItemQueryDto,
  FoodItemUpdateDto,
  RecipeInputDto,
  RecipeLineDto,
} from './dto/canteen-menu.dto';
import { FoodCategory, FoodItem, RecipeLine } from './entities/canteen-menu.entity';
import { CanteenStockItem } from './entities/canteen-supply.entity';

const defined = <T extends object>(dto: T) =>
  Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)) as Partial<T>;

const toItemDto = (row: FoodItem, categoryName: string): FoodItemDto => ({
  id: row.id,
  category_id: row.category_id,
  category_name: categoryName,
  name: row.name,
  code: row.code,
  description: row.description,
  price: row.price,
  is_veg: row.is_veg,
  prep_minutes: row.prep_minutes,
  calories: row.calories,
  allergens: row.allergens,
  available: row.available,
  active: row.active,
});

@Injectable()
export class CanteenMenuService {
  constructor(
    @InjectRepository(FoodCategory) private readonly categoriesRepo: Repository<FoodCategory>,
    @InjectRepository(FoodItem) private readonly itemsRepo: Repository<FoodItem>,
    @InjectRepository(RecipeLine) private readonly recipeRepo: Repository<RecipeLine>,
    @InjectRepository(CanteenStockItem) private readonly stockRepo: Repository<CanteenStockItem>,
  ) {}

  private async itemCounts(schoolId: number, categoryIds: number[]): Promise<Map<number, number>> {
    if (categoryIds.length === 0) return new Map();
    const rows: { category_id: number; total: string }[] = await this.itemsRepo
      .createQueryBuilder('i')
      .select('i.category_id', 'category_id')
      .addSelect('COUNT(*)', 'total')
      .where('i.school_id = :schoolId AND i.category_id IN (:...categoryIds)', { schoolId, categoryIds })
      .groupBy('i.category_id')
      .getRawMany();
    return new Map(rows.map((row) => [Number(row.category_id), Number(row.total)]));
  }

  private toCategoryDto(row: FoodCategory, itemCount: number): FoodCategoryDto {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      sort_order: row.sort_order,
      active: row.active,
      item_count: itemCount,
    };
  }

  async categories(schoolId: number, query: FoodCategoryQueryDto): Promise<Paginated<FoodCategoryDto>> {
    const qb = this.categoriesRepo.createQueryBuilder('c').where('c.school_id = :schoolId', { schoolId });
    if (query.active !== undefined) qb.andWhere('c.active = :active', { active: query.active });
    const ordered = Object.assign(query, { order: query.sort ? query.order : ('asc' as const) });
    const page = await listQuery(qb, ordered, {
      searchable: ['c.name', 'c.description'],
      sortable: { name: 'c.name', sort_order: 'c.sort_order', created_at: 'c.created_at' },
      defaultSort: 'sort_order',
    });
    const counts = await this.itemCounts(
      schoolId,
      page.items.map((row) => row.id),
    );
    return { ...page, items: page.items.map((row) => this.toCategoryDto(row, counts.get(row.id) ?? 0)) };
  }

  private async category(schoolId: number, id: number): Promise<FoodCategory> {
    const row = await this.categoriesRepo.findOneBy({ id, school_id: schoolId });
    if (!row) throw AppException.notFound('Category not found', 'CATEGORY_NOT_FOUND');
    return row;
  }

  private async assertCategoryNameFree(schoolId: number, name: string, exceptId?: number) {
    const clash = await this.categoriesRepo
      .createQueryBuilder('c')
      .where('c.school_id = :schoolId AND LOWER(c.name) = LOWER(:name)', { schoolId, name })
      .getOne();
    if (clash && clash.id !== exceptId) {
      throw AppException.conflict(`Category ${name} already exists`, 'CATEGORY_EXISTS');
    }
  }

  async createCategory(schoolId: number, dto: FoodCategoryInputDto): Promise<FoodCategoryDto> {
    await this.assertCategoryNameFree(schoolId, dto.name);
    const saved = await this.categoriesRepo.save(this.categoriesRepo.create({ ...dto, school_id: schoolId }));
    return this.toCategoryDto(saved, 0);
  }

  async updateCategory(schoolId: number, id: number, dto: FoodCategoryUpdateDto): Promise<FoodCategoryDto> {
    const row = await this.category(schoolId, id);
    if (dto.name !== undefined) await this.assertCategoryNameFree(schoolId, dto.name, id);
    const saved = await this.categoriesRepo.save(Object.assign(row, defined(dto)));
    const counts = await this.itemCounts(schoolId, [id]);
    return this.toCategoryDto(saved, counts.get(id) ?? 0);
  }

  async deleteCategory(schoolId: number, id: number): Promise<void> {
    await this.category(schoolId, id);
    const used = await this.itemsRepo.countBy({ school_id: schoolId, category_id: id });
    if (used > 0) {
      throw AppException.conflict(
        `This category has ${used} food items. Move or delete them first.`,
        'CATEGORY_IN_USE',
      );
    }
    await this.categoriesRepo.softDelete({ id, school_id: schoolId });
  }

  private async categoryNames(schoolId: number, ids: number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.categoriesRepo.find({ where: { school_id: schoolId, id: In(ids) }, withDeleted: true });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  async items(schoolId: number, query: FoodItemQueryDto): Promise<Paginated<FoodItemDto>> {
    const qb = this.itemsRepo.createQueryBuilder('i').where('i.school_id = :schoolId', { schoolId });
    if (query.category_id) qb.andWhere('i.category_id = :categoryId', { categoryId: query.category_id });
    if (query.is_veg !== undefined) qb.andWhere('i.is_veg = :isVeg', { isVeg: query.is_veg });
    if (query.available !== undefined) qb.andWhere('i.available = :available', { available: query.available });
    if (query.active !== undefined) qb.andWhere('i.active = :active', { active: query.active });
    const page = await listQuery(qb, query, {
      searchable: ['i.name', 'i.code'],
      sortable: { name: 'i.name', price: 'i.price', created_at: 'i.created_at' },
      defaultSort: 'name',
    });
    const names = await this.categoryNames(schoolId, [...new Set(page.items.map((row) => row.category_id))]);
    return { ...page, items: page.items.map((row) => toItemDto(row, names.get(row.category_id) ?? '')) };
  }

  async insights(schoolId: number): Promise<FoodItemInsightsDto> {
    const row = await this.itemsRepo
      .createQueryBuilder('i')
      .select('COUNT(*)', 'total')
      .addSelect('COUNT(*) FILTER (WHERE i.active)', 'active')
      .addSelect('COUNT(*) FILTER (WHERE i.is_veg)', 'veg')
      .addSelect('COUNT(*) FILTER (WHERE NOT i.is_veg)', 'non_veg')
      .addSelect('COUNT(*) FILTER (WHERE NOT i.available)', 'unavailable')
      .where('i.school_id = :schoolId', { schoolId })
      .getRawOne<Record<keyof FoodItemInsightsDto, string>>();
    return {
      total: Number(row?.total ?? 0),
      active: Number(row?.active ?? 0),
      veg: Number(row?.veg ?? 0),
      non_veg: Number(row?.non_veg ?? 0),
      unavailable: Number(row?.unavailable ?? 0),
    };
  }

  private async item(schoolId: number, id: number): Promise<FoodItem> {
    const row = await this.itemsRepo.findOneBy({ id, school_id: schoolId });
    if (!row) throw AppException.notFound('Food item not found', 'FOOD_ITEM_NOT_FOUND');
    return row;
  }

  private async view(schoolId: number, row: FoodItem): Promise<FoodItemDto> {
    const names = await this.categoryNames(schoolId, [row.category_id]);
    return toItemDto(row, names.get(row.category_id) ?? '');
  }

  async getItem(schoolId: number, id: number): Promise<FoodItemDto> {
    return this.view(schoolId, await this.item(schoolId, id));
  }

  private async checkItem(schoolId: number, dto: FoodItemUpdateDto, exceptId?: number) {
    if (dto.category_id !== undefined) await this.category(schoolId, dto.category_id);
    if (dto.name !== undefined) {
      const clash = await this.itemsRepo
        .createQueryBuilder('i')
        .where('i.school_id = :schoolId AND LOWER(i.name) = LOWER(:name)', { schoolId, name: dto.name })
        .getOne();
      if (clash && clash.id !== exceptId) {
        throw AppException.conflict(`Food item ${dto.name} already exists`, 'FOOD_ITEM_EXISTS');
      }
    }
    if (dto.code) {
      const clash = await this.itemsRepo.findOneBy({ school_id: schoolId, code: dto.code });
      if (clash && clash.id !== exceptId) {
        throw AppException.conflict(`Code ${dto.code} is already used`, 'FOOD_ITEM_CODE_EXISTS');
      }
    }
  }

  async createItem(schoolId: number, dto: FoodItemInputDto): Promise<FoodItemDto> {
    await this.checkItem(schoolId, dto);
    const saved = await this.itemsRepo.save(this.itemsRepo.create({ ...dto, school_id: schoolId }));
    return this.view(schoolId, saved);
  }

  async updateItem(schoolId: number, id: number, dto: FoodItemUpdateDto): Promise<FoodItemDto> {
    const row = await this.item(schoolId, id);
    await this.checkItem(schoolId, dto, id);
    return this.view(schoolId, await this.itemsRepo.save(Object.assign(row, defined(dto))));
  }

  async setAvailability(schoolId: number, id: number, available: boolean): Promise<FoodItemDto> {
    const row = await this.item(schoolId, id);
    row.available = available;
    return this.view(schoolId, await this.itemsRepo.save(row));
  }

  async deleteItem(schoolId: number, id: number): Promise<void> {
    await this.item(schoolId, id);
    await this.itemsRepo.softDelete({ id, school_id: schoolId });
  }

  async recipe(schoolId: number, itemId: number): Promise<RecipeLineDto[]> {
    await this.item(schoolId, itemId);
    const rows: { stock_item_id: number; name: string; unit: string; quantity: number }[] = await this.recipeRepo
      .createQueryBuilder('r')
      .innerJoin(CanteenStockItem, 's', 's.id = r.stock_item_id')
      .select(['r.stock_item_id AS stock_item_id', 's.name AS name', 's.unit AS unit', 'r.quantity AS quantity'])
      .where('r.school_id = :schoolId AND r.food_item_id = :itemId', { schoolId, itemId })
      .orderBy('s.name', 'ASC')
      .getRawMany();
    return rows.map((row) => ({
      stock_item_id: Number(row.stock_item_id),
      stock_item_name: row.name,
      unit: row.unit,
      quantity: Number(row.quantity),
    }));
  }

  async replaceRecipe(schoolId: number, itemId: number, dto: RecipeInputDto): Promise<RecipeLineDto[]> {
    await this.item(schoolId, itemId);
    const ids = dto.lines.map((line) => line.stock_item_id);
    if (new Set(ids).size !== ids.length) {
      throw AppException.validation([{ field: 'lines', message: 'Each stock item can appear only once' }]);
    }
    if (ids.length > 0) {
      const found = await this.stockRepo.find({ where: { school_id: schoolId, id: In(ids) }, select: ['id'] });
      if (found.length !== ids.length) {
        throw AppException.validation([{ field: 'lines', message: 'One or more stock items were not found' }]);
      }
    }
    await this.recipeRepo.manager.transaction(async (manager) => {
      await manager.delete(RecipeLine, { school_id: schoolId, food_item_id: itemId });
      if (dto.lines.length > 0) {
        await manager.save(
          RecipeLine,
          dto.lines.map((line) =>
            manager.create(RecipeLine, {
              school_id: schoolId,
              food_item_id: itemId,
              stock_item_id: line.stock_item_id,
              quantity: line.quantity,
            }),
          ),
        );
      }
    });
    return this.recipe(schoolId, itemId);
  }
}
