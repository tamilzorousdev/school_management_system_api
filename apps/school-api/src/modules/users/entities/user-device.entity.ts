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
import { ClientApp } from '../../access/entities/role.entity';
import { User } from './user.entity';

export const PLATFORMS = ['android', 'ios', 'web'] as const;
export type Platform = (typeof PLATFORMS)[number];

@Entity('user_devices')
export class UserDevice {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  user_id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'int', nullable: true })
  session_id: number | null;

  @Index('UQ_user_devices_token', { unique: true })
  @Column({ type: 'varchar', length: 512 })
  fcm_token: string;

  @Column({ type: 'varchar', length: 10 })
  platform: Platform;

  @Column({ type: 'varchar', length: 10, nullable: true })
  app: ClientApp | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  onesignal_app_id: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  device_name: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  app_version: string | null;

  @Column({ type: 'timestamptz' })
  last_seen_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
