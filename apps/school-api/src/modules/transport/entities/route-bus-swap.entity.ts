import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

@Entity('route_bus_swaps')
@Index('UQ_route_bus_swaps_route_date', ['route_id', 'swap_date'], { unique: true, where: 'deleted_at IS NULL' })
export class RouteBusSwap extends SchoolScopedEntity {
  @Column({ type: 'int' })
  route_id: number;

  @Column({ type: 'date' })
  swap_date: string;

  @Column({ type: 'int' })
  vehicle_id: number;

  @Column({ type: 'int', nullable: true })
  original_vehicle_id: number | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  reason: string | null;
}
