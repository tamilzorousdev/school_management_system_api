import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

@Entity('special_classes')
@Index('IDX_special_classes_section_slot', ['section_id', 'day_of_week', 'period_no'])
export class SpecialClass extends SchoolScopedEntity {
  @Index()
  @Column({ type: 'int' })
  academic_year_id: number;

  @Index()
  @Column({ type: 'int' })
  section_id: number;

  @Column({ type: 'int', nullable: true })
  subject_id: number | null;

  @Index()
  @Column({ type: 'int' })
  teacher_user_id: number;

  @Column({ type: 'smallint' })
  day_of_week: number;

  @Column({ type: 'smallint' })
  period_no: number;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  @OneToMany(() => SpecialClassStudent, (student) => student.special_class)
  students?: SpecialClassStudent[];
}

@Entity('special_class_students')
@Index('UQ_special_class_students', ['special_class_id', 'student_id'], { unique: true })
export class SpecialClassStudent {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  special_class_id: number;

  @ManyToOne(() => SpecialClass, (special) => special.students, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'special_class_id' })
  special_class?: SpecialClass;

  @Index()
  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'int' })
  school_id: number;
}
