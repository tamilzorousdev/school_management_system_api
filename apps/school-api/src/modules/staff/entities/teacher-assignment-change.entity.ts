import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('teacher_assignment_changes')
@Index('IDX_teacher_assignment_changes_year_week', ['school_id', 'academic_year_id', 'week_start'])
export class TeacherAssignmentChange {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  academic_year_id: number;

  @Column({ type: 'int' })
  section_id: number;

  @Column({ type: 'int' })
  subject_id: number;

  @Column({ type: 'int', nullable: true })
  from_teacher_user_id: number | null;

  @Column({ type: 'int', nullable: true })
  to_teacher_user_id: number | null;

  @Column({ type: 'smallint', nullable: true })
  from_periods: number | null;

  @Column({ type: 'smallint', nullable: true })
  to_periods: number | null;

  @Column({ type: 'date' })
  week_start: string;

  @Column({ type: 'int', nullable: true })
  changed_by: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
