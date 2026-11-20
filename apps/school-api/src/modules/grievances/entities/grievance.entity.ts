import { Column, Entity, Index, OneToMany } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { GrievanceTimeline } from './grievance-timeline.entity';
import { GrievanceAttachment } from './grievance-attachment.entity';

export const COMPLAINANT_TYPES = ['parent', 'staff', 'student', 'anonymous'] as const;
export type ComplainantType = (typeof COMPLAINANT_TYPES)[number];

export const GRIEVANCE_CATEGORIES = [
  'transport',
  'academics',
  'safety_bullying',
  'fees_billing',
  'facilities',
  'staff_conduct',
  'workplace_staff',
  'other',
] as const;
export type GrievanceCategory = (typeof GRIEVANCE_CATEGORIES)[number];

export const GRIEVANCE_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type GrievancePriority = (typeof GRIEVANCE_PRIORITIES)[number];

export const GRIEVANCE_STATUSES = [
  'submitted',
  'acknowledged',
  'in_progress',
  'action_taken',
  'resolved',
  'reopened',
  'closed',
  'escalated',
] as const;
export type GrievanceStatus = (typeof GRIEVANCE_STATUSES)[number];

@Entity('grievances')
@Index('UQ_grievances_school_ticket', ['school_id', 'ticket_no'], { unique: true, where: 'deleted_at IS NULL' })
@Index('IDX_grievances_school_status', ['school_id', 'status'])
@Index('IDX_grievances_school_category', ['school_id', 'category'])
@Index('IDX_grievances_school_assigned', ['school_id', 'assigned_to_user_id'])
@Index('IDX_grievances_school_sla', ['school_id', 'sla_due_at'])
export class Grievance extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 30 })
  ticket_no: string;

  @Column({ type: 'varchar', length: 20 })
  complainant_type: ComplainantType;

  @Column({ type: 'int', nullable: true })
  complainant_user_id: number | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  complainant_name: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  complainant_mobile: string | null;

  @Column({ type: 'int', nullable: true })
  student_id: number | null;

  @Column({ type: 'varchar', length: 30 })
  category: GrievanceCategory;

  @Column({ type: 'varchar', length: 100, nullable: true })
  subcategory: string | null;

  @Column({ type: 'varchar', length: 20 })
  priority: GrievancePriority;

  @Column({ type: 'boolean', default: false })
  is_anonymous: boolean;

  @Column({ type: 'varchar', length: 200 })
  subject: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 20, default: 'submitted' })
  status: GrievanceStatus;

  @Column({ type: 'int', nullable: true })
  assigned_to_user_id: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  assigned_at: Date | null;

  @Column({ type: 'timestamptz' })
  sla_due_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  escalated_at: Date | null;

  @Column({ type: 'text', nullable: true })
  escalation_reason: string | null;

  @Column({ type: 'text', nullable: true })
  resolution_summary: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolved_at: Date | null;

  @Column({ type: 'smallint', nullable: true })
  satisfaction_rating: number | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  linked_entity_type: string | null;

  @Column({ type: 'int', nullable: true })
  linked_entity_id: number | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  linked_entity_label: string | null;

  @OneToMany(() => GrievanceTimeline, (item) => item.grievance)
  timeline?: GrievanceTimeline[];

  @OneToMany(() => GrievanceAttachment, (item) => item.grievance)
  attachments?: GrievanceAttachment[];
}
