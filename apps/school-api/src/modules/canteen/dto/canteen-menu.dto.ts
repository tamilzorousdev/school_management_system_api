import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { MEAL_KINDS, MEAL_SLOTS, MealKind, MealSlot } from '../entities/canteen-menu.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const notNull = (_object: unknown, value: unknown) => value !== null && value !== undefined;

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const CODE = /^[A-Z0-9-]{1,20}$/;

export class CanteenSettingsDto {
  @ApiProperty({ example: '08:00' }) opens_at: string;
  @ApiProperty({ example: '17:00' }) closes_at: string;
  @ApiProperty({ example: true }) accepts_orders: boolean;
  @ApiProperty({ example: true }) wallet_enabled: boolean;
  @ApiProperty({ example: false }) allow_negative_balance: boolean;
  @ApiProperty({ example: true }) allow_walk_in: boolean;
  @ApiProperty({ example: 50 }) low_balance_limit: number;
  @ApiProperty({ nullable: true, type: Number, example: 150 }) default_daily_limit: number | null;
  @ApiProperty({ example: 15, description: 'Minutes before closing when new orders stop' })
  order_cutoff_minutes: number;
  @ApiProperty({ example: 'T' }) token_prefix: string;
  @ApiProperty({ example: 5 }) tax_percent: number;
  @ApiProperty({ nullable: true, type: String, example: 'Thank you' }) receipt_footer: string | null;
}

export class CanteenSettingsInputDto {
  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @Matches(CLOCK, { message: 'opens_at must be a time in HH:mm format' })
  opens_at?: string;
  @ApiPropertyOptional({ example: '17:00' })
  @IsOptional()
  @Matches(CLOCK, { message: 'closes_at must be a time in HH:mm format' })
  closes_at?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() accepts_orders?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() wallet_enabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allow_negative_balance?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allow_walk_in?: boolean;
  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  low_balance_limit?: number;
  @ApiPropertyOptional({ nullable: true, type: Number, example: 150 })
  @IsOptional()
  @ValidateIf(notNull)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  default_daily_limit?: number | null;
  @ApiPropertyOptional({ example: 15, minimum: 0, maximum: 240 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  order_cutoff_minutes?: number;
  @ApiPropertyOptional({ example: 'T', description: '1 to 4 uppercase letters' })
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z]{1,4}$/, { message: 'token_prefix must be 1 to 4 uppercase letters' })
  token_prefix?: string;
  @ApiPropertyOptional({ example: 5, minimum: 0, maximum: 50 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(50)
  tax_percent?: number;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(200)
  receipt_footer?: string | null;
}

export class CounterDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ example: 'Counter 1' }) name: string;
  @ApiProperty({ nullable: true, type: String, example: 'Main hall' }) description: string | null;
  @ApiProperty({ example: true }) active: boolean;
}

export class CounterInputDto {
  @ApiProperty({ example: 'Counter 1' }) @Transform(trim) @IsString() @Length(1, 60) name: string;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Main hall' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(200)
  description?: string | null;
  @ApiPropertyOptional({ example: true }) @IsOptional() @IsBoolean() active?: boolean;
}

export class CounterUpdateDto extends PartialType(CounterInputDto) {}

export class CounterQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(toBoolean) @IsBoolean() active?: boolean;
}

export class FoodCategoryDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ example: 'Snacks' }) name: string;
  @ApiProperty({ nullable: true, type: String, example: 'Evening snacks' }) description: string | null;
  @ApiProperty({ example: 1 }) sort_order: number;
  @ApiProperty({ example: true }) active: boolean;
  @ApiProperty({ example: 8, description: 'Food items in this category' }) item_count: number;
}

export class FoodCategoryInputDto {
  @ApiProperty({ example: 'Snacks' }) @Transform(trim) @IsString() @Length(1, 80) name: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(300)
  description?: string | null;
  @ApiPropertyOptional({ example: 1, minimum: 0, maximum: 9999 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sort_order?: number;
  @ApiPropertyOptional({ example: true }) @IsOptional() @IsBoolean() active?: boolean;
}

export class FoodCategoryUpdateDto extends PartialType(FoodCategoryInputDto) {}

export class FoodCategoryQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(toBoolean) @IsBoolean() active?: boolean;
}

export class FoodItemDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ example: 1 }) category_id: number;
  @ApiProperty({ example: 'Snacks' }) category_name: string;
  @ApiProperty({ example: 'Veg Puff' }) name: string;
  @ApiProperty({ nullable: true, type: String, example: 'PUFF' }) code: string | null;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty({ example: 20 }) price: number;
  @ApiProperty({ example: true }) is_veg: boolean;
  @ApiProperty({ example: 10 }) prep_minutes: number;
  @ApiProperty({ nullable: true, type: Number, example: 250 }) calories: number | null;
  @ApiProperty({ nullable: true, type: String, example: 'gluten' }) allergens: string | null;
  @ApiProperty({ example: true, description: 'Switched off when sold out for the day' }) available: boolean;
  @ApiProperty({ example: true }) active: boolean;
}

export class FoodItemInputDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) category_id: number;
  @ApiProperty({ example: 'Veg Puff' }) @Transform(trim) @IsString() @Length(1, 120) name: string;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'PUFF' })
  @IsOptional()
  @Transform(upper)
  @ValidateIf(notNull)
  @Matches(CODE, { message: 'code must be 1 to 20 letters, digits or dashes' })
  code?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(400)
  description?: string | null;
  @ApiProperty({ example: 20 }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) price: number;
  @ApiPropertyOptional({ example: true }) @IsOptional() @IsBoolean() is_veg?: boolean;
  @ApiPropertyOptional({ example: 10, minimum: 0, maximum: 240 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  prep_minutes?: number;
  @ApiPropertyOptional({ nullable: true, type: Number, example: 250 })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(0)
  @Max(10000)
  calories?: number | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'gluten' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(200)
  allergens?: string | null;
  @ApiPropertyOptional({ example: true }) @IsOptional() @IsBoolean() available?: boolean;
  @ApiPropertyOptional({ example: true }) @IsOptional() @IsBoolean() active?: boolean;
}

export class FoodItemUpdateDto extends PartialType(FoodItemInputDto) {}

export class FoodItemQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) category_id?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(toBoolean) @IsBoolean() is_veg?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(toBoolean) @IsBoolean() available?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(toBoolean) @IsBoolean() active?: boolean;
}

export class FoodItemAvailabilityDto {
  @ApiProperty({ example: false }) @IsBoolean() available: boolean;
}

export class FoodItemInsightsDto {
  @ApiProperty({ example: 42 }) total: number;
  @ApiProperty({ example: 38 }) active: number;
  @ApiProperty({ example: 30 }) veg: number;
  @ApiProperty({ example: 12 }) non_veg: number;
  @ApiProperty({ example: 3 }) unavailable: number;
}

export class RecipeLineDto {
  @ApiProperty({ example: 4 }) stock_item_id: number;
  @ApiProperty({ example: 'Rice' }) stock_item_name: string;
  @ApiProperty({ example: 'kg' }) unit: string;
  @ApiProperty({ example: 0.15 }) quantity: number;
}

export class RecipeLineInputDto {
  @ApiProperty({ example: 4 }) @IsInt() @Min(1) stock_item_id: number;
  @ApiProperty({ example: 0.15, description: 'Stock used for one serving' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1000000)
  quantity: number;
}

export class RecipeInputDto {
  @ApiProperty({ type: [RecipeLineInputDto], description: 'Replaces the whole recipe; empty clears it' })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RecipeLineInputDto)
  lines: RecipeLineInputDto[];
}

export class MealItemDto {
  @ApiProperty({ example: 1 }) food_item_id: number;
  @ApiProperty({ example: 'Veg Puff' }) name: string;
  @ApiProperty({ example: 20 }) price: number;
  @ApiProperty({ example: 2 }) quantity: number;
}

export class MealDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ example: 'Snack Combo' }) name: string;
  @ApiProperty({ nullable: true, type: String, example: 'COMBO1' }) code: string | null;
  @ApiProperty({ enum: MEAL_KINDS }) kind: MealKind;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty({ example: 50 }) price: number;
  @ApiProperty({ example: true }) active: boolean;
  @ApiProperty({ type: [MealItemDto] }) items: MealItemDto[];
  @ApiProperty({ example: 60, description: 'Sum of the component prices' }) item_total: number;
  @ApiProperty({ example: 10, description: 'item_total minus price' }) saving: number;
}

export class MealItemInputDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) food_item_id: number;
  @ApiProperty({ example: 2 }) @IsInt() @Min(1) @Max(50) quantity: number;
}

export class MealInputDto {
  @ApiProperty({ example: 'Snack Combo' }) @Transform(trim) @IsString() @Length(1, 120) name: string;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'COMBO1' })
  @IsOptional()
  @Transform(upper)
  @ValidateIf(notNull)
  @Matches(CODE, { message: 'code must be 1 to 20 letters, digits or dashes' })
  code?: string | null;
  @ApiPropertyOptional({ enum: MEAL_KINDS, default: 'meal' }) @IsOptional() @IsIn(MEAL_KINDS) kind?: MealKind;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(400)
  description?: string | null;
  @ApiProperty({ example: 50 }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) price: number;
  @ApiPropertyOptional({ example: true }) @IsOptional() @IsBoolean() active?: boolean;
  @ApiProperty({ type: [MealItemInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => MealItemInputDto)
  items: MealItemInputDto[];
}

export class MealUpdateDto extends PartialType(MealInputDto) {}

export class MealQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: MEAL_KINDS }) @IsOptional() @IsIn(MEAL_KINDS) kind?: MealKind;
  @ApiPropertyOptional() @IsOptional() @Transform(toBoolean) @IsBoolean() active?: boolean;
}

export class DailyMenuQueryDto {
  @IsDateOnly('2026-06-01') date: string;
  @ApiPropertyOptional({ enum: MEAL_SLOTS }) @IsOptional() @IsIn(MEAL_SLOTS) slot?: MealSlot;
}

export class DailyMenuWeekQueryDto {
  @IsDateOnly('2026-06-01', true) from?: string;
}

export class DailyMenuEntryDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ example: '2026-06-01', format: 'date' }) menu_date: string;
  @ApiProperty({ enum: MEAL_SLOTS }) slot: MealSlot;
  @ApiProperty({ enum: ['item', 'meal'] }) kind: 'item' | 'meal';
  @ApiProperty({ nullable: true, type: Number, example: 1 }) food_item_id: number | null;
  @ApiProperty({ nullable: true, type: Number, example: null }) meal_id: number | null;
  @ApiProperty({ example: 'Veg Puff' }) name: string;
  @ApiProperty({ nullable: true, type: Boolean, example: true, description: 'Null for meals and combos' })
  is_veg: boolean | null;
  @ApiProperty({ example: 20, description: 'Price of the item or meal itself' }) base_price: number;
  @ApiProperty({ nullable: true, type: Number, example: null, description: 'Price override for the day' })
  price: number | null;
  @ApiProperty({ example: 20, description: 'price when set, else base_price' }) effective_price: number;
  @ApiProperty({ nullable: true, type: Number, example: 50 }) quantity_limit: number | null;
  @ApiProperty({ example: 12 }) sold_quantity: number;
  @ApiProperty({ nullable: true, type: Number, example: 38, description: 'Null when there is no limit' })
  remaining: number | null;
  @ApiProperty({ example: true }) active: boolean;
}

export class DailyMenuSlotDto {
  @ApiProperty({ enum: MEAL_SLOTS }) slot: MealSlot;
  @ApiProperty({ type: [DailyMenuEntryDto] }) entries: DailyMenuEntryDto[];
}

export class DailyMenuDayDto {
  @ApiProperty({ example: '2026-06-01', format: 'date' }) date: string;
  @ApiProperty({ type: [DailyMenuSlotDto] }) slots: DailyMenuSlotDto[];
}

export class DailyMenuEntryInputDto {
  @ApiPropertyOptional({ nullable: true, type: Number, example: 1 })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  food_item_id?: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number, example: null })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  meal_id?: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number, example: null })
  @IsOptional()
  @ValidateIf(notNull)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  price?: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number, example: 50 })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  @Max(100000)
  quantity_limit?: number | null;
  @ApiPropertyOptional({ example: true }) @IsOptional() @IsBoolean() active?: boolean;
}

export class DailyMenuInputDto {
  @IsDateOnly('2026-06-01') date: string;
  @ApiProperty({ enum: MEAL_SLOTS }) @IsIn(MEAL_SLOTS) slot: MealSlot;
  @ApiProperty({ type: [DailyMenuEntryInputDto], description: 'Replaces the slot; empty clears it' })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DailyMenuEntryInputDto)
  entries: DailyMenuEntryInputDto[];
}

export class DailyMenuCopyDto {
  @IsDateOnly('2026-06-01') from_date: string;
  @IsDateOnly('2026-06-02') to_date: string;
  @ApiPropertyOptional({ enum: MEAL_SLOTS, description: 'Copy one slot; all slots when left out' })
  @IsOptional()
  @IsIn(MEAL_SLOTS)
  slot?: MealSlot;
}
