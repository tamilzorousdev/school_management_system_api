import { SchoolScopedEntity } from '@app/common';
import { Column, Entity, Index } from 'typeorm';

export const BEHAVIOUR_CATEGORIES = ['appreciation', 'concern', 'incident', 'disciplinary'] as const;
export type BehaviourCategory = (typeof BEHAVIOUR_CATEGORIES)[number];

@Entity('student_behaviour_notes')
export class BehaviourNote extends SchoolScopedEntity {
  @Index()
  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'date' })
  noted_on: string;

  @Column({ type: 'varchar', length: 15 })
  category: BehaviourCategory;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  details: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  action_taken: string | null;

  @Column({ type: 'boolean', default: true })
  visible_to_parent: boolean;
}
