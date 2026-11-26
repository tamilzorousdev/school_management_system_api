import { CanteenDailyMenuService } from './canteen-menu-daily.service';
import { CanteenMealsService } from './canteen-menu-meals.service';
import {
  CanteenCategoriesController,
  CanteenDailyMenuController,
  CanteenItemsController,
  CanteenMealsController,
} from './canteen-menu.controller';
import { CanteenMenuService } from './canteen-menu.service';
import { CanteenSetupController } from './canteen-setup.controller';
import { CanteenSettingsService, CanteenSetupService } from './canteen-setup.service';
import {
  CanteenCounter,
  CanteenSettings,
  DailyMenuEntry,
  FoodCategory,
  FoodItem,
  Meal,
  MealItem,
  RecipeLine,
} from './entities/canteen-menu.entity';

export const MENU_PARTS = {
  entities: [CanteenSettings, CanteenCounter, FoodCategory, FoodItem, RecipeLine, Meal, MealItem, DailyMenuEntry],
  controllers: [
    CanteenSetupController,
    CanteenCategoriesController,
    CanteenItemsController,
    CanteenMealsController,
    CanteenDailyMenuController,
  ],
  providers: [
    CanteenSettingsService,
    CanteenSetupService,
    CanteenMenuService,
    CanteenMealsService,
    CanteenDailyMenuService,
  ],
};
