import { SchoolScopedEntity } from '@app/common';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const EVENT_AUDIENCES = ['school', 'classes'] as const;
export type EventAudience = (typeof EVENT_AUDIENCES)[number];

export const EVENT_STATUSES = ['draft', 'published', 'cancelled'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const RSVP_RESPONSES = ['attending', 'not_attending', 'maybe'] as const;
export type RsvpResponse = (typeof RSVP_RESPONSES)[number];

@Entity('school_events')
@Index('IDX_school_events_school_year_date', ['school_id', 'academic_year_id', 'event_date'])
export class SchoolEvent extends SchoolScopedEntity {
  @Column({ type: 'int' })
  academic_year_id: number;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'varchar', length: 4000, nullable: true })
  description: string | null;

  @Column({ type: 'date' })
  event_date: string;

  @Column({ type: 'varchar', length: 5, nullable: true })
  start_time: string | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  end_time: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  venue: string | null;

  @Column({ type: 'varchar', length: 10, default: 'school' })
  audience: EventAudience;

  @Column({ type: 'boolean', default: true })
  rsvp_required: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  rsvp_deadline: Date | null;

  @Column({ type: 'varchar', length: 10, default: 'draft' })
  status: EventStatus;

  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelled_at: Date | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  cancel_reason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  day_before_sent_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deadline_reminder_sent_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  day_of_sent_at: Date | null;
}

@Entity('event_targets')
export class EventTarget {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  event_id: number;

  @Column({ type: 'int', nullable: true })
  class_id: number | null;

  @Column({ type: 'int', nullable: true })
  section_id: number | null;
}

@Entity('event_rsvps')
@Index('UQ_event_rsvps_student', ['event_id', 'student_id'], { unique: true })
export class EventRsvp {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  event_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'varchar', length: 15 })
  response: RsvpResponse;

  @Column({ type: 'int' })
  responded_by: number;

  @Column({ type: 'timestamptz' })
  responded_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
