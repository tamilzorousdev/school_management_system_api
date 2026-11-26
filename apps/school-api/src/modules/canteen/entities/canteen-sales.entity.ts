import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { decimal } from './decimal';
import { MealSlot } from './canteen-menu.entity';

export const DINER_TYPES = ['student', 'staff'] as const;
export type DinerType = (typeof DINER_TYPES)[number];

export const CARD_STATUSES = ['active', 'blocked', 'lost', 'expired'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const DINER_STATUSES = ['active', 'suspended', 'left'] as const;
export type DinerStatus = (typeof DINER_STATUSES)[number];

export const DIETS = ['veg', 'non_veg', 'egg'] as const;
export type Diet = (typeof DIETS)[number];

export const WALLET_KINDS = ['topup', 'purchase', 'refund', 'adjustment', 'reversal'] as const;
export type WalletKind = (typeof WALLET_KINDS)[number];

export const PAYMENT_MODES = ['wallet', 'cash', 'upi', 'card'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const TOPUP_MODES = ['cash', 'upi', 'card', 'online', 'fee_account'] as const;
export type TopupMode = (typeof TOPUP_MODES)[number];

export const ORDER_CHANNELS = ['counter', 'preorder', 'table'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const ORDER_STATUSES = ['placed', 'preparing', 'ready', 'served', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ['unpaid', 'paid', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

@Entity('canteen_diners')
@Index('UQ_canteen_diners_card', ['school_id', 'card_no'], { unique: true })
@Index('UQ_canteen_diners_student', ['school_id', 'student_id'], { unique: true, where: '"student_id" IS NOT NULL' })
@Index('UQ_canteen_diners_staff', ['school_id', 'staff_id'], { unique: true, where: '"staff_id" IS NOT NULL' })
export class CanteenDiner extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 8 })
  person_type: DinerType;

  @Column({ type: 'int', nullable: true })
  student_id: number | null;

  @Column({ type: 'int', nullable: true })
  staff_id: number | null;

  @Column({ type: 'varchar', length: 20 })
  card_no: string;

  @Column({ type: 'varchar', length: 10, default: 'active' })
  card_status: CardStatus;

  @Column({ type: 'int', default: 1 })
  card_version: number;

  @Column({ type: 'timestamptz', nullable: true })
  card_issued_at: Date | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: decimal })
  wallet_balance: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true, transformer: decimal })
  daily_limit: number | null;

  @Column({ type: 'varchar', length: 8, default: 'veg' })
  diet: Diet;

  @Column({ type: 'varchar', length: 300, nullable: true })
  allergies: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  meal_slots: string | null;

  @Column({ type: 'varchar', length: 10, default: 'active' })
  status: DinerStatus;

  @Column({ type: 'varchar', length: 300, nullable: true })
  notes: string | null;
}

@Entity('canteen_wallet_transactions')
@Index('IDX_canteen_wallet_transactions_diner', ['diner_id', 'created_at'])
export class WalletTransaction extends SchoolScopedEntity {
  @Column({ type: 'int' })
  diner_id: number;

  @Column({ type: 'varchar', length: 12 })
  kind: WalletKind;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: decimal })
  amount: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: decimal })
  balance_after: number;

  @Column({ type: 'varchar', length: 12, nullable: true })
  mode: TopupMode | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  reference: string | null;

  @Column({ type: 'int', nullable: true })
  order_id: number | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  note: string | null;
}

@Entity('canteen_orders')
@Index('UQ_canteen_orders_no', ['school_id', 'order_no'], { unique: true })
@Index('IDX_canteen_orders_day', ['school_id', 'order_date', 'status'])
export class CanteenOrder extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 24 })
  order_no: string;

  @Column({ type: 'int' })
  token_no: number;

  @Column({ type: 'varchar', length: 12 })
  token_label: string;

  @Column({ type: 'date' })
  order_date: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  slot: MealSlot | null;

  @Column({ type: 'int', nullable: true })
  diner_id: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  customer_name: string | null;

  @Column({ type: 'varchar', length: 10, default: 'counter' })
  channel: OrderChannel;

  @Column({ type: 'varchar', length: 10, default: 'placed' })
  status: OrderStatus;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: decimal })
  subtotal: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: decimal })
  tax_amount: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: decimal })
  discount_amount: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: decimal })
  total_amount: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: decimal })
  paid_amount: number;

  @Column({ type: 'varchar', length: 10, default: 'unpaid' })
  payment_status: PaymentStatus;

  @Column({ type: 'int', nullable: true })
  counter_id: number | null;

  @Column({ type: 'int', nullable: true })
  table_id: number | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  ready_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  served_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelled_at: Date | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  cancel_reason: string | null;
}

@Entity('canteen_order_items')
@Index('IDX_canteen_order_items_order', ['order_id'])
export class CanteenOrderItem extends SchoolScopedEntity {
  @Column({ type: 'int' })
  order_id: number;

  @Column({ type: 'int', nullable: true })
  food_item_id: number | null;

  @Column({ type: 'int', nullable: true })
  meal_id: number | null;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: decimal })
  unit_price: number;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: decimal })
  line_total: number;
}

@Entity('canteen_payments')
@Index('IDX_canteen_payments_order', ['order_id'])
export class CanteenPayment extends SchoolScopedEntity {
  @Column({ type: 'int' })
  order_id: number;

  @Column({ type: 'varchar', length: 24 })
  receipt_no: string;

  @Column({ type: 'varchar', length: 8 })
  mode: PaymentMode;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: decimal })
  amount: number;

  @Column({ type: 'varchar', length: 60, nullable: true })
  reference: string | null;

  @Column({ type: 'boolean', default: false })
  is_refund: boolean;
}
