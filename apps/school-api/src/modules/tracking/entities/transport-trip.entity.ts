import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const TRIP_KINDS = ['pickup', 'drop'] as const;
export type TripKind = (typeof TRIP_KINDS)[number];

export const TRIP_STATUSES = ['active', 'ended'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const STOP_STATUSES = ['pending', 'approaching', 'arrived', 'departed', 'skipped'] as const;
export type StopStatus = (typeof STOP_STATUSES)[number];

export interface TripStop {
  stop_id: number;
  name: string;
  sequence: number;
  lat: number;
  lng: number;
  radius_m: number;
  planned_time: string | null;
  status: StopStatus;
  eta_seconds: number | null;
  approached_at: string | null;
  arrived_at: string | null;
  departed_at: string | null;
}

export interface TripPosition {
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  recorded_at: string;
  source: string | null;
}

@Entity('transport_trips')
@Index('UQ_transport_trips_active_vehicle', ['vehicle_id'], { unique: true, where: "status = 'active'" })
@Index('IDX_transport_trips_school_date', ['school_id', 'trip_date'])
export class TransportTrip {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Index()
  @Column({ type: 'int' })
  route_id: number;

  @Column({ type: 'int' })
  vehicle_id: number;

  @Column({ type: 'int' })
  device_id: number;

  @Column({ type: 'varchar', length: 10 })
  kind: TripKind;

  @Column({ type: 'date' })
  trip_date: string;

  @Column({ type: 'int', nullable: true })
  delay_minutes: number | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  delay_reason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  delayed_at: Date | null;

  @Column({ type: 'int', nullable: true })
  handover_of: number | null;

  @Column({ type: 'int', nullable: true })
  replaced_by: number | null;

  @Column({ type: 'varchar', length: 10, default: 'active' })
  status: TripStatus;

  @Index()
  @Column({ type: 'int', nullable: true })
  telematics_trip_id: number | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  stops: TripStop[];

  @Column({ type: 'jsonb', nullable: true })
  last_position: TripPosition | null;

  @Column({ type: 'int', nullable: true })
  destination_eta_seconds: number | null;

  @Column({ type: 'int', nullable: true })
  started_by: number | null;

  @Column({ type: 'timestamptz' })
  started_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  ended_at: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  end_reason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  not_boarded_sent_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  flags_sent_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
