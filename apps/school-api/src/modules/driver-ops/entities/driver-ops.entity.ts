import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

export const DUTY_PLACES = ['school', 'stop', 'other', 'unknown'] as const;
export type DutyPlace = (typeof DUTY_PLACES)[number];

export const INCIDENT_TYPES = ['breakdown', 'accident', 'injury', 'medical', 'misbehaviour', 'fight', 'other'] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const INCIDENT_STATUSES = ['open', 'resolved'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const OPT_OUT_TRIPS = ['pickup', 'drop'] as const;
export type OptOutTrip = (typeof OPT_OUT_TRIPS)[number];

@Entity('driver_duties')
@Index('UQ_driver_duties_user_date', ['user_id', 'duty_date'], { unique: true, where: 'deleted_at IS NULL' })
export class DriverDuty extends SchoolScopedEntity {
  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'int', nullable: true })
  vehicle_id: number | null;

  @Index()
  @Column({ type: 'date' })
  duty_date: string;

  @Column({ type: 'timestamptz' })
  check_in_at: Date;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  check_in_lat: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  check_in_lng: string | null;

  @Column({ type: 'varchar', length: 10, default: 'unknown' })
  check_in_place: DutyPlace;

  @Column({ type: 'int', nullable: true })
  check_in_photo_id: number | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  reporting_time: string | null;

  @Column({ type: 'int', default: 0 })
  late_minutes: number;

  @Column({ type: 'int', nullable: true })
  attendant_user_id: number | null;

  @Column({ type: 'boolean', nullable: true })
  attendant_present: boolean | null;

  @Column({ type: 'timestamptz', nullable: true })
  check_out_at: Date | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  check_out_lat: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  check_out_lng: string | null;

  @Column({ type: 'int', nullable: true })
  check_out_photo_id: number | null;
}

@Entity('transport_incidents')
@Index('IDX_transport_incidents_school_status', ['school_id', 'status'])
export class TransportIncident extends SchoolScopedEntity {
  @Column({ type: 'int', nullable: true })
  vehicle_id: number | null;

  @Column({ type: 'int', nullable: true })
  trip_id: number | null;

  @Column({ type: 'int' })
  reported_by: number;

  @Column({ type: 'varchar', length: 20 })
  type: IncidentType;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  student_ids: number[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  photo_file_ids: number[];

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  lat: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  lng: string | null;

  @Column({ type: 'timestamptz' })
  occurred_at: Date;

  @Column({ type: 'varchar', length: 10, default: 'open' })
  status: IncidentStatus;

  @Column({ type: 'int', nullable: true })
  resolved_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolved_at: Date | null;

  @Column({ type: 'text', nullable: true })
  resolution_note: string | null;
}

@Entity('bus_opt_outs')
@Index('UQ_bus_opt_outs_student_date_trip', ['student_id', 'opt_date', 'trip'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
export class BusOptOut extends SchoolScopedEntity {
  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'date' })
  opt_date: string;

  @Column({ type: 'varchar', length: 10 })
  trip: OptOutTrip;

  @Column({ type: 'varchar', length: 200, nullable: true })
  reason: string | null;
}

@Entity('bus_pickup_persons')
@Index('UQ_bus_pickup_persons_student_date', ['student_id', 'pickup_date'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
export class BusPickupPerson extends SchoolScopedEntity {
  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'date' })
  pickup_date: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 40 })
  relation: string;

  @Column({ type: 'varchar', length: 15 })
  mobile: string;

  @Column({ type: 'int', nullable: true })
  photo_file_id: number | null;
}
