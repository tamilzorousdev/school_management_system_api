import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '@app/common';
import { Grievance } from './grievance.entity';

@Entity('grievance_attachments')
@Index('IDX_grievance_attachments_grievance', ['grievance_id'])
@Index('IDX_grievance_attachments_school', ['school_id'])
export class GrievanceAttachment extends BaseEntity {
  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  grievance_id: number;

  @ManyToOne(() => Grievance, (g) => g.attachments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'grievance_id' })
  grievance?: Grievance;

  @Column({ type: 'varchar', length: 255 })
  file_name: string;

  @Column({ type: 'text' })
  file_url: string;

  @Column({ type: 'int', nullable: true })
  file_size: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  mime_type: string | null;

  @Column({ type: 'boolean', default: false })
  is_internal: boolean;
}
