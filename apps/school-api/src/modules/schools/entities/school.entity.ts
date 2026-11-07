import { TrackedEntity } from '@app/common';
import { Column, Entity, Index } from 'typeorm';

export const SCHOOL_BOARDS = ['CBSE', 'STATE', 'ICSE', 'OTHER'] as const;
export type SchoolBoard = (typeof SCHOOL_BOARDS)[number];

export const DIARY_REVIEW_MODES = ['all', 'remarks', 'none'] as const;
export type DiaryReviewMode = (typeof DIARY_REVIEW_MODES)[number];

@Entity('schools')
@Index('UQ_schools_code', ['code'], { unique: true, where: 'deleted_at IS NULL' })
export class School extends TrackedEntity {
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  code: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  board: SchoolBoard | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  state: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  pincode: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  emergency_phone: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email: string | null;

  @Column({ type: 'int', nullable: true })
  logo_file_id: number | null;

  @Column({ type: 'int', nullable: true })
  signature_file_id: number | null;

  @Column({ type: 'int', nullable: true })
  seal_file_id: number | null;

  @Column({ type: 'varchar', length: 50, default: 'Asia/Kolkata' })
  timezone: string;

  @Column({ type: 'double precision', nullable: true })
  latitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude: number | null;

  @Column({ type: 'int', default: 200 })
  geofence_radius_m: number;

  @Column({ type: 'varchar', length: 5, default: '08:45' })
  staff_reporting_time: string;

  @Column({ type: 'varchar', length: 10, default: 'remarks' })
  diary_review_mode: DiaryReviewMode;

  @Column({ type: 'varchar', length: 5, default: '08:00' })
  chat_office_start: string;

  @Column({ type: 'varchar', length: 5, default: '17:00' })
  chat_office_end: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;
}
