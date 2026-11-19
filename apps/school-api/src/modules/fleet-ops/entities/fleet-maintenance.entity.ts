import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { decimal } from './decimal';

export const SERVICE_CATEGORIES = [
  'engine_oil',
  'tyres',
  'brakes',
  'battery',
  'ac',
  'body',
  'electrical',
  'general_service',
  'other',
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const EXPENSE_CATEGORIES = [
  'tyres',
  'insurance',
  'fitness',
  'permit',
  'puc',
  'road_tax',
  'rc',
  'speed_governor',
  'fire_extinguisher',
  'first_aid',
  'fine',
  'toll',
  'parking',
  'cleaning',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const PAYMENT_MODES = ['cash', 'upi', 'card', 'fuel_card', 'credit', 'driver_paid'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const VENDOR_KINDS = ['garage', 'fuel_station', 'other'] as const;
export type VendorKind = (typeof VENDOR_KINDS)[number];

export const PRE_TRIP_ITEMS = [
  'tyres',
  'brakes',
  'lights',
  'horn',
  'wipers',
  'mirrors',
  'doors',
  'first_aid',
  'fire_extinguisher',
  'cleanliness',
] as const;
export type PreTripItem = (typeof PRE_TRIP_ITEMS)[number];
export const CRITICAL_PRE_TRIP_ITEMS: PreTripItem[] = ['tyres', 'brakes', 'doors'];

export const CHANGE_ENTITIES = ['fuel', 'expense', 'ticket', 'settings'] as const;
export type ChangeEntity = (typeof CHANGE_ENTITIES)[number];

export const CHANGE_ACTIONS = ['update', 'delete', 'approve', 'reject', 'reimburse', 'lock'] as const;
export type ChangeAction = (typeof CHANGE_ACTIONS)[number];

export interface PreTripMark {
  item: PreTripItem;
  ok: boolean;
  note: string | null;
}

@Entity('fleet_settings')
@Index('UQ_fleet_settings_school', ['school_id'], { unique: true })
export class FleetSettings {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int', default: 500 })
  due_soon_km: number;

  @Column({ type: 'int', default: 15 })
  due_soon_days: number;

  @Column({ type: 'int', default: 20 })
  low_mileage_drop_pct: number;

  @Column({ type: 'int', default: 15 })
  price_warning_pct: number;

  @Column({ ...decimal(4, 2, false), default: 2.5 })
  idle_litres_per_hour: number;

  @Column({ type: 'boolean', default: false })
  pre_trip_check_required: boolean;

  @Column({ type: 'date', nullable: true })
  locked_until: string | null;

  @Column({ type: 'int', nullable: true })
  updated_by: number | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  updated_at: Date;
}

@Entity('maintenance_schedules')
@Index('IDX_maintenance_schedules_school_vehicle', ['school_id', 'vehicle_id'])
export class MaintenanceSchedule extends SchoolScopedEntity {
  @Column({ type: 'int' })
  vehicle_id: number;

  @Column({ type: 'varchar', length: 20 })
  category: ServiceCategory;

  @Column({ type: 'varchar', length: 100 })
  title: string;

  @Column({ type: 'int', nullable: true })
  every_km: number | null;

  @Column({ type: 'smallint', nullable: true })
  every_months: number | null;

  @Column({ type: 'date' })
  last_done_on: string;

  @Column(decimal(10, 1))
  last_done_km: number | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'varchar', length: 10, nullable: true })
  alerted_status: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  alerted_at: Date | null;
}

@Entity('vehicle_expenses')
@Index('IDX_vehicle_expenses_school_vehicle_date', ['school_id', 'vehicle_id', 'spent_on'])
export class VehicleExpense extends SchoolScopedEntity {
  @Column({ type: 'int' })
  vehicle_id: number;

  @Column({ type: 'date' })
  spent_on: string;

  @Column({ type: 'varchar', length: 20 })
  category: ExpenseCategory;

  @Column(decimal(12, 2, false))
  amount: number;

  @Column({ type: 'int', nullable: true })
  vendor_id: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  paid_to: string | null;

  @Column({ type: 'varchar', length: 12, default: 'cash' })
  payment_mode: PaymentMode;

  @Column({ type: 'timestamptz', nullable: true })
  reimbursed_at: Date | null;

  @Column({ type: 'int', nullable: true })
  reimbursed_by: number | null;

  @Column({ type: 'int', nullable: true })
  bill_file_id: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ type: 'date', nullable: true })
  renewed_until: string | null;
}

@Entity('fleet_vendors')
@Index('UQ_fleet_vendors_school_kind_name', ['school_id', 'kind', 'name'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
export class FleetVendor extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 12 })
  kind: VendorKind;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 15, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 15, nullable: true })
  gst_no: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  address: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;
}

@Entity('pre_trip_checks')
@Index('UQ_pre_trip_checks_vehicle_date', ['vehicle_id', 'check_date'], { unique: true, where: 'deleted_at IS NULL' })
export class PreTripCheck extends SchoolScopedEntity {
  @Column({ type: 'int' })
  vehicle_id: number;

  @Column({ type: 'date' })
  check_date: string;

  @Column({ type: 'int' })
  checked_by: number;

  @Column({ type: 'jsonb' })
  items: PreTripMark[];

  @Column(decimal(10, 1))
  odometer_km: number | null;

  @Column({ type: 'smallint', default: 0 })
  failed_count: number;

  @Column({ type: 'boolean', default: false })
  critical_failed: boolean;

  @Column({ type: 'int', nullable: true })
  ticket_id: number | null;

  @Column({ type: 'int', nullable: true })
  photo_file_id: number | null;

  @Column({ type: 'int', nullable: true })
  cleared_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  cleared_at: Date | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  clear_note: string | null;
}

@Entity('fleet_entry_changes')
@Index('IDX_fleet_entry_changes_entity', ['school_id', 'entity', 'entity_id'])
export class FleetEntryChange extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 10 })
  entity: ChangeEntity;

  @Column({ type: 'int' })
  entity_id: number;

  @Column({ type: 'int', nullable: true })
  vehicle_id: number | null;

  @Column({ type: 'varchar', length: 10 })
  action: ChangeAction;

  @Column({ type: 'jsonb', nullable: true })
  before: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;
}
