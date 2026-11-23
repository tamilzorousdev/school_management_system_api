import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Permission } from './permission.entity';

export const APP_SECTIONS = ['admin', 'staff', 'parent', 'driver', 'office'] as const;
export type AppSection = (typeof APP_SECTIONS)[number];

export const MOBILE_SECTIONS = ['parent', 'staff', 'driver', 'office'] as const;
export type MobileSection = (typeof MOBILE_SECTIONS)[number];

export const CLIENT_APPS = ['admin', 'mobile', ...MOBILE_SECTIONS] as const;
export type ClientApp = (typeof CLIENT_APPS)[number];

export const SECTION_LABELS: Record<AppSection, string> = {
  admin: 'Admin web',
  staff: 'Staff',
  parent: 'Parent',
  driver: 'Driver',
  office: 'Office',
};

export const OFFICE_APP_ROLES = ['AO'];

export function canOpen(app: ClientApp, sections: AppSection[]): boolean {
  if (app === 'mobile') return sections.some((section) => (MOBILE_SECTIONS as readonly string[]).includes(section));
  return sections.includes(app);
}

@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('UQ_roles_code', { unique: true })
  @Column({ type: 'varchar', length: 40 })
  code: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 10 })
  app: AppSection;

  @Column({ type: 'boolean', default: true })
  is_system: boolean;

  @Column({ type: 'smallint', default: 0 })
  sort_order: number;

  @ManyToMany(() => Permission)
  @JoinTable({
    name: 'role_permissions',
    joinColumn: { name: 'role_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  permissions: Permission[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
