import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { CanteenDailyMenuService } from './canteen-menu-daily.service';
import { CanteenMealsService } from './canteen-menu-meals.service';
import { CanteenMenuService } from './canteen-menu.service';
import {
  DailyMenuCopyDto,
  DailyMenuDayDto,
  DailyMenuInputDto,
  DailyMenuQueryDto,
  DailyMenuWeekQueryDto,
  FoodCategoryDto,
  FoodCategoryInputDto,
  FoodCategoryQueryDto,
  FoodCategoryUpdateDto,
  FoodItemAvailabilityDto,
  FoodItemDto,
  FoodItemInputDto,
  FoodItemInsightsDto,
  FoodItemQueryDto,
  FoodItemUpdateDto,
  MealDto,
  MealInputDto,
  MealQueryDto,
  MealUpdateDto,
  RecipeInputDto,
  RecipeLineDto,
} from './dto/canteen-menu.dto';

const P = PERMISSIONS;

@ApiTags('Admin · Canteen categories')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/canteen/categories')
export class CanteenCategoriesController {
  constructor(private readonly menu: CanteenMenuService) {}

  @Get()
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Food categories with item counts, in menu order' })
  @ApiEnvelope(FoodCategoryDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: FoodCategoryQueryDto) {
    return this.menu.categories(schoolId, query);
  }

  @Post()
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Category added')
  @ApiOperation({ summary: 'Add a food category' })
  @ApiEnvelope(FoodCategoryDto, { status: HttpStatus.CREATED, message: 'Category added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: FoodCategoryInputDto) {
    return this.menu.createCategory(schoolId, dto);
  }

  @Patch(':id')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Category updated')
  @ApiOperation({ summary: 'Change a category, including its sort_order' })
  @ApiEnvelope(FoodCategoryDto, { message: 'Category updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: FoodCategoryUpdateDto) {
    return this.menu.updateCategory(schoolId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Category deleted')
  @ApiOperation({ summary: 'Delete an empty category (CATEGORY_IN_USE otherwise)' })
  @ApiEnvelope(undefined, { message: 'Category deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.menu.deleteCategory(schoolId, id);
    return null;
  }
}

@ApiTags('Admin · Canteen items')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/canteen/items')
export class CanteenItemsController {
  constructor(private readonly menu: CanteenMenuService) {}

  @Get()
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Food items; filter by category, veg, availability or active' })
  @ApiEnvelope(FoodItemDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: FoodItemQueryDto) {
    return this.menu.items(schoolId, query);
  }

  @Get('insights')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Counts for the item cards: total, active, veg, non-veg, unavailable' })
  @ApiEnvelope(FoodItemInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.menu.insights(schoolId);
  }

  @Get(':id')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'One food item' })
  @ApiEnvelope(FoodItemDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.menu.getItem(schoolId, id);
  }

  @Post()
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Food item added')
  @ApiOperation({ summary: 'Add a food item' })
  @ApiEnvelope(FoodItemDto, { status: HttpStatus.CREATED, message: 'Food item added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: FoodItemInputDto) {
    return this.menu.createItem(schoolId, dto);
  }

  @Patch(':id')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Food item updated')
  @ApiOperation({ summary: 'Change a food item' })
  @ApiEnvelope(FoodItemDto, { message: 'Food item updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: FoodItemUpdateDto) {
    return this.menu.updateItem(schoolId, id, dto);
  }

  @Patch(':id/availability')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Availability updated')
  @ApiOperation({ summary: 'Mark a food item available or sold out' })
  @ApiEnvelope(FoodItemDto, { message: 'Availability updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  availability(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FoodItemAvailabilityDto,
  ) {
    return this.menu.setAvailability(schoolId, id, dto.available);
  }

  @Delete(':id')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Food item deleted')
  @ApiOperation({ summary: 'Delete a food item (soft delete, past orders keep it)' })
  @ApiEnvelope(undefined, { message: 'Food item deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.menu.deleteItem(schoolId, id);
    return null;
  }

  @Get(':id/recipe')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Stock used for one serving of the item' })
  @ApiEnvelope(RecipeLineDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  recipe(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.menu.recipe(schoolId, id);
  }

  @Put(':id/recipe')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Recipe saved')
  @ApiOperation({ summary: 'Replace the recipe of the item' })
  @ApiEnvelope(RecipeLineDto, { isArray: true, message: 'Recipe saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  replaceRecipe(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: RecipeInputDto) {
    return this.menu.replaceRecipe(schoolId, id, dto);
  }
}

@ApiTags('Admin · Canteen meals')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/canteen/meals')
export class CanteenMealsController {
  constructor(private readonly meals: CanteenMealsService) {}

  @Get()
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Meals and combos with their items, item total and saving' })
  @ApiEnvelope(MealDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: MealQueryDto) {
    return this.meals.list(schoolId, query);
  }

  @Get(':id')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'One meal or combo' })
  @ApiEnvelope(MealDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.meals.get(schoolId, id);
  }

  @Post()
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Meal added')
  @ApiOperation({ summary: 'Add a meal or combo' })
  @ApiEnvelope(MealDto, { status: HttpStatus.CREATED, message: 'Meal added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: MealInputDto) {
    return this.meals.create(schoolId, dto);
  }

  @Patch(':id')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Meal updated')
  @ApiOperation({ summary: 'Change a meal; sending items replaces its items' })
  @ApiEnvelope(MealDto, { message: 'Meal updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: MealUpdateDto) {
    return this.meals.update(schoolId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Meal deleted')
  @ApiOperation({ summary: 'Delete a meal or combo (soft delete)' })
  @ApiEnvelope(undefined, { message: 'Meal deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.meals.remove(schoolId, id);
    return null;
  }
}

@ApiTags('Admin · Canteen daily menu')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/canteen/daily-menu')
export class CanteenDailyMenuController {
  constructor(private readonly daily: CanteenDailyMenuService) {}

  @Get()
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'The menu of one day, grouped by slot, with effective price and what is left' })
  @ApiEnvelope(DailyMenuDayDto)
  day(@SchoolId() schoolId: number, @Query() query: DailyMenuQueryDto) {
    return this.daily.getDay(schoolId, query.date, query.slot);
  }

  @Get('week')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Seven days of menu starting at from (today when left out)' })
  @ApiEnvelope(DailyMenuDayDto, { isArray: true })
  week(@SchoolId() schoolId: number, @Query() query: DailyMenuWeekQueryDto) {
    return this.daily.getWeek(schoolId, query.from);
  }

  @Put()
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Menu saved')
  @ApiOperation({
    summary: 'Set the menu of one date and slot',
    description:
      'Replaces the slot. Entries that stay keep their sold_quantity. Each entry is a food_item_id or a meal_id. Past dates are refused (MENU_DATE_PAST).',
  })
  @ApiEnvelope(DailyMenuDayDto, { message: 'Menu saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  set(@SchoolId() schoolId: number, @Body() dto: DailyMenuInputDto) {
    return this.daily.setDay(schoolId, dto);
  }

  @Post('copy')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Menu copied')
  @ApiOperation({ summary: 'Copy the menu of one date (or one slot) to another date' })
  @ApiEnvelope(DailyMenuDayDto, { message: 'Menu copied' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  copy(@SchoolId() schoolId: number, @Body() dto: DailyMenuCopyDto) {
    return this.daily.copyDay(schoolId, dto);
  }
}
