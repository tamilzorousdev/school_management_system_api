import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';

export const TICKET_KINDS = ['breakdown', 'preventive', 'inspection'] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

export const TICKET_PRIORITIES = ['low', 'medium', 'high'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'cancelled'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const STOCK_UNITS = [
  'pcs',
  'box',
  'pack',
  'ream',
  'kg',
  'g',
  'litre',
  'ml',
  'set',
  'pair',
  'roll',
  'bottle',
] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];

export const MOVEMENT_KINDS = ['receipt', 'issue', 'return', 'adjustment'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const REQUISITION_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'issued',
  'partly_issued',
  'cancelled',
] as const;
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

export const AUDIT_KINDS = ['asset', 'stock'] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

export const AUDIT_STATUSES = ['open', 'closed'] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export const AUDIT_FINDINGS = ['found', 'misplaced', 'not_available', 'unknown'] as const;
export type AuditFinding = (typeof AUDIT_FINDINGS)[number];

const quantity = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? 0 : Number(value)),
};
const optionalQuantity = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};
const qty = (options: { nullable?: boolean } = {}) =>
  options.nullable
    ? {
        type: 'numeric' as const,
        precision: 12,
        scale: 2,
        nullable: true,
        default: null,
        transformer: optionalQuantity,
      }
    : { type: 'numeric' as const, precision: 12, scale: 2, default: 0, transformer: quantity };

@Entity('asset_maintenance_tickets')
@Index('UQ_asset_maintenance_tickets_no', ['school_id', 'ticket_no'], { unique: true })
@Index('IDX_asset_maintenance_tickets_asset', ['asset_id'])
export class AssetMaintenanceTicket extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 30 })
  ticket_no: string;

  @Column({ type: 'int' })
  asset_id: number;

  @Column({ type: 'varchar', length: 10, default: 'breakdown' })
  kind: TicketKind;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 6, default: 'medium' })
  priority: TicketPriority;

  @Column({ type: 'varchar', length: 11, default: 'open' })
  status: TicketStatus;

  @Column({ type: 'int', nullable: true })
  reported_by: number | null;

  @Column({ type: 'int', nullable: true })
  assigned_to_user_id: number | null;

  @Column({ type: 'int', nullable: true })
  vendor_id: number | null;

  @Column({ type: 'boolean', default: false })
  under_warranty: boolean;

  @Column(money({ nullable: true, default: null }))
  cost: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  parts: string | null;

  @Column({ type: 'timestamptz' })
  opened_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolved_at: Date | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  resolution: string | null;

  @Column({ type: 'int', nullable: true })
  schedule_id: number | null;
}

@Entity('asset_maintenance_schedules')
@Index('IDX_asset_maintenance_schedules_due', ['school_id', 'next_due_on'])
export class AssetMaintenanceSchedule extends SchoolScopedEntity {
  @Column({ type: 'int' })
  asset_id: number;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'smallint' })
  interval_days: number;

  @Column({ type: 'date' })
  next_due_on: string;

  @Column({ type: 'date', nullable: true })
  last_done_on: string | null;

  @Column({ type: 'int', nullable: true })
  vendor_id: number | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;
}

@Entity('stock_items')
@Index('UQ_stock_items_code', ['school_id', 'code'], { unique: true, where: 'deleted_at IS NULL' })
export class StockItem extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 30 })
  code: string;

  @Index()
  @Column({ type: 'int' })
  category_id: number;

  @Column({ type: 'varchar', length: 8, default: 'pcs' })
  unit: StockUnit;

  @Column(qty())
  reorder_level: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;
}

@Entity('stock_balances')
@Index('UQ_stock_balances_item_store', ['item_id', 'store_id'], { unique: true })
export class StockBalance {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  item_id: number;

  @Column({ type: 'int' })
  store_id: number;

  @Column(qty())
  quantity: number;

  @Column(money())
  value: number;
}

@Entity('stock_movements')
@Index('IDX_stock_movements_item', ['item_id', 'store_id', 'id'])
@Index('IDX_stock_movements_school_date', ['school_id', 'moved_on'])
export class StockMovement extends SchoolScopedEntity {
  @Column({ type: 'int' })
  item_id: number;

  @Column({ type: 'int' })
  store_id: number;

  @Column({ type: 'varchar', length: 10 })
  kind: MovementKind;

  @Column(qty())
  quantity: number;

  @Column(money())
  rate: number;

  @Column(money())
  value: number;

  @Column(qty())
  balance_after: number;

  @Column({ type: 'varchar', length: 12, nullable: true })
  ref_type: 'receipt' | 'requisition' | 'stock_count' | null;

  @Column({ type: 'int', nullable: true })
  ref_id: number | null;

  @Column({ type: 'int', nullable: true })
  department_id: number | null;

  @Column({ type: 'int', nullable: true })
  user_id: number | null;

  @Column({ type: 'int', nullable: true })
  section_id: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @Column({ type: 'date' })
  moved_on: string;
}

@Entity('stock_receipts')
@Index('UQ_stock_receipts_no', ['school_id', 'receipt_no'], { unique: true })
export class StockReceipt extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 30 })
  receipt_no: string;

  @Column({ type: 'int' })
  store_id: number;

  @Column({ type: 'int', nullable: true })
  vendor_id: number | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  invoice_no: string | null;

  @Column({ type: 'date', nullable: true })
  invoice_date: string | null;

  @Column({ type: 'date' })
  received_on: string;

  @Column(money())
  total: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;
}

@Entity('stock_receipt_lines')
@Index('IDX_stock_receipt_lines_receipt', ['receipt_id'])
export class StockReceiptLine {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  receipt_id: number;

  @Column({ type: 'int' })
  item_id: number;

  @Column(qty())
  quantity: number;

  @Column(money())
  rate: number;

  @Column(money())
  amount: number;
}

@Entity('requisitions')
@Index('UQ_requisitions_no', ['school_id', 'requisition_no'], { unique: true })
export class Requisition extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 30 })
  requisition_no: string;

  @Column({ type: 'int' })
  store_id: number;

  @Column({ type: 'int', nullable: true })
  department_id: number | null;

  @Column({ type: 'int', nullable: true })
  requested_for_user_id: number | null;

  @Column({ type: 'int', nullable: true })
  section_id: number | null;

  @Column({ type: 'varchar', length: 255 })
  purpose: string;

  @Column({ type: 'date', nullable: true })
  needed_by: string | null;

  @Column({ type: 'varchar', length: 13, default: 'pending' })
  status: RequisitionStatus;

  @Column({ type: 'int', nullable: true })
  decided_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  decision_note: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  issued_at: Date | null;

  @Column({ type: 'int', nullable: true })
  issued_by: number | null;
}

@Entity('requisition_lines')
@Index('IDX_requisition_lines_requisition', ['requisition_id'])
export class RequisitionLine {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  requisition_id: number;

  @Column({ type: 'int' })
  item_id: number;

  @Column(qty())
  quantity: number;

  @Column(qty({ nullable: true }))
  approved_quantity: number | null;

  @Column(qty())
  issued_quantity: number;
}

@Entity('inventory_audits')
export class InventoryAudit extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 6 })
  kind: AuditKind;

  @Column({ type: 'varchar', length: 6, default: 'open' })
  status: AuditStatus;

  @Column({ type: 'int', nullable: true })
  location_id: number | null;

  @Column({ type: 'int', nullable: true })
  category_id: number | null;

  @Column({ type: 'int', nullable: true })
  department_id: number | null;

  @Column({ type: 'int', nullable: true })
  store_id: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  closed_at: Date | null;

  @Column({ type: 'int', nullable: true })
  closed_by: number | null;

  @Column({ type: 'int', default: 0 })
  expected_count: number;

  @Column({ type: 'int', default: 0 })
  found_count: number;

  @Column({ type: 'int', default: 0 })
  missing_count: number;
}

@Entity('asset_audit_items')
@Index('UQ_asset_audit_items_code', ['audit_id', 'code'], { unique: true })
export class AssetAuditItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  audit_id: number;

  @Column({ type: 'int', nullable: true })
  asset_id: number | null;

  @Column({ type: 'varchar', length: 60 })
  code: string;

  @Column({ type: 'varchar', length: 14 })
  finding: AuditFinding;

  @Column({ type: 'int', nullable: true })
  found_location_id: number | null;

  @Column({ type: 'int', nullable: true })
  scanned_by: number | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  scanned_at: Date;
}

@Entity('stock_count_lines')
@Index('UQ_stock_count_lines_item', ['audit_id', 'item_id'], { unique: true })
export class StockCountLine {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  audit_id: number;

  @Column({ type: 'int' })
  item_id: number;

  @Column(qty())
  system_quantity: number;

  @Column(qty({ nullable: true }))
  counted_quantity: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;
}
