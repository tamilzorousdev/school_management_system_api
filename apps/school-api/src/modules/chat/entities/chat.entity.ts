import { BaseEntity, SchoolScopedEntity } from '@app/common';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const CHAT_PARTIES = ['teacher', 'parent'] as const;
export type ChatParty = (typeof CHAT_PARTIES)[number];

export const CHAT_MESSAGE_KINDS = ['text', 'image', 'file', 'voice', 'video'] as const;
export type ChatMessageKind = (typeof CHAT_MESSAGE_KINDS)[number];

@Entity('chat_threads')
@Index('UQ_chat_threads_pair', ['academic_year_id', 'teacher_user_id', 'parent_user_id', 'student_id'], {
  unique: true,
  where: 'deleted_at IS NULL AND is_group = false',
})
export class ChatThread extends SchoolScopedEntity {
  @Index()
  @Column({ type: 'int' })
  academic_year_id: number;

  @Index()
  @Column({ type: 'int', nullable: true })
  teacher_user_id: number | null;

  @Index()
  @Column({ type: 'int', nullable: true })
  parent_user_id: number | null;

  @Column({ type: 'int', nullable: true })
  student_id: number | null;

  @Column({ type: 'boolean', default: false })
  is_group: boolean;

  @Column({ type: 'varchar', length: 120, nullable: true })
  title: string | null;

  @Column({ type: 'int', nullable: true })
  created_by_user_id: number | null;

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

@Entity('chat_group_members')
@Index('IDX_chat_group_members_thread', ['thread_id'])
@Index('IDX_chat_group_members_user', ['user_id'])
@Index('UQ_chat_group_members_thread_user', ['thread_id', 'user_id'], { unique: true })
export class ChatGroupMember {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'int' })
  thread_id: number;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'varchar', length: 20, default: 'member' })
  role: string;

  @Column({ type: 'int', default: 0 })
  unread_count: number;

  @Column({ type: 'timestamptz', nullable: true })
  cleared_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
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

  @Column({ type: 'timestamptz', nullable: true })
  edited_at: Date | null;
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

@Entity('chat_message_edits')
export class ChatMessageEdit {
  @PrimaryGeneratedColumn({ primaryKeyConstraintName: 'PK_chat_message_edits' })
  id: number;

  @Index('IDX_chat_message_edits_school')
  @Column({ type: 'int' })
  school_id: number;

  @Index('IDX_chat_message_edits_message')
  @Column({ type: 'int' })
  message_id: number;

  @Column({ type: 'text', nullable: true })
  previous_body: string | null;

  @Column({ type: 'int' })
  edited_by: number;

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
  'edited_message',
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
