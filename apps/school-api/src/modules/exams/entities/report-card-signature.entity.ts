import { SchoolScopedEntity } from '@app/common';
import { Column, Entity, Index } from 'typeorm';

@Entity('report_card_signatures')
@Index('IDX_rc_sig_school_student', ['school_id', 'student_id'])
export class ReportCardSignature extends SchoolScopedEntity {
  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'int' })
  academic_year_id: number;

  @Column({ type: 'int', nullable: true })
  term_id: number | null;

  @Column({ type: 'int', nullable: true })
  exam_id: number | null;

  @Column({ type: 'int', nullable: true })
  teacher_user_id: number | null;

  @Column({ type: 'int', nullable: true })
  teacher_signature_file_id: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  teacher_signed_at: Date | null;

  @Column({ type: 'int', nullable: true })
  parent_user_id: number | null;

  @Column({ type: 'int', nullable: true })
  parent_signature_file_id: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  parent_signed_at: Date | null;
}
