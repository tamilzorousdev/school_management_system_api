import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';

export const ASSET_CONDITIONS = ['good', 'fair', 'damaged', 'missing'] as const;
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];

export const LOCKER_STATUSES = ['available', 'allotted', 'damaged', 'blocked'] as const;
export type LockerStatus = (typeof LOCKER_STATUSES)[number];

export const LOCKER_SIZES = ['small', 'medium', 'large'] as const;
export type LockerSize = (typeof LOCKER_SIZES)[number];

export const INSPECTION_RESULTS = ['ok', 'issues'] as const;
export type InspectionResult = (typeof INSPECTION_RESULTS)[number];

export const CHECK_RESULTS = ['ok', 'issue', 'na'] as const;
export type CheckResult = (typeof CHECK_RESULTS)[number];

export const BELONGING_STATUSES = ['with_student', 'returned_home', 'lost', 'confiscated'] as const;
export type BelongingStatus = (typeof BELONGING_STATUSES)[number];

@Entity('hostel_room_assets')
@Index('IDX_hostel_room_assets_room', ['school_id', 'room_id'])
export class HostelRoomAsset extends SchoolScopedEntity {
  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'int' })
  room_id: number;

  @Column({ type: 'varchar', length: 80 })
  item_name: string;

  @Column({ type: 'smallint', default: 1 })
  quantity: number;

  @Column({ type: 'varchar', length: 8, default: 'good' })
  condition: AssetCondition;

  @Column({ type: 'int', nullable: true })
  inventory_asset_id: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_checked_at: Date | null;
}

@Entity('hostel_lockers')
@Index('UQ_hostel_lockers_no', ['school_id', 'hostel_id', 'locker_no'], { unique: true, where: 'deleted_at IS NULL' })
export class HostelLocker extends SchoolScopedEntity {
  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'int', nullable: true })
  block_id: number | null;

  @Column({ type: 'int', nullable: true })
  room_id: number | null;

  @Column({ type: 'varchar', length: 20 })
  locker_no: string;

  @Column({ type: 'varchar', length: 8, nullable: true })
  size: LockerSize | null;

  @Column({ type: 'varchar', length: 10, default: 'available' })
  status: LockerStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;
}

@Entity('hostel_locker_allocations')
@Index('UQ_hostel_locker_allocations_live_locker', ['locker_id'], { unique: true, where: 'to_date IS NULL' })
@Index('UQ_hostel_locker_allocations_live_admission', ['admission_id'], { unique: true, where: 'to_date IS NULL' })
export class HostelLockerAllocation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  locker_id: number;

  @Column({ type: 'int' })
  admission_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'date' })
  from_date: string;

  @Column({ type: 'date', nullable: true })
  to_date: string | null;

  @Column({ type: 'smallint', default: 1 })
  keys_given: number;

  @Column({ type: 'smallint', nullable: true })
  keys_returned: number | null;

  @Column({ type: 'varchar', length: 8, default: 'school' })
  lock_type: 'school' | 'own';

  @Column(money({ nullable: true, default: null }))
  deposit: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  return_note: string | null;

  @Column({ type: 'int', nullable: true })
  created_by: number | null;

  @Column({ type: 'int', nullable: true })
  returned_by: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

@Entity('hostel_inspections')
@Index('IDX_hostel_inspections_room', ['school_id', 'room_id', 'inspected_at'])
export class HostelInspection extends SchoolScopedEntity {
  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'int' })
  room_id: number;

  @Column({ type: 'timestamptz' })
  inspected_at: Date;

  @Column({ type: 'int', nullable: true })
  inspector_user_id: number | null;

  @Column({ type: 'smallint' })
  score: number;

  @Column({ type: 'smallint', nullable: true })
  cleanliness: number | null;

  @Column({ type: 'varchar', length: 8 })
  result: InspectionResult;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  @Column({ type: 'int', nullable: true })
  maintenance_ticket_id: number | null;

  @Column({ type: 'int', nullable: true })
  discipline_case_id: number | null;
}

@Entity('hostel_inspection_items')
@Index('IDX_hostel_inspection_items_inspection', ['inspection_id'])
export class HostelInspectionItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  inspection_id: number;

  @Column({ type: 'varchar', length: 80 })
  item: string;

  @Column({ type: 'varchar', length: 6 })
  result: CheckResult;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;
}

@Entity('hostel_belongings')
@Index('IDX_hostel_belongings_admission', ['school_id', 'admission_id'])
export class HostelBelonging extends SchoolScopedEntity {
  @Column({ type: 'int' })
  admission_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'varchar', length: 80 })
  item: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  serial_no: string | null;

  @Column({ type: 'smallint', default: 1 })
  quantity: number;

  @Column({ type: 'date' })
  declared_on: string;

  @Column({ type: 'varchar', length: 14, default: 'with_student' })
  status: BelongingStatus;

  @Column({ type: 'int', nullable: true })
  photo_file_id: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;
}
