import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { decimal } from './decimal';

export const MEAL_SLOTS = ['breakfast', 'lunch', 'snacks', 'dinner'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const MEAL_KINDS = ['meal', 'combo'] as const;
export type MealKind = (typeof MEAL_KINDS)[number];

@Entity('canteen_settings')
@Index('UQ_canteen_settings_school', ['school_id'], { unique: true })
export class CanteenSettings extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 5, default: '08:00' })
  opens_at: string;

  @Column({ type: 'varchar', length: 5, default: '17:00' })
  closes_at: string;

  @Column({ type: 'boolean', default: true })
  accepts_orders: boolean;

  @Column({ type: 'boolean', default: true })
  wallet_enabled: boolean;

  @Column({ type: 'boolean', default: false })
  allow_negative_balance: boolean;

  @Column({ type: 'boolean', default: true })
  allow_walk_in: boolean;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 50, transformer: decimal })
  low_balance_limit: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true, transformer: decimal })
  default_daily_limit: number | null;

  @Column({ type: 'smallint', default: 15 })
  order_cutoff_minutes: number;

  @Column({ type: 'varchar', length: 4, default: 'T' })
  token_prefix: string;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0, transformer: decimal })
  tax_percent: number;

  @Column({ type: 'varchar', length: 200, nullable: true })
  receipt_footer: string | null;

  @Column({ type: 'int', nullable: true })
  updated_by: number | null;
}

@Entity('canteen_counters')
@Index('UQ_canteen_counters_name', ['school_id', 'name'], { unique: true, where: '"deleted_at" IS NULL' })
export class CanteenCounter extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  description: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;
}

@Entity('canteen_food_categories')
@Index('UQ_canteen_food_categories_name', ['school_id', 'name'], { unique: true, where: '"deleted_at" IS NULL' })
export class FoodCategory extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  description: string | null;

  @Column({ type: 'smallint', default: 0 })
  sort_order: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;
}

@Entity('canteen_food_items')
@Index('UQ_canteen_food_items_name', ['school_id', 'name'], { unique: true, where: '"deleted_at" IS NULL' })
export class FoodItem extends SchoolScopedEntity {
  @Column({ type: 'int' })
  category_id: number;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  code: string | null;

  @Column({ type: 'varchar', length: 400, nullable: true })
  description: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: decimal })
  price: number;

  @Column({ type: 'boolean', default: true })
  is_veg: boolean;

  @Column({ type: 'smallint', default: 10 })
  prep_minutes: number;

  @Column({ type: 'int', nullable: true })
  calories: number | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  allergens: string | null;

  @Column({ type: 'boolean', default: true })
  available: boolean;

  @Column({ type: 'boolean', default: true })
  active: boolean;
}

@Entity('canteen_recipe_lines')
@Index('UQ_canteen_recipe_lines', ['food_item_id', 'stock_item_id'], { unique: true })
export class RecipeLine extends SchoolScopedEntity {
  @Column({ type: 'int' })
  food_item_id: number;

  @Column({ type: 'int' })
  stock_item_id: number;

  @Column({ type: 'numeric', precision: 12, scale: 3, transformer: decimal })
  quantity: number;
}

@Entity('canteen_meals')
@Index('UQ_canteen_meals_name', ['school_id', 'name'], { unique: true, where: '"deleted_at" IS NULL' })
export class Meal extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  code: string | null;

  @Column({ type: 'varchar', length: 10, default: 'meal' })
  kind: MealKind;

  @Column({ type: 'varchar', length: 400, nullable: true })
  description: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: decimal })
  price: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;
}

@Entity('canteen_meal_items')
@Index('UQ_canteen_meal_items', ['meal_id', 'food_item_id'], { unique: true })
export class MealItem extends SchoolScopedEntity {
  @Column({ type: 'int' })
  meal_id: number;

  @Column({ type: 'int' })
  food_item_id: number;

  @Column({ type: 'smallint', default: 1 })
  quantity: number;
}

@Entity('canteen_daily_menu')
@Index('IDX_canteen_daily_menu_day', ['school_id', 'menu_date', 'slot'])
export class DailyMenuEntry extends SchoolScopedEntity {
  @Column({ type: 'date' })
  menu_date: string;

  @Column({ type: 'varchar', length: 10 })
  slot: MealSlot;

  @Column({ type: 'int', nullable: true })
  food_item_id: number | null;

  @Column({ type: 'int', nullable: true })
  meal_id: number | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true, transformer: decimal })
  price: number | null;

  @Column({ type: 'int', nullable: true })
  quantity_limit: number | null;

  @Column({ type: 'int', default: 0 })
  sold_quantity: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;
}
