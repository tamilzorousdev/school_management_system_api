import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('bell_periods')
export class BellPeriod {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  school_id: number;

  @Index()
  @Column({ type: 'int', nullable: true })
  class_id: number | null;

  @Column({ type: 'smallint', nullable: true })
  period_no: number | null;

  @Column({ type: 'varchar', length: 30 })
  name: string;

  @Column({ type: 'varchar', length: 5 })
  start_time: string;

  @Column({ type: 'varchar', length: 5 })
  end_time: string;

  @Column({ type: 'boolean', default: false })
  is_break: boolean;

  @Column({ type: 'smallint', default: 0 })
  sort_order: number;
}
