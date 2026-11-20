import { SchoolScopedEntity } from '@app/common';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Exam } from './exam.entity';
import { ExamHall } from './exam-hall.entity';
import { Student } from '../../students/entities/student.entity';

@Entity('exam_hall_allocations')
@Index('UQ_exam_hall_student', ['exam_id', 'student_id'], { unique: true })
@Index('UQ_exam_hall_seat', ['exam_id', 'hall_id', 'seat_number'], { unique: true })
export class ExamHallAllocation extends SchoolScopedEntity {
  @Index()
  @Column({ type: 'int' })
  exam_id: number;

  @ManyToOne(() => Exam, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exam_id' })
  exam?: Exam;

  @Index()
  @Column({ type: 'int' })
  hall_id: number;

  @ManyToOne(() => ExamHall, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'hall_id' })
  hall?: ExamHall;

  @Index()
  @Column({ type: 'int' })
  student_id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student?: Student;

  @Column({ type: 'varchar', length: 30 })
  seat_number: string;

  @Column({ type: 'int', default: 1 })
  desk_order: number;
}
