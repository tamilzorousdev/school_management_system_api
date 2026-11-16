import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { VerifyDocumentDto } from '../../shared/verification';
import { ROLES } from '../access/access.catalog';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateStaffDto, StaffDocumentInputDto, UpdateStaffDto } from '../staff/dto/staff-input.dto';
import { StaffDocumentDto } from '../staff/dto/staff-response.dto';
import { CREW_DOCUMENT_TYPES, StaffDocument } from '../staff/entities/staff-document.entity';
import { Staff } from '../staff/entities/staff.entity';
import { StaffService } from '../staff/staff.service';
import { TransportRoute } from '../transport/entities/transport-route.entity';
import { Vehicle } from '../transport/entities/vehicle.entity';
import { User } from '../users/entities/user.entity';
import { CREW_ROLE_SQL, DRIVER_SQL, DUTY_SQL, EXPIRY_SQL, ON_BUS_SQL, VEHICLE_SQL } from './crew-sql';
import {
  CREW_DESIGNATIONS,
  CrewCheck,
  crewChecks,
  CrewRole,
  dateProblems,
  dueChecks,
  DutyStatus,
  dutyStatus,
  earliestExpiry,
  REMINDER_GAP_MS,
  reminderText,
} from './crew.logic';
import {
  CREW_KEYS,
  CreateCrewDto,
  CrewDetailDto,
  CrewInsightsDto,
  CrewListItemDto,
  CrewQueryDto,
  DRIVER_ONLY_KEYS,
  PROFILE_KEYS,
  RemindManyDto,
  RemindResultDto,
  UpdateCrewDto,
} from './dto/crew.dto';

type CrewRow = Staff & { user: User };
type CrewFields = Partial<Pick<Staff, (typeof CREW_KEYS)[number]>>;

const CLEARED_APPROVAL = { duty_approved_at: null, duty_approved_by: null, duty_approved_until: null };

function pick<T extends object, K extends string>(source: T, keys: readonly K[]): Record<string, unknown> {
  return Object.fromEntries(
    keys
      .filter((key) => (source as Record<string, unknown>)[key] !== undefined)
      .map((key) => [key, (source as Record<string, unknown>)[key]]),
  );
}

@Injectable()
export class CrewService {
  constructor(
    @InjectRepository(Staff) private readonly staff: Repository<Staff>,
    @InjectRepository(StaffDocument) private readonly documents: Repository<StaffDocument>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(TransportRoute) private readonly routes: Repository<TransportRoute>,
    private readonly staffService: StaffService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async list(schoolId: number, query: CrewQueryDto): Promise<Paginated<CrewListItemDto>> {
    const qb = this.base(schoolId, query.status);
    if (query.role) qb.andWhere(query.role === 'driver' ? DRIVER_SQL : `NOT ${DRIVER_SQL}`);
    if (query.duty_status) qb.andWhere(DUTY_SQL[query.duty_status]);
    if (query.expiry_state) qb.andWhere(EXPIRY_SQL[query.expiry_state]);
    if (query.vehicle_id) qb.andWhere(VEHICLE_SQL, { vehicleId: query.vehicle_id });
    if (query.unassigned !== undefined) qb.andWhere(query.unassigned ? `NOT ${ON_BUS_SQL}` : ON_BUS_SQL);
    const ordered = query.sort ? query : { ...query, sort: 'name', order: 'asc' as const };
    const page = await listQuery(qb, ordered, {
      searchable: ['u.name', 'u.mobile', 'st.employee_no', 'st.licence_no', 'st.badge_no'],
      sortable: {
        name: 'u.name',
        employee_no: 'st.employee_no',
        licence_expiry: 'st.licence_expiry',
        joining_date: 'st.joining_date',
        created_at: 'st.created_at',
      },
      defaultSort: 'name',
    });
    return { ...page, items: (await this.present(schoolId, page.items as CrewRow[])).map((item) => item.summary) };
  }

  async insights(schoolId: number): Promise<CrewInsightsDto> {
    const count = (sql: string) => this.base(schoolId).andWhere(sql).getCount();
    const [drivers, attendants, approved, pending, blocked, dueSoon, unassigned] = await Promise.all([
      count(DRIVER_SQL),
      count(`NOT ${DRIVER_SQL}`),
      count(DUTY_SQL.approved),
      count(DUTY_SQL.pending),
      count(DUTY_SQL.blocked),
      count(EXPIRY_SQL.due_soon),
      count(`NOT ${ON_BUS_SQL}`),
    ]);
    return { drivers, attendants, approved, pending, blocked, due_soon: dueSoon, unassigned };
  }

  async get(schoolId: number, id: number): Promise<CrewDetailDto> {
    const row = await this.find(schoolId, id);
    const [detail, [crew], people] = await Promise.all([
      this.staffService.get(schoolId, id),
      this.present(schoolId, [row]),
      this.people([row.duty_approved_by, row.last_reminded_by]),
    ]);
    return {
      ...crew!.summary,
      email: detail.email,
      language: detail.language,
      gender: detail.gender,
      dob: detail.dob,
      joining_date: detail.joining_date,
      experience_years: detail.experience_years,
      prior_experience_years: detail.prior_experience_years,
      address: detail.address,
      emergency_contact_name: detail.emergency_contact_name,
      emergency_contact_mobile: detail.emergency_contact_mobile,
      left_on: detail.left_on,
      licence_issued_on: row.licence_issued_on,
      licence_expiry: row.licence_expiry,
      badge_no: row.badge_no,
      badge_expiry: row.badge_expiry,
      medical_fitness_expiry: row.medical_fitness_expiry,
      police_verified_on: row.police_verified_on,
      police_verification_expiry: row.police_verification_expiry,
      checks: crew!.checks,
      clear: crew!.checks.every((check) => check.clear),
      approved_at: row.duty_approved_at,
      approved_by: row.duty_approved_by ? (people.get(row.duty_approved_by) ?? null) : null,
      approved_until: row.duty_approved_until,
      last_reminded_at: row.last_reminded_at,
      last_reminded_by: row.last_reminded_by ? (people.get(row.last_reminded_by) ?? null) : null,
      documents: detail.documents,
    };
  }

  async create(schoolId: number, dto: CreateCrewDto, actor: AuthUser): Promise<CrewDetailDto> {
    const crew = this.crewFields(dto, dto.role);
    this.assertDates({ ...this.emptyCrew(), ...crew });
    const created = await this.staffService.create(
      schoolId,
      {
        ...pick(dto, [...PROFILE_KEYS, 'employee_no', 'send_invite']),
        role_codes: [dto.role === 'driver' ? ROLES.DRIVER : ROLES.ATTENDANT],
        staff_type: 'non_teaching',
        designation: dto.designation ?? CREW_DESIGNATIONS[dto.role],
        department: 'Transport',
      } as unknown as CreateStaffDto,
      actor,
    );
    if (Object.keys(crew).length) await this.staff.update(created.id, crew);
    return this.get(schoolId, created.id);
  }

  async update(schoolId: number, id: number, dto: UpdateCrewDto, actor: AuthUser): Promise<CrewDetailDto> {
    const row = await this.find(schoolId, id);
    const role = await this.roleOf(row.user_id);
    const crew = this.crewFields(dto, role);
    this.assertDates({ ...row, ...crew });
    const profile = pick(dto, [...PROFILE_KEYS, 'employee_no', 'status', 'left_on', 'designation']);
    if (Object.keys(profile).length) {
      await this.staffService.update(schoolId, id, profile as UpdateStaffDto, actor);
    }
    const changed = Object.entries(crew).some(
      ([key, value]) => (row as unknown as Record<string, unknown>)[key] !== value,
    );
    if (Object.keys(crew).length) await this.staff.update(id, { ...crew, ...(changed ? CLEARED_APPROVAL : {}) });
    return this.get(schoolId, id);
  }

  async remove(schoolId: number, id: number, actor: AuthUser): Promise<{ id: number }> {
    const row = await this.find(schoolId, id);
    await this.staffService.remove(schoolId, id, actor);
    await this.vehicles.update({ school_id: schoolId, driver_user_id: row.user_id }, { driver_user_id: null });
    await this.vehicles.update({ school_id: schoolId, attendant_user_id: row.user_id }, { attendant_user_id: null });
    return { id };
  }

  async approve(schoolId: number, id: number, actor: AuthUser): Promise<CrewDetailDto> {
    const row = await this.find(schoolId, id);
    if (row.status !== 'active') {
      throw AppException.badRequest('Only active crew can be approved for duty', 'CREW_INACTIVE');
    }
    const checks = await this.checksOf(row);
    const failing = checks.filter((check) => !check.clear);
    if (failing.length) {
      throw AppException.badRequest(
        `Not cleared yet: ${failing.map((check) => `${check.label} (${check.problem?.toLowerCase()})`).join(', ')}`,
        'CREW_NOT_CLEAR',
      );
    }
    await this.staff.update(id, {
      duty_approved_at: new Date(),
      duty_approved_by: actor.id,
      duty_approved_until: earliestExpiry(checks),
    });
    return this.get(schoolId, id);
  }

  async remind(schoolId: number, id: number, actor: AuthUser): Promise<CrewDetailDto> {
    const row = await this.find(schoolId, id);
    const due = dueChecks(await this.checksOf(row));
    if (!due.length) throw AppException.badRequest('Nothing ends in the next 30 days', 'NOTHING_DUE');
    if (this.remindedRecently(row)) {
      throw AppException.tooManyRequests('A reminder was sent less than 6 hours ago', 'REMINDER_TOO_SOON');
    }
    await this.sendReminder(schoolId, row, due, actor);
    return this.get(schoolId, id);
  }

  async remindMany(schoolId: number, dto: RemindManyDto, actor: AuthUser): Promise<RemindResultDto> {
    const rows = (await this.base(schoolId)
      .andWhere('st.id IN (:...ids)', { ids: [...new Set(dto.staff_ids)] })
      .getMany()) as CrewRow[];
    let sent = 0;
    for (const row of rows) {
      const due = dueChecks(await this.checksOf(row));
      if (!due.length || this.remindedRecently(row)) continue;
      await this.sendReminder(schoolId, row, due, actor);
      sent += 1;
    }
    return { sent, skipped: dto.staff_ids.length - sent };
  }

  async addDocument(schoolId: number, id: number, dto: StaffDocumentInputDto): Promise<StaffDocumentDto> {
    await this.find(schoolId, id);
    return this.staffService.addDocument(schoolId, id, dto);
  }

  async verifyDocument(
    schoolId: number,
    id: number,
    documentId: number,
    dto: VerifyDocumentDto,
    actor: AuthUser,
  ): Promise<StaffDocumentDto> {
    await this.find(schoolId, id);
    return this.staffService.verifyDocument(schoolId, id, documentId, dto, actor);
  }

  async removeDocument(schoolId: number, id: number, documentId: number): Promise<{ id: number }> {
    await this.find(schoolId, id);
    return this.staffService.removeDocument(schoolId, id, documentId);
  }

  async dutyOf(schoolId: number, userId: number): Promise<{ name: string; status: DutyStatus }> {
    const row = (await this.staff.findOne({
      where: { school_id: schoolId, user_id: userId },
      relations: { user: true },
    })) as CrewRow | null;
    if (!row) {
      const user = await this.dataSource.getRepository(User).findOneBy({ id: userId });
      return { name: user?.name ?? 'This person', status: 'pending' };
    }
    return { name: row.user.name, status: dutyStatus(row.duty_approved_at, await this.checksOf(row)) };
  }

  async assertOnDuty(schoolId: number, userIds: (number | null)[]): Promise<void> {
    for (const userId of userIds) {
      if (!userId) continue;
      const duty = await this.dutyOf(schoolId, userId);
      if (duty.status !== 'approved') {
        throw AppException.forbidden(
          `${duty.name} is not cleared for duty. Renew their documents and approve them in Drivers and attendants.`,
          'CREW_NOT_APPROVED',
        );
      }
    }
  }

  private base(schoolId: number, status?: string) {
    const qb = this.staff
      .createQueryBuilder('st')
      .innerJoinAndSelect('st.user', 'u')
      .where('st.school_id = :schoolId', { schoolId })
      .andWhere(CREW_ROLE_SQL)
      .setParameter('today', todayIn(this.app.timeZone));
    if (status) qb.andWhere('st.status = :status', { status });
    else qb.andWhere(`st.status <> 'resigned'`);
    return qb;
  }

  private async find(schoolId: number, id: number): Promise<CrewRow> {
    const row = (await this.staff
      .createQueryBuilder('st')
      .innerJoinAndSelect('st.user', 'u')
      .where('st.id = :id AND st.school_id = :schoolId', { id, schoolId })
      .andWhere(CREW_ROLE_SQL)
      .getOne()) as CrewRow | null;
    if (!row) throw AppException.notFound('Driver or attendant not found', 'CREW_NOT_FOUND');
    return row;
  }

  private async roleOf(userId: number): Promise<CrewRole> {
    return (await this.roles([userId])).get(userId) ?? 'attendant';
  }

  private async roles(userIds: number[]): Promise<Map<number, CrewRole>> {
    if (!userIds.length) return new Map();
    const rows: { user_id: number; code: string }[] = await this.dataSource.query(
      `SELECT ur.user_id, r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ANY($1) AND r.code = ANY($2)`,
      [userIds, [ROLES.DRIVER, ROLES.ATTENDANT]],
    );
    const result = new Map<number, CrewRole>();
    for (const row of rows) {
      const userId = Number(row.user_id);
      if (row.code === ROLES.DRIVER || !result.has(userId)) {
        result.set(userId, row.code === ROLES.DRIVER ? 'driver' : 'attendant');
      }
    }
    return result;
  }

  private async checksOf(row: CrewRow): Promise<CrewCheck[]> {
    const [role, documents] = await Promise.all([
      this.roleOf(row.user_id),
      this.documents.find({ where: { staff_id: row.id, type: In(CREW_DOCUMENT_TYPES) } }),
    ]);
    return crewChecks(role, row, documents, todayIn(this.app.timeZone));
  }

  private async present(
    schoolId: number,
    rows: CrewRow[],
  ): Promise<{ summary: CrewListItemDto; checks: CrewCheck[] }[]> {
    if (!rows.length) return [];
    const today = todayIn(this.app.timeZone);
    const [roles, documents, vehicles] = await Promise.all([
      this.roles(rows.map((row) => row.user_id)),
      this.documents.find({
        where: { staff_id: In(rows.map((row) => row.id)), type: In(CREW_DOCUMENT_TYPES) },
      }),
      this.vehicles.findBy({ school_id: schoolId }),
    ]);
    const routes = vehicles.length
      ? await this.routes.find({
          where: { school_id: schoolId, vehicle_id: In(vehicles.map((vehicle) => vehicle.id)) },
          order: { code: 'ASC' },
        })
      : [];
    return rows.map((row) => {
      const role = roles.get(row.user_id) ?? 'attendant';
      const checks = crewChecks(
        role,
        row,
        documents.filter((document) => document.staff_id === row.id),
        today,
      );
      const vehicle = vehicles.find((item) =>
        role === 'driver' ? item.driver_user_id === row.user_id : item.attendant_user_id === row.user_id,
      );
      const route = vehicle ? routes.find((item) => item.vehicle_id === vehicle.id) : undefined;
      return {
        checks,
        summary: {
          id: row.id,
          user_id: row.user_id,
          employee_no: row.employee_no,
          name: row.user.name,
          mobile: row.user.mobile,
          photo_file_id: row.user.photo_file_id,
          photo_url: this.files.linkFor(row.user.photo_file_id),
          role,
          designation: row.designation,
          status: row.status,
          duty_status: dutyStatus(row.duty_approved_at, checks),
          vehicle: vehicle ? { id: vehicle.id, name: vehicle.registration_no } : null,
          route: route ? { id: route.id, name: route.name } : null,
          licence_no: row.licence_no,
          licence_type: row.licence_type,
          expiries: checks.map((check) => check.expiry),
          on_app: Boolean(row.user.last_login_at),
        },
      };
    });
  }

  private async people(ids: (number | null)[]): Promise<Map<number, { id: number; name: string }>> {
    const wanted = [...new Set(ids.filter((id): id is number => Boolean(id)))];
    if (!wanted.length) return new Map();
    const users = await this.dataSource
      .getRepository(User)
      .find({ where: { id: In(wanted) }, withDeleted: true, select: { id: true, name: true } });
    return new Map(users.map((user) => [user.id, { id: user.id, name: user.name }]));
  }

  private crewFields(dto: Partial<CreateCrewDto>, role: CrewRole): CrewFields {
    const fields = pick(dto, CREW_KEYS) as CrewFields;
    if (role === 'attendant') {
      for (const key of DRIVER_ONLY_KEYS) {
        if (key in fields) (fields as Record<string, unknown>)[key] = null;
      }
    }
    return fields;
  }

  private emptyCrew(): Required<CrewFields> {
    return Object.fromEntries(CREW_KEYS.map((key) => [key, null])) as Required<CrewFields>;
  }

  private assertDates(values: Required<CrewFields> | Staff): void {
    const problems = dateProblems(values, todayIn(this.app.timeZone));
    if (problems.length) throw AppException.validation(problems);
  }

  private remindedRecently(row: Staff): boolean {
    return Boolean(row.last_reminded_at && Date.now() - row.last_reminded_at.getTime() < REMINDER_GAP_MS);
  }

  private async sendReminder(schoolId: number, row: CrewRow, due: CrewCheck[], actor: AuthUser): Promise<void> {
    await this.notifications.dispatch({
      template: 'CREW_DOCUMENT_EXPIRY_SELF',
      audience: { user_ids: [row.user_id], school_id: schoolId },
      data: { documents: reminderText(due) },
    });
    await this.staff.update(row.id, { last_reminded_at: new Date(), last_reminded_by: actor.id });
  }
}
