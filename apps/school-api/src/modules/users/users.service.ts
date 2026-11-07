import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { ROLES } from '../access/access.catalog';
import { AccessService } from '../access/access.service';
import { APP_SECTIONS, AppSection } from '../access/entities/role.entity';
import { UserSession } from '../auth/entities/user-session.entity';
import { FilesService } from '../files/files.service';
import { CreateUserDto, UpdateMeDto, UpdateUserDto, UserQueryDto } from './dto/user-input.dto';
import { UserInsightsDto, UserListItemDto, UserProfileDto } from './dto/user-response.dto';
import { UserDevice } from './entities/user-device.entity';
import { UserRole } from './entities/user-role.entity';
import { User } from './entities/user.entity';
import { toUserListItem, toUserProfile } from './users.presenter';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly access: AccessService,
    private readonly files: FilesService,
    private readonly dataSource: DataSource,
  ) {}

  findActiveByMobile(mobile: string): Promise<User | null> {
    return this.users.findOneBy({ mobile, deleted_at: IsNull() });
  }

  async profile(userId: number): Promise<UserProfileDto> {
    const access = await this.access.load(userId);
    if (!access) throw AppException.notFound('User not found');
    return toUserProfile(
      access,
      this.files.linkFor(access.user.school?.logo_file_id ?? null),
      this.files.linkFor(access.user.school?.signature_file_id ?? null),
      this.files.linkFor(access.user.school?.seal_file_id ?? null),
    );
  }

  async updateMe(userId: number, dto: UpdateMeDto): Promise<UserProfileDto> {
    await this.users.update(userId, dto);
    return this.profile(userId);
  }

  async list(query: UserQueryDto, actor: AuthUser): Promise<Paginated<UserListItemDto>> {
    const qb = this.scoped(actor)
      .leftJoinAndSelect('u.user_roles', 'user_role')
      .leftJoinAndSelect('user_role.role', 'role');
    if (query.status) qb.andWhere('u.status = :status', { status: query.status });
    if (query.language) qb.andWhere('u.language = :language', { language: query.language });
    if (query.never_signed_in !== undefined) {
      qb.andWhere(query.never_signed_in ? 'u.last_login_at IS NULL' : 'u.last_login_at IS NOT NULL');
    }
    if (query.role) qb.andWhere(this.hasRole('r_filter.code = :role'), { role: query.role });
    if (query.app) qb.andWhere(this.hasRole('r_filter.app = :app'), { app: query.app });

    const page = await listQuery(qb, query, {
      searchable: ['u.name', 'u.mobile', 'u.email'],
      sortable: { created_at: 'u.created_at', name: 'u.name', last_login_at: 'u.last_login_at' },
      defaultSort: 'created_at',
    });
    return { ...page, items: page.items.map((user) => toUserListItem(this.access.describe(user))) };
  }

  async insights(actor: AuthUser): Promise<UserInsightsDto> {
    const totals = await this.scoped(actor)
      .select('COUNT(*)', 'total')
      .addSelect(`COUNT(*) FILTER (WHERE u.status = 'active')`, 'active')
      .addSelect(`COUNT(*) FILTER (WHERE u.status = 'inactive')`, 'inactive')
      .addSelect('COUNT(*) FILTER (WHERE u.last_login_at IS NULL)', 'never_signed_in')
      .addSelect(`COUNT(*) FILTER (WHERE u.language = 'ta')`, 'tamil')
      .getRawOne<Record<string, string>>();
    const apps = await this.scoped(actor)
      .innerJoin('u.user_roles', 'user_role')
      .innerJoin('user_role.role', 'role')
      .select('role.app', 'app')
      .addSelect('COUNT(DISTINCT u.id)', 'count')
      .groupBy('role.app')
      .getRawMany<{ app: AppSection; count: string }>();
    const byApp = Object.fromEntries(APP_SECTIONS.map((app) => [app, 0])) as Record<AppSection, number>;
    apps.forEach((row) => (byApp[row.app] = Number(row.count)));
    return {
      total: Number(totals?.total ?? 0),
      active: Number(totals?.active ?? 0),
      inactive: Number(totals?.inactive ?? 0),
      never_signed_in: Number(totals?.never_signed_in ?? 0),
      tamil: Number(totals?.tamil ?? 0),
      by_app: byApp,
    };
  }

  async get(id: number, actor: AuthUser): Promise<UserProfileDto> {
    await this.findScoped(id, actor);
    return this.profile(id);
  }

  async create(dto: CreateUserDto, actor: AuthUser): Promise<UserProfileDto> {
    const isSuper = actor.roles.includes(ROLES.SUPER_ADMIN);
    if (dto.school_id && !isSuper)
      throw AppException.forbidden('Only a super admin can create users in another school');
    const schoolId = isSuper ? (dto.school_id ?? actor.school_id) : actor.school_id;
    await this.assertMobileFree(dto.mobile);
    const roles = await this.access.resolveRoles(dto.role_codes, actor.roles);

    const id = await this.dataSource.transaction(async (manager) => {
      const user = await manager.save(
        manager.create(User, {
          school_id: schoolId,
          name: dto.name,
          mobile: dto.mobile,
          email: dto.email ?? null,
          status: dto.status ?? 'active',
          language: dto.language ?? 'en',
        }),
      );
      await manager.insert(
        UserRole,
        roles.map((role) => ({ user_id: user.id, role_id: role.id })),
      );
      return user.id;
    });
    return this.profile(id);
  }

  async update(id: number, dto: UpdateUserDto, actor: AuthUser): Promise<UserProfileDto> {
    const user = await this.findScoped(id, actor);
    if (dto.mobile && dto.mobile !== user.mobile) await this.assertMobileFree(dto.mobile);
    if (id === actor.id && dto.status === 'inactive')
      throw AppException.badRequest('You cannot deactivate your own account');
    const roles = dto.role_codes ? await this.access.resolveRoles(dto.role_codes, actor.roles) : null;
    if (roles && id === actor.id && !roles.some((role) => role.app === 'admin')) {
      throw AppException.badRequest('You cannot remove your own admin access');
    }

    await this.dataSource.transaction(async (manager) => {
      const fields = Object.fromEntries(Object.entries(dto).filter(([key]) => key !== 'role_codes'));
      if (Object.keys(fields).length) await manager.update(User, id, fields);
      if (roles) {
        await manager.delete(UserRole, { user_id: id });
        await manager.insert(
          UserRole,
          roles.map((role) => ({ user_id: id, role_id: role.id })),
        );
      }
      if (dto.status === 'inactive' || (dto.mobile && dto.mobile !== user.mobile)) {
        await this.signOutEverywhere(id, manager.getRepository(UserSession), manager.getRepository(UserDevice));
      }
    });
    return this.profile(id);
  }

  async remove(id: number, actor: AuthUser): Promise<{ id: number }> {
    await this.findScoped(id, actor);
    if (id === actor.id) throw AppException.badRequest('You cannot delete your own account');
    await this.dataSource.transaction(async (manager) => {
      await this.signOutEverywhere(id, manager.getRepository(UserSession), manager.getRepository(UserDevice));
      await manager.softDelete(User, id);
    });
    return { id };
  }

  private async signOutEverywhere(
    userId: number,
    sessions: Repository<UserSession>,
    devices: Repository<UserDevice>,
  ): Promise<void> {
    await sessions.update({ user_id: userId, revoked_at: IsNull() }, { revoked_at: new Date() });
    await devices.delete({ user_id: userId });
  }

  private async assertMobileFree(mobile: string): Promise<void> {
    if (await this.findActiveByMobile(mobile)) {
      throw AppException.conflict('A user with this mobile number already exists', 'MOBILE_TAKEN');
    }
  }

  private async findScoped(id: number, actor: AuthUser): Promise<User> {
    const user = await this.scoped(actor).andWhere('u.id = :id', { id }).getOne();
    if (!user) throw AppException.notFound('User not found');
    return user;
  }

  private scoped(actor: AuthUser): SelectQueryBuilder<User> {
    const qb = this.users.createQueryBuilder('u');
    if (!actor.roles.includes(ROLES.SUPER_ADMIN)) {
      qb.andWhere('u.school_id = :schoolId', { schoolId: actor.school_id });
    }
    return qb;
  }

  private hasRole(condition: string): string {
    return `EXISTS (SELECT 1 FROM user_roles ur_filter INNER JOIN roles r_filter ON r_filter.id = ur_filter.role_id WHERE ur_filter.user_id = u.id AND ${condition})`;
  }
}
