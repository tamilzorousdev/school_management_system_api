import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import type { SchoolBoard } from '../../schools/entities/school.entity';

@Entity('school_wings')
@Index('UQ_school_wings_name', ['school_id', 'name'], { unique: true, where: 'deleted_at IS NULL' })
export class SchoolWing extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'smallint' })
  from_grade: number;

  @Column({ type: 'smallint' })
  to_grade: number;

  @Column({ type: 'int', array: true, nullable: true })
  class_ids: number[] | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  board: SchoolBoard | null;

  @Column({ type: 'smallint', default: 0 })
  sort_order: number;
}

@Entity('user_wings')
@Index('IDX_user_wings_user', ['user_id'])
@Index('IDX_user_wings_wing', ['wing_id'])
export class UserWing extends SchoolScopedEntity {
  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'int' })
  wing_id: number;

  @Column({ type: 'date', nullable: true })
  valid_from: string | null;

  @Column({ type: 'date', nullable: true })
  valid_to: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  note: string | null;
}

export const OFFICE_ACTIONS = [
  'student_viewed',
  'documents_viewed',
  'wings_changed',
  'reminded',
  'bank_viewed',
] as const;
export type OfficeAction = (typeof OFFICE_ACTIONS)[number];

@Entity('office_activity_logs')
@Index('IDX_office_activity_user', ['school_id', 'user_id', 'created_at'])
export class OfficeActivityLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'varchar', length: 30 })
  action: OfficeAction;

  @Column({ type: 'int', nullable: true })
  student_id: number | null;

  @Column({ type: 'int', nullable: true })
  target_user_id: number | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
