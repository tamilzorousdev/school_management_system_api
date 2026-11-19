import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { decimal } from '../../fleet-ops/entities/decimal';

export const VEHICLE_STATUSES = ['active', 'inactive'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const VEHICLE_TYPES = ['bus', 'mini_bus', 'van', 'car'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const FUEL_TYPES = ['diesel', 'petrol', 'cng', 'electric'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const OWNERSHIPS = ['school', 'contractor'] as const;
export type Ownership = (typeof OWNERSHIPS)[number];

@Entity('vehicles')
@Index('UQ_vehicles_school_registration', ['school_id', 'registration_no'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('UQ_vehicles_device', ['device_id'], { unique: true, where: 'deleted_at IS NULL AND device_id IS NOT NULL' })
export class Vehicle extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 20 })
  registration_no: string;

  @Column({ type: 'varchar', length: 40 })
  name: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  make_model: string | null;

  @Column({ type: 'smallint', default: 40 })
  capacity: number;

  @Column({ type: 'varchar', length: 12, default: 'bus' })
  vehicle_type: VehicleType;

  @Column({ type: 'varchar', length: 10, nullable: true })
  fuel_type: FuelType | null;

  @Column({ type: 'smallint', nullable: true })
  manufacture_year: number | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  chassis_no: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  engine_no: string | null;

  @Column({ type: 'varchar', length: 12, default: 'school' })
  ownership: Ownership;

  @Column({ type: 'varchar', length: 80, nullable: true })
  contractor_name: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  contractor_mobile: string | null;

  @Column({ type: 'int', nullable: true })
  device_id: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  device_imei: string | null;

  @Column({ type: 'int', nullable: true })
  driver_user_id: number | null;

  @Column({ type: 'int', nullable: true })
  attendant_user_id: number | null;

  @Column({ type: 'date', nullable: true })
  insurance_expiry: string | null;

  @Column({ type: 'date', nullable: true })
  fitness_expiry: string | null;

  @Column({ type: 'date', nullable: true })
  puc_expiry: string | null;

  @Column({ type: 'date', nullable: true })
  permit_expiry: string | null;

  @Column({ type: 'date', nullable: true })
  rc_expiry: string | null;

  @Column({ type: 'date', nullable: true })
  road_tax_expiry: string | null;

  @Column({ type: 'date', nullable: true })
  speed_governor_expiry: string | null;

  @Column({ type: 'date', nullable: true })
  fire_extinguisher_expiry: string | null;

  @Column({ type: 'date', nullable: true })
  first_aid_expiry: string | null;

  @Column({ type: 'varchar', length: 10, default: 'active' })
  status: VehicleStatus;

  @Column({ type: 'smallint', nullable: true })
  tank_litres: number | null;

  @Column(decimal(12, 2))
  monthly_budget: number | null;

  @Column({ type: 'varchar', length: 7, nullable: true })
  budget_alerted_month: string | null;

  @Column(decimal(10, 1))
  tracker_odometer_km: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  tracker_odometer_at: Date | null;
}
