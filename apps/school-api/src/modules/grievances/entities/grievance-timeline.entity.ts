import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '@app/common';
import { Grievance, GrievanceStatus } from './grievance.entity';

@Entity('grievance_timeline')
@Index('IDX_grievance_timeline_grievance', ['grievance_id', 'created_at'])
@Index('IDX_grievance_timeline_school', ['school_id'])
export class GrievanceTimeline extends BaseEntity {
  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  grievance_id: number;

  @ManyToOne(() => Grievance, (g) => g.timeline, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'grievance_id' })
  grievance?: Grievance;

  @Column({ type: 'int', nullable: true })
  actor_user_id: number | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  actor_name: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  actor_role: string | null;

  @Column({ type: 'varchar', length: 50 })
  action: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  from_status: GrievanceStatus | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  to_status: GrievanceStatus | null;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'boolean', default: false })
  is_internal: boolean;
}
