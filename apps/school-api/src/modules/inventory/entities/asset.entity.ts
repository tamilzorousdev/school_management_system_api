import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';

export const ASSET_STATUSES = ['in_store', 'allocated', 'in_maintenance', 'lost', 'disposed'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged'] as const;
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];

export const ASSIGNEE_TYPES = ['staff', 'department', 'location'] as const;
export type AssigneeType = (typeof ASSIGNEE_TYPES)[number];

export const FUNDING_SOURCES = ['school', 'government', 'donation', 'pta', 'other'] as const;
export type FundingSource = (typeof FUNDING_SOURCES)[number];

export const TRANSFER_STATUSES = ['requested', 'approved', 'rejected', 'completed', 'cancelled'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const DISPOSAL_METHODS = ['sold', 'scrapped', 'donated', 'lost', 'written_off'] as const;
export type DisposalMethod = (typeof DISPOSAL_METHODS)[number];

export const DISPOSAL_STATUSES = ['requested', 'approved', 'rejected'] as const;
export type DisposalStatus = (typeof DISPOSAL_STATUSES)[number];

export const ASSET_EVENT_KINDS = [
  'registered',
  'edited',
  'allocated',
  'acknowledged',
  'returned',
  'transfer_requested',
  'transferred',
  'maintenance_opened',
  'maintenance_closed',
  'condition_changed',
  'audited',
  'marked_lost',
  'found',
  'disposal_requested',
  'disposed',
] as const;
export type AssetEventKind = (typeof ASSET_EVENT_KINDS)[number];

@Entity('assets')
@Index('UQ_assets_school_tag', ['school_id', 'asset_tag'], { unique: true, where: 'deleted_at IS NULL' })
@Index('IDX_assets_school_status', ['school_id', 'status'])
export class Asset extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 30 })
  asset_tag: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Index()
  @Column({ type: 'int' })
  category_id: number;

  @Column({ type: 'varchar', length: 60, nullable: true })
  make: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  model: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  serial_no: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @Column({ type: 'int', nullable: true })
  vendor_id: number | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  invoice_no: string | null;

  @Column({ type: 'int', nullable: true })
  invoice_file_id: number | null;

  @Column({ type: 'date', nullable: true })
  purchase_date: string | null;

  @Column(money({ nullable: true, default: null }))
  cost: number | null;

  @Column(money({ nullable: true, default: null }))
  residual_value: number | null;

  @Column({ type: 'date', nullable: true })
  warranty_until: string | null;

  @Column({ type: 'date', nullable: true })
  amc_until: string | null;

  @Column({ type: 'int', nullable: true })
  amc_vendor_id: number | null;

  @Column({ type: 'varchar', length: 12, default: 'school' })
  funding_source: FundingSource;

  @Column({ type: 'varchar', length: 8, default: 'new' })
  condition: AssetCondition;

  @Column({ type: 'varchar', length: 14, default: 'in_store' })
  status: AssetStatus;

  @Index()
  @Column({ type: 'int', nullable: true })
  location_id: number | null;

  @Index()
  @Column({ type: 'int', nullable: true })
  department_id: number | null;

  @Index()
  @Column({ type: 'int', nullable: true })
  custodian_user_id: number | null;

  @Column({ type: 'int', nullable: true })
  store_id: number | null;

  @Column({ type: 'int', nullable: true })
  photo_file_id: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  disposed_at: Date | null;
}

@Entity('asset_allocations')
@Index('UQ_asset_allocations_active', ['asset_id'], { unique: true, where: "status = 'active' AND deleted_at IS NULL" })
@Index('IDX_asset_allocations_user', ['school_id', 'user_id', 'status'])
export class AssetAllocation extends SchoolScopedEntity {
  @Column({ type: 'int' })
  asset_id: number;

  @Column({ type: 'varchar', length: 10 })
  assignee_type: 'staff' | 'department' | 'location';

  @Column({ type: 'int', nullable: true })
  user_id: number | null;

  @Column({ type: 'int', nullable: true })
  department_id: number | null;

  @Column({ type: 'int', nullable: true })
  location_id: number | null;

  @Column({ type: 'date' })
  allocated_on: string;

  @Column({ type: 'date', nullable: true })
  expected_return_on: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  acknowledged_at: Date | null;

  @Column({ type: 'date', nullable: true })
  returned_on: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  return_condition: AssetCondition | null;

  @Column({ type: 'varchar', length: 8, default: 'active' })
  status: 'active' | 'returned';

  @Column({ type: 'int', nullable: true })
  allocated_by: number | null;

  @Column({ type: 'int', nullable: true })
  returned_by: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remarks: string | null;
}

@Entity('asset_transfers')
@Index('UQ_asset_transfers_no', ['school_id', 'transfer_no'], { unique: true })
export class AssetTransfer extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 30 })
  transfer_no: string;

  @Column({ type: 'varchar', length: 10 })
  to_type: 'staff' | 'department' | 'location';

  @Column({ type: 'int', nullable: true })
  to_user_id: number | null;

  @Column({ type: 'int', nullable: true })
  to_department_id: number | null;

  @Column({ type: 'int', nullable: true })
  to_location_id: number | null;

  @Column({ type: 'varchar', length: 255 })
  reason: string;

  @Column({ type: 'varchar', length: 10, default: 'requested' })
  status: TransferStatus;

  @Column({ type: 'int', nullable: true })
  requested_by: number | null;

  @Column({ type: 'int', nullable: true })
  decided_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  decision_note: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date | null;

  @Column({ type: 'int', nullable: true })
  completed_by: number | null;
}

@Entity('asset_transfer_items')
@Index('IDX_asset_transfer_items_transfer', ['transfer_id'])
export class AssetTransferItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  transfer_id: number;

  @Column({ type: 'int' })
  asset_id: number;

  @Column({ type: 'varchar', length: 120, nullable: true })
  from_label: string | null;
}

@Entity('asset_events')
@Index('IDX_asset_events_asset', ['asset_id', 'created_at'])
export class AssetEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  asset_id: number;

  @Column({ type: 'varchar', length: 20 })
  kind: AssetEventKind;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  ref_type: string | null;

  @Column({ type: 'int', nullable: true })
  ref_id: number | null;

  @Column({ type: 'int', nullable: true })
  actor_id: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

@Entity('asset_disposals')
@Index('UQ_asset_disposals_no', ['school_id', 'disposal_no'], { unique: true })
export class AssetDisposal extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 30 })
  disposal_no: string;

  @Column({ type: 'int' })
  asset_id: number;

  @Column({ type: 'varchar', length: 12 })
  method: DisposalMethod;

  @Column({ type: 'varchar', length: 255 })
  reason: string;

  @Column(money({ nullable: true, default: null }))
  value_realised: number | null;

  @Column(money({ nullable: true, default: null }))
  book_value: number | null;

  @Column({ type: 'varchar', length: 10, default: 'requested' })
  status: DisposalStatus;

  @Column({ type: 'int', nullable: true })
  requested_by: number | null;

  @Column({ type: 'int', nullable: true })
  decided_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  decision_note: string | null;
}
