import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const ROUTE_CHANGE_KINDS = [
  'stop_time',
  'stop_moved',
  'stop_added',
  'stop_removed',
  'bus_changed',
  'student_moved',
  'pass_changed',
] as const;
export type RouteChangeKind = (typeof ROUTE_CHANGE_KINDS)[number];

@Entity('route_changes')
@Index('IDX_route_changes_route', ['route_id'])
@Index('IDX_route_changes_school', ['school_id'])
export class RouteChange {
  @PrimaryGeneratedColumn({ primaryKeyConstraintName: 'PK_route_changes' })
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  route_id: number;

  @Column({ type: 'int', nullable: true })
  stop_id: number | null;

  @Column({ type: 'int', nullable: true })
  student_id: number | null;

  @Column({ type: 'varchar', length: 16 })
  kind: RouteChangeKind;

  @Column({ type: 'varchar', length: 255 })
  summary: string;

  @Column({ type: 'int', default: 0 })
  parents_told: number;

  @Column({ type: 'int', nullable: true })
  changed_by: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
