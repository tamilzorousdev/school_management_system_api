import { TrackedEntity } from '@app/common';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { UserRole } from './user-role.entity';

export const USER_STATUSES = ['active', 'inactive'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const LANGUAGES = ['en', 'ta'] as const;
export type Language = (typeof LANGUAGES)[number];

@Entity('users')
@Index('UQ_users_mobile', ['mobile'], { unique: true, where: 'deleted_at IS NULL' })
export class User extends TrackedEntity {
  @Index()
  @Column({ type: 'int', nullable: true })
  school_id: number | null;

  @ManyToOne(() => School, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'school_id' })
  school?: School | null;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 10 })
  mobile: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 10, default: 'active' })
  status: UserStatus;

  @Column({ type: 'varchar', length: 5, default: 'en' })
  language: Language;

  @Column({ type: 'int', nullable: true })
  photo_file_id: number | null;

  @Column({ type: 'int', nullable: true })
  signature_file_id: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_login_at: Date | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  auth_user_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  auth_registered_at: Date | null;

  @OneToMany(() => UserRole, (userRole) => userRole.user)
  user_roles?: UserRole[];
}
