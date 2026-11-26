import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AppException } from '@app/common';
import { User } from '../users/entities/user.entity';
import { FULL_ACCESS_ROLES, PERMISSION_CATALOG, roleConflict, ROLES } from './access.catalog';
import { AppSection, OFFICE_APP_ROLES, Role, TRANSPORT_APP_ROLES } from './entities/role.entity';
import { Permission } from './entities/permission.entity';

export interface UserAccess {
  user: User;
  roles: Role[];
  permissions: string[];
  apps: AppSection[];
}

const APP_ORDER: AppSection[] = ['admin', 'staff', 'parent', 'driver', 'office', 'transport'];

@Injectable()
export class AccessService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(Permission) private readonly permissions: Repository<Permission>,
  ) {}

  async load(userId: number): Promise<UserAccess | null> {
    const user = await this.users
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.school', 'school')
      .leftJoinAndSelect('user.user_roles', 'user_role')
      .leftJoinAndSelect('user_role.role', 'role')
      .leftJoinAndSelect('role.permissions', 'permission')
      .where('user.id = :userId', { userId })
      .getOne();
    if (!user) return null;
    return this.describe(user);
  }

  describe(user: User): UserAccess {
    const roles = (user.user_roles ?? [])
      .map((userRole) => userRole.role)
      .filter((role): role is Role => Boolean(role))
      .sort((a, b) => a.sort_order - b.sort_order);
    const fullAccess = roles.some((role) => FULL_ACCESS_ROLES.includes(role.code));
    const permissions = fullAccess
      ? PERMISSION_CATALOG.map((permission) => permission.code)
      : [...new Set(roles.flatMap((role) => (role.permissions ?? []).map((permission) => permission.code)))].sort();
    const apps = APP_ORDER.filter((app) => roles.some((role) => opensApp(role, app)));
    return { user, roles, permissions, apps };
  }

  async listRoles(): Promise<(Role & { user_count: number })[]> {
    const roles = await this.roles.find({ relations: { permissions: true }, order: { sort_order: 'ASC' } });
    return this.withUserCounts(roles);
  }

  listPermissions(): Promise<Permission[]> {
    return this.permissions.find({ order: { group_name: 'ASC', code: 'ASC' } });
  }

  async resolveRoles(codes: string[], actorRoles: string[]): Promise<Role[]> {
    const unique = [...new Set(codes)];
    const roles = await this.roles.find({ where: { code: In(unique) } });
    const missing = unique.filter((code) => !roles.some((role) => role.code === code));
    if (missing.length) throw AppException.badRequest(`Unknown role: ${missing.join(', ')}`, 'UNKNOWN_ROLE');
    const conflict = roleConflict(unique);
    if (conflict) throw AppException.validation([{ field: 'role_codes', message: conflict }]);
    if (unique.includes(ROLES.SUPER_ADMIN) && !actorRoles.includes(ROLES.SUPER_ADMIN)) {
      throw AppException.forbidden('Only a super admin can assign the super admin role');
    }
    return roles;
  }

  private async withUserCounts(roles: Role[]): Promise<(Role & { user_count: number })[]> {
    const rows: { role_id: number; count: string }[] = await this.roles.manager
      .createQueryBuilder()
      .select('user_role.role_id', 'role_id')
      .addSelect('COUNT(*)', 'count')
      .from('user_roles', 'user_role')
      .innerJoin('users', 'user', 'user.id = user_role.user_id AND user.deleted_at IS NULL')
      .groupBy('user_role.role_id')
      .getRawMany();
    const counts = new Map(rows.map((row) => [Number(row.role_id), Number(row.count)]));
    return roles.map((role) => Object.assign(role, { user_count: counts.get(role.id) ?? 0 }));
  }
}

export function opensApp(role: Role, app: AppSection): boolean {
  return (
    role.app === app ||
    (app === 'office' && OFFICE_APP_ROLES.includes(role.code)) ||
    (app === 'transport' && TRANSPORT_APP_ROLES.includes(role.code))
  );
}
