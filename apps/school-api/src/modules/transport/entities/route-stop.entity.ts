import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '@app/common';
import { TransportRoute } from './transport-route.entity';

const coordinate = { to: (value: number) => value, from: (value: string) => Number(value) };
const optionalNumber = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

@Entity('route_stops')
@Index('IDX_route_stops_route_sequence', ['route_id', 'sequence'])
export class RouteStop extends BaseEntity {
  @Index()
  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  route_id: number;

  @ManyToOne(() => TransportRoute, (route) => route.stops, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'route_id' })
  route?: TransportRoute;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  landmark: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, transformer: coordinate })
  lat: number;

  @Column({ type: 'numeric', precision: 9, scale: 6, transformer: coordinate })
  lng: number;

  @Column({ type: 'smallint' })
  sequence: number;

  @Column({ type: 'varchar', length: 5, nullable: true })
  pickup_time: string | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  drop_time: string | null;

  @Column({ type: 'smallint', default: 100 })
  geofence_radius_m: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true, transformer: optionalNumber })
  monthly_fee: number | null;
}
