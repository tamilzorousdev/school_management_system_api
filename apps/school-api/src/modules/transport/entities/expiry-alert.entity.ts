import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const VEHICLE_EXPIRY_KINDS = [
  'insurance',
  'fitness',
  'permit',
  'puc',
  'rc',
  'road_tax',
  'speed_governor',
  'fire_extinguisher',
  'first_aid',
] as const;
export type VehicleExpiryKind = (typeof VEHICLE_EXPIRY_KINDS)[number];

export const EXPIRY_KINDS = [...VEHICLE_EXPIRY_KINDS, 'licence', 'badge', 'medical', 'police'] as const;
export type ExpiryKind = (typeof EXPIRY_KINDS)[number];

export const CREW_EXPIRY_KINDS = ['licence', 'badge', 'medical', 'police'] as const;
export type CrewExpiryKind = (typeof CREW_EXPIRY_KINDS)[number];

export type AlertKind = ExpiryKind | `${ExpiryKind}_self` | 'blocked';

@Entity('fleet_expiry_alerts')
@Index('UQ_fleet_expiry_alerts', ['kind', 'ref_id', 'expiry_date', 'threshold_days'], { unique: true })
export class ExpiryAlert {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'varchar', length: 24 })
  kind: AlertKind;

  @Column({ type: 'int' })
  ref_id: number;

  @Column({ type: 'date' })
  expiry_date: string;

  @Column({ type: 'smallint' })
  threshold_days: number;

  @CreateDateColumn({ type: 'timestamptz' })
  sent_at: Date;
}
