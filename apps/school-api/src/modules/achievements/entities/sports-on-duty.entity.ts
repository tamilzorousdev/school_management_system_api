import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

@Entity('sports_on_duty')
@Index('IDX_sports_on_duty_school_dates', ['school_id', 'from_date', 'to_date'])
@Index('IDX_sports_on_duty_student_dates', ['student_id', 'from_date', 'to_date'])
export class SportsOnDuty extends SchoolScopedEntity {
  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'varchar', length: 80 })
  sport_name: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'date' })
  from_date: string;

  @Column({ type: 'date' })
  to_date: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  session: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  venue: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;
}
