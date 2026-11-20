import { SchoolScopedEntity } from '@app/common';
import { Column, Entity, Index } from 'typeorm';

@Entity('exam_halls')
@Index('UQ_exam_halls_school_name', ['school_id', 'name'], { unique: true, where: 'deleted_at IS NULL' })
export class ExamHall extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  building: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  floor: string | null;

  @Column({ type: 'int', default: 30 })
  capacity: number;

  @Column({ type: 'int', default: 5 })
  rows_count: number;

  @Column({ type: 'int', default: 6 })
  columns_count: number;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;
}

