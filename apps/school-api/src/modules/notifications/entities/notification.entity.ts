import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export const CHANNELS = ['in_app', 'push', 'sms'] as const;
export type Channel = (typeof CHANNELS)[number];

export const NOTIFICATION_STATUSES = ['queued', 'sent', 'delivered', 'read', 'failed', 'skipped'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const CATEGORIES = [
  'system',
  'account',
  'attendance',
  'transport',
  'diary',
  'chat',
  'meeting',
  'alert',
  'fees',
  'announcement',
  'approval',
] as const;
export type NotificationCategory = (typeof CATEGORIES)[number];

@Entity('notifications')
@Index('IDX_notifications_user_channel_created', ['user_id', 'channel', 'created_at'])
@Index('IDX_notifications_channel_status', ['channel', 'status'])
export class Notification {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int', nullable: true })
  school_id: number | null;

  @Column({ type: 'int' })
  user_id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'uuid' })
  batch_id: string;

  @Column({ type: 'varchar', length: 10 })
  channel: Channel;

  @Column({ type: 'varchar', length: 20 })
  category: NotificationCategory;

  @Column({ type: 'varchar', length: 60, nullable: true })
  template_code: string | null;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  data: Record<string, string>;

  @Column({ type: 'varchar', length: 10 })
  status: NotificationStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  recipient: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  provider: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  provider_ref: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'smallint', default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  sent_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  read_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
