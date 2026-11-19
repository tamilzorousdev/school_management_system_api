import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('diary_submission_attachments')
@Index('UQ_diary_submission_attachments_submission_file', ['submission_id', 'file_id'], { unique: true })
export class DiarySubmissionAttachment {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  submission_id: number;

  @Column({ type: 'int' })
  file_id: number;

  @Column({ type: 'smallint', default: 0 })
  sort_order: number;
}
