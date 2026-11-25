import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const BOARDING_ACTIONS = ['boarded', 'alighted', 'missed'] as const;
export type BoardingAction = (typeof BOARDING_ACTIONS)[number];

export const BOARDING_METHODS = ['qr', 'manual'] as const;
export type BoardingMethod = (typeof BOARDING_METHODS)[number];

@Entity('transport_boardings')
@Index('UQ_transport_boardings_trip_student_action', ['trip_id', 'student_id', 'action'], { unique: true })
@Index('IDX_transport_boardings_school_occurred', ['school_id', 'occurred_at'])
export class TripBoarding {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  trip_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'int', nullable: true })
  stop_id: number | null;

  @Column({ type: 'varchar', length: 10 })
  action: BoardingAction;

  @Column({ type: 'varchar', length: 10, default: 'manual' })
  method: BoardingMethod;

  @Column({ type: 'int', nullable: true })
  recorded_by: number | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  handed_to: string | null;

  @Column({ type: 'boolean', default: false })
  pass_on_hold: boolean;

  @Column({ type: 'timestamptz' })
  occurred_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
