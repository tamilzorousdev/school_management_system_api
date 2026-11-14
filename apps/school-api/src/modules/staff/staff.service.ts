import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Not, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { VerifyDocumentDto } from '../../shared/verification';
import { ROLES } from '../access/access.catalog';
import { AccessService } from '../access/access.service';
import { Role } from '../access/entities/role.entity';
import { UserSession } from '../auth/entities/user-session.entity';
import { FilesService } from '../files/files.service';
import { bankAccountsFrom } from './bank-input';
import { NotificationsService } from '../notifications/notifications.service';
import { School } from '../schools/entities/school.entity';
import { SequencesService } from '../schools/sequences.service';
import { FieldCipher, lastDigits, masked } from '../security/field-cipher';
import { AcademicYear } from '../setup/entities/academic-year.entity';
import { UserDevice } from '../users/entities/user-device.entity';
import { UserRole } from '../users/entities/user-role.entity';
import { User } from '../users/entities/user.entity';
import {
  BankDetailsInputDto,
  CreateStaffDto,
  QualificationsDto,
  SaveStaffBanksDto,
  STAFF_ROLE_CODES,
  StaffDocumentInputDto,
  StaffQueryDto,
  UpdateStaffDto,
} from './dto/staff-input.dto';
import {
  BankDetailsDto,
  BankSummaryDto,
  QualificationDto,
  StaffDetailDto,
  StaffDocumentDto,
  StaffInsightsDto,
  StaffListItemDto,
} from './dto/staff-response.dto';
import { StaffBankAccount } from './entities/staff-bank-account.entity';
import { StaffDocument, StaffDocumentType } from './entities/staff-document.entity';
import { StaffQualification } from './entities/staff-qualification.entity';
import { Staff } from './entities/staff.entity';
import { TeacherAssignment } from './entities/teacher-assignment.entity';
import {
  ATTENTION_SQL,
  attentionReasons,
  averageLoad,
  CLASS_TEACHER_SQL,
  experienceYears,
  OVERLOADED_SQL,
  StaffMetrics,
} from './staff-metrics';
import { yearWhere } from '../../shared/year-context';
import { assertLimitCoversLoad, teacherLoads } from './teacher-load';

const DOCUMENT_TITLES: Record<StaffDocumentType, string> = {
  id_proof: 'ID proof',
  address_proof: 'Address proof',
  degree_certificate: 'Degree certificate',
  experience_letter: 'Experience letter',
  police_verification: 'Police verification',
  medical_fitness: 'Medical fitness certificate',
  photo: 'Photo',
  other: 'Document',
};

type StaffWithUser = Staff & { user: User & { user_roles?: (UserRole & { role?: Role })[] } };

@Injectable()
export class StaffService {
  private readonly logger = new Logger('Staff');

  constructor(
    @InjectRepository(Staff) private readonly staff: Repository<Staff>,
    @InjectRepository(StaffDocument) private readonly documents: Repository<StaffDocument>,
    @InjectRepository(StaffBankAccount) private readonly bankAccounts: Repository<StaffBankAccount>,
    @InjectRepository(AcademicYear) private readonly years: Repository<AcademicYear>,
    private readonly access: AccessService,
    private readonly files: FilesService,
    private readonly sequences: SequencesService,
    private readonly notifications: NotificationsService,
    private readonly cipher: FieldCipher,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async list(schoolId: number, query: StaffQueryDto): Promise<Paginated<StaffListItemDto>> {
    const yearId = await this.currentYearId(schoolId);
    const qb = this.staff
      .createQueryBuilder('st')
      .innerJoinAndSelect('st.user', 'u')
      .leftJoinAndSelect('u.user_roles', 'ur')
      .leftJoinAndSelect('ur.role', 'r')
      .where('st.school_id = :schoolId', { schoolId })
      .setParameter('yearId', yearId);
    if (query.staff_type) qb.andWhere('st.staff_type = :staffType', { staffType: query.staff_type });
    if (query.status) qb.andWhere('st.status = :status', { status: query.status });
    else qb.andWhere(`st.status <> 'resigned'`);
    if (query.department) qb.andWhere('LOWER(st.department) = LOWER(:department)', { department: query.department });
    if (query.role) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM user_roles fur JOIN roles fr ON fr.id = fur.role_id WHERE fur.user_id = u.id AND fr.code = :role)`,
        { role: query.role },
      );
    }
    if (query.class_teacher !== undefined)
      qb.andWhere(query.class_teacher ? CLASS_TEACHER_SQL : `NOT ${CLASS_TEACHER_SQL}`);
    if (query.needs_attention !== undefined)
      qb.andWhere(query.needs_attention ? ATTENTION_SQL : `NOT ${ATTENTION_SQL}`);
    if (query.overloaded !== undefined) qb.andWhere(query.overloaded ? OVERLOADED_SQL : `NOT ${OVERLOADED_SQL}`);

    const ordered = query.sort ? query : { ...query, sort: 'name', order: 'asc' as const };
    const page = await listQuery(qb, ordered, {
      searchable: ['u.name', 'u.mobile', 'st.employee_no', 'st.designation', 'st.department'],
      sortable: {
        name: 'u.name',
        employee_no: 'st.employee_no',
        joining_date: 'st.joining_date',
        designation: 'st.designation',
        created_at: 'st.created_at',
      },
      defaultSort: 'name',
    });
    const rows = page.items as StaffWithUser[];
    const [metrics, classTeacher] = await Promise.all([this.metrics(rows, yearId), this.classTeacherOf(rows, yearId)]);
    const today = todayIn(this.app.timeZone);
    return {
      ...page,
      items: rows.map((row) => this.toListItem(row, metrics.get(row.id)!, classTeacher.get(row.user_id) ?? [], today)),
    };
  }

  async insights(schoolId: number): Promise<StaffInsightsDto> {
    const yearId = await this.currentYearId(schoolId);
    const params = { schoolId, yearId };
    const base = () =>
      this.staff
        .createQueryBuilder('st')
        .where('st.school_id = :schoolId', params)
        .andWhere(`st.status <> 'resigned'`)
        .setParameters(params);
    const teacherLoads: { load: string }[] = await base()
      .select(
        `(SELECT COALESCE(SUM(ta.periods_per_week), 0) FROM teacher_assignments ta
          WHERE ta.teacher_user_id = st.user_id AND ta.academic_year_id = :yearId AND ta.deleted_at IS NULL)`,
        'load',
      )
      .andWhere(`st.staff_type = 'teaching'`)
      .getRawMany();
    const [totalStaff, classTeachers, attention, overloaded] = await Promise.all([
      base().getCount(),
      base().andWhere(CLASS_TEACHER_SQL).getCount(),
      base().andWhere(ATTENTION_SQL).getCount(),
      base().andWhere(OVERLOADED_SQL).getCount(),
    ]);
    return {
      total_teachers: teacherLoads.length,
      average_load: averageLoad(teacherLoads.map((row) => Number(row.load))),
      class_teachers: classTeachers,
      need_attention: attention,
      total_staff: totalStaff,
      overloaded,
    };
  }

  async get(schoolId: number, id: number): Promise<StaffDetailDto> {
    const row = (await this.staff.findOne({
      where: { id, school_id: schoolId },
      relations: { user: { user_roles: { role: true } }, qualifications: true },
    })) as StaffWithUser | null;
    if (!row) throw AppException.notFound('Staff member not found', 'STAFF_NOT_FOUND');
    const yearId = await this.currentYearId(schoolId);
    const [metrics, classTeacher, documents, assignments, bankRows] = await Promise.all([
      this.metrics([row], yearId),
      this.classTeacherOf([row], yearId),
      this.documents.find({ where: { staff_id: id }, order: { created_at: 'DESC' } }),
      this.dataSource.getRepository(TeacherAssignment).find({
        where: { teacher_user_id: row.user_id, academic_year_id: yearId ?? 0 },
        relations: { section: { school_class: true }, subject: true },
      }),
      this.bankAccounts.find({
        where: { staff_id: id, school_id: schoolId },
        order: { is_primary: 'DESC', id: 'ASC' },
      }),
    ]);
    const banksSummary: BankSummaryDto[] = bankRows.map((b) => ({
      id: b.id,
      account_holder: b.account_holder,
      bank_name: b.bank_name,
      ifsc: b.ifsc,
      account_masked: masked(b.account_no_last4),
      pan_masked: masked(b.pan_last4),
      complete: Boolean(b.account_no_last4 && b.ifsc),
      is_primary: b.is_primary,
    }));
    const primaryBank: BankSummaryDto = banksSummary.find((b) => b.is_primary) ??
      banksSummary[0] ?? {
        id: undefined,
        account_holder: row.bank_account_holder,
        bank_name: row.bank_name,
        ifsc: row.bank_ifsc,
        account_masked: masked(row.bank_account_last4),
        pan_masked: masked(row.pan_last4),
        complete: Boolean(row.bank_account_last4 && row.bank_ifsc),
        is_primary: true,
      };
    return {
      ...this.toListItem(row, metrics.get(row.id)!, classTeacher.get(row.user_id) ?? [], todayIn(this.app.timeZone)),
      language: row.user.language,
      gender: row.gender,
      dob: row.dob,
      prior_experience_years: row.prior_experience_years,
      address: row.address,
      emergency_contact_name: row.emergency_contact_name,
      emergency_contact_mobile: row.emergency_contact_mobile,
      left_on: row.left_on,
      qualifications: (row.qualifications ?? [])
        .sort((a, b) => (b.year_completed ?? 0) - (a.year_completed ?? 0))
        .map(({ id: qualificationId, degree, specialization, institution, year_completed }) => ({
          id: qualificationId,
          degree,
          specialization,
          institution,
          year_completed,
        })),
      documents: await this.presentDocuments(documents),
      bank: primaryBank,
      banks: banksSummary,
      assignments: assignments
        .filter((item) => item.section && item.subject)
        .sort(
          (a, b) =>
            (a.section!.school_class?.grade_level ?? 0) - (b.section!.school_class?.grade_level ?? 0) ||
            a.section!.name.localeCompare(b.section!.name) ||
            a.subject!.name.localeCompare(b.subject!.name),
        )
        .map((item) => ({
          id: item.id,
          section: { id: item.section_id, name: `${item.section!.school_class?.name ?? ''} - ${item.section!.name}` },
          subject: { id: item.subject_id, name: item.subject!.name },
          periods_per_week: item.periods_per_week,
        })),
    };
  }

  async getQualificationsByUserId(schoolId: number, userId: number): Promise<QualificationDto[]> {
    const row = await this.staff.findOne({
      where: { user_id: userId, school_id: schoolId },
      relations: { qualifications: true },
    });
    if (!row) throw AppException.notFound('Staff record not found', 'STAFF_NOT_FOUND');
    return (row.qualifications ?? [])
      .sort((a, b) => (b.year_completed ?? 0) - (a.year_completed ?? 0))
      .map(({ id, degree, specialization, institution, year_completed }) => ({
        id,
        degree,
        specialization,
        institution,
        year_completed,
      }));
  }

  async getDocumentsByUserId(schoolId: number, userId: number): Promise<StaffDocumentDto[]> {
    const row = await this.staff.findOne({
      where: { user_id: userId, school_id: schoolId },
    });
    if (!row) throw AppException.notFound('Staff record not found', 'STAFF_NOT_FOUND');
    const documents = await this.documents.find({
      where: { staff_id: row.id },
      order: { created_at: 'DESC' },
    });
    return this.presentDocuments(documents);
  }

  async getDocumentByUserId(schoolId: number, userId: number, documentId: number): Promise<StaffDocumentDto> {
    const row = await this.staff.findOne({
      where: { user_id: userId, school_id: schoolId },
    });
    if (!row) throw AppException.notFound('Staff record not found', 'STAFF_NOT_FOUND');
    const doc = await this.documents.findOne({
      where: { id: documentId, staff_id: row.id },
    });
    if (!doc) throw AppException.notFound('Document not found', 'DOCUMENT_NOT_FOUND');
    return (await this.presentDocuments([doc]))[0];
  }

  async getBankByUserId(schoolId: number, userId: number): Promise<BankDetailsDto> {
    const row = await this.staff
      .createQueryBuilder('st')
      .addSelect(['st.bank_account_enc', 'st.pan_enc'])
      .where('st.user_id = :userId AND st.school_id = :schoolId', { userId, schoolId })
      .getOne();
    if (!row) throw AppException.notFound('Staff record not found', 'STAFF_NOT_FOUND');
    return {
      account_holder: row.bank_account_holder,
      bank_name: row.bank_name,
      ifsc: row.bank_ifsc,
      account_no: row.bank_account_enc ? this.cipher.decrypt(row.bank_account_enc) : null,
      pan: row.pan_enc ? this.cipher.decrypt(row.pan_enc) : null,
    };
  }

  async create(schoolId: number, dto: CreateStaffDto, actor: AuthUser): Promise<StaffDetailDto> {
    this.assertCanGrant(dto.role_codes, actor);
    const roles = await this.access.resolveRoles(dto.role_codes, actor.roles);
    const { staffId, invite } = await this.dataSource.transaction(async (manager) => {
      let user = await manager.findOneBy(User, { mobile: dto.mobile, deleted_at: IsNull() });
      if (user && user.school_id !== null && user.school_id !== schoolId) {
        throw AppException.conflict('This mobile number belongs to a user in another school', 'MOBILE_TAKEN');
      }
      if (user && (await manager.exists(Staff, { where: { user_id: user.id } }))) {
        throw AppException.conflict('This person is already on the staff list', 'STAFF_EXISTS');
      }
      let invited = false;
      if (!user) {
        user = await manager.save(
          manager.create(User, {
            school_id: schoolId,
            name: dto.name,
            mobile: dto.mobile,
            email: dto.email ?? null,
            status: 'active',
            language: dto.language ?? 'en',
            photo_file_id: dto.photo_file_id ?? null,
          }),
        );
        invited = true;
      } else {
        await manager.update(User, user.id, {
          name: dto.name,
          school_id: schoolId,
          status: 'active',
          ...(dto.email !== undefined ? { email: dto.email } : {}),
          ...(dto.language ? { language: dto.language } : {}),
          ...(dto.photo_file_id !== undefined ? { photo_file_id: dto.photo_file_id } : {}),
        });
      }
      const existing = await manager.findBy(UserRole, { user_id: user.id });
      const fresh = roles.filter((role) => !existing.some((item) => item.role_id === role.id));
      if (fresh.length) {
        await manager.insert(
          UserRole,
          fresh.map((role) => ({ user_id: user!.id, role_id: role.id })),
        );
        invited = true;
      }

      const employeeNo = dto.employee_no ?? (await this.nextEmployeeNo(manager, schoolId));
      if (await manager.exists(Staff, { where: { school_id: schoolId, employee_no: employeeNo } })) {
        throw AppException.conflict(`Employee number ${employeeNo} is already used`, 'EMPLOYEE_NO_TAKEN');
      }
      const saved = await manager.save(
        manager.create(Staff, {
          school_id: schoolId,
          user_id: user.id,
          employee_no: employeeNo,
          staff_type: dto.staff_type,
          designation: dto.designation,
          department: dto.department ?? null,
          gender: dto.gender ?? null,
          dob: dto.dob ?? null,
          joining_date: dto.joining_date ?? todayIn(this.app.timeZone),
          prior_experience_years: dto.prior_experience_years ?? 0,
          max_periods_per_week: dto.max_periods_per_week ?? 30,
          address: dto.address ?? null,
          emergency_contact_name: dto.emergency_contact_name ?? null,
          emergency_contact_mobile: dto.emergency_contact_mobile ?? null,
          status: 'active',
        }),
      );
      if (dto.qualifications?.length) {
        await manager.insert(
          StaffQualification,
          dto.qualifications.map((item) => ({ ...item, staff_id: saved.id })),
        );
      }
      return { staffId: saved.id, invite: invited && dto.send_invite !== false ? user.id : null };
    });
    if (invite) await this.sendInvite(schoolId, invite);
    return this.get(schoolId, staffId);
  }

  async update(schoolId: number, id: number, dto: UpdateStaffDto, actor: AuthUser): Promise<StaffDetailDto> {
    const row = await this.find(schoolId, id);
    if (dto.role_codes) this.assertCanGrant(dto.role_codes, actor);
    const roles = dto.role_codes ? await this.access.resolveRoles(dto.role_codes, actor.roles) : null;
    await this.dataSource.transaction(async (manager) => {
      if (dto.max_periods_per_week !== undefined && dto.max_periods_per_week < row.max_periods_per_week) {
        const yearId = await this.currentYearId(schoolId);
        if (yearId) {
          const loads = await teacherLoads(manager, schoolId, yearId, [row.user_id]);
          assertLimitCoversLoad(loads.get(row.user_id), dto.max_periods_per_week);
        }
      }
      const user = await manager.findOneByOrFail(User, { id: row.user_id });
      if (dto.mobile && dto.mobile !== user.mobile) {
        if (await manager.exists(User, { where: { mobile: dto.mobile, id: Not(user.id), deleted_at: IsNull() } })) {
          throw AppException.conflict('A user with this mobile number already exists', 'MOBILE_TAKEN');
        }
      }
      if (dto.employee_no && dto.employee_no !== row.employee_no) {
        if (
          await manager.exists(Staff, { where: { school_id: schoolId, employee_no: dto.employee_no, id: Not(id) } })
        ) {
          throw AppException.conflict(`Employee number ${dto.employee_no} is already used`, 'EMPLOYEE_NO_TAKEN');
        }
      }
      const userFields = {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.mobile ? { mobile: dto.mobile } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.language ? { language: dto.language } : {}),
        ...(dto.status ? { status: dto.status === 'resigned' ? ('inactive' as const) : ('active' as const) } : {}),
        ...(dto.photo_file_id !== undefined ? { photo_file_id: dto.photo_file_id } : {}),
      };
      if (Object.keys(userFields).length) await manager.update(User, user.id, userFields);
      if ((dto.mobile && dto.mobile !== user.mobile) || dto.status === 'resigned') {
        await manager.update(UserSession, { user_id: user.id, revoked_at: IsNull() }, { revoked_at: new Date() });
        await manager.delete(UserDevice, { user_id: user.id });
      }
      if (roles) await this.replaceStaffRoles(manager, user.id, roles);

      const userKeys = ['name', 'mobile', 'email', 'language', 'role_codes', 'photo_file_id'];
      const staffFields: Partial<Staff> = Object.fromEntries(
        Object.entries(dto).filter(([key]) => !userKeys.includes(key)),
      );
      if (dto.status === 'resigned' && !dto.left_on && !row.left_on) {
        Object.assign(staffFields, { left_on: todayIn(this.app.timeZone) });
      }
      if (dto.status && dto.status !== 'resigned') Object.assign(staffFields, { left_on: null });
      if (Object.keys(staffFields).length) await manager.update(Staff, id, staffFields);
    });
    return this.get(schoolId, id);
  }

  async remove(schoolId: number, id: number, actor: AuthUser): Promise<{ id: number }> {
    const row = await this.find(schoolId, id);
    if (row.user_id === actor.id) throw AppException.badRequest('You cannot remove yourself from the staff list');
    const yearId = await this.currentYearId(schoolId);
    const busy =
      (await this.dataSource.getRepository(TeacherAssignment).existsBy({ teacher_user_id: row.user_id })) ||
      (
        await this.dataSource.query(
          `SELECT 1 FROM sections WHERE class_teacher_user_id = $1 AND academic_year_id = $2 AND deleted_at IS NULL LIMIT 1`,
          [row.user_id, yearId ?? 0],
        )
      ).length > 0;
    if (busy) {
      throw AppException.conflict(
        'This teacher has classes. Mark them as resigned, or remove their classes first.',
        'STAFF_HAS_CLASSES',
      );
    }
    await this.dataSource.transaction(async (manager) => {
      await this.replaceStaffRoles(manager, row.user_id, []);
      const remaining = await manager.countBy(UserRole, { user_id: row.user_id });
      if (!remaining) {
        await manager.update(User, row.user_id, { status: 'inactive' });
        await manager.update(UserSession, { user_id: row.user_id, revoked_at: IsNull() }, { revoked_at: new Date() });
        await manager.delete(UserDevice, { user_id: row.user_id });
      }
      await manager.softDelete(Staff, id);
    });
    return { id };
  }

  async setQualifications(schoolId: number, id: number, dto: QualificationsDto): Promise<StaffDetailDto> {
    await this.find(schoolId, id);
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(StaffQualification, { staff_id: id });
      if (dto.items.length) {
        await manager.insert(
          StaffQualification,
          dto.items.map((item) => ({ ...item, staff_id: id })),
        );
      }
    });
    return this.get(schoolId, id);
  }

  async addDocument(schoolId: number, id: number, dto: StaffDocumentInputDto): Promise<StaffDocumentDto> {
    await this.find(schoolId, id);
    await this.files.assertAttachable(dto.file_id, schoolId);
    const saved = await this.documents.save(
      this.documents.create({
        school_id: schoolId,
        staff_id: id,
        type: dto.type,
        title: dto.title ?? DOCUMENT_TITLES[dto.type],
        file_id: dto.file_id,
        status: 'pending',
      }),
    );
    return (await this.presentDocuments([saved]))[0];
  }

  async verifyDocument(
    schoolId: number,
    id: number,
    documentId: number,
    dto: VerifyDocumentDto,
    actor: AuthUser,
  ): Promise<StaffDocumentDto> {
    const document = await this.documents.findOneBy({ id: documentId, staff_id: id, school_id: schoolId });
    if (!document) throw AppException.notFound('Document not found', 'DOCUMENT_NOT_FOUND');
    Object.assign(document, {
      status: dto.status,
      remarks: dto.remarks ?? null,
      verified_by: actor.id,
      verified_at: new Date(),
    });
    return (await this.presentDocuments([await this.documents.save(document)]))[0];
  }

  async removeDocument(schoolId: number, id: number, documentId: number): Promise<{ id: number }> {
    const document = await this.documents.findOneBy({ id: documentId, staff_id: id, school_id: schoolId });
    if (!document) throw AppException.notFound('Document not found', 'DOCUMENT_NOT_FOUND');
    await this.documents.softDelete(documentId);
    return { id: documentId };
  }

  async bank(schoolId: number, id: number): Promise<BankDetailsDto[]> {
    await this.find(schoolId, id);
    const rows = await this.bankAccounts
      .createQueryBuilder('ba')
      .addSelect(['ba.account_no_enc', 'ba.pan_enc'])
      .where('ba.staff_id = :id AND ba.school_id = :schoolId', { id, schoolId })
      .orderBy('ba.is_primary', 'DESC')
      .addOrderBy('ba.id', 'ASC')
      .getMany();
    if (!rows.length) {
      const row = await this.staff
        .createQueryBuilder('st')
        .addSelect(['st.bank_account_enc', 'st.pan_enc'])
        .where('st.id = :id', { id })
        .getOneOrFail();
      if (!row.bank_account_holder && !row.bank_name && !row.bank_ifsc) {
        return [];
      }
      return [
        {
          account_holder: row.bank_account_holder,
          bank_name: row.bank_name,
          ifsc: row.bank_ifsc,
          account_no: row.bank_account_enc ? this.cipher.decrypt(row.bank_account_enc) : null,
          pan: row.pan_enc ? this.cipher.decrypt(row.pan_enc) : null,
          account_masked: masked(row.bank_account_last4),
          pan_masked: masked(row.pan_last4),
          is_primary: true,
        },
      ];
    }
    return rows.map((b) => ({
      id: b.id,
      account_holder: b.account_holder,
      bank_name: b.bank_name,
      ifsc: b.ifsc,
      account_no: b.account_no_enc ? this.cipher.decrypt(b.account_no_enc) : null,
      pan: b.pan_enc ? this.cipher.decrypt(b.pan_enc) : null,
      account_masked: masked(b.account_no_last4),
      pan_masked: masked(b.pan_last4),
      is_primary: b.is_primary,
    }));
  }

  async saveBank(
    schoolId: number,
    id: number,
    payload: SaveStaffBanksDto | BankDetailsInputDto[] | BankDetailsInputDto,
  ): Promise<StaffDetailDto> {
    await this.find(schoolId, id);
    const accounts = bankAccountsFrom(payload);
    let primaryIndex = accounts.findIndex((a) => a.is_primary);
    if (primaryIndex < 0) primaryIndex = 0;

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(StaffBankAccount, { staff_id: id, school_id: schoolId });
      const entities: StaffBankAccount[] = [];
      for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        const isPrimary = i === primaryIndex;
        const bankAcc = manager.create(StaffBankAccount, {
          school_id: schoolId,
          staff_id: id,
          account_holder: acc.account_holder,
          bank_name: acc.bank_name,
          ifsc: acc.ifsc,
          account_no_enc: this.cipher.encrypt(acc.account_no),
          account_no_last4: lastDigits(acc.account_no),
          pan_enc: acc.pan ? this.cipher.encrypt(acc.pan) : null,
          pan_last4: acc.pan ? lastDigits(acc.pan) : null,
          is_primary: isPrimary,
        });
        entities.push(bankAcc);
      }
      await manager.save(StaffBankAccount, entities);

      const primary = accounts[primaryIndex];
      await manager.update(Staff, id, {
        bank_account_holder: primary.account_holder,
        bank_name: primary.bank_name,
        bank_ifsc: primary.ifsc,
        bank_account_enc: this.cipher.encrypt(primary.account_no),
        bank_account_last4: lastDigits(primary.account_no),
        pan_enc: primary.pan ? this.cipher.encrypt(primary.pan) : null,
        pan_last4: primary.pan ? lastDigits(primary.pan) : null,
      });
    });
    return this.get(schoolId, id);
  }

  async setPrimaryBank(schoolId: number, staffId: number, bankId: number): Promise<StaffDetailDto> {
    await this.find(schoolId, staffId);
    const target = await this.bankAccounts
      .createQueryBuilder('ba')
      .addSelect(['ba.account_no_enc', 'ba.pan_enc'])
      .where('ba.id = :bankId AND ba.staff_id = :staffId AND ba.school_id = :schoolId', {
        bankId,
        staffId,
        schoolId,
      })
      .getOne();
    if (!target) throw AppException.notFound('Bank account not found', 'BANK_ACCOUNT_NOT_FOUND');

    await this.dataSource.transaction(async (manager) => {
      await manager.update(StaffBankAccount, { staff_id: staffId, school_id: schoolId }, { is_primary: false });
      await manager.update(StaffBankAccount, { id: bankId }, { is_primary: true });
      await manager.update(Staff, staffId, {
        bank_account_holder: target.account_holder,
        bank_name: target.bank_name,
        bank_ifsc: target.ifsc,
        bank_account_enc: target.account_no_enc,
        bank_account_last4: target.account_no_last4,
        pan_enc: target.pan_enc,
        pan_last4: target.pan_last4,
      });
    });
    return this.get(schoolId, staffId);
  }

  async deleteBankAccount(schoolId: number, staffId: number, bankId: number): Promise<StaffDetailDto> {
    await this.find(schoolId, staffId);
    const account = await this.bankAccounts.findOneBy({ id: bankId, staff_id: staffId, school_id: schoolId });
    if (!account) throw AppException.notFound('Bank account not found', 'BANK_ACCOUNT_NOT_FOUND');

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(StaffBankAccount, { id: bankId });
      const remaining = await manager
        .createQueryBuilder(StaffBankAccount, 'ba')
        .addSelect(['ba.account_no_enc', 'ba.pan_enc'])
        .where('ba.staff_id = :staffId AND ba.school_id = :schoolId', { staffId, schoolId })
        .orderBy('ba.is_primary', 'DESC')
        .addOrderBy('ba.id', 'ASC')
        .getMany();

      if (!remaining.length) {
        await manager.update(Staff, staffId, {
          bank_account_holder: null,
          bank_name: null,
          bank_ifsc: null,
          bank_account_enc: null,
          bank_account_last4: null,
          pan_enc: null,
          pan_last4: null,
        });
      } else {
        let primary = remaining.find((r) => r.is_primary);
        if (!primary) {
          primary = remaining[0];
          await manager.update(StaffBankAccount, { id: primary.id }, { is_primary: true });
        }
        await manager.update(Staff, staffId, {
          bank_account_holder: primary.account_holder,
          bank_name: primary.bank_name,
          bank_ifsc: primary.ifsc,
          bank_account_enc: primary.account_no_enc,
          bank_account_last4: primary.account_no_last4,
          pan_enc: primary.pan_enc,
          pan_last4: primary.pan_last4,
        });
      }
    });
    return this.get(schoolId, staffId);
  }

  async currentYearId(schoolId: number): Promise<number | null> {
    return (await this.years.findOneBy(yearWhere(schoolId)))?.id ?? null;
  }

  private assertCanGrant(codes: string[], actor: AuthUser): void {
    const admin = actor.roles.includes(ROLES.ADMIN) || actor.roles.includes(ROLES.SUPER_ADMIN);
    if (codes.includes(ROLES.ADMIN) && !admin) {
      throw AppException.forbidden('Only a school admin can give the school admin role');
    }
  }

  private async replaceStaffRoles(manager: EntityManager, userId: number, roles: Role[]): Promise<void> {
    const staffRoles = await manager.findBy(Role, { code: In([...STAFF_ROLE_CODES]) });
    await manager.delete(UserRole, { user_id: userId, role_id: In(staffRoles.map((role) => role.id)) });
    if (roles.length) {
      await manager.insert(
        UserRole,
        roles.map((role) => ({ user_id: userId, role_id: role.id })),
      );
    }
  }

  private async sendInvite(schoolId: number, userId: number): Promise<void> {
    const school = await this.dataSource.getRepository(School).findOneBy({ id: schoolId });
    await this.notifications
      .dispatch({
        template: 'ACCOUNT_INVITE',
        audience: { user_ids: [userId] },
        data: { school: school?.name ?? 'your school', app: 'Staff app' },
      })
      .catch((error: Error) => this.logger.warn(`Invite for user ${userId} not sent: ${error.message}`));
  }

  private async nextEmployeeNo(manager: EntityManager, schoolId: number): Promise<string> {
    const school = await manager.findOneByOrFail(School, { id: schoolId });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const value = await this.sequences.next(manager, schoolId, 'employee');
      const candidate = `${school.code}-EMP-${String(value).padStart(4, '0')}`;
      if (!(await manager.exists(Staff, { where: { school_id: schoolId, employee_no: candidate } }))) return candidate;
    }
    throw AppException.conflict('Could not generate an employee number. Enter one manually.', 'EMPLOYEE_NO_EXHAUSTED');
  }

  private async find(schoolId: number, id: number): Promise<Staff> {
    const row = await this.staff.findOneBy({ id, school_id: schoolId });
    if (!row) throw AppException.notFound('Staff member not found', 'STAFF_NOT_FOUND');
    return row;
  }

  private async metrics(rows: Staff[], yearId: number | null): Promise<Map<number, StaffMetrics>> {
    const result = new Map<number, StaffMetrics>(
      rows.map((row) => [row.id, { load: 0, sections: 0, documents: 0, pending: 0, rejected: 0 }]),
    );
    if (!rows.length) return result;
    const byUser = new Map(rows.map((row) => [row.user_id, row.id]));
    const [loads, documents] = await Promise.all([
      this.dataSource.query(
        `SELECT teacher_user_id, COALESCE(SUM(periods_per_week), 0) AS load, COUNT(DISTINCT section_id) AS sections
         FROM teacher_assignments WHERE teacher_user_id = ANY($1) AND academic_year_id = $2 AND deleted_at IS NULL
         GROUP BY teacher_user_id`,
        [[...byUser.keys()], yearId ?? 0],
      ) as Promise<{ teacher_user_id: number; load: string; sections: string }[]>,
      this.dataSource.query(
        `SELECT staff_id, COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'pending') AS pending,
                COUNT(*) FILTER (WHERE status = 'rejected') AS rejected
         FROM staff_documents WHERE staff_id = ANY($1) AND deleted_at IS NULL GROUP BY staff_id`,
        [rows.map((row) => row.id)],
      ) as Promise<{ staff_id: number; total: string; pending: string; rejected: string }[]>,
    ]);
    for (const row of loads) {
      const metrics = result.get(byUser.get(Number(row.teacher_user_id))!)!;
      metrics.load = Number(row.load);
      metrics.sections = Number(row.sections);
    }
    for (const row of documents) {
      const metrics = result.get(Number(row.staff_id))!;
      metrics.documents = Number(row.total);
      metrics.pending = Number(row.pending);
      metrics.rejected = Number(row.rejected);
    }
    return result;
  }

  private async classTeacherOf(
    rows: Staff[],
    yearId: number | null,
  ): Promise<Map<number, { id: number; name: string }[]>> {
    const result = new Map<number, { id: number; name: string }[]>();
    if (!rows.length || !yearId) return result;
    const sections: { id: number; class_teacher_user_id: number; class_name: string; name: string }[] =
      await this.dataSource.query(
        `SELECT sec.id, sec.class_teacher_user_id, c.name AS class_name, sec.name FROM sections sec
         JOIN classes c ON c.id = sec.class_id
         WHERE sec.class_teacher_user_id = ANY($1) AND sec.academic_year_id = $2 AND sec.deleted_at IS NULL
         ORDER BY c.grade_level, sec.name`,
        [rows.map((row) => row.user_id), yearId],
      );
    for (const section of sections) {
      const key = Number(section.class_teacher_user_id);
      result.set(key, [
        ...(result.get(key) ?? []),
        { id: Number(section.id), name: `${section.class_name} - ${section.name}` },
      ]);
    }
    return result;
  }

  private toListItem(
    row: StaffWithUser,
    metrics: StaffMetrics,
    classTeacherOf: { id: number; name: string }[],
    today: string,
  ): StaffListItemDto {
    const roles = (row.user.user_roles ?? [])
      .filter((item) => item.role)
      .sort((a, b) => a.role!.sort_order - b.role!.sort_order)
      .map((item) => ({ code: item.role!.code, name: item.role!.name }));
    return {
      id: row.id,
      user_id: row.user_id,
      employee_no: row.employee_no,
      name: row.user.name,
      mobile: row.user.mobile,
      email: row.user.email,
      photo_file_id: row.user.photo_file_id,
      photo_url: this.files.linkFor(row.user.photo_file_id),
      roles,
      staff_type: row.staff_type,
      designation: row.designation,
      department: row.department,
      status: row.status,
      joining_date: row.joining_date,
      experience_years: experienceYears(row.joining_date, row.prior_experience_years, today),
      load_periods: metrics.load,
      max_periods_per_week: row.max_periods_per_week,
      sections_count: metrics.sections,
      class_teacher_of: classTeacherOf,
      attention: attentionReasons(row, metrics),
      on_app: Boolean(row.user.last_login_at),
    };
  }

  private async presentDocuments(rows: StaffDocument[]): Promise<StaffDocumentDto[]> {
    const ids = [...new Set(rows.map((row) => row.verified_by).filter((id): id is number => Boolean(id)))];
    const [files, people] = await Promise.all([
      this.files.presentMany(rows.map((row) => row.file_id)),
      ids.length
        ? this.dataSource
            .getRepository(User)
            .find({ where: { id: In(ids) }, withDeleted: true, select: { id: true, name: true } })
        : Promise.resolve([] as User[]),
    ]);
    const names = new Map(people.map((person) => [person.id, { id: person.id, name: person.name }]));
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      status: row.status,
      remarks: row.remarks,
      verified_by: row.verified_by ? (names.get(row.verified_by) ?? null) : null,
      verified_at: row.verified_at,
      file: files.get(row.file_id) ?? null,
      created_at: row.created_at,
    }));
  }
  async updateSignature(
    schoolId: number,
    userId: number,
    fileId: number | null,
  ): Promise<{ signature_file_id: number | null; signature_url: string | null }> {
    if (fileId !== null && fileId !== undefined) {
      await this.files.assertAttachable(fileId, schoolId, 'signature_file_id');
    }
    const staff = await this.staff.findOneBy({ user_id: userId, school_id: schoolId });
    if (!staff) throw AppException.notFound('Staff record not found', 'STAFF_NOT_FOUND');
    staff.signature_file_id = fileId ?? null;
    await this.staff.save(staff);
    await this.dataSource.getRepository(User).update(userId, { signature_file_id: fileId ?? null });
    return {
      signature_file_id: staff.signature_file_id,
      signature_url: this.files.linkFor(staff.signature_file_id),
    };
  }
}
