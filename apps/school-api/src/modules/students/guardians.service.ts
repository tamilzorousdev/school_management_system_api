import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Not, Repository } from 'typeorm';
import { AppException, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn, yearsBetween } from '../../shared/dates';
import { ROLES } from '../access/access.catalog';
import { Role } from '../access/entities/role.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { School } from '../schools/entities/school.entity';
import { UserRole } from '../users/entities/user-role.entity';
import { Language, User } from '../users/entities/user.entity';
import {
  GuardianInputDto,
  GuardianQueryDto,
  UpdateGuardianDto,
  UpdateMyParentProfileDto,
} from './dto/student-input.dto';
import {
  GuardianChildDto,
  GuardianDetailDto,
  GuardianInsightsDto,
  GuardianListItemDto,
  ParentChildDto,
} from './dto/student-response.dto';
import { Guardian } from './entities/guardian.entity';
import { StudentGuardian } from './entities/student-guardian.entity';
import { yearClause } from '../../shared/year-context';

export interface Invite {
  user_id: number;
  school_id: number;
}

interface ChildRow {
  guardian_id: number;
  id: number;
  first_name: string;
  last_name: string | null;
  class_name: string | null;
  section_name: string | null;
  relation: StudentGuardian['relation'];
  admission_date: string;
}

@Injectable()
export class GuardiansService {
  private readonly logger = new Logger('Guardians');

  constructor(
    @InjectRepository(Guardian) private readonly guardians: Repository<Guardian>,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async upsertForStudent(
    manager: EntityManager,
    schoolId: number,
    studentId: number,
    input: GuardianInputDto,
  ): Promise<{ guardian: Guardian; invite: Invite | null }> {
    const existing = await manager.findOneBy(Guardian, { school_id: schoolId, mobile: input.mobile });
    if (existing && existing.name.trim().toLowerCase() !== input.name.trim().toLowerCase()) {
      throw AppException.badRequest(
        `This mobile number (${input.mobile}) is already registered to ${existing.name}. Please verify the name or select the existing parent.`,
        'GUARDIAN_MOBILE_NAME_MISMATCH',
      );
    }
    const profile = {
      name: input.name,
      alt_mobile: input.alt_mobile,
      email: input.email,
      occupation: input.occupation,
      qualification: input.qualification,
    };
    const defined = Object.fromEntries(Object.entries(profile).filter(([, value]) => value !== undefined));
    const guardian = await manager.save(
      existing
        ? manager.merge(Guardian, existing, defined)
        : manager.create(Guardian, { ...defined, school_id: schoolId, mobile: input.mobile }),
    );

    const receivesAlerts = input.receives_alerts ?? true;
    const link = await manager.findOneBy(StudentGuardian, { student_id: studentId, guardian_id: guardian.id });
    await manager.save(
      manager.merge(StudentGuardian, link ?? manager.create(StudentGuardian), {
        school_id: schoolId,
        student_id: studentId,
        guardian_id: guardian.id,
        relation: input.relation,
        is_primary: input.is_primary ?? link?.is_primary ?? false,
        can_pickup: input.can_pickup ?? link?.can_pickup ?? true,
        receives_alerts: receivesAlerts,
      }),
    );
    if (input.is_primary) await this.makePrimary(manager, studentId, guardian.id);
    await this.ensureOnePrimary(manager, studentId);

    const invite = receivesAlerts ? await this.ensureLogin(manager, guardian, input.language) : null;
    return { guardian, invite };
  }

  async ensureLogin(manager: EntityManager, guardian: Guardian, language?: Language): Promise<Invite | null> {
    const parentRole = await manager.findOneByOrFail(Role, { code: ROLES.PARENT });
    let user = await manager.findOneBy(User, { mobile: guardian.mobile, deleted_at: IsNull() });
    let invited = false;
    if (!user) {
      user = await manager.save(
        manager.create(User, {
          school_id: guardian.school_id,
          name: guardian.name,
          mobile: guardian.mobile,
          email: guardian.email,
          status: 'active',
          language: language ?? 'en',
        }),
      );
      invited = true;
    }
    const hasRole = await manager.exists(UserRole, { where: { user_id: user.id, role_id: parentRole.id } });
    if (!hasRole) {
      await manager.insert(UserRole, { user_id: user.id, role_id: parentRole.id });
      invited = true;
    }
    if (guardian.user_id !== user.id) await manager.update(Guardian, guardian.id, { user_id: user.id });
    guardian.user_id = user.id;
    return invited ? { user_id: user.id, school_id: guardian.school_id } : null;
  }

  async sendInvites(invites: (Invite | null)[]): Promise<void> {
    const unique = [
      ...new Map(invites.filter((item): item is Invite => Boolean(item)).map((item) => [item.user_id, item])).values(),
    ];
    for (const invite of unique) {
      const school = await this.dataSource.getRepository(School).findOneBy({ id: invite.school_id });
      await this.notifications
        .dispatch({
          template: 'ACCOUNT_INVITE',
          audience: { user_ids: [invite.user_id] },
          data: { school: school?.name ?? 'your school', app: 'Parent app' },
        })
        .catch((error: Error) => this.logger.warn(`Invite for user ${invite.user_id} not sent: ${error.message}`));
    }
  }

  async list(schoolId: number, query: GuardianQueryDto): Promise<Paginated<GuardianListItemDto>> {
    const qb = this.guardians
      .createQueryBuilder('g')
      .leftJoinAndSelect('g.user', 'u')
      .where('g.school_id = :schoolId', { schoolId });
    qb.andWhere(
      'EXISTS (SELECT 1 FROM student_guardians sg JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL WHERE sg.guardian_id = g.id)',
    );
    if (query.on_app !== undefined)
      qb.andWhere(query.on_app ? 'u.last_login_at IS NOT NULL' : 'u.last_login_at IS NULL');
    if (query.language) qb.andWhere('u.language = :language', { language: query.language });
    if (query.multiple_children !== undefined) {
      qb.andWhere(
        `(SELECT COUNT(*) FROM student_guardians sg JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL
          WHERE sg.guardian_id = g.id) ${query.multiple_children ? '> 1' : '<= 1'}`,
      );
    }
    const ordered = query.sort ? query : { ...query, sort: 'name', order: 'asc' as const };
    const page = await listQuery(qb, ordered, {
      searchable: ['g.name', 'g.mobile', 'g.email', 'g.occupation'],
      sortable: { name: 'g.name', created_at: 'g.created_at', last_login_at: 'u.last_login_at' },
      defaultSort: 'name',
    });
    const children = await this.children(
      schoolId,
      page.items.map((guardian) => guardian.id),
    );
    return { ...page, items: page.items.map((guardian) => this.toListItem(guardian, children.get(guardian.id) ?? [])) };
  }

  async insights(schoolId: number): Promise<GuardianInsightsDto> {
    const [row] = await this.dataSource.query(
      `WITH active AS (
         SELECT g.id, g.user_id, COUNT(s.id) AS kids
         FROM guardians g
         JOIN student_guardians sg ON sg.guardian_id = g.id
         JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL
         WHERE g.school_id = $1 AND g.deleted_at IS NULL
         GROUP BY g.id, g.user_id
       )
       SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE u.last_login_at IS NOT NULL) AS on_app,
              COUNT(*) FILTER (WHERE a.kids > 1) AS multiple_children,
              COUNT(*) FILTER (WHERE u.language = 'ta') AS tamil
       FROM active a LEFT JOIN users u ON u.id = a.user_id AND u.deleted_at IS NULL`,
      [schoolId],
    );
    return {
      total: Number(row.total),
      on_app: Number(row.on_app),
      multiple_children: Number(row.multiple_children),
      tamil: Number(row.tamil),
    };
  }

  async get(schoolId: number, id: number): Promise<GuardianDetailDto> {
    const guardian = await this.guardians.findOne({ where: { id, school_id: schoolId }, relations: { user: true } });
    if (!guardian) throw AppException.notFound('Parent or guardian not found', 'GUARDIAN_NOT_FOUND');
    const children = (await this.children(schoolId, [id])).get(id) ?? [];
    const coGuardians: { id: number; name: string; mobile: string; relation: StudentGuardian['relation'] }[] =
      await this.dataSource.query(
        `SELECT DISTINCT ON (g.id) g.id, g.name, g.mobile, other.relation
         FROM student_guardians mine
         JOIN student_guardians other ON other.student_id = mine.student_id AND other.guardian_id <> mine.guardian_id
         JOIN guardians g ON g.id = other.guardian_id AND g.deleted_at IS NULL
         WHERE mine.guardian_id = $1
         ORDER BY g.id`,
        [id],
      );
    return {
      ...this.toListItem(guardian, children),
      alt_mobile: guardian.alt_mobile,
      address_line: guardian.address_line,
      city: guardian.city,
      pincode: guardian.pincode,
      co_guardians: coGuardians.map((row) => ({ ...row, id: Number(row.id) })),
    };
  }

  async profileForUser(userId: number): Promise<GuardianDetailDto> {
    const guardian = await this.ownGuardian(userId);
    return this.get(guardian.school_id, guardian.id);
  }

  async updateProfileForUser(userId: number, dto: UpdateMyParentProfileDto): Promise<GuardianDetailDto> {
    const guardian = await this.ownGuardian(userId);
    return this.update(guardian.school_id, guardian.id, dto);
  }

  private async ownGuardian(userId: number): Promise<Guardian> {
    const guardian = await this.guardians.findOne({ where: { user_id: userId }, order: { id: 'ASC' } });
    if (!guardian) {
      throw AppException.notFound('No parent profile is linked to this login', 'PARENT_PROFILE_NOT_FOUND');
    }
    return guardian;
  }

  async update(schoolId: number, id: number, dto: UpdateGuardianDto): Promise<GuardianDetailDto> {
    const guardian = await this.guardians.findOneBy({ id, school_id: schoolId });
    if (!guardian) throw AppException.notFound('Parent or guardian not found', 'GUARDIAN_NOT_FOUND');
    const { language, ...fields } = dto;
    if (fields.mobile && fields.mobile !== guardian.mobile) {
      if (await this.guardians.exists({ where: { school_id: schoolId, mobile: fields.mobile, id: Not(id) } })) {
        throw AppException.conflict('Another parent already uses this mobile number', 'MOBILE_TAKEN');
      }
      if (
        guardian.user_id &&
        (await this.dataSource
          .getRepository(User)
          .exists({ where: { mobile: fields.mobile, id: Not(guardian.user_id) } }))
      ) {
        throw AppException.conflict('A user with this mobile number already exists', 'MOBILE_TAKEN');
      }
    }
    await this.dataSource.transaction(async (manager) => {
      if (Object.keys(fields).length) await manager.update(Guardian, id, fields);
      if (guardian.user_id) {
        const userFields = Object.fromEntries(
          Object.entries({ name: fields.name, mobile: fields.mobile, language }).filter(
            ([, value]) => value !== undefined,
          ),
        );
        if (Object.keys(userFields).length) await manager.update(User, guardian.user_id, userFields);
      }
    });
    return this.get(schoolId, id);
  }

  async childrenForUser(userId: number): Promise<ParentChildDto[]> {
    const rows: {
      id: number;
      first_name: string;
      last_name: string | null;
      admission_no: string;
      gender: ParentChildDto['gender'];
      dob: string;
      photo_file_id: number | null;
      class_name: string | null;
      section_name: string | null;
      roll_no: number | null;
      class_teacher: string | null;
      relation: StudentGuardian['relation'];
      school_id: number;
      school_name: string;
    }[] = await this.dataSource.query(
      `SELECT s.id, s.first_name, s.last_name, s.admission_no, s.gender, to_char(s.dob, 'YYYY-MM-DD') AS dob, s.photo_file_id,
              c.name AS class_name, sec.name AS section_name, e.roll_no, t.name AS class_teacher, sg.relation,
              sch.id AS school_id, sch.name AS school_name
       FROM guardians g
       JOIN student_guardians sg ON sg.guardian_id = g.id
       JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       JOIN schools sch ON sch.id = s.school_id
       LEFT JOIN academic_years y ON y.school_id = s.school_id AND ${yearClause('y')} AND y.deleted_at IS NULL
       LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = y.id
       LEFT JOIN classes c ON c.id = e.class_id
       LEFT JOIN sections sec ON sec.id = e.section_id
       LEFT JOIN users t ON t.id = sec.class_teacher_user_id
       WHERE g.user_id = $1 AND g.deleted_at IS NULL
       ORDER BY c.grade_level DESC NULLS LAST, s.first_name`,
      [userId],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      full_name: [row.first_name, row.last_name].filter(Boolean).join(' '),
      admission_no: row.admission_no,
      gender: row.gender,
      dob: row.dob,
      photo_file_id: row.photo_file_id,
      class_name: row.class_name,
      section_name: row.section_name,
      roll_no: row.roll_no,
      class_teacher: row.class_teacher,
      relation: row.relation,
      school: { id: Number(row.school_id), name: row.school_name },
    }));
  }

  private async makePrimary(manager: EntityManager, studentId: number, guardianId: number): Promise<void> {
    await manager.update(
      StudentGuardian,
      { student_id: studentId, guardian_id: Not(guardianId) },
      { is_primary: false },
    );
    await manager.update(StudentGuardian, { student_id: studentId, guardian_id: guardianId }, { is_primary: true });
  }

  async ensureOnePrimary(manager: EntityManager, studentId: number): Promise<void> {
    const links = await manager.find(StudentGuardian, {
      where: { student_id: studentId },
      order: { created_at: 'ASC', id: 'ASC' },
    });
    if (links.length && !links.some((link) => link.is_primary)) {
      await manager.update(StudentGuardian, links[0].id, { is_primary: true });
    }
  }

  private async children(schoolId: number, guardianIds: number[]): Promise<Map<number, GuardianChildDto[]>> {
    const result = new Map<number, GuardianChildDto[]>();
    if (!guardianIds.length) return result;
    const rows: ChildRow[] = await this.dataSource.query(
      `SELECT sg.guardian_id, s.id, s.first_name, s.last_name, c.name AS class_name, sec.name AS section_name, sg.relation,
              to_char(s.admission_date, 'YYYY-MM-DD') AS admission_date
       FROM student_guardians sg
       JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL
       LEFT JOIN academic_years y ON y.school_id = $1 AND ${yearClause('y')} AND y.deleted_at IS NULL
       LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = y.id
       LEFT JOIN classes c ON c.id = e.class_id
       LEFT JOIN sections sec ON sec.id = e.section_id
       WHERE sg.guardian_id = ANY($2)
       ORDER BY c.grade_level DESC NULLS LAST, s.first_name`,
      [schoolId, guardianIds],
    );
    const today = todayIn(this.app.timeZone);
    rows.forEach((row) => {
      const list = result.get(Number(row.guardian_id)) ?? [];
      list.push({
        id: Number(row.id),
        full_name: [row.first_name, row.last_name].filter(Boolean).join(' '),
        class_section: row.class_name ? [row.class_name, row.section_name].filter(Boolean).join(' - ') : null,
        relation: row.relation,
        admission_date: row.admission_date,
        years_in_school: yearsBetween(row.admission_date, today),
      });
      result.set(Number(row.guardian_id), list);
    });
    return result;
  }

  private toListItem(guardian: Guardian, children: GuardianChildDto[]): GuardianListItemDto {
    return {
      id: guardian.id,
      name: guardian.name,
      mobile: guardian.mobile,
      email: guardian.email,
      occupation: guardian.occupation,
      qualification: guardian.qualification,
      language: guardian.user?.language ?? null,
      on_app: Boolean(guardian.user?.last_login_at),
      last_login_at: guardian.user?.last_login_at ?? null,
      children_count: children.length,
      children,
    };
  }
}
