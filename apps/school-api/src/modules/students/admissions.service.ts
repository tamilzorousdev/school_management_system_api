import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { SequencesService } from '../schools/sequences.service';
import { AcademicYearsService } from '../setup/academic-years.service';
import { ClassesService } from '../setup/classes.service';
import { AcademicYear } from '../setup/entities/academic-year.entity';
import {
  AdmissionInputDto,
  AdmissionQueryDto,
  DecisionDto,
  EnrolAdmissionDto,
  UpdateAdmissionDto,
} from './dto/student-input.dto';
import { AdmissionDto, AdmissionInsightsDto } from './dto/student-response.dto';
import { Admission, AdmissionStatus } from './entities/admission.entity';
import { GuardiansService, Invite } from './guardians.service';
import { StudentsService } from './students.service';

export type AdmissionAction = 'approve' | 'reject' | 'enrol' | 'edit';

const ALLOWED: Record<AdmissionAction, AdmissionStatus[]> = {
  approve: ['applied'],
  reject: ['applied', 'approved'],
  enrol: ['approved'],
  edit: ['applied', 'approved'],
};

const VERBS: Record<AdmissionAction, string> = {
  approve: 'approved',
  reject: 'rejected',
  enrol: 'enrolled',
  edit: 'edited',
};

export function assertAdmissionAllows(action: AdmissionAction, status: AdmissionStatus): void {
  if (!ALLOWED[action].includes(status)) {
    throw AppException.conflict(
      `Only ${ALLOWED[action].join(' or ')} applications can be ${VERBS[action]}. This one is ${status}.`,
      'INVALID_ADMISSION_STATUS',
    );
  }
}

@Injectable()
export class AdmissionsService {
  constructor(
    @InjectRepository(Admission) private readonly admissions: Repository<Admission>,
    private readonly years: AcademicYearsService,
    private readonly classes: ClassesService,
    private readonly students: StudentsService,
    private readonly guardians: GuardiansService,
    private readonly sequences: SequencesService,
    private readonly dataSource: DataSource,
  ) {}

  async list(schoolId: number, query: AdmissionQueryDto): Promise<Paginated<AdmissionDto>> {
    const qb = this.base().where('a.school_id = :schoolId', { schoolId });
    if (query.status) qb.andWhere('a.status = :status', { status: query.status });
    if (query.class_id) qb.andWhere('a.class_id = :classId', { classId: query.class_id });
    const page = await listQuery(qb, query, {
      searchable: ['a.application_no', 'a.first_name', 'a.last_name', 'a.guardian_name', 'a.guardian_mobile'],
      sortable: { created_at: 'a.created_at', first_name: 'a.first_name', status: 'a.status', class: 'c.grade_level' },
      defaultSort: 'created_at',
    });
    return { ...page, items: page.items.map((admission) => this.present(admission)) };
  }

  async insights(schoolId: number): Promise<AdmissionInsightsDto> {
    const year = await this.dataSource.getRepository(AcademicYear).findOneBy({ school_id: schoolId, is_current: true });
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'applied') AS applied,
              COUNT(*) FILTER (WHERE status = 'approved') AS approved,
              COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
              COUNT(*) FILTER (WHERE status = 'enrolled') AS enrolled
       FROM admissions WHERE school_id = $1 AND academic_year_id = $2 AND deleted_at IS NULL`,
      [schoolId, year?.id ?? 0],
    );
    return {
      applied: Number(row.applied),
      approved: Number(row.approved),
      rejected: Number(row.rejected),
      enrolled: Number(row.enrolled),
    };
  }

  async get(schoolId: number, id: number): Promise<AdmissionDto> {
    return this.present(await this.find(schoolId, id));
  }

  async create(schoolId: number, dto: AdmissionInputDto): Promise<AdmissionDto> {
    const year = await this.years.resolve(schoolId, dto.academic_year_id);
    await this.classes.findClass(schoolId, dto.class_id);
    const id = await this.dataSource.transaction(async (manager) => {
      const startYear = year.start_date.slice(0, 4);
      const value = await this.sequences.next(manager, schoolId, `application:${startYear}`);
      const admission = await manager.save(
        manager.create(Admission, {
          ...dto,
          school_id: schoolId,
          academic_year_id: year.id,
          application_no: SequencesService.format('APP', startYear, value),
          last_name: dto.last_name ?? null,
          guardian_email: dto.guardian_email ?? null,
          previous_school: dto.previous_school ?? null,
          identification_marks: dto.identification_marks ?? null,
          emis_number: dto.emis_number ?? null,
          notes: dto.notes ?? null,
          status: 'applied',
        }),
      );
      return admission.id;
    });
    return this.get(schoolId, id);
  }

  async update(schoolId: number, id: number, dto: UpdateAdmissionDto): Promise<AdmissionDto> {
    const admission = await this.find(schoolId, id);
    this.assertStatus(admission, 'edit');
    if (dto.class_id) await this.classes.findClass(schoolId, dto.class_id);
    if (Object.keys(dto).length) await this.admissions.update(id, dto);
    return this.get(schoolId, id);
  }

  async approve(schoolId: number, id: number, dto: DecisionDto, actor: AuthUser): Promise<AdmissionDto> {
    const admission = await this.find(schoolId, id);
    this.assertStatus(admission, 'approve');
    await this.decide(id, 'approved', dto.note ?? null, actor);
    return this.get(schoolId, id);
  }

  async reject(schoolId: number, id: number, dto: DecisionDto, actor: AuthUser): Promise<AdmissionDto> {
    const admission = await this.find(schoolId, id);
    this.assertStatus(admission, 'reject');
    await this.decide(id, 'rejected', dto.note ?? null, actor);
    return this.get(schoolId, id);
  }

  async enrol(schoolId: number, id: number, dto: EnrolAdmissionDto, actor: AuthUser): Promise<AdmissionDto> {
    const admission = await this.find(schoolId, id);
    this.assertStatus(admission, 'enrol');
    const current = await this.years.current(schoolId);
    if (admission.academic_year_id !== current.id) {
      throw AppException.badRequest(
        'This application is for another academic year. Make that year current first.',
        'YEAR_MISMATCH',
      );
    }
    const invites: (Invite | null)[] = await this.dataSource.transaction(async (manager) => {
      const result = await this.students.createInTx(manager, schoolId, {
        first_name: admission.first_name,
        last_name: admission.last_name,
        dob: admission.dob,
        gender: admission.gender,
        previous_school: admission.previous_school,
        identification_marks: admission.identification_marks,
        emis_number: admission.emis_number ?? null,
        admission_date: dto.admission_date,
        class_id: admission.class_id,
        section_id: dto.section_id ?? null,
        guardians: [
          {
            name: admission.guardian_name,
            mobile: admission.guardian_mobile,
            relation: admission.guardian_relation,
            email: admission.guardian_email,
            is_primary: true,
            language: dto.language,
          },
        ],
      });
      await manager.update(Admission, id, {
        status: 'enrolled',
        student_id: result.student.id,
        decided_by: actor.id,
        decided_at: new Date(),
      });
      return result.invites;
    });
    await this.guardians.sendInvites(invites);
    return this.get(schoolId, id);
  }

  async remove(schoolId: number, id: number): Promise<{ id: number }> {
    const admission = await this.find(schoolId, id);
    if (admission.status === 'enrolled') {
      throw AppException.conflict('An enrolled application cannot be deleted', 'ADMISSION_ENROLLED');
    }
    await this.admissions.softDelete(id);
    return { id };
  }

  private async decide(id: number, status: AdmissionStatus, note: string | null, actor: AuthUser): Promise<void> {
    await this.admissions.update(id, { status, decision_note: note, decided_by: actor.id, decided_at: new Date() });
  }

  private assertStatus(admission: Admission, action: AdmissionAction): void {
    assertAdmissionAllows(action, admission.status);
  }

  private async find(schoolId: number, id: number): Promise<Admission> {
    const admission = await this.base().where('a.id = :id AND a.school_id = :schoolId', { id, schoolId }).getOne();
    if (!admission) throw AppException.notFound('Application not found', 'ADMISSION_NOT_FOUND');
    return admission;
  }

  private base() {
    return this.admissions
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.school_class', 'c')
      .leftJoinAndSelect('a.academic_year', 'y')
      .leftJoinAndSelect('a.student', 'st');
  }

  private present(admission: Admission): AdmissionDto {
    return {
      id: admission.id,
      application_no: admission.application_no,
      status: admission.status,
      class: { id: admission.class_id, name: admission.school_class?.name ?? '' },
      academic_year: { id: admission.academic_year_id, name: admission.academic_year?.name ?? '' },
      first_name: admission.first_name,
      last_name: admission.last_name,
      full_name: [admission.first_name, admission.last_name].filter(Boolean).join(' '),
      dob: admission.dob,
      gender: admission.gender,
      guardian_name: admission.guardian_name,
      guardian_mobile: admission.guardian_mobile,
      guardian_relation: admission.guardian_relation,
      guardian_email: admission.guardian_email,
      previous_school: admission.previous_school,
      identification_marks: admission.identification_marks,
      emis_number: admission.emis_number ?? null,
      notes: admission.notes,
      decision_note: admission.decision_note,
      decided_at: admission.decided_at,
      student_id: admission.student_id,
      admission_no: admission.student?.admission_no ?? null,
      created_at: admission.created_at,
    };
  }
}
