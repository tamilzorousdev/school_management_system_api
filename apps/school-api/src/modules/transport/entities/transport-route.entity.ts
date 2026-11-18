import { Column, Entity, Index, OneToMany } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { RouteStop } from './route-stop.entity';

const fee = { to: (value: number) => value, from: (value: string) => Number(value) };

@Entity('transport_routes')
@Index('UQ_transport_routes_school_code', ['school_id', 'code'], { unique: true, where: 'deleted_at IS NULL' })
export class TransportRoute extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 20 })
  code: string;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'int', nullable: true })
  vehicle_id: number | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0, transformer: fee })
  monthly_fee: number;

  @OneToMany(() => RouteStop, (stop) => stop.route)
  stops?: RouteStop[];
}
