import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { IdCardLayout, normalizeIdCardLayout, parseIdCardLayout } from '../../shared/id-card-layout';
import { ROLES } from '../access/access.catalog';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { CreateSchoolDto, SchoolDto, SchoolQueryDto, UpdateCurrentSchoolDto, UpdateSchoolDto } from './dto/school.dto';
import { School } from './entities/school.entity';

@Injectable()
export class SchoolsService {
  constructor(
    @InjectRepository(School) private readonly schools: Repository<School>,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
    private readonly files: FilesService,
    private readonly dataSource: DataSource,
  ) {}

  async list(query: SchoolQueryDto): Promise<Paginated<SchoolDto>> {
    const qb = this.schools.createQueryBuilder('school');
    if (query.is_active !== undefined) qb.andWhere('school.is_active = :active', { active: query.is_active });
    const page = await listQuery(qb, query, {
      searchable: ['school.name', 'school.code', 'school.city'],
      sortable: { created_at: 'school.created_at', name: 'school.name', code: 'school.code' },
      defaultSort: 'name',
    });
    const counts = await this.counts(page.items.map((school) => school.id));
    return { ...page, items: page.items.map((school) => this.present(school, counts)) };
  }

  async get(id: number): Promise<SchoolDto> {
    const school = await this.find(id);
    return this.present(school, await this.counts([id]));
  }

  async create(dto: CreateSchoolDto, actor: AuthUser): Promise<SchoolDto> {
    if (dto.admin_name && !dto.admin_mobile)
      throw AppException.badRequest('Enter the admin mobile number', 'ADMIN_MOBILE_REQUIRED');
    if (dto.admin_mobile && !dto.admin_name)
      throw AppException.badRequest('Enter the admin name', 'ADMIN_NAME_REQUIRED');
    if (await this.schools.findOneBy({ code: dto.code, deleted_at: IsNull() })) {
      throw AppException.conflict(`School code ${dto.code} is already used`, 'SCHOOL_CODE_TAKEN');
    }
    if (dto.admin_mobile && (await this.users.findActiveByMobile(dto.admin_mobile))) {
      throw AppException.conflict('A user with this mobile number already exists', 'MOBILE_TAKEN');
    }

    const { admin_name: adminName, admin_mobile: adminMobile, ...profile } = dto;
    await this.assertLogo(0, profile.logo_file_id);
    await this.assertSignature(0, profile.signature_file_id);
    const school = await this.schools.save(this.schools.create({ ...profile, timezone: 'Asia/Kolkata' }));
    if (adminName && adminMobile) {
      const admin = await this.users.create(
        { name: adminName, mobile: adminMobile, role_codes: [ROLES.ADMIN], school_id: school.id },
        actor,
      );
      await this.notifications.dispatch({
        template: 'ACCOUNT_INVITE',
        audience: { user_ids: [admin.id] },
        data: { school: school.name, app: 'admin console' },
      });
    }
    return this.get(school.id);
  }

  async update(id: number, dto: UpdateSchoolDto): Promise<SchoolDto> {
    const school = await this.find(id);
    if (
      dto.code &&
      dto.code !== school.code &&
      (await this.schools.findOneBy({ code: dto.code, deleted_at: IsNull() }))
    ) {
      throw AppException.conflict(`School code ${dto.code} is already used`, 'SCHOOL_CODE_TAKEN');
    }
    await this.assertLogo(id, dto.logo_file_id);
    await this.assertSignature(id, dto.signature_file_id);
    await this.assertSeal(id, dto.seal_file_id);
    this.assertOfficeHours(school, dto);
    await this.assertIdCardDesign(id, school, dto);
    await this.schools.update(id, this.withIdCardLayout(dto));
    return this.get(id);
  }

  async updateCurrent(id: number, dto: UpdateCurrentSchoolDto): Promise<SchoolDto> {
    const school = await this.find(id);
    await this.assertLogo(id, dto.logo_file_id);
    await this.assertSignature(id, dto.signature_file_id);
    await this.assertSeal(id, dto.seal_file_id);
    this.assertOfficeHours(school, dto);
    await this.assertIdCardDesign(id, school, dto);
    await this.schools.update(id, this.withIdCardLayout(dto));
    return this.get(id);
  }

  private withIdCardLayout<T extends { id_card_layout?: Record<string, unknown> | null }>(
    dto: T,
  ): Omit<T, 'id_card_layout'> & { id_card_layout?: IdCardLayout | null } {
    const { id_card_layout, ...rest } = dto;
    if (id_card_layout === undefined) return rest;
    return { ...rest, id_card_layout: id_card_layout === null ? null : normalizeIdCardLayout(id_card_layout) };
  }

  async find(id: number): Promise<School> {
    const school = await this.schools.findOneBy({ id });
    if (!school) throw AppException.notFound('School not found', 'SCHOOL_NOT_FOUND');
    return school;
  }

  private assertOfficeHours(school: School, dto: { chat_office_start?: string; chat_office_end?: string }): void {
    const start = dto.chat_office_start ?? school.chat_office_start;
    const end = dto.chat_office_end ?? school.chat_office_end;
    if (end <= start) {
      throw AppException.validation([{ field: 'chat_office_end', message: 'Office hours must end after they start' }]);
    }
  }

  private async assertLogo(schoolId: number, fileId: number | null | undefined): Promise<void> {
    if (!fileId) return;
    const file = await this.files.assertAttachable(fileId, schoolId, 'logo_file_id');
    if (!file.mime_type.startsWith('image/')) {
      throw AppException.validation([{ field: 'logo_file_id', message: 'The logo must be an image (PNG or JPG)' }]);
    }
  }

  private async assertSignature(schoolId: number, fileId: number | null | undefined): Promise<void> {
    if (!fileId) return;
    const file = await this.files.assertAttachable(fileId, schoolId, 'signature_file_id');
    if (!file.mime_type.startsWith('image/')) {
      throw AppException.validation([
        { field: 'signature_file_id', message: 'The signature must be an image (PNG or JPG)' },
      ]);
    }
  }

  private async assertIdCardDesign(
    schoolId: number,
    school: School,
    dto: {
      id_card_design?: string | null;
      id_card_front_file_id?: number | null;
      id_card_back_file_id?: number | null;
    },
  ): Promise<void> {
    for (const field of ['id_card_front_file_id', 'id_card_back_file_id'] as const) {
      const fileId = dto[field];
      if (!fileId) continue;
      const file = await this.files.assertAttachable(fileId, schoolId, field);
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mime_type)) {
        throw AppException.validation([{ field, message: 'The ID card design must be a PNG or JPG image' }]);
      }
    }
    if (dto.id_card_design === undefined && dto.id_card_front_file_id === undefined) return;
    const design = dto.id_card_design === undefined ? school.id_card_design : dto.id_card_design;
    const front = dto.id_card_front_file_id === undefined ? school.id_card_front_file_id : dto.id_card_front_file_id;
    if (design === 'custom' && !front) {
      throw AppException.validation([
        { field: 'id_card_front_file_id', message: 'Upload the front side of the ID card design first' },
      ]);
    }
  }

  private async assertSeal(schoolId: number, fileId: number | null | undefined): Promise<void> {
    if (!fileId) return;
    const file = await this.files.assertAttachable(fileId, schoolId, 'seal_file_id');
    if (!file.mime_type.startsWith('image/')) {
      throw AppException.validation([{ field: 'seal_file_id', message: 'The seal must be an image (PNG or JPG)' }]);
    }
  }

  private async counts(ids: number[]): Promise<Map<number, { students: number; users: number }>> {
    const result = new Map(ids.map((id) => [id, { students: 0, users: 0 }]));
    if (!ids.length) return result;
    const rows: { school_id: number; students: string; users: string }[] = await this.dataSource.query(
      `SELECT s.id AS school_id,
              (SELECT COUNT(*) FROM students st WHERE st.school_id = s.id AND st.deleted_at IS NULL AND st.status = 'active') AS students,
              (SELECT COUNT(*) FROM users u WHERE u.school_id = s.id AND u.deleted_at IS NULL) AS users
       FROM schools s WHERE s.id = ANY($1)`,
      [ids],
    );
    rows.forEach((row) =>
      result.set(Number(row.school_id), { students: Number(row.students), users: Number(row.users) }),
    );
    return result;
  }

  private present(school: School, counts: Map<number, { students: number; users: number }>): SchoolDto {
    const count = counts.get(school.id) ?? { students: 0, users: 0 };
    return {
      id: school.id,
      name: school.name,
      code: school.code,
      board: school.board,
      address: school.address,
      city: school.city,
      state: school.state,
      pincode: school.pincode,
      phone: school.phone,
      emergency_phone: school.emergency_phone,
      email: school.email,
      latitude: school.latitude,
      longitude: school.longitude,
      geofence_radius_m: school.geofence_radius_m,
      staff_reporting_time: school.staff_reporting_time,
      diary_review_mode: school.diary_review_mode,
      attendance_grace_minutes: school.attendance_grace_minutes,
      attendance_mode: school.attendance_mode,
      chat_office_start: school.chat_office_start,
      chat_office_end: school.chat_office_end,
      chat_delete_window: school.chat_delete_window ?? '24_hours',
      timezone: school.timezone,
      logo_file_id: school.logo_file_id,
      logo_url: this.files.linkFor(school.logo_file_id),
      signature_file_id: school.signature_file_id,
      signature_url: this.files.linkFor(school.signature_file_id),
      seal_file_id: school.seal_file_id,
      seal_url: this.files.linkFor(school.seal_file_id),
      id_card_design: school.id_card_design ?? 'design2',
      id_card_front_file_id: school.id_card_front_file_id,
      id_card_front_url: this.files.linkFor(school.id_card_front_file_id),
      id_card_back_file_id: school.id_card_back_file_id,
      id_card_back_url: this.files.linkFor(school.id_card_back_file_id),
      id_card_layout: parseIdCardLayout(school.id_card_layout),
      is_active: school.is_active,
      student_count: count.students,
      user_count: count.users,
      created_at: school.created_at,
    };
  }
}
