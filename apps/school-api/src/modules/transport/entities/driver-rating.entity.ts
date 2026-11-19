import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

export const RATING_TAGS = [
  'safe_driving',
  'on_time',
  'polite',
  'clean_bus',
  'careful_with_children',
  'rash_driving',
  'late',
  'rude',
  'uses_phone',
] as const;
export type RatingTag = (typeof RATING_TAGS)[number];

@Entity('driver_ratings')
@Index('UQ_driver_ratings_parent_driver_month', ['parent_user_id', 'driver_user_id', 'month'], { unique: true })
@Index('IDX_driver_ratings_driver', ['school_id', 'driver_user_id', 'created_at'])
export class DriverRating extends SchoolScopedEntity {
  @Column({ type: 'int' })
  driver_user_id: number;

  @Column({ type: 'int', nullable: true })
  vehicle_id: number | null;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'int' })
  parent_user_id: number;

  @Column({ type: 'varchar', length: 7 })
  month: string;

  @Column({ type: 'smallint' })
  rating: number;

  @Column({ type: 'varchar', array: true, default: () => "'{}'" })
  tags: RatingTag[];

  @Column({ type: 'varchar', length: 500, nullable: true })
  comment: string | null;
}
