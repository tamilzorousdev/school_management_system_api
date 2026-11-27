import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { FilesService } from '../files/files.service';
import { User } from '../users/entities/user.entity';
import { QualificationInputDto, StaffDocumentInputDto } from './dto/staff-input.dto';
import { QualificationDto, StaffDocumentDto } from './dto/staff-response.dto';
import { MyBankListDto, MyStaffProfileDto, UpdateMyStaffProfileDto } from './dto/my-staff.dto';
import { StaffDocument } from './entities/staff-document.entity';
import { StaffQualification } from './entities/staff-qualification.entity';
import { Staff } from './entities/staff.entity';
import { StaffService } from './staff.service';

import { identityOf } from '../../shared/identity';

const EDITABLE = ['photo', 'email', 'language', 'address', 'emergency_contact_name', 'emergency_contact_mobile'];

const defined = <T extends object>(values: T): Partial<T> =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;

@Injectable()
export class MyStaffService {
  private readonly logger = new Logger('MyStaff');

  constructor(
    @InjectRepository(Staff) private readonly staffRepo: Repository<Staff>,
    @InjectRepository(StaffQualification) private readonly qualifications: Repository<StaffQualification>,
    @InjectRepository(StaffDocument) private readonly documents: Repository<StaffDocument>,
    private readonly staff: StaffService,
    private readonly files: FilesService,
    private readonly dataSource: DataSource,
  ) {}

  async profile(actor: AuthUser): Promise<MyStaffProfileDto> {
    const row = await this.mine(actor);
    const user = await this.dataSource.getRepository(User).findOneByOrFail({ id: actor.id });
    const photo = user.photo_file_id
      ? (await this.files.presentMany([user.photo_file_id])).get(user.photo_file_id)
      : null;
    const roles: { name: string }[] = await this.dataSource.query(
      `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.sort_order`,
      [actor.id],
    );
    return {
      user_id: user.id,
      name: user.name,
      mobile: user.mobile,
      email: user.email,
      language: user.language,
      photo_file_id: user.photo_file_id,
      photo_url: photo?.thumbnail_url ?? photo?.url ?? null,
      employee_no: row.employee_no,
      staff_type: row.staff_type,
      designation: row.designation,
      department: row.department,
      gender: row.gender,
      dob: row.dob,
      joining_date: row.joining_date,
      address: row.address,
      emergency_contact_name: row.emergency_contact_name,
      emergency_contact_mobile: row.emergency_contact_mobile,
      ...identityOf(row),
      roles: roles.map((role) => role.name),
      editable: EDITABLE,
    };
  }

  async updateProfile(actor: AuthUser, dto: UpdateMyStaffProfileDto): Promise<MyStaffProfileDto> {
    const row = await this.mine(actor);
    if (dto.photo_file_id) {
      const file = await this.files.assertAttachable(dto.photo_file_id, row.school_id, 'photo_file_id');
      if (!file.mime_type.startsWith('image/')) {
        throw AppException.validation([{ field: 'photo_file_id', message: 'The photo must be an image (PNG or JPG)' }]);
      }
    }
    const staffChanges = defined({
      address: dto.address,
      emergency_contact_name: dto.emergency_contact_name,
      emergency_contact_mobile: dto.emergency_contact_mobile,
    });
    const userChanges = defined({ email: dto.email, language: dto.language, photo_file_id: dto.photo_file_id });
    await this.dataSource.transaction(async (manager) => {
      if (Object.keys(staffChanges).length) await manager.update(Staff, row.id, staffChanges);
      if (Object.keys(userChanges).length) await manager.update(User, actor.id, userChanges);
    });
    return this.profile(actor);
  }

  async listQualifications(actor: AuthUser): Promise<QualificationDto[]> {
    return this.staff.getQualificationsByUserId(this.schoolOf(actor), actor.id);
  }

  async addQualification(actor: AuthUser, dto: QualificationInputDto): Promise<QualificationDto[]> {
    const row = await this.mine(actor);
    await this.qualifications.insert({ ...this.qualificationFields(dto), staff_id: row.id });
    return this.listQualifications(actor);
  }

  async updateQualification(actor: AuthUser, id: number, dto: QualificationInputDto): Promise<QualificationDto[]> {
    const row = await this.mine(actor);
    const found = await this.qualifications.findOneBy({ id, staff_id: row.id });
    if (!found) throw AppException.notFound('Qualification not found', 'QUALIFICATION_NOT_FOUND');
    await this.qualifications.update(id, this.qualificationFields(dto));
    return this.listQualifications(actor);
  }

  async removeQualification(actor: AuthUser, id: number): Promise<QualificationDto[]> {
    const row = await this.mine(actor);
    const found = await this.qualifications.findOneBy({ id, staff_id: row.id });
    if (!found) throw AppException.notFound('Qualification not found', 'QUALIFICATION_NOT_FOUND');
    await this.qualifications.delete(id);
    return this.listQualifications(actor);
  }

  async listDocuments(actor: AuthUser): Promise<StaffDocumentDto[]> {
    return this.staff.getDocumentsByUserId(this.schoolOf(actor), actor.id);
  }

  async addDocument(actor: AuthUser, dto: StaffDocumentInputDto): Promise<StaffDocumentDto> {
    const row = await this.mine(actor);
    return this.staff.addDocument(row.school_id, row.id, dto);
  }

  async removeDocument(actor: AuthUser, id: number): Promise<{ id: number }> {
    const row = await this.mine(actor);
    const found = await this.documents.findOneBy({ id, staff_id: row.id, school_id: row.school_id });
    if (!found) throw AppException.notFound('Document not found', 'DOCUMENT_NOT_FOUND');
    if (found.status !== 'pending') {
      throw AppException.conflict('A checked document can only be removed by the office', 'DOCUMENT_ALREADY_CHECKED');
    }
    return this.staff.removeDocument(row.school_id, row.id, id);
  }

  async bank(actor: AuthUser): Promise<MyBankListDto> {
    const row = await this.mine(actor);
    const accounts = await this.staff.bank(row.school_id, row.id);
    return { accounts: accounts.map((account) => ({ ...account, account_no: null, pan: null })) };
  }

  async revealBank(actor: AuthUser): Promise<MyBankListDto> {
    const row = await this.mine(actor);
    const accounts = await this.staff.bank(row.school_id, row.id);
    await this.dataSource.query(
      `INSERT INTO office_activity_logs (school_id, user_id, action, target_user_id, note) VALUES ($1, $2, 'bank_viewed', $2, $3)`,
      [row.school_id, actor.id, 'Viewed own bank account and PAN in the app'],
    );
    this.logger.log(`user ${actor.id} revealed own bank details`);
    return { accounts };
  }

  private qualificationFields(dto: QualificationInputDto) {
    return {
      degree: dto.degree,
      specialization: dto.specialization ?? null,
      institution: dto.institution ?? null,
      year_completed: dto.year_completed ?? null,
    };
  }

  private schoolOf(actor: AuthUser): number {
    if (!actor.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
    return actor.school_id;
  }

  private async mine(actor: AuthUser): Promise<Staff> {
    const row = await this.staffRepo.findOneBy({ user_id: actor.id, school_id: this.schoolOf(actor) });
    if (!row) {
      throw AppException.notFound(
        'Your staff profile is not set up yet. Ask the office to add you to the staff list.',
        'STAFF_NOT_FOUND',
      );
    }
    return row;
  }
}
