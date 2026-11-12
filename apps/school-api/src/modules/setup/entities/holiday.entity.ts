import { SchoolScopedEntity } from '@app/common';
import { Column, Entity, Index } from 'typeorm';

export const HOLIDAY_TYPES = ['holiday', 'emergency_closure', 'event'] as const;
export type HolidayType = (typeof HOLIDAY_TYPES)[number];

@Entity('holidays')
@Index('IDX_holidays_school_date', ['school_id', 'date'])
export class Holiday extends SchoolScopedEntity {
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'date', nullable: true })
  end_date: string | null;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 20, default: 'holiday' })
  type: HolidayType;

  @Column({ type: 'int', array: true, nullable: true })
  class_ids: number[] | null;
}
