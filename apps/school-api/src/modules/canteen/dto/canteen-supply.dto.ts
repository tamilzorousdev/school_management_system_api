import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { IsDateOnly, IsNullableDate } from '../../../shared/dates';
import { IsMobile } from '../../../shared/mobile';
import { MEAL_SLOTS, MealSlot } from '../entities/canteen-menu.entity';
import {
  BATCH_STATUSES,
  BatchStatus,
  BOOKING_STATUSES,
  BookingStatus,
  PURCHASE_STATUSES,
  PurchaseStatus,
  STOCK_MOVEMENT_KINDS,
  STOCK_UNITS,
  StockMovementKind,
  StockUnit,
  TABLE_STATUSES,
  TableStatus,
  WASTE_REASONS,
  WasteReason,
} from '../entities/canteen-supply.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export const STOCK_STATES = ['out', 'low', 'ok'] as const;
export const ADJUST_KINDS = ['adjustment', 'return', 'issue'] as const;
export type AdjustKind = (typeof ADJUST_KINDS)[number];

export class CanteenStockItemInputDto {
  @ApiProperty({ example: 'Basmati rice', maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: 'RICE01', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(20)
  code?: string | null;

  @ApiProperty({ enum: STOCK_UNITS, example: 'kg' })
  @IsIn(STOCK_UNITS)
  unit: StockUnit;

  @ApiPropertyOptional({ example: 10, description: 'Alert when stock falls to this level' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  reorder_level?: number;

  @ApiPropertyOptional({ example: 62.5 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost_per_unit?: number;

  @ApiPropertyOptional({ example: 25, description: 'Opening stock, recorded as an adjustment' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  opening_quantity?: number;

  @IsNullableDate('2026-12-31')
  expiry_date?: string | null;

  @ApiPropertyOptional({ example: 3, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  supplier_id?: number | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CanteenStockItemUpdateDto extends PartialType(CanteenStockItemInputDto) {}

export class CanteenStockItemQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: STOCK_STATES })
  @IsOptional()
  @IsIn(STOCK_STATES)
  status?: (typeof STOCK_STATES)[number];

  @ApiPropertyOptional({
    example: 7,
    description: 'Items whose expiry date falls within this many days (or already passed)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  expiring_within_days?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  supplier_id?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}

export class CanteenStockAdjustDto {
  @ApiProperty({ enum: ADJUST_KINDS, example: 'adjustment' })
  @IsIn(ADJUST_KINDS)
  kind: AdjustKind;

  @ApiProperty({ example: -2.5, description: 'Signed for an adjustment, positive for return and issue' })
  @IsNumber({ maxDecimalPlaces: 3 })
  quantity: number;

  @ApiPropertyOptional({ example: 'Physical count correction', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(200)
  note?: string | null;
}

export class CanteenStockMovementQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: STOCK_MOVEMENT_KINDS })
  @IsOptional()
  @IsIn(STOCK_MOVEMENT_KINDS)
  kind?: StockMovementKind;
}

export class CanteenSupplierRefDto {
  @ApiProperty({ example: 3 }) id: number;
  @ApiProperty({ example: 'Sri Murugan Traders' }) name: string;
}

export class CanteenStockItemDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ example: 'Basmati rice' }) name: string;
  @ApiProperty({ example: 'RICE01', nullable: true, type: String }) code: string | null;
  @ApiProperty({ enum: STOCK_UNITS }) unit: StockUnit;
  @ApiProperty({ example: 42.5 }) quantity_on_hand: number;
  @ApiProperty({ example: 10 }) reorder_level: number;
  @ApiProperty({ example: 62.5 }) cost_per_unit: number;
  @ApiProperty({ example: 2656.25 }) stock_value: number;
  @ApiProperty({ example: '2026-12-31', nullable: true, type: String }) expiry_date: string | null;
  @ApiProperty({ example: 25, nullable: true, type: Number, description: 'Days to expiry, negative when expired' })
  days_to_expiry: number | null;
  @ApiProperty({ enum: STOCK_STATES }) status: (typeof STOCK_STATES)[number];
  @ApiProperty({ nullable: true, type: CanteenSupplierRefDto }) supplier: CanteenSupplierRefDto | null;
  @ApiProperty({ example: true }) active: boolean;
  @ApiProperty({ example: '2026-06-01T10:00:00+05:30' }) created_at: Date;
}

export class CanteenStockMovementDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ example: 1 }) stock_item_id: number;
  @ApiProperty({ enum: STOCK_MOVEMENT_KINDS }) kind: StockMovementKind;
  @ApiProperty({ example: -2.5, description: 'Signed change' }) quantity: number;
  @ApiProperty({ example: 40 }) balance_after: number;
  @ApiProperty({ example: 62.5, nullable: true, type: Number }) unit_cost: number | null;
  @ApiProperty({ example: 'purchase', nullable: true, type: String }) reference_type: string | null;
  @ApiProperty({ example: 4, nullable: true, type: Number }) reference_id: number | null;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty({ example: 2, nullable: true, type: Number }) created_by: number | null;
  @ApiProperty({ example: '2026-06-01T10:00:00+05:30' }) created_at: Date;
}

export class CanteenStockInsightsDto {
  @ApiProperty({ example: 48 }) total_items: number;
  @ApiProperty({ example: 3 }) out_of_stock: number;
  @ApiProperty({ example: 7 }) low_stock: number;
  @ApiProperty({ example: 4, description: 'Expired or expiring within 7 days' }) expiring_soon: number;
  @ApiProperty({ example: 125000.5 }) stock_value: number;
}

export class CanteenSupplierInputDto {
  @ApiProperty({ example: 'Sri Murugan Traders', maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: 'Murugan', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  contact_person?: string | null;

  @IsMobile()
  mobile: string;

  @ApiPropertyOptional({ example: 'orders@murugan.example', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsEmail()
  @MaxLength(120)
  email?: string | null;

  @ApiPropertyOptional({ example: '12 Market Road, Madurai', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @ApiPropertyOptional({ example: '33ABCDE1234F1Z5', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(20)
  gstin?: string | null;

  @ApiPropertyOptional({ example: 'Rice, pulses, oil', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(200)
  supplies?: string | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CanteenSupplierUpdateDto extends PartialType(CanteenSupplierInputDto) {}

export class CanteenSupplierQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}

export class CanteenSupplierDto {
  @ApiProperty({ example: 3 }) id: number;
  @ApiProperty({ example: 'Sri Murugan Traders' }) name: string;
  @ApiProperty({ nullable: true, type: String }) contact_person: string | null;
  @ApiProperty({ example: '9876543210', nullable: true, type: String }) mobile: string | null;
  @ApiProperty({ nullable: true, type: String }) email: string | null;
  @ApiProperty({ nullable: true, type: String }) address: string | null;
  @ApiProperty({ nullable: true, type: String }) gstin: string | null;
  @ApiProperty({ nullable: true, type: String }) supplies: string | null;
  @ApiProperty({ example: true }) active: boolean;
  @ApiProperty({ example: '2026-06-01T10:00:00+05:30' }) created_at: Date;
}

export class CanteenSupplierDetailDto extends CanteenSupplierDto {
  @ApiProperty({ example: 12 }) purchase_count: number;
  @ApiProperty({ example: 2, description: 'Draft, ordered or partial orders' }) open_purchase_count: number;
  @ApiProperty({ example: 84500 }) purchase_total: number;
  @ApiProperty({ example: '2026-05-28', nullable: true, type: String }) last_order_date: string | null;
}

export class CanteenPurchaseLineInputDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  stock_item_id: number;

  @ApiProperty({ example: 25 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;

  @ApiProperty({ example: 62.5 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unit_cost: number;
}

export class CanteenPurchaseInputDto {
  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  supplier_id: number;

  @IsDateOnly('2026-06-01', true)
  order_date?: string;

  @IsDateOnly('2026-06-03', true)
  expected_date?: string;

  @ApiPropertyOptional({ example: 'Deliver before 8 AM', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;

  @ApiProperty({ type: [CanteenPurchaseLineInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CanteenPurchaseLineInputDto)
  lines: CanteenPurchaseLineInputDto[];
}

export class CanteenPurchaseQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: PURCHASE_STATUSES })
  @IsOptional()
  @IsIn(PURCHASE_STATUSES)
  status?: PurchaseStatus;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  supplier_id?: number;

  @IsDateOnly('2026-06-01', true)
  from?: string;

  @IsDateOnly('2026-06-30', true)
  to?: string;
}

export class CanteenReceiveLineDto {
  @ApiProperty({ example: 11 })
  @IsInt()
  @Min(1)
  line_id: number;

  @ApiProperty({ example: 10 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;
}

export class CanteenReceiveDto {
  @ApiProperty({ type: [CanteenReceiveLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CanteenReceiveLineDto)
  lines: CanteenReceiveLineDto[];
}

export class CanteenPurchaseLineDto {
  @ApiProperty({ example: 11 }) id: number;
  @ApiProperty({ example: 1 }) stock_item_id: number;
  @ApiProperty({ example: 'Basmati rice' }) stock_item_name: string;
  @ApiProperty({ enum: STOCK_UNITS }) unit: StockUnit;
  @ApiProperty({ example: 25 }) quantity: number;
  @ApiProperty({ example: 62.5 }) unit_cost: number;
  @ApiProperty({ example: 10 }) received_quantity: number;
  @ApiProperty({ example: 1562.5 }) line_total: number;
}

export class CanteenPurchaseDto {
  @ApiProperty({ example: 4 }) id: number;
  @ApiProperty({ example: 'PO-20260601-0001' }) po_no: string;
  @ApiProperty({ type: CanteenSupplierRefDto }) supplier: CanteenSupplierRefDto;
  @ApiProperty({ example: '2026-06-01' }) order_date: string;
  @ApiProperty({ example: '2026-06-03', nullable: true, type: String }) expected_date: string | null;
  @ApiProperty({ enum: PURCHASE_STATUSES }) status: PurchaseStatus;
  @ApiProperty({ example: 1562.5 }) total_amount: number;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty({ example: '2026-06-03T10:00:00+05:30', nullable: true, type: Date }) received_at: Date | null;
  @ApiProperty({ example: 2 }) line_count: number;
  @ApiProperty({ type: [CanteenPurchaseLineDto] }) lines: CanteenPurchaseLineDto[];
  @ApiProperty({ example: '2026-06-01T10:00:00+05:30' }) created_at: Date;
}

export class CanteenPurchaseInsightsDto {
  @ApiProperty({ example: 2 }) draft: number;
  @ApiProperty({ example: 3 }) ordered: number;
  @ApiProperty({ example: 1 }) partial: number;
  @ApiProperty({ example: 14 }) received: number;
  @ApiProperty({ example: 4 }) open_orders: number;
  @ApiProperty({ example: 52000, description: 'Value of orders placed this month, cancelled excluded' })
  month_total: number;
  @ApiProperty({ example: 1, description: 'Ordered or partial orders past their expected date' }) overdue: number;
}

export class CanteenKitchenQueueQueryDto {
  @IsDateOnly('2026-06-01', true)
  date?: string;
}

export class CanteenKitchenPlanQueryDto {
  @IsDateOnly('2026-06-01', true)
  date?: string;

  @ApiPropertyOptional({ enum: MEAL_SLOTS })
  @IsOptional()
  @IsIn(MEAL_SLOTS)
  slot?: MealSlot;
}

export class CanteenKitchenQueueItemDto {
  @ApiProperty({ example: 5 }) food_item_id: number;
  @ApiProperty({ example: 'Veg biryani' }) name: string;
  @ApiProperty({ example: 14 }) total_quantity: number;
  @ApiProperty({ example: 5, description: 'Orders still being prepared or waiting' }) order_count: number;
  @ApiProperty({ example: ['T012', 'T015'] }) tokens: string[];
  @ApiProperty({ example: 10 }) prep_minutes: number;
}

export class CanteenKitchenQueueDto {
  @ApiProperty({ example: '2026-06-01' }) date: string;
  @ApiProperty({ example: 6 }) open_orders: number;
  @ApiProperty({ type: [CanteenKitchenQueueItemDto] }) items: CanteenKitchenQueueItemDto[];
}

export class CanteenKitchenPlanRowDto {
  @ApiProperty({ enum: MEAL_SLOTS }) slot: MealSlot;
  @ApiProperty({ example: 5 }) food_item_id: number;
  @ApiProperty({ example: 'Veg biryani' }) name: string;
  @ApiProperty({ example: 100, nullable: true, type: Number }) quantity_limit: number | null;
  @ApiProperty({ example: 40 }) sold_quantity: number;
  @ApiProperty({ example: 30, description: 'Planned in active batches' }) planned_quantity: number;
  @ApiProperty({ example: 70 }) suggested_quantity: number;
}

export class CanteenKitchenBatchInputDto {
  @IsDateOnly('2026-06-01')
  batch_date: string;

  @ApiProperty({ enum: MEAL_SLOTS, example: 'lunch' })
  @IsIn(MEAL_SLOTS)
  slot: MealSlot;

  @ApiProperty({ example: 5 })
  @IsInt()
  @Min(1)
  food_item_id: number;

  @ApiProperty({ example: 60 })
  @IsInt()
  @Min(1)
  @Max(100000)
  planned_quantity: number;

  @ApiPropertyOptional({ example: 2, nullable: true, description: 'Canteen staff id of the cook' })
  @IsOptional()
  @IsInt()
  @Min(1)
  cook_id?: number | null;

  @ApiPropertyOptional({ example: 'Less spicy', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class CanteenKitchenBatchUpdateDto {
  @ApiPropertyOptional({ example: 80 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  planned_quantity?: number;

  @ApiPropertyOptional({ example: 2, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  cook_id?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class CanteenKitchenBatchCompleteDto {
  @ApiProperty({ example: 58, description: 'Portions actually cooked' })
  @IsInt()
  @Min(0)
  @Max(100000)
  prepared_quantity: number;
}

export class CanteenKitchenBatchQueryDto extends ListQueryDto {
  @IsDateOnly('2026-06-01', true)
  date?: string;

  @ApiPropertyOptional({ enum: MEAL_SLOTS })
  @IsOptional()
  @IsIn(MEAL_SLOTS)
  slot?: MealSlot;

  @ApiPropertyOptional({ enum: BATCH_STATUSES })
  @IsOptional()
  @IsIn(BATCH_STATUSES)
  status?: BatchStatus;
}

export class CanteenKitchenCookDto {
  @ApiProperty({ example: 2 }) id: number;
  @ApiProperty({ example: 'Lakshmi' }) name: string;
}

export class CanteenKitchenBatchDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ example: '2026-06-01' }) batch_date: string;
  @ApiProperty({ enum: MEAL_SLOTS }) slot: MealSlot;
  @ApiProperty({ example: 5 }) food_item_id: number;
  @ApiProperty({ example: 'Veg biryani' }) food_item_name: string;
  @ApiProperty({ example: 60 }) planned_quantity: number;
  @ApiProperty({ example: 58 }) prepared_quantity: number;
  @ApiProperty({ enum: BATCH_STATUSES }) status: BatchStatus;
  @ApiProperty({ nullable: true, type: CanteenKitchenCookDto }) cook: CanteenKitchenCookDto | null;
  @ApiProperty({ example: '2026-06-01T10:00:00+05:30', nullable: true, type: Date }) started_at: Date | null;
  @ApiProperty({ example: '2026-06-01T10:45:00+05:30', nullable: true, type: Date }) completed_at: Date | null;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
}

export class CanteenKitchenInsightsDto {
  @ApiProperty({ example: '2026-06-01' }) date: string;
  @ApiProperty({ example: 6 }) batches: number;
  @ApiProperty({ example: 2 }) planned: number;
  @ApiProperty({ example: 1 }) cooking: number;
  @ApiProperty({ example: 3 }) done: number;
  @ApiProperty({ example: 180 }) planned_portions: number;
  @ApiProperty({ example: 150 }) prepared_portions: number;
  @ApiProperty({ example: 5 }) open_orders: number;
}

export class CanteenTableInputDto {
  @ApiProperty({ example: 'T1', maxLength: 40 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name: string;

  @ApiPropertyOptional({ example: 'Main hall', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(60)
  area?: string | null;

  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(1)
  @Max(50)
  seats: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CanteenTableUpdateDto extends PartialType(CanteenTableInputDto) {}

export class CanteenTableStatusDto {
  @ApiProperty({ enum: TABLE_STATUSES, example: 'cleaning' })
  @IsIn(TABLE_STATUSES)
  status: TableStatus;
}

export class CanteenTableQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: TABLE_STATUSES })
  @IsOptional()
  @IsIn(TABLE_STATUSES)
  status?: TableStatus;

  @ApiPropertyOptional({ example: 'Main hall' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  area?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}

export class CanteenTableLayoutQueryDto {
  @IsDateOnly('2026-06-01', true)
  date?: string;

  @ApiPropertyOptional({ enum: MEAL_SLOTS })
  @IsOptional()
  @IsIn(MEAL_SLOTS)
  slot?: MealSlot;
}

export class CanteenTableDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ example: 'T1' }) name: string;
  @ApiProperty({ example: 'Main hall', nullable: true, type: String }) area: string | null;
  @ApiProperty({ example: 4 }) seats: number;
  @ApiProperty({ enum: TABLE_STATUSES }) status: TableStatus;
  @ApiProperty({ example: true }) active: boolean;
}

export class CanteenBookingInputDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  table_id: number;

  @IsDateOnly('2026-06-01')
  booking_date: string;

  @ApiProperty({ enum: MEAL_SLOTS, example: 'lunch' })
  @IsIn(MEAL_SLOTS)
  slot: MealSlot;

  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  @Max(50)
  party_size: number;

  @ApiPropertyOptional({ example: 12, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  diner_id?: number | null;

  @ApiPropertyOptional({ example: 'Visiting parent', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  guest_name?: string | null;
}

export class CanteenBookingReleaseDto {
  @ApiPropertyOptional({ example: true, description: 'Mark the table for cleaning instead of free' })
  @IsOptional()
  @IsBoolean()
  needs_cleaning?: boolean;
}

export class CanteenBookingQueryDto extends ListQueryDto {
  @IsDateOnly('2026-06-01', true)
  date?: string;

  @ApiPropertyOptional({ enum: MEAL_SLOTS })
  @IsOptional()
  @IsIn(MEAL_SLOTS)
  slot?: MealSlot;

  @ApiPropertyOptional({ enum: BOOKING_STATUSES })
  @IsOptional()
  @IsIn(BOOKING_STATUSES)
  status?: BookingStatus;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  table_id?: number;
}

export class CanteenBookingDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ example: 1 }) table_id: number;
  @ApiProperty({ example: 'T1' }) table_name: string;
  @ApiProperty({ example: '2026-06-01' }) booking_date: string;
  @ApiProperty({ enum: MEAL_SLOTS }) slot: MealSlot;
  @ApiProperty({ example: 3 }) party_size: number;
  @ApiProperty({ example: 12, nullable: true, type: Number }) diner_id: number | null;
  @ApiProperty({ example: 'Visiting parent', nullable: true, type: String }) guest_name: string | null;
  @ApiProperty({ enum: BOOKING_STATUSES }) status: BookingStatus;
  @ApiProperty({ example: '2026-06-01T12:30:00+05:30', nullable: true, type: Date }) seated_at: Date | null;
  @ApiProperty({ example: '2026-06-01T13:10:00+05:30', nullable: true, type: Date }) released_at: Date | null;
}

export class CanteenTableLayoutRowDto extends CanteenTableDto {
  @ApiProperty({ nullable: true, type: CanteenBookingDto }) booking: CanteenBookingDto | null;
}

export class CanteenTablesInsightsDto {
  @ApiProperty({ example: 12 }) total_tables: number;
  @ApiProperty({ example: 48 }) total_seats: number;
  @ApiProperty({ example: 16 }) occupied_seats: number;
  @ApiProperty({ example: 28 }) free_seats: number;
  @ApiProperty({ example: 4 }) occupied_tables: number;
  @ApiProperty({ example: 7 }) free_tables: number;
  @ApiProperty({ example: 5 }) reserved_today: number;
}

export class CanteenWasteInputDto {
  @IsDateOnly('2026-06-01')
  waste_date: string;

  @ApiPropertyOptional({ example: 5, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  food_item_id?: number | null;

  @ApiPropertyOptional({ example: 1, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  stock_item_id?: number | null;

  @ApiPropertyOptional({ example: 'Leftover dosa batter', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(120)
  item_name?: string | null;

  @ApiProperty({ example: 2.5 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;

  @ApiProperty({ enum: STOCK_UNITS, example: 'kg' })
  @IsIn(STOCK_UNITS)
  unit: StockUnit;

  @ApiProperty({ enum: WASTE_REASONS, example: 'leftover' })
  @IsIn(WASTE_REASONS)
  reason: WasteReason;

  @ApiPropertyOptional({ example: 150, description: 'Defaults to the estimated cost' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost?: number;

  @ApiPropertyOptional({ example: 'Unsold after lunch', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class CanteenWasteQueryDto extends ListQueryDto {
  @IsDateOnly('2026-06-01', true)
  from?: string;

  @IsDateOnly('2026-06-30', true)
  to?: string;

  @ApiPropertyOptional({ enum: WASTE_REASONS })
  @IsOptional()
  @IsIn(WASTE_REASONS)
  reason?: WasteReason;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  food_item_id?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  stock_item_id?: number;
}

export class CanteenWasteSummaryQueryDto {
  @IsDateOnly('2026-06-01', true)
  from?: string;

  @IsDateOnly('2026-06-30', true)
  to?: string;
}

export class CanteenWasteDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ example: '2026-06-01' }) waste_date: string;
  @ApiProperty({ example: 5, nullable: true, type: Number }) food_item_id: number | null;
  @ApiProperty({ example: 1, nullable: true, type: Number }) stock_item_id: number | null;
  @ApiProperty({ example: 'Veg biryani' }) item_name: string;
  @ApiProperty({ example: 2.5 }) quantity: number;
  @ApiProperty({ enum: STOCK_UNITS }) unit: StockUnit;
  @ApiProperty({ enum: WASTE_REASONS }) reason: WasteReason;
  @ApiProperty({ example: 150 }) cost: number;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty({ example: '2026-06-01T15:00:00+05:30' }) created_at: Date;
}

export class CanteenWasteReasonRowDto {
  @ApiProperty({ enum: WASTE_REASONS }) reason: WasteReason;
  @ApiProperty({ example: 6 }) entries: number;
  @ApiProperty({ example: 750 }) cost: number;
}

export class CanteenWasteDayRowDto {
  @ApiProperty({ example: '2026-06-01' }) date: string;
  @ApiProperty({ example: 2 }) entries: number;
  @ApiProperty({ example: 300 }) cost: number;
}

export class CanteenWasteTopRowDto {
  @ApiProperty({ example: 'Veg biryani' }) item_name: string;
  @ApiProperty({ example: 9.5 }) quantity: number;
  @ApiProperty({ example: 640 }) cost: number;
}

export class CanteenWasteSummaryDto {
  @ApiProperty({ example: '2026-06-01' }) from: string;
  @ApiProperty({ example: '2026-06-30' }) to: string;
  @ApiProperty({ example: 14 }) entries: number;
  @ApiProperty({ example: 2100.5 }) total_cost: number;
  @ApiProperty({ type: [CanteenWasteReasonRowDto] }) by_reason: CanteenWasteReasonRowDto[];
  @ApiProperty({ type: [CanteenWasteDayRowDto] }) by_day: CanteenWasteDayRowDto[];
  @ApiProperty({ type: [CanteenWasteTopRowDto] }) top_items: CanteenWasteTopRowDto[];
}
