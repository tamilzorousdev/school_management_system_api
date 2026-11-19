import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

export const CATEGORY_KINDS = ['asset', 'stock'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const LOCATION_KINDS = [
  'classroom',
  'lab',
  'office',
  'staff_room',
  'store',
  'library',
  'hall',
  'ground',
  'other',
] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const DEPRECIATION_METHODS = ['straight_line', 'written_down'] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];

const decimal = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

@Entity('inventory_settings')
@Index('UQ_inventory_settings_school', ['school_id'], { unique: true })
export class InventorySettings {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'boolean', default: true })
  approve_transfers: boolean;

  @Column({ type: 'boolean', default: true })
  approve_requisitions: boolean;

  @Column({ type: 'boolean', default: true })
  approve_disposals: boolean;

  @Column({ type: 'varchar', length: 14, default: 'straight_line' })
  depreciation_method: DepreciationMethod;

  @Column({ type: 'smallint', default: 30 })
  warranty_alert_days: number;

  @Column({ type: 'smallint', default: 7 })
  maintenance_alert_days: number;

  @Column({ type: 'int', nullable: true })
  updated_by: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

@Entity('inventory_categories')
@Index('UQ_inventory_categories_code', ['school_id', 'code'], { unique: true, where: 'deleted_at IS NULL' })
export class InventoryCategory extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  code: string;

  @Column({ type: 'varchar', length: 6 })
  kind: CategoryKind;

  @Column({ type: 'int', nullable: true })
  parent_id: number | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: decimal })
  depreciation_rate: number | null;

  @Column({ type: 'smallint', nullable: true })
  useful_life_years: number | null;

  @Column({ type: 'smallint', nullable: true })
  maintenance_interval_days: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;
}

@Entity('inventory_locations')
@Index('UQ_inventory_locations_code', ['school_id', 'code'], { unique: true, where: 'deleted_at IS NULL' })
export class InventoryLocation extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 30 })
  code: string;

  @Column({ type: 'varchar', length: 10, default: 'classroom' })
  kind: LocationKind;

  @Column({ type: 'varchar', length: 40, nullable: true })
  building: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  floor: string | null;

  @Column({ type: 'int', nullable: true })
  section_id: number | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;
}

@Entity('departments')
@Index('UQ_departments_school_name', ['school_id', 'name'], { unique: true, where: 'deleted_at IS NULL' })
export class Department extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  code: string;

  @Column({ type: 'int', nullable: true })
  head_user_id: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;
}

@Entity('inventory_vendors')
export class InventoryVendor extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  contact_person: string | null;

  @Column({ type: 'varchar', length: 15, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 15, nullable: true })
  gstin: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  supplies: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;
}

@Entity('inventory_stores')
@Index('UQ_inventory_stores_code', ['school_id', 'code'], { unique: true, where: 'deleted_at IS NULL' })
export class InventoryStore extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  code: string;

  @Column({ type: 'int', nullable: true })
  location_id: number | null;

  @Column({ type: 'int', nullable: true })
  keeper_user_id: number | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;
}
