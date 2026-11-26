import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { decimal } from './decimal';
import { MealSlot } from './canteen-menu.entity';

export const STOCK_UNITS = ['kg', 'g', 'l', 'ml', 'pcs', 'pack'] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];

export const STOCK_MOVEMENT_KINDS = ['purchase', 'issue', 'wastage', 'adjustment', 'return'] as const;
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number];

export const PURCHASE_STATUSES = ['draft', 'ordered', 'partial', 'received', 'cancelled'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const BATCH_STATUSES = ['planned', 'cooking', 'done', 'cancelled'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const TABLE_STATUSES = ['free', 'occupied', 'reserved', 'cleaning'] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

export const BOOKING_STATUSES = ['reserved', 'seated', 'completed', 'cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const WASTE_REASONS = ['leftover', 'expired', 'spoiled', 'preparation_error', 'returned'] as const;
export type WasteReason = (typeof WASTE_REASONS)[number];

@Entity('canteen_suppliers')
@Index('UQ_canteen_suppliers_name', ['school_id', 'name'], { unique: true, where: '"deleted_at" IS NULL' })
export class Supplier extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  contact_person: string | null;

  @Column({ type: 'varchar', length: 15, nullable: true })
  mobile: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  gstin: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  supplies: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;
}

@Entity('canteen_stock_items')
@Index('UQ_canteen_stock_items_name', ['school_id', 'name'], { unique: true, where: '"deleted_at" IS NULL' })
export class CanteenStockItem extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  code: string | null;

  @Column({ type: 'varchar', length: 6, default: 'kg' })
  unit: StockUnit;

  @Column({ type: 'numeric', precision: 12, scale: 3, default: 0, transformer: decimal })
  quantity_on_hand: number;

  @Column({ type: 'numeric', precision: 12, scale: 3, default: 0, transformer: decimal })
  reorder_level: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: decimal })
  cost_per_unit: number;

  @Column({ type: 'date', nullable: true })
  expiry_date: string | null;

  @Column({ type: 'int', nullable: true })
  supplier_id: number | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;
}

@Entity('canteen_stock_movements')
@Index('IDX_canteen_stock_movements_item', ['stock_item_id', 'created_at'])
export class CanteenStockMovement extends SchoolScopedEntity {
  @Column({ type: 'int' })
  stock_item_id: number;

  @Column({ type: 'varchar', length: 12 })
  kind: StockMovementKind;

  @Column({ type: 'numeric', precision: 12, scale: 3, transformer: decimal })
  quantity: number;

  @Column({ type: 'numeric', precision: 12, scale: 3, transformer: decimal })
  balance_after: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: decimal })
  unit_cost: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  reference_type: string | null;

  @Column({ type: 'int', nullable: true })
  reference_id: number | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  note: string | null;
}

@Entity('canteen_purchase_orders')
@Index('UQ_canteen_purchase_orders_no', ['school_id', 'po_no'], { unique: true })
export class PurchaseOrder extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 24 })
  po_no: string;

  @Column({ type: 'int' })
  supplier_id: number;

  @Column({ type: 'date' })
  order_date: string;

  @Column({ type: 'date', nullable: true })
  expected_date: string | null;

  @Column({ type: 'varchar', length: 10, default: 'draft' })
  status: PurchaseStatus;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: decimal })
  total_amount: number;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  received_at: Date | null;
}

@Entity('canteen_purchase_lines')
@Index('IDX_canteen_purchase_lines_po', ['purchase_order_id'])
export class PurchaseLine extends SchoolScopedEntity {
  @Column({ type: 'int' })
  purchase_order_id: number;

  @Column({ type: 'int' })
  stock_item_id: number;

  @Column({ type: 'numeric', precision: 12, scale: 3, transformer: decimal })
  quantity: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: decimal })
  unit_cost: number;

  @Column({ type: 'numeric', precision: 12, scale: 3, default: 0, transformer: decimal })
  received_quantity: number;
}

@Entity('canteen_kitchen_batches')
@Index('IDX_canteen_kitchen_batches_day', ['school_id', 'batch_date', 'slot'])
export class KitchenBatch extends SchoolScopedEntity {
  @Column({ type: 'date' })
  batch_date: string;

  @Column({ type: 'varchar', length: 10 })
  slot: MealSlot;

  @Column({ type: 'int' })
  food_item_id: number;

  @Column({ type: 'int' })
  planned_quantity: number;

  @Column({ type: 'int', default: 0 })
  prepared_quantity: number;

  @Column({ type: 'varchar', length: 10, default: 'planned' })
  status: BatchStatus;

  @Column({ type: 'int', nullable: true })
  cook_id: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  started_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;
}

@Entity('canteen_tables')
@Index('UQ_canteen_tables_name', ['school_id', 'name'], { unique: true, where: '"deleted_at" IS NULL' })
export class CanteenTable extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 40 })
  name: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  area: string | null;

  @Column({ type: 'smallint', default: 4 })
  seats: number;

  @Column({ type: 'varchar', length: 10, default: 'free' })
  status: TableStatus;

  @Column({ type: 'boolean', default: true })
  active: boolean;
}

@Entity('canteen_table_bookings')
@Index('IDX_canteen_table_bookings_day', ['school_id', 'booking_date', 'slot'])
export class TableBooking extends SchoolScopedEntity {
  @Column({ type: 'int' })
  table_id: number;

  @Column({ type: 'date' })
  booking_date: string;

  @Column({ type: 'varchar', length: 10 })
  slot: MealSlot;

  @Column({ type: 'smallint' })
  party_size: number;

  @Column({ type: 'int', nullable: true })
  diner_id: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  guest_name: string | null;

  @Column({ type: 'varchar', length: 10, default: 'reserved' })
  status: BookingStatus;

  @Column({ type: 'timestamptz', nullable: true })
  seated_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  released_at: Date | null;

  @Column({ type: 'int', nullable: true })
  order_id: number | null;
}

@Entity('canteen_waste_logs')
@Index('IDX_canteen_waste_logs_day', ['school_id', 'waste_date'])
export class WasteLog extends SchoolScopedEntity {
  @Column({ type: 'date' })
  waste_date: string;

  @Column({ type: 'int', nullable: true })
  food_item_id: number | null;

  @Column({ type: 'int', nullable: true })
  stock_item_id: number | null;

  @Column({ type: 'varchar', length: 120 })
  item_name: string;

  @Column({ type: 'numeric', precision: 12, scale: 3, transformer: decimal })
  quantity: number;

  @Column({ type: 'varchar', length: 6, default: 'pcs' })
  unit: StockUnit;

  @Column({ type: 'varchar', length: 20 })
  reason: WasteReason;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: decimal })
  cost: number;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;
}
