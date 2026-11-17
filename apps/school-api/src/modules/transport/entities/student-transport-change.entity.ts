import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { TransportMode } from './student-transport.entity';

export const TRANSPORT_CHANGE_ACTIONS = ['assigned', 'moved', 'removed'] as const;
export type TransportChangeAction = (typeof TRANSPORT_CHANGE_ACTIONS)[number];

@Entity('student_transport_changes')
@Index('IDX_student_transport_changes_student', ['school_id', 'student_id', 'created_at'])
export class StudentTransportChange extends SchoolScopedEntity {
  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'varchar', length: 10 })
  action: TransportChangeAction;

  @Column({ type: 'int', nullable: true })
  from_route_id: number | null;

  @Column({ type: 'int', nullable: true })
  from_stop_id: number | null;

  @Column({ type: 'int', nullable: true })
  from_drop_stop_id: number | null;

  @Column({ type: 'int', nullable: true })
  to_route_id: number | null;

  @Column({ type: 'int', nullable: true })
  to_stop_id: number | null;

  @Column({ type: 'int', nullable: true })
  to_drop_stop_id: number | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  mode: TransportMode | null;
}
