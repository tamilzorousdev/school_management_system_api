import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

export const BEHAVIOURS = ['good', 'bad'] as const;
export type Behaviour = (typeof BEHAVIOURS)[number];

export const RATING_CYCLES = [1, 2, 3, 6, 12] as const;
export type RatingCycle = (typeof RATING_CYCLES)[number];

@Entity('teacher_ratings')
@Index('UQ_teacher_ratings_cycle', ['parent_user_id', 'teacher_user_id', 'student_id', 'cycle_start'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('IDX_teacher_ratings_teacher', ['school_id', 'teacher_user_id'])
export class TeacherRating extends SchoolScopedEntity {
  @Column({ type: 'int' })
  academic_year_id: number;

  @Column({ type: 'int' })
  teacher_user_id: number;

  @Column({ type: 'int' })
  parent_user_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'int', nullable: true })
  section_id: number | null;

  @Column({ type: 'smallint' })
  stars: number;

  @Column({ type: 'varchar', length: 4 })
  behaviour: Behaviour;

  @Column({ type: 'varchar', length: 500, nullable: true })
  remark: string | null;

  @Column({ type: 'date' })
  cycle_start: string;

  @Column({ type: 'date' })
  cycle_end: string;
}

@Entity('student_feedback')
@Index('UQ_student_feedback_term', ['teacher_user_id', 'student_id', 'academic_year_id', 'term_id'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('IDX_student_feedback_student', ['school_id', 'student_id'])
export class StudentFeedback extends SchoolScopedEntity {
  @Column({ type: 'int' })
  academic_year_id: number;

  @Column({ type: 'int', default: 0 })
  term_id: number;

  @Column({ type: 'int' })
  teacher_user_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'int', nullable: true })
  section_id: number | null;

  @Column({ type: 'smallint' })
  studies: number;

  @Column({ type: 'smallint' })
  behaviour: number;

  @Column({ type: 'smallint', nullable: true })
  sports: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  remark: string | null;
}
