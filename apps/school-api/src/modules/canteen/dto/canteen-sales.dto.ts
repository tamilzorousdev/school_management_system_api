import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { MEAL_SLOTS, MealSlot } from '../entities/canteen-menu.entity';
import {
  CARD_STATUSES,
  CardStatus,
  DIETS,
  Diet,
  DINER_STATUSES,
  DINER_TYPES,
  DinerStatus,
  DinerType,
  ORDER_CHANNELS,
  ORDER_STATUSES,
  OrderChannel,
  OrderStatus,
  PAYMENT_MODES,
  PAYMENT_STATUSES,
  PaymentMode,
  PaymentStatus,
  TOPUP_MODES,
  TopupMode,
  WALLET_KINDS,
  WalletKind,
} from '../entities/canteen-sales.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const notNull = (_object: unknown, value: unknown) => value !== null && value !== undefined;
const SLOT_LIST = /^(breakfast|lunch|snacks|dinner)(,(breakfast|lunch|snacks|dinner))*$/;

export class DinerPersonDto {
  @ApiProperty({ example: 12 }) id: number;
  @ApiProperty({ example: 'Arun Kumar' }) name: string;
  @ApiProperty({ nullable: true, type: String, example: 'ADM-0012' }) admission_no: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'EMP-007' }) employee_no: string | null;
  @ApiProperty({ nullable: true, type: String, example: '6' }) class_name: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'A' }) section_name: string | null;
}

export class DinerDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ enum: DINER_TYPES }) person_type: DinerType;
  @ApiProperty({ nullable: true, type: Number, example: 12 }) student_id: number | null;
  @ApiProperty({ nullable: true, type: Number, example: null }) staff_id: number | null;
  @ApiProperty({ type: DinerPersonDto }) person: DinerPersonDto;
  @ApiProperty({ example: 'CN000001' }) card_no: string;
  @ApiProperty({ enum: CARD_STATUSES }) card_status: CardStatus;
  @ApiProperty({ example: 1 }) card_version: number;
  @ApiProperty({ nullable: true, type: String, example: '2026-06-01T09:00:00+05:30' }) card_issued_at: Date | null;
  @ApiProperty({ example: 250 }) wallet_balance: number;
  @ApiProperty({ nullable: true, type: Number, example: 150 }) daily_limit: number | null;
  @ApiProperty({ enum: DIETS }) diet: Diet;
  @ApiProperty({ nullable: true, type: String, example: 'peanut, milk' }) allergies: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'breakfast,lunch' }) meal_slots: string | null;
  @ApiProperty({ enum: DINER_STATUSES }) status: DinerStatus;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
}

export class RecentOrderDto {
  @ApiProperty({ example: 5 }) id: number;
  @ApiProperty({ example: 'ORD-20260601-0005' }) order_no: string;
  @ApiProperty({ example: 'T005' }) token_label: string;
  @ApiProperty({ example: '2026-06-01' }) order_date: string;
  @ApiProperty({ enum: ORDER_STATUSES }) status: OrderStatus;
  @ApiProperty({ example: 85 }) total_amount: number;
  @ApiProperty({ enum: PAYMENT_STATUSES }) payment_status: PaymentStatus;
}

export class DinerDetailDto extends DinerDto {
  @ApiProperty({ example: 85 }) today_spend: number;
  @ApiProperty({ type: RecentOrderDto, isArray: true }) recent_orders: RecentOrderDto[];
}

export class DinerInsightsDto {
  @ApiProperty({ example: 320 }) total: number;
  @ApiProperty({ example: 280 }) students: number;
  @ApiProperty({ example: 40 }) staff: number;
  @ApiProperty({ example: 300 }) active: number;
  @ApiProperty({ example: 6 }) blocked_cards: number;
  @ApiProperty({ example: 12 }) low_balance: number;
}

export class DinerQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: DINER_TYPES }) @IsOptional() @IsIn(DINER_TYPES) person_type?: DinerType;
  @ApiPropertyOptional({ enum: DINER_STATUSES }) @IsOptional() @IsIn(DINER_STATUSES) status?: DinerStatus;
  @ApiPropertyOptional({ enum: CARD_STATUSES }) @IsOptional() @IsIn(CARD_STATUSES) card_status?: CardStatus;
  @ApiPropertyOptional({ enum: DIETS }) @IsOptional() @IsIn(DIETS) diet?: Diet;
  @ApiPropertyOptional({ example: 3 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) class_id?: number;
}

export class DinerInputDto {
  @ApiProperty({ enum: DINER_TYPES }) @IsIn(DINER_TYPES) person_type: DinerType;
  @ApiPropertyOptional({ example: 12, description: 'Required for a student' })
  @ValidateIf((dto: DinerInputDto) => dto.person_type === 'student')
  @IsInt()
  @Min(1)
  student_id?: number;
  @ApiPropertyOptional({ example: 4, description: 'Required for a staff member' })
  @ValidateIf((dto: DinerInputDto) => dto.person_type === 'staff')
  @IsInt()
  @Min(1)
  staff_id?: number;
  @ApiPropertyOptional({ enum: DIETS, default: 'veg' }) @IsOptional() @IsIn(DIETS) diet?: Diet;
  @ApiPropertyOptional({ example: 'peanut, milk' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  allergies?: string;
  @ApiPropertyOptional({ example: 'breakfast,lunch', description: 'Comma-separated slots; empty means all' })
  @IsOptional()
  @Matches(SLOT_LIST, { message: `meal_slots must be a comma-separated list of ${MEAL_SLOTS.join(', ')}` })
  meal_slots?: string;
  @ApiPropertyOptional({ example: 150, minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  daily_limit?: number;
  @ApiPropertyOptional({ example: 'Pays by wallet only' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  notes?: string;
}

export class DinerUpdateDto {
  @ApiPropertyOptional({ enum: DIETS }) @IsOptional() @IsIn(DIETS) diet?: Diet;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'peanut' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(300)
  allergies?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'lunch' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @Matches(SLOT_LIST, { message: `meal_slots must be a comma-separated list of ${MEAL_SLOTS.join(', ')}` })
  meal_slots?: string | null;
  @ApiPropertyOptional({ nullable: true, type: Number, example: 150 })
  @IsOptional()
  @ValidateIf(notNull)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  daily_limit?: number | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(300)
  notes?: string | null;
}

export class DinerStatusDto {
  @ApiProperty({ enum: DINER_STATUSES, example: 'suspended' }) @IsIn(DINER_STATUSES) status: DinerStatus;
}

export class CardBlockDto {
  @ApiProperty({ example: 'Card lost' }) @Transform(trim) @IsString() @MaxLength(200) reason: string;
  @ApiPropertyOptional({ enum: ['blocked', 'lost'], default: 'blocked' })
  @IsOptional()
  @IsIn(['blocked', 'lost'])
  card_status?: 'blocked' | 'lost';
}

export class CardLookupQueryDto {
  @ApiPropertyOptional({ example: 'CN000001' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  card_no?: string;
  @ApiPropertyOptional({ example: 'TZS1.12.1.abcdef' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  qr?: string;
}

export class WalletTransactionDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ example: 1 }) diner_id: number;
  @ApiProperty({ enum: WALLET_KINDS }) kind: WalletKind;
  @ApiProperty({ example: 200, description: 'Signed: credits positive, debits negative' }) amount: number;
  @ApiProperty({ example: 450 }) balance_after: number;
  @ApiProperty({ nullable: true, enum: TOPUP_MODES, type: String }) mode: TopupMode | null;
  @ApiProperty({ nullable: true, type: String, example: 'UPI-8841' }) reference: string | null;
  @ApiProperty({ nullable: true, type: Number, example: null }) order_id: number | null;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty({ example: '2026-06-01T09:00:00+05:30' }) created_at: Date;
}

export class WalletResultDto {
  @ApiProperty({ example: 1 }) diner_id: number;
  @ApiProperty({ example: 450 }) wallet_balance: number;
  @ApiProperty({ type: WalletTransactionDto }) transaction: WalletTransactionDto;
}

export class TopupDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) diner_id: number;
  @ApiProperty({ example: 200, minimum: 0.01 }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount: number;
  @ApiProperty({ enum: TOPUP_MODES }) @IsIn(TOPUP_MODES) mode: TopupMode;
  @ApiPropertyOptional({ example: 'UPI-8841' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  reference?: string;
  @ApiPropertyOptional({ example: 'Monthly advance' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class WalletRefundDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) diner_id: number;
  @ApiProperty({ example: 50, minimum: 0.01 }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount: number;
  @ApiPropertyOptional({ example: 'Overcharged' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class WalletAdjustmentDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) diner_id: number;
  @ApiProperty({ example: -20, description: 'Signed amount, not zero' })
  @IsNumber({ maxDecimalPlaces: 2 })
  amount: number;
  @ApiProperty({ example: 'Correction of duplicate top-up' }) @Transform(trim) @IsString() @MaxLength(200) note: string;
}

export class WalletTransactionQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: WALLET_KINDS }) @IsOptional() @IsIn(WALLET_KINDS) kind?: WalletKind;
}

export class LowBalanceQueryDto extends ListQueryDto {}

export class LowBalanceDto {
  @ApiProperty({ example: 1 }) diner_id: number;
  @ApiProperty({ example: 'Arun Kumar' }) name: string;
  @ApiProperty({ enum: DINER_TYPES }) person_type: DinerType;
  @ApiProperty({ example: 'CN000001' }) card_no: string;
  @ApiProperty({ example: 20 }) wallet_balance: number;
}

export class WalletSummaryDto {
  @ApiProperty({ example: 25400, description: 'Sum of all positive balances: money owed to diners' })
  total_liability: number;
  @ApiProperty({ example: 3200 }) topups_today: number;
  @ApiProperty({ example: 1800 }) spend_today: number;
  @ApiProperty({ example: 320 }) diners: number;
  @ApiProperty({ example: 12 }) low_balance: number;
}

export class OrderLineInputDto {
  @ApiPropertyOptional({ example: 3, description: 'Give food_item_id or meal_id' })
  @ValidateIf((line: OrderLineInputDto) => line.meal_id === undefined)
  @IsInt()
  @Min(1)
  food_item_id?: number;
  @ApiPropertyOptional({ example: 2 })
  @ValidateIf((line: OrderLineInputDto) => line.food_item_id === undefined)
  @IsInt()
  @Min(1)
  meal_id?: number;
  @ApiProperty({ example: 2, minimum: 1, maximum: 50 }) @IsInt() @Min(1) quantity: number;
}

export class OrderInputDto {
  @ApiPropertyOptional({ example: 1, description: 'Enrolled diner. Leave out for a walk-in' })
  @IsOptional()
  @IsInt()
  @Min(1)
  diner_id?: number;
  @ApiPropertyOptional({ example: 'Visitor' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  customer_name?: string;
  @ApiPropertyOptional({ enum: ORDER_CHANNELS, default: 'counter' })
  @IsOptional()
  @IsIn(ORDER_CHANNELS)
  channel?: OrderChannel;
  @ApiPropertyOptional({ enum: MEAL_SLOTS, description: 'Defaults from the time of day' })
  @IsOptional()
  @IsIn(MEAL_SLOTS)
  slot?: MealSlot;
  @ApiPropertyOptional({ example: 1 }) @IsOptional() @IsInt() @Min(1) counter_id?: number;
  @ApiPropertyOptional({ example: 4 }) @IsOptional() @IsInt() @Min(1) table_id?: number;
  @ApiProperty({ type: OrderLineInputDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  items: OrderLineInputDto[];
  @ApiPropertyOptional({ enum: PAYMENT_MODES, description: 'Leave out to pay later' })
  @IsOptional()
  @IsIn(PAYMENT_MODES)
  payment_mode?: PaymentMode;
  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount_amount?: number;
  @ApiPropertyOptional({ example: 'Less spicy' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class OrderItemDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ nullable: true, type: Number, example: 3 }) food_item_id: number | null;
  @ApiProperty({ nullable: true, type: Number, example: null }) meal_id: number | null;
  @ApiProperty({ example: 'Masala Dosa' }) name: string;
  @ApiProperty({ example: 40 }) unit_price: number;
  @ApiProperty({ example: 2 }) quantity: number;
  @ApiProperty({ example: 80 }) line_total: number;
}

export class PaymentDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ example: 5 }) order_id: number;
  @ApiProperty({ example: 'RCP-20260601-0001' }) receipt_no: string;
  @ApiProperty({ enum: PAYMENT_MODES }) mode: PaymentMode;
  @ApiProperty({ example: 85, description: 'Negative for a refund' }) amount: number;
  @ApiProperty({ nullable: true, type: String }) reference: string | null;
  @ApiProperty({ example: false }) is_refund: boolean;
  @ApiProperty({ example: '2026-06-01T09:00:00+05:30' }) created_at: Date;
}

export class OrderDto {
  @ApiProperty({ example: 5 }) id: number;
  @ApiProperty({ example: 'ORD-20260601-0005' }) order_no: string;
  @ApiProperty({ example: 5 }) token_no: number;
  @ApiProperty({ example: 'T005' }) token_label: string;
  @ApiProperty({ example: '2026-06-01' }) order_date: string;
  @ApiProperty({ nullable: true, enum: MEAL_SLOTS, type: String }) slot: MealSlot | null;
  @ApiProperty({ nullable: true, type: Number, example: 1 }) diner_id: number | null;
  @ApiProperty({ nullable: true, type: String, example: 'Arun Kumar' }) customer_name: string | null;
  @ApiProperty({ enum: ORDER_CHANNELS }) channel: OrderChannel;
  @ApiProperty({ enum: ORDER_STATUSES }) status: OrderStatus;
  @ApiProperty({ example: 80 }) subtotal: number;
  @ApiProperty({ example: 4 }) tax_amount: number;
  @ApiProperty({ example: 0 }) discount_amount: number;
  @ApiProperty({ example: 84 }) total_amount: number;
  @ApiProperty({ example: 84 }) paid_amount: number;
  @ApiProperty({ enum: PAYMENT_STATUSES }) payment_status: PaymentStatus;
  @ApiProperty({ nullable: true, type: Number }) counter_id: number | null;
  @ApiProperty({ nullable: true, type: Number }) table_id: number | null;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty({ nullable: true, type: String }) ready_at: Date | null;
  @ApiProperty({ nullable: true, type: String }) served_at: Date | null;
  @ApiProperty({ nullable: true, type: String }) cancelled_at: Date | null;
  @ApiProperty({ nullable: true, type: String }) cancel_reason: string | null;
  @ApiProperty({ example: '2026-06-01T09:00:00+05:30' }) created_at: Date;
  @ApiProperty({ example: 2, description: 'Number of item lines' }) item_count: number;
}

export class OrderDetailDto extends OrderDto {
  @ApiProperty({ type: OrderItemDto, isArray: true }) items: OrderItemDto[];
  @ApiProperty({ type: PaymentDto, isArray: true }) payments: PaymentDto[];
  @ApiProperty({ nullable: true, type: DinerPersonDto }) person: DinerPersonDto | null;
  @ApiProperty({ nullable: true, type: String, example: 'CN000001' }) card_no: string | null;
}

export class OrderPlacedDto extends OrderDetailDto {
  @ApiProperty({
    type: String,
    isArray: true,
    example: ['Masala Dosa contains peanut, which this diner is allergic to'],
  })
  warnings: string[];
}

export class OrderQueryDto extends ListQueryDto {
  @IsDateOnly('2026-06-01', true) date?: string;
  @ApiPropertyOptional({ enum: ORDER_STATUSES }) @IsOptional() @IsIn(ORDER_STATUSES) status?: OrderStatus;
  @ApiPropertyOptional({ enum: MEAL_SLOTS }) @IsOptional() @IsIn(MEAL_SLOTS) slot?: MealSlot;
  @ApiPropertyOptional({ enum: PAYMENT_STATUSES }) @IsOptional() @IsIn(PAYMENT_STATUSES) payment_status?: PaymentStatus;
  @ApiPropertyOptional({ example: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) diner_id?: number;
  @ApiPropertyOptional({ example: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) counter_id?: number;
}

export class OrderDateQueryDto {
  @IsDateOnly('2026-06-01', true) date?: string;
}

export class OrderStatusDto {
  @ApiProperty({ enum: ORDER_STATUSES, example: 'preparing' }) @IsIn(ORDER_STATUSES) status: OrderStatus;
  @ApiPropertyOptional({ example: 'Customer left', description: 'Required to cancel' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class TokenBoardDto {
  @ApiProperty({ example: '2026-06-01' }) date: string;
  @ApiProperty({ type: String, isArray: true, example: ['T004', 'T006'] }) preparing: string[];
  @ApiProperty({ type: String, isArray: true, example: ['T003', 'T005'] }) ready: string[];
}

export class OrderInsightsDto {
  @ApiProperty({ example: '2026-06-01' }) date: string;
  @ApiProperty({ example: 48 }) total: number;
  @ApiProperty({ example: 4 }) placed: number;
  @ApiProperty({ example: 6 }) preparing: number;
  @ApiProperty({ example: 3 }) ready: number;
  @ApiProperty({ example: 33 }) served: number;
  @ApiProperty({ example: 2 }) cancelled: number;
  @ApiProperty({ example: 3850, description: 'Paid amount of orders not cancelled' }) revenue: number;
  @ApiProperty({ example: 420 }) unpaid_amount: number;
}

export class PayOrderDto {
  @ApiProperty({ enum: PAYMENT_MODES }) @IsIn(PAYMENT_MODES) mode: PaymentMode;
  @ApiPropertyOptional({ example: 84, description: 'Must equal the order total when given' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;
  @ApiPropertyOptional({ example: 'UPI-9921' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  reference?: string;
}

export class RefundOrderDto {
  @ApiProperty({ example: 'Wrong item served' }) @Transform(trim) @IsString() @MaxLength(200) reason: string;
}

export class ReceiptLineDto {
  @ApiProperty({ example: 'Masala Dosa' }) name: string;
  @ApiProperty({ example: 40 }) unit_price: number;
  @ApiProperty({ example: 2 }) quantity: number;
  @ApiProperty({ example: 80 }) line_total: number;
}

export class ReceiptDto {
  @ApiProperty({ example: 'ORD-20260601-0005' }) order_no: string;
  @ApiProperty({ example: 'T005' }) token_label: string;
  @ApiProperty({ example: '2026-06-01' }) order_date: string;
  @ApiProperty({ nullable: true, type: String, example: 'Arun Kumar' }) customer: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'CN000001' }) card_no: string | null;
  @ApiProperty({ type: ReceiptLineDto, isArray: true }) lines: ReceiptLineDto[];
  @ApiProperty({ example: 80 }) subtotal: number;
  @ApiProperty({ example: 0 }) discount_amount: number;
  @ApiProperty({ example: 4 }) tax_amount: number;
  @ApiProperty({ example: 84 }) total_amount: number;
  @ApiProperty({ example: 84 }) paid_amount: number;
  @ApiProperty({ enum: PAYMENT_STATUSES }) payment_status: PaymentStatus;
  @ApiProperty({ type: PaymentDto, isArray: true }) payments: PaymentDto[];
  @ApiProperty({ nullable: true, type: String, example: 'Thank you' }) footer: string | null;
}

export class PaymentQueryDto extends ListQueryDto {
  @IsDateOnly('2026-06-01', true) from?: string;
  @IsDateOnly('2026-06-30', true) to?: string;
  @ApiPropertyOptional({ enum: PAYMENT_MODES }) @IsOptional() @IsIn(PAYMENT_MODES) mode?: PaymentMode;
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  is_refund?: boolean;
}

export class PaymentSummaryQueryDto {
  @IsDateOnly('2026-06-01', true) from?: string;
  @IsDateOnly('2026-06-30', true) to?: string;
}

export class PaymentLedgerDto extends PaymentDto {
  @ApiProperty({ example: 'ORD-20260601-0005' }) order_no: string;
  @ApiProperty({ example: 'T005' }) token_label: string;
}

export class PaymentModeTotalDto {
  @ApiProperty({ enum: PAYMENT_MODES }) mode: PaymentMode;
  @ApiProperty({ example: 2400 }) collections: number;
  @ApiProperty({ example: 100 }) refunds: number;
  @ApiProperty({ example: 2300 }) net: number;
}

export class PaymentSummaryDto {
  @ApiProperty({ example: '2026-06-01' }) from: string;
  @ApiProperty({ example: '2026-06-30' }) to: string;
  @ApiProperty({ type: PaymentModeTotalDto, isArray: true }) by_mode: PaymentModeTotalDto[];
  @ApiProperty({ example: 4000 }) collections: number;
  @ApiProperty({ example: 150 }) refunds: number;
  @ApiProperty({ example: 3850 }) net: number;
}
