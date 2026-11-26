import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';

export const HOSTEL_GENDERS = ['boys', 'girls', 'mixed'] as const;
export type HostelGender = (typeof HOSTEL_GENDERS)[number];

export const HOSTEL_STATUSES = ['active', 'inactive'] as const;
export type HostelStatus = (typeof HOSTEL_STATUSES)[number];

export const ROOM_STATUSES = ['active', 'maintenance', 'closed'] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const BED_STATUSES = ['vacant', 'occupied', 'reserved', 'blocked', 'maintenance'] as const;
export type BedStatus = (typeof BED_STATUSES)[number];

@Entity('hostel_settings')
@Index('UQ_hostel_settings_school', ['school_id'], { unique: true })
export class HostelSettings {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  enabled_modules: Record<string, boolean>;

  @Column({ type: 'varchar', length: 5, default: '05:30' })
  wake_up_time: string;

  @Column({ type: 'varchar', length: 5, default: '18:30' })
  study_start_time: string;

  @Column({ type: 'varchar', length: 5, default: '20:30' })
  study_end_time: string;

  @Column({ type: 'varchar', length: 5, default: '19:00' })
  in_time: string;

  @Column({ type: 'varchar', length: 5, default: '22:00' })
  lights_out_time: string;

  @Column({ type: 'varchar', length: 5, default: '16:00' })
  outing_from_time: string;

  @Column({ type: 'varchar', length: 5, default: '18:30' })
  outing_until_time: string;

  @Column({ type: 'boolean', default: true })
  parent_consent_for_leave: boolean;

  @Column({ type: 'boolean', default: false })
  holiday_mode: boolean;

  @Column({ type: 'text', nullable: true })
  rules: string | null;

  @Column(money())
  caution_deposit: number;

  @Column({ type: 'boolean', default: true })
  bill_on_admission: boolean;

  @Column({ type: 'int', nullable: true })
  updated_by: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

@Entity('hostels')
@Index('UQ_hostels_school_code', ['school_id', 'code'], { unique: true, where: 'deleted_at IS NULL' })
export class Hostel extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  code: string;

  @Column({ type: 'varchar', length: 10 })
  gender: HostelGender;

  @Column({ type: 'varchar', length: 10, default: 'active' })
  status: HostelStatus;

  @Column({ type: 'int', nullable: true })
  warden_user_id: number | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;
}

@Entity('hostel_blocks')
@Index('UQ_hostel_blocks_code', ['school_id', 'hostel_id', 'code'], { unique: true, where: 'deleted_at IS NULL' })
export class HostelBlock extends SchoolScopedEntity {
  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  code: string;

  @Column({ type: 'smallint', default: 0 })
  sort_order: number;

  @Column({ type: 'int', nullable: true })
  incharge_user_id: number | null;
}

@Entity('hostel_floors')
@Index('UQ_hostel_floors_level', ['school_id', 'block_id', 'level'], { unique: true, where: 'deleted_at IS NULL' })
export class HostelFloor extends SchoolScopedEntity {
  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'int' })
  block_id: number;

  @Column({ type: 'varchar', length: 40 })
  name: string;

  @Column({ type: 'smallint' })
  level: number;
}

@Entity('hostel_room_types')
@Index('UQ_hostel_room_types_code', ['school_id', 'code'], { unique: true, where: 'deleted_at IS NULL' })
export class HostelRoomType extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  code: string;

  @Column({ type: 'smallint' })
  default_beds: number;

  @Column({ type: 'boolean', default: false })
  is_ac: boolean;

  @Column({ type: 'boolean', default: false })
  attached_bathroom: boolean;

  @Column(money())
  annual_fee: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  amenities: string | null;
}

@Entity('hostel_rooms')
@Index('UQ_hostel_rooms_no', ['school_id', 'hostel_id', 'room_no'], { unique: true, where: 'deleted_at IS NULL' })
@Index('IDX_hostel_rooms_floor', ['school_id', 'floor_id'])
export class HostelRoom extends SchoolScopedEntity {
  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'int' })
  block_id: number;

  @Column({ type: 'int' })
  floor_id: number;

  @Column({ type: 'int' })
  room_type_id: number;

  @Column({ type: 'varchar', length: 20 })
  room_no: string;

  @Column({ type: 'smallint' })
  capacity: number;

  @Column({ type: 'varchar', length: 12, default: 'active' })
  status: RoomStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;
}

@Entity('hostel_beds')
@Index('UQ_hostel_beds_label', ['school_id', 'room_id', 'bed_no'], { unique: true, where: 'deleted_at IS NULL' })
@Index('IDX_hostel_beds_status', ['school_id', 'hostel_id', 'status'])
export class HostelBed extends SchoolScopedEntity {
  @Column({ type: 'int' })
  hostel_id: number;

  @Column({ type: 'int' })
  room_id: number;

  @Column({ type: 'varchar', length: 10 })
  bed_no: string;

  @Column({ type: 'varchar', length: 12, default: 'vacant' })
  status: BedStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;
}
