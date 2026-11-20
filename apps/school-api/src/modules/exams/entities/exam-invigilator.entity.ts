import { SchoolScopedEntity } from '@app/common';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Exam } from './exam.entity';
import { ExamHall } from './exam-hall.entity';
import { User } from '../../users/entities/user.entity';

@Entity('exam_invigilators')
@Index('IDX_exam_invig_exam_date', ['exam_id', 'exam_date'])
export class ExamInvigilator extends SchoolScopedEntity {
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
  teacher_user_id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'teacher_user_id' })
  teacher?: User;

  @Column({ type: 'date' })
  exam_date: string;

  @Column({ type: 'varchar', length: 20, default: 'Morning' })
  session: string;
}
