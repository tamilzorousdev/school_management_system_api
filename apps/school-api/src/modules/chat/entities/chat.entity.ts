import { BaseEntity, SchoolScopedEntity } from '@app/common';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const CHAT_PARTIES = ['teacher', 'parent'] as const;
export type ChatParty = (typeof CHAT_PARTIES)[number];

export const CHAT_MESSAGE_KINDS = ['text', 'image', 'file', 'voice', 'video'] as const;
export type ChatMessageKind = (typeof CHAT_MESSAGE_KINDS)[number];

@Entity('chat_threads')
@Index('UQ_chat_threads_pair', ['academic_year_id', 'teacher_user_id', 'parent_user_id', 'student_id'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
export class ChatThread extends SchoolScopedEntity {
  @Index()
  @Column({ type: 'int' })
  academic_year_id: number;

  @Index()
  @Column({ type: 'int' })
  teacher_user_id: number;

  @Index()
  @Column({ type: 'int' })
  parent_user_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @Column({ type: 'timestamptz', nullable: true })
  last_message_at: Date | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  last_message_preview: string | null;

  @Column({ type: 'int', nullable: true })
  last_sender_id: number | null;

  @Column({ type: 'int', default: 0 })
  teacher_unread: number;

  @Column({ type: 'int', default: 0 })
  parent_unread: number;

  @Column({ type: 'int', default: 0 })
  message_count: number;

  @Column({ type: 'int', default: 0 })
  open_flags: number;

  @Column({ type: 'timestamptz', nullable: true })
  teacher_cleared_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  parent_cleared_at: Date | null;
}

@Entity('chat_messages')
@Index('IDX_chat_messages_thread_id', ['thread_id', 'id'])
export class ChatMessage extends BaseEntity {
  @Index()
  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  thread_id: number;

  @Column({ type: 'int' })
  sender_user_id: number;

  @Column({ type: 'varchar', length: 10 })
  sender_party: ChatParty;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  body: string | null;

  @Column({ type: 'int', nullable: true })
  file_id: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  read_at: Date | null;

  @Index()
  @Column({ type: 'boolean', default: false })
  push_pending: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  push_after: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  flagged_at: Date | null;

  @Column({ type: 'int', nullable: true })
  flagged_by: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  flag_reason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  flag_resolved_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  hidden_at: Date | null;

  @Column({ type: 'int', nullable: true })
  hidden_by: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  hidden_reason: string | null;

  @Column({ type: 'varchar', length: 10, default: 'text' })
  kind: ChatMessageKind;

  @Column({ type: 'int', nullable: true })
  duration_seconds: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  deleted_for_all_at: Date | null;

  @Column({ type: 'int', nullable: true })
  deleted_for_all_by: number | null;
}

@Entity('chat_message_hides')
@Index('UQ_chat_message_hides', ['message_id', 'user_id'], { unique: true })
export class ChatMessageHide {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  message_id: number;

  @Index()
  @Column({ type: 'int' })
  user_id: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

export const CHAT_AUDIT_ACTIONS = [
  'viewed_thread',
  'hid_message',
  'unhid_message',
  'dismissed_flag',
  'deleted_for_everyone',
  'undid_delete',
  'deleted_for_me',
  'cleared_chat',
] as const;
export type ChatAuditAction = (typeof CHAT_AUDIT_ACTIONS)[number];

@Entity('chat_audit_logs')
export class ChatAuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  school_id: number;

  @Index()
  @Column({ type: 'int' })
  thread_id: number;

  @Column({ type: 'int', nullable: true })
  message_id: number | null;

  @Column({ type: 'int' })
  actor_user_id: number;

  @Column({ type: 'varchar', length: 20 })
  action: ChatAuditAction;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
