import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import { AppException, AuthUser, Paginated, paginate } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { yearClause } from '../../shared/year-context';
import { SequencesService } from '../schools/sequences.service';
import {
  AdmissionDetailDto,
  AdmissionDto,
  AdmissionInputDto,
  AdmissionInsightsDto,
  AdmissionQueryDto,
  AdmissionUpdateDto,
  AllocateDto,
  ApplicationDto,
  ApplicationInputDto,
  ApplicationQueryDto,
  DecisionDto,
  StudentHostelDto,
  StudentPickDto,
  SwapDto,
  TransferDto,
  VacateDto,
} from './dto/hostel-admission.dto';
import {
  AllocationEndReason,
  HostelAdmission,
  HostelAllocation,
  HostelApplication,
  HostelTransfer,
} from './entities/hostel-admission.entity';
import { Hostel, HostelBed, HostelRoom, HostelRoomType } from './entities/hostel.entity';
import { HOSTEL_TEMPLATES } from '../notifications/hostel-templates.catalog';
import { HostelAuditService } from './hostel-audit.service';
import { HostelNotifyService } from './hostel-notify.service';
import { ApplicationAction, applicationMove, genderAllowed, serialNumber } from './hostel.logic';

const OPEN_ADMISSION = ['active', 'on_leave'];
const ADMISSION_SORTS: Record<string, string> = {
  created_at: 'a.created_at',
  admitted_on: 'a.admitted_on',
  admission_no: 'a.admission_no',
  name: 's.first_name',
  room_no: 'r.room_no',
};
const APPLICATION_COLUMNS = `p.id, p.application_no, p.hostel_id, p.room_type_id, p.source, p.status, p.priority,
         p.wanted_from::text AS wanted_from, p.reason, p.decision_note, p.decided_at, p.admission_id, p.created_at`;
const APPLICATION_SORTS: Record<string, string> = {
  created_at: 'p.created_at',
  priority: 'p.priority',
  wanted_from: 'p.wanted_from',
};

interface StudentRow {
  id: number;
  name: string;
  admission_no: string;
  gender: string;
  status: string;
  photo_file_id: number | null;
  class_name: string | null;
  section_name: string | null;
}

interface PlacedBed {
  bed: HostelBed;
  room: HostelRoom;
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`);

export function studentJoins(studentAlias: string): string {
  return `LEFT JOIN academic_years ay ON ay.school_id = ${studentAlias}.school_id AND ay.deleted_at IS NULL AND ${yearClause('ay')}
       LEFT JOIN student_enrollments e ON e.student_id = ${studentAlias}.id AND e.academic_year_id = ay.id
       LEFT JOIN classes c ON c.id = e.class_id
       LEFT JOIN sections sec ON sec.id = e.section_id`;
}

export const STUDENT_COLUMNS = `s.id AS student_id, TRIM(CONCAT(s.first_name, ' ', s.last_name)) AS student_name,
         s.admission_no AS student_admission_no, s.gender AS student_gender, s.photo_file_id AS student_photo_file_id,
         c.name AS class_name, sec.name AS section_name`;

export function studentFromRow(row: Record<string, unknown>) {
  return {
    id: row.student_id as number,
    name: row.student_name as string,
    admission_no: row.student_admission_no as string,
    gender: row.student_gender as string,
    class_name: (row.class_name as string | null) ?? null,
    section_name: (row.section_name as string | null) ?? null,
    photo_file_id: (row.student_photo_file_id as number | null) ?? null,
  };
}

@Injectable()
export class HostelAdmissionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sequences: SequencesService,
    private readonly audit: HostelAuditService,
    private readonly notify: HostelNotifyService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  today(): string {
    return todayIn(this.app.timeZone);
  }

  async listApplications(schoolId: number, query: ApplicationQueryDto): Promise<Paginated<ApplicationDto>> {
    const params: unknown[] = [schoolId];
    const where = ['p.school_id = $1', 'p.deleted_at IS NULL'];
    if (query.status) where.push(`p.status = $${params.push(query.status)}`);
    if (query.hostel_id) where.push(`p.hostel_id = $${params.push(query.hostel_id)}`);
    this.addSearch(where, params, query.search, ['p.application_no', 's.first_name', 's.last_name', 's.admission_no']);
    const sortKey = query.sort ?? 'created_at';
    const sort = this.sortColumn(APPLICATION_SORTS, sortKey);
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const from = `FROM hostel_applications p
       JOIN students s ON s.id = p.student_id
       ${studentJoins('s')}
       LEFT JOIN hostels h ON h.id = p.hostel_id
       LEFT JOIN hostel_room_types t ON t.id = p.room_type_id
       WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    const rows = await this.dataSource.query(
      `SELECT ${APPLICATION_COLUMNS}, h.name AS hostel_name, t.name AS room_type_name, ${STUDENT_COLUMNS}
       ${from} ORDER BY ${sort} ${order} NULLS LAST, p.id ${order}
       LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    return paginate(
      [rows.map((row: Record<string, unknown>) => this.toApplication(row)), total],
      query.page,
      query.limit,
    );
  }

  async getApplication(schoolId: number, id: number): Promise<ApplicationDto> {
    const rows = await this.dataSource.query(
      `SELECT ${APPLICATION_COLUMNS}, h.name AS hostel_name, t.name AS room_type_name, ${STUDENT_COLUMNS}
       FROM hostel_applications p
       JOIN students s ON s.id = p.student_id
       ${studentJoins('s')}
       LEFT JOIN hostels h ON h.id = p.hostel_id
       LEFT JOIN hostel_room_types t ON t.id = p.room_type_id
       WHERE p.school_id = $1 AND p.id = $2 AND p.deleted_at IS NULL`,
      [schoolId, id],
    );
    if (!rows.length) throw AppException.notFound('Hostel application not found', 'HOSTEL_APPLICATION_NOT_FOUND');
    return this.toApplication(rows[0]);
  }

  async createApplication(
    schoolId: number,
    dto: ApplicationInputDto,
    actor: AuthUser,
    source: 'office' | 'parent' = 'office',
  ): Promise<ApplicationDto> {
    const student = await this.findStudent(schoolId, dto.student_id);
    await this.ensureNotAdmitted(this.dataSource.manager, schoolId, student.id);
    if (dto.hostel_id) {
      const hostel = await this.findHostel(this.dataSource.manager, schoolId, dto.hostel_id);
      this.ensureGender(hostel, student);
    }
    if (dto.room_type_id) await this.findRoomType(schoolId, dto.room_type_id);
    const year = await this.currentYear(schoolId);
    const open = await this.dataSource.manager.existsBy(HostelApplication, {
      school_id: schoolId,
      student_id: student.id,
      academic_year_id: year.id,
      status: In(['pending', 'waitlisted', 'approved']),
    });
    if (open)
      throw AppException.conflict('This student already has an open hostel application', 'HOSTEL_APPLICATION_EXISTS');
    const id = await this.dataSource.transaction(async (manager) => {
      const value = await this.sequences.next(manager, schoolId, `hostel_application:${year.start_year}`);
      const saved = await manager.save(
        manager.create(HostelApplication, {
          school_id: schoolId,
          application_no: serialNumber('HAP', year.start_year, value),
          student_id: student.id,
          academic_year_id: year.id,
          hostel_id: dto.hostel_id ?? null,
          room_type_id: dto.room_type_id ?? null,
          source,
          status: 'pending',
          priority: dto.priority ?? 0,
          wanted_from: dto.wanted_from ?? null,
          reason: dto.reason ?? null,
          created_by: actor.id,
        }),
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'application',
        entity_id: saved.id,
        action: 'create',
        student_id: student.id,
        changes: { source, hostel_id: saved.hostel_id, room_type_id: saved.room_type_id },
      });
      return saved.id;
    });
    return this.getApplication(schoolId, id);
  }

  async decideApplication(
    schoolId: number,
    id: number,
    action: ApplicationAction,
    dto: DecisionDto,
    actor: AuthUser,
  ): Promise<ApplicationDto> {
    await this.dataSource.transaction(async (manager) => {
      const application = await manager.findOne(HostelApplication, {
        where: { school_id: schoolId, id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!application) throw AppException.notFound('Hostel application not found', 'HOSTEL_APPLICATION_NOT_FOUND');
      const next = applicationMove(application.status, action);
      if (!next) {
        throw AppException.conflict(
          `A ${application.status} application cannot be changed this way`,
          'HOSTEL_APPLICATION_STATE',
        );
      }
      const before = application.status;
      Object.assign(application, {
        status: next,
        decided_by: actor.id,
        decided_at: new Date(),
        decision_note: dto.note ?? null,
      });
      await manager.save(application);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'application',
        entity_id: id,
        action,
        student_id: application.student_id,
        changes: { status: [before, next] },
        note: dto.note ?? null,
      });
    });
    return this.getApplication(schoolId, id);
  }

  async listAdmissions(schoolId: number, query: AdmissionQueryDto): Promise<Paginated<AdmissionDto>> {
    const params: unknown[] = [schoolId];
    const where = ['a.school_id = $1', 'a.deleted_at IS NULL'];
    if (query.status) where.push(`a.status = $${params.push(query.status)}`);
    else where.push(`a.status <> 'checked_out'`);
    if (query.hostel_id) where.push(`a.hostel_id = $${params.push(query.hostel_id)}`);
    if (query.block_id) where.push(`r.block_id = $${params.push(query.block_id)}`);
    if (query.room_id) where.push(`r.id = $${params.push(query.room_id)}`);
    if (query.class_id) where.push(`e.class_id = $${params.push(query.class_id)}`);
    if (query.has_bed === true) where.push('al.id IS NOT NULL');
    if (query.has_bed === false) where.push('al.id IS NULL');
    this.addSearch(where, params, query.search, [
      'a.admission_no',
      's.first_name',
      's.last_name',
      's.admission_no',
      'r.room_no',
    ]);
    const sortKey = query.sort ?? 'created_at';
    const sort = this.sortColumn(ADMISSION_SORTS, sortKey);
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const from = `${this.admissionFrom()} WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    const rows = await this.dataSource.query(
      `SELECT ${this.admissionColumns()} ${from} ORDER BY ${sort} ${order} NULLS LAST, a.id ${order}
       LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    return paginate(
      [rows.map((row: Record<string, unknown>) => this.toAdmission(row)), total],
      query.page,
      query.limit,
    );
  }

  async insights(schoolId: number, hostelId?: number): Promise<AdmissionInsightsDto> {
    const params: unknown[] = [schoolId];
    const hostelFilter = hostelId ? ` AND a.hostel_id = $${params.push(hostelId)}` : '';
    const [counts] = await this.dataSource.query(
      `SELECT
         COUNT(*) FILTER (WHERE a.status = 'active')::int AS active,
         COUNT(*) FILTER (WHERE a.status = 'on_leave')::int AS on_leave,
         COUNT(*) FILTER (WHERE a.status = 'checking_out')::int AS checking_out,
         COUNT(*) FILTER (WHERE a.status <> 'checked_out' AND al.id IS NULL)::int AS without_bed,
         COUNT(*) FILTER (WHERE a.status = 'checked_out' AND a.checked_out_on BETWEEN ay.start_date AND ay.end_date)::int AS checked_out
       FROM hostel_admissions a
       LEFT JOIN hostel_allocations al ON al.admission_id = a.id AND al.to_date IS NULL
       LEFT JOIN academic_years ay ON ay.school_id = a.school_id AND ay.deleted_at IS NULL AND ${yearClause('ay')}
       WHERE a.school_id = $1 AND a.deleted_at IS NULL${hostelFilter}`,
      params,
    );
    const appParams: unknown[] = [schoolId];
    const appHostel = hostelId ? ` AND hostel_id = $${appParams.push(hostelId)}` : '';
    const [apps] = await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'waitlisted')::int AS waitlisted
       FROM hostel_applications WHERE school_id = $1 AND deleted_at IS NULL${appHostel}`,
      appParams,
    );
    return {
      active: counts.active,
      on_leave: counts.on_leave,
      checking_out: counts.checking_out,
      without_bed: counts.without_bed,
      checked_out: counts.checked_out,
      pending_applications: apps.pending,
      waitlisted_applications: apps.waitlisted,
    };
  }

  async getAdmission(schoolId: number, id: number): Promise<AdmissionDetailDto> {
    const rows = await this.dataSource.query(
      `SELECT ${this.admissionColumns()} ${this.admissionFrom()} WHERE a.school_id = $1 AND a.id = $2 AND a.deleted_at IS NULL`,
      [schoolId, id],
    );
    if (!rows.length) throw AppException.notFound('Hostel admission not found', 'HOSTEL_ADMISSION_NOT_FOUND');
    const allocations = await this.dataSource.query(
      `SELECT al.id, r.room_no, bd.bed_no, h.name AS hostel_name, al.from_date::text AS from_date,
         al.to_date::text AS to_date, al.end_reason
       FROM hostel_allocations al
       JOIN hostel_rooms r ON r.id = al.room_id
       JOIN hostel_beds bd ON bd.id = al.bed_id
       JOIN hostels h ON h.id = al.hostel_id
       WHERE al.school_id = $1 AND al.admission_id = $2 ORDER BY al.from_date DESC, al.id DESC`,
      [schoolId, id],
    );
    const transfers = await this.dataSource.query(
      `SELECT t.id, t.kind, t.transfer_date::text AS transfer_date, t.reason,
         CASE WHEN fr.id IS NULL THEN NULL ELSE CONCAT(fr.room_no, ' / ', fb.bed_no) END AS from_bed,
         CONCAT(tr.room_no, ' / ', tb.bed_no) AS to_bed
       FROM hostel_transfers t
       LEFT JOIN hostel_beds fb ON fb.id = t.from_bed_id
       LEFT JOIN hostel_rooms fr ON fr.id = fb.room_id
       JOIN hostel_beds tb ON tb.id = t.to_bed_id
       JOIN hostel_rooms tr ON tr.id = tb.room_id
       WHERE t.school_id = $1 AND t.admission_id = $2 ORDER BY t.transfer_date DESC, t.id DESC`,
      [schoolId, id],
    );
    const [checkout] = await this.dataSource.query(
      `SELECT id FROM hostel_checkouts WHERE school_id = $1 AND admission_id = $2 AND status = 'open' AND deleted_at IS NULL`,
      [schoolId, id],
    );
    return {
      ...this.toAdmission(rows[0]),
      allocations,
      transfers,
      open_checkout_id: checkout?.id ?? null,
    };
  }

  async studentHostel(schoolId: number, studentId: number): Promise<StudentHostelDto> {
    await this.findStudent(schoolId, studentId, false);
    const rows = await this.dataSource.query(
      `SELECT ${this.admissionColumns()} ${this.admissionFrom()}
       WHERE a.school_id = $1 AND a.student_id = $2 AND a.deleted_at IS NULL ORDER BY a.admitted_on DESC, a.id DESC`,
      [schoolId, studentId],
    );
    const history = rows.map((row: Record<string, unknown>) => this.toAdmission(row));
    const live = history.find((admission: AdmissionDto) => admission.status !== 'checked_out');
    return {
      current: live ? await this.getAdmission(schoolId, live.id) : null,
      history: history.filter((admission: AdmissionDto) => admission.id !== live?.id),
    };
  }

  async searchStudents(schoolId: number, search: string): Promise<StudentPickDto[]> {
    const params: unknown[] = [schoolId];
    const where = ['s.school_id = $1', 's.deleted_at IS NULL', `s.status = 'active'`];
    this.addSearch(where, params, search, ['s.first_name', 's.last_name', 's.admission_no']);
    const rows = await this.dataSource.query(
      `SELECT ${STUDENT_COLUMNS}, ha.id AS hostel_admission_id, ap.id AS application_id, ap.status AS application_status
       FROM students s ${studentJoins('s')}
       LEFT JOIN hostel_admissions ha ON ha.student_id = s.id AND ha.status <> 'checked_out' AND ha.deleted_at IS NULL
       LEFT JOIN hostel_applications ap ON ap.student_id = s.id AND ap.academic_year_id = ay.id
         AND ap.status IN ('pending', 'waitlisted', 'approved') AND ap.deleted_at IS NULL
       WHERE ${where.join(' AND ')}
       ORDER BY s.first_name, s.last_name LIMIT 20`,
      params,
    );
    return rows.map((row: Record<string, unknown>) => ({
      ...studentFromRow(row),
      hostel_admission_id: (row.hostel_admission_id as number | null) ?? null,
      application_id: (row.application_id as number | null) ?? null,
      application_status: (row.application_status as string | null) ?? null,
    }));
  }

  async admit(schoolId: number, dto: AdmissionInputDto, actor: AuthUser): Promise<AdmissionDetailDto> {
    const student = await this.findStudent(schoolId, dto.student_id);
    const year = await this.currentYear(schoolId);
    const admittedOn = dto.admitted_on ?? this.today();
    const id = await this.dataSource.transaction(async (manager) => {
      await this.ensureNotAdmitted(manager, schoolId, student.id);
      const hostel = await this.findHostel(manager, schoolId, dto.hostel_id);
      this.ensureGender(hostel, student);
      let application: HostelApplication | null = null;
      if (dto.application_id) {
        application = await manager.findOne(HostelApplication, {
          where: { school_id: schoolId, id: dto.application_id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!application || application.student_id !== student.id || application.status !== 'approved') {
          throw AppException.conflict(
            'The application must be an approved application of this student',
            'HOSTEL_APPLICATION_NOT_APPROVED',
          );
        }
      }
      const value = await this.sequences.next(manager, schoolId, `hostel_admission:${year.start_year}`);
      const admission = await manager.save(
        manager.create(HostelAdmission, {
          school_id: schoolId,
          admission_no: serialNumber('HST', year.start_year, value),
          student_id: student.id,
          academic_year_id: year.id,
          hostel_id: hostel.id,
          application_id: application?.id ?? null,
          status: 'active',
          admitted_on: admittedOn,
          diet: dto.diet ?? 'veg',
          local_guardian_name: dto.local_guardian_name ?? null,
          local_guardian_mobile: dto.local_guardian_mobile ?? null,
          local_guardian_relation: dto.local_guardian_relation ?? null,
          local_guardian_address: dto.local_guardian_address ?? null,
          medical_notes: dto.medical_notes ?? null,
          notes: dto.notes ?? null,
          created_by: actor.id,
        }),
      );
      if (application) {
        application.status = 'admitted';
        application.admission_id = admission.id;
        await manager.save(application);
      }
      await this.audit.record(manager, schoolId, actor, {
        entity: 'admission',
        entity_id: admission.id,
        action: 'admit',
        student_id: student.id,
        changes: { hostel_id: hostel.id, admitted_on: admittedOn, application_id: application?.id ?? null },
      });
      if (dto.bed_id) {
        const placed = await this.placeBed(manager, schoolId, admission, student, dto.bed_id, admittedOn, actor);
        await this.audit.record(manager, schoolId, actor, {
          entity: 'admission',
          entity_id: admission.id,
          action: 'allocate',
          student_id: student.id,
          changes: { bed_id: placed.bed.id, room_id: placed.room.id, from_date: admittedOn },
        });
      }
      return admission.id;
    });
    const detail = await this.getAdmission(schoolId, id);
    await this.notify.tellParents(id, HOSTEL_TEMPLATES.HOSTEL_ADMITTED, {
      admission_no: detail.admission_no,
      bed: detail.bed ? `${detail.bed.room_no} / ${detail.bed.bed_no}` : 'to be allotted',
    });
    return detail;
  }

  async updateAdmission(
    schoolId: number,
    id: number,
    dto: AdmissionUpdateDto,
    actor: AuthUser,
  ): Promise<AdmissionDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      const admission = await this.lockAdmission(manager, schoolId, id);
      if (admission.status === 'checked_out') {
        throw AppException.conflict('This student has checked out of the hostel', 'HOSTEL_ADMISSION_CLOSED');
      }
      const changes: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(dto)) {
        if (value === undefined) continue;
        const current = (admission as unknown as Record<string, unknown>)[key];
        if (current !== value) changes[key] = [current, value];
      }
      if (!Object.keys(changes).length) return;
      Object.assign(admission, Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)));
      await manager.save(admission);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'admission',
        entity_id: id,
        action: 'update',
        student_id: admission.student_id,
        changes,
      });
    });
    return this.getAdmission(schoolId, id);
  }

  async allocate(schoolId: number, id: number, dto: AllocateDto, actor: AuthUser): Promise<AdmissionDetailDto> {
    const date = dto.from_date ?? this.today();
    await this.dataSource.transaction(async (manager) => {
      const admission = await this.lockAdmission(manager, schoolId, id);
      this.ensureOpen(admission);
      if (await this.liveAllocation(manager, schoolId, id)) {
        throw AppException.conflict(
          'This student already has a bed. Use transfer to move them.',
          'HOSTEL_ALREADY_HAS_BED',
        );
      }
      if (date < admission.admitted_on) {
        throw AppException.validation([{ field: 'from_date', message: 'Cannot be before the hostel admission date' }]);
      }
      const student = await this.findStudent(schoolId, admission.student_id, false);
      const placed = await this.placeBed(manager, schoolId, admission, student, dto.bed_id, date, actor);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'admission',
        entity_id: id,
        action: 'allocate',
        student_id: admission.student_id,
        changes: { bed_id: placed.bed.id, room_id: placed.room.id, from_date: date },
      });
    });
    await this.notify.tellParents(id, HOSTEL_TEMPLATES.HOSTEL_BED_CHANGED);
    return this.getAdmission(schoolId, id);
  }

  async transfer(schoolId: number, id: number, dto: TransferDto, actor: AuthUser): Promise<AdmissionDetailDto> {
    const date = dto.transfer_date ?? this.today();
    await this.dataSource.transaction(async (manager) => {
      const admission = await this.lockAdmission(manager, schoolId, id);
      this.ensureOpen(admission);
      const current = await this.liveAllocation(manager, schoolId, id);
      if (!current) throw AppException.conflict('This student has no bed yet. Allocate one first.', 'HOSTEL_NO_BED');
      if (current.bed_id === dto.bed_id) {
        throw AppException.badRequest('The student is already in this bed', 'HOSTEL_SAME_BED');
      }
      this.ensureDateAfter(date, current.from_date, 'transfer_date');
      const student = await this.findStudent(schoolId, admission.student_id, false);
      await this.lockBeds(manager, schoolId, [current.bed_id, dto.bed_id]);
      await this.closeAllocation(manager, current, date, 'transfer');
      const placed = await this.placeBed(manager, schoolId, admission, student, dto.bed_id, date, actor);
      await manager.insert(HostelTransfer, {
        school_id: schoolId,
        admission_id: id,
        student_id: admission.student_id,
        kind: 'transfer',
        from_bed_id: current.bed_id,
        to_bed_id: placed.bed.id,
        transfer_date: date,
        reason: dto.reason ?? null,
        created_by: actor.id,
      });
      await this.audit.record(manager, schoolId, actor, {
        entity: 'admission',
        entity_id: id,
        action: 'transfer',
        student_id: admission.student_id,
        changes: { bed_id: [current.bed_id, placed.bed.id], room_id: [current.room_id, placed.room.id] },
        note: dto.reason ?? null,
      });
    });
    await this.notify.tellParents(id, HOSTEL_TEMPLATES.HOSTEL_BED_CHANGED);
    return this.getAdmission(schoolId, id);
  }

  async swap(schoolId: number, id: number, dto: SwapDto, actor: AuthUser): Promise<AdmissionDetailDto> {
    if (dto.other_admission_id === id) {
      throw AppException.badRequest('Choose another student to swap with', 'HOSTEL_SWAP_SELF');
    }
    const date = dto.transfer_date ?? this.today();
    await this.dataSource.transaction(async (manager) => {
      const [firstId, secondId] = [id, dto.other_admission_id].sort((a, b) => a - b);
      const first = await this.lockAdmission(manager, schoolId, firstId);
      const second = await this.lockAdmission(manager, schoolId, secondId);
      const mine = first.id === id ? first : second;
      const other = first.id === id ? second : first;
      this.ensureOpen(mine);
      this.ensureOpen(other);
      const mineBed = await this.liveAllocation(manager, schoolId, mine.id);
      const otherBed = await this.liveAllocation(manager, schoolId, other.id);
      if (!mineBed || !otherBed) {
        throw AppException.conflict('Both students need a bed to swap', 'HOSTEL_NO_BED');
      }
      this.ensureDateAfter(date, mineBed.from_date, 'transfer_date');
      this.ensureDateAfter(date, otherBed.from_date, 'transfer_date');
      const mineStudent = await this.findStudent(schoolId, mine.student_id, false);
      const otherStudent = await this.findStudent(schoolId, other.student_id, false);
      await this.lockBeds(manager, schoolId, [mineBed.bed_id, otherBed.bed_id]);
      await this.closeAllocation(manager, mineBed, date, 'swap');
      await this.closeAllocation(manager, otherBed, date, 'swap');
      await this.placeBed(manager, schoolId, mine, mineStudent, otherBed.bed_id, date, actor);
      await this.placeBed(manager, schoolId, other, otherStudent, mineBed.bed_id, date, actor);
      for (const [admission, from, to, partner] of [
        [mine, mineBed, otherBed, other],
        [other, otherBed, mineBed, mine],
      ] as const) {
        await manager.insert(HostelTransfer, {
          school_id: schoolId,
          admission_id: admission.id,
          student_id: admission.student_id,
          kind: 'swap',
          from_bed_id: from.bed_id,
          to_bed_id: to.bed_id,
          swap_admission_id: partner.id,
          transfer_date: date,
          reason: dto.reason ?? null,
          created_by: actor.id,
        });
        await this.audit.record(manager, schoolId, actor, {
          entity: 'admission',
          entity_id: admission.id,
          action: 'swap',
          student_id: admission.student_id,
          changes: { bed_id: [from.bed_id, to.bed_id], swap_admission_id: partner.id },
          note: dto.reason ?? null,
        });
      }
    });
    await this.notify.tellParents(id, HOSTEL_TEMPLATES.HOSTEL_BED_CHANGED);
    await this.notify.tellParents(dto.other_admission_id, HOSTEL_TEMPLATES.HOSTEL_BED_CHANGED);
    return this.getAdmission(schoolId, id);
  }

  async vacate(schoolId: number, id: number, dto: VacateDto, actor: AuthUser): Promise<AdmissionDetailDto> {
    const date = dto.date ?? this.today();
    await this.dataSource.transaction(async (manager) => {
      const admission = await this.lockAdmission(manager, schoolId, id);
      if (admission.status === 'checked_out') {
        throw AppException.conflict('This student has checked out of the hostel', 'HOSTEL_ADMISSION_CLOSED');
      }
      const current = await this.liveAllocation(manager, schoolId, id);
      if (!current) throw AppException.conflict('This student has no bed', 'HOSTEL_NO_BED');
      this.ensureDateAfter(date, current.from_date, 'date');
      await this.lockBeds(manager, schoolId, [current.bed_id]);
      await this.closeAllocation(manager, current, date, 'vacated');
      await this.audit.record(manager, schoolId, actor, {
        entity: 'admission',
        entity_id: id,
        action: 'vacate',
        student_id: admission.student_id,
        changes: { bed_id: current.bed_id, to_date: date },
        note: dto.reason ?? null,
      });
    });
    return this.getAdmission(schoolId, id);
  }

  async lockAdmission(manager: EntityManager, schoolId: number, id: number): Promise<HostelAdmission> {
    const admission = await manager.findOne(HostelAdmission, {
      where: { school_id: schoolId, id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!admission) throw AppException.notFound('Hostel admission not found', 'HOSTEL_ADMISSION_NOT_FOUND');
    return admission;
  }

  async liveAllocation(
    manager: EntityManager,
    schoolId: number,
    admissionId: number,
  ): Promise<HostelAllocation | null> {
    return manager.findOne(HostelAllocation, {
      where: { school_id: schoolId, admission_id: admissionId, to_date: IsNull() },
    });
  }

  async closeAllocation(
    manager: EntityManager,
    allocation: HostelAllocation,
    date: string,
    reason: AllocationEndReason,
  ): Promise<void> {
    await manager.update(HostelAllocation, { id: allocation.id }, { to_date: date, end_reason: reason });
    await manager.update(HostelBed, { id: allocation.bed_id, status: 'occupied' }, { status: 'vacant' });
  }

  private async placeBed(
    manager: EntityManager,
    schoolId: number,
    admission: HostelAdmission,
    student: StudentRow,
    bedId: number,
    date: string,
    actor: AuthUser,
  ): Promise<PlacedBed> {
    const bed = await manager.findOne(HostelBed, {
      where: { school_id: schoolId, id: bedId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!bed) throw AppException.notFound('Bed not found', 'HOSTEL_BED_NOT_FOUND');
    if (bed.status !== 'vacant') throw AppException.conflict('This bed is not vacant', 'HOSTEL_BED_NOT_VACANT');
    const room = await manager.findOneBy(HostelRoom, { school_id: schoolId, id: bed.room_id });
    if (!room || room.status !== 'active') {
      throw AppException.conflict('This room is not open for students', 'HOSTEL_ROOM_NOT_ACTIVE');
    }
    const hostel = await this.findHostel(manager, schoolId, room.hostel_id);
    this.ensureGender(hostel, student);
    await manager.insert(HostelAllocation, {
      school_id: schoolId,
      admission_id: admission.id,
      student_id: admission.student_id,
      hostel_id: room.hostel_id,
      room_id: room.id,
      bed_id: bed.id,
      from_date: date,
      created_by: actor.id,
    });
    bed.status = 'occupied';
    await manager.save(bed);
    if (admission.hostel_id !== room.hostel_id) {
      admission.hostel_id = room.hostel_id;
      await manager.update(HostelAdmission, { id: admission.id }, { hostel_id: room.hostel_id });
    }
    return { bed, room };
  }

  private async lockBeds(manager: EntityManager, schoolId: number, bedIds: number[]): Promise<void> {
    await manager.query(`SELECT id FROM hostel_beds WHERE school_id = $1 AND id = ANY($2) ORDER BY id FOR UPDATE`, [
      schoolId,
      [...new Set(bedIds)],
    ]);
  }

  async findStudent(schoolId: number, studentId: number, mustBeActive = true): Promise<StudentRow> {
    const [row] = await this.dataSource.query(
      `SELECT s.id, TRIM(CONCAT(s.first_name, ' ', s.last_name)) AS name, s.admission_no, s.gender, s.status,
         s.photo_file_id, c.name AS class_name, sec.name AS section_name
       FROM students s ${studentJoins('s')}
       WHERE s.school_id = $1 AND s.id = $2 AND s.deleted_at IS NULL`,
      [schoolId, studentId],
    );
    if (!row) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    if (mustBeActive && row.status !== 'active') {
      throw AppException.conflict(
        'Only students who are studying here can join the hostel',
        'HOSTEL_STUDENT_NOT_ACTIVE',
      );
    }
    return row;
  }

  private async ensureNotAdmitted(manager: EntityManager, schoolId: number, studentId: number): Promise<void> {
    const live = await manager.existsBy(HostelAdmission, {
      school_id: schoolId,
      student_id: studentId,
      status: In(['active', 'on_leave', 'checking_out']),
    });
    if (live) throw AppException.conflict('This student is already in the hostel', 'HOSTEL_ALREADY_ADMITTED');
  }

  private async findHostel(manager: EntityManager, schoolId: number, id: number): Promise<Hostel> {
    const hostel = await manager.findOneBy(Hostel, { school_id: schoolId, id });
    if (!hostel) throw AppException.notFound('Hostel not found', 'HOSTEL_NOT_FOUND');
    if (hostel.status !== 'active') throw AppException.conflict('This hostel is not active', 'HOSTEL_INACTIVE');
    return hostel;
  }

  private async findRoomType(schoolId: number, id: number): Promise<void> {
    if (!(await this.dataSource.manager.existsBy(HostelRoomType, { school_id: schoolId, id }))) {
      throw AppException.notFound('Room type not found', 'HOSTEL_ROOM_TYPE_NOT_FOUND');
    }
  }

  private ensureGender(hostel: Hostel, student: StudentRow): void {
    if (!genderAllowed(hostel.gender, student.gender)) {
      throw AppException.conflict(`${hostel.name} is a ${hostel.gender} hostel`, 'HOSTEL_GENDER_MISMATCH');
    }
  }

  private ensureOpen(admission: HostelAdmission): void {
    if (!OPEN_ADMISSION.includes(admission.status)) {
      throw AppException.conflict(
        admission.status === 'checking_out'
          ? 'Checkout has started for this student. Cancel the checkout to change the bed.'
          : 'This student has checked out of the hostel',
        'HOSTEL_ADMISSION_CLOSED',
      );
    }
  }

  private ensureDateAfter(date: string, from: string, field: string): void {
    if (date < from) {
      throw AppException.validation([{ field, message: `Cannot be before the current bed start date ${from}` }]);
    }
  }

  private async currentYear(schoolId: number): Promise<{ id: number; start_year: string }> {
    const [year] = await this.dataSource.query(
      `SELECT id, start_date::text AS start_date FROM academic_years
       WHERE school_id = $1 AND is_current = true AND deleted_at IS NULL`,
      [schoolId],
    );
    if (!year) throw AppException.badRequest('Set the current academic year first', 'NO_CURRENT_YEAR');
    return { id: year.id, start_year: year.start_date.slice(0, 4) };
  }

  private sortColumn(sorts: Record<string, string>, key: string): string {
    const column = sorts[key];
    if (!column) throw AppException.badRequest(`sort must be one of ${Object.keys(sorts).join(', ')}`, 'INVALID_SORT');
    return column;
  }

  private addSearch(where: string[], params: unknown[], search: string | undefined, columns: string[]): void {
    for (const word of (search ?? '').split(/\s+/).filter(Boolean)) {
      const slot = `$${params.push(`%${escapeLike(word)}%`)}`;
      where.push(`(${columns.map((column) => `${column} ILIKE ${slot}`).join(' OR ')})`);
    }
  }

  private admissionColumns(): string {
    return `a.id, a.admission_no, a.hostel_id, a.status, a.admitted_on::text AS admitted_on,
         a.checked_out_on::text AS checked_out_on, a.diet, a.local_guardian_name, a.local_guardian_mobile,
         a.local_guardian_relation, a.local_guardian_address, a.medical_notes, a.notes,
         h.name AS hostel_name, ${STUDENT_COLUMNS},
         al.from_date::text AS bed_from_date, bd.id AS bed_id, bd.bed_no, r.id AS room_id, r.room_no,
         b.name AS block_name, f.name AS floor_name,
         pg.name AS guardian_name, pg.mobile AS guardian_mobile, pg.relation AS guardian_relation`;
  }

  private admissionFrom(): string {
    return `FROM hostel_admissions a
       JOIN hostels h ON h.id = a.hostel_id
       JOIN students s ON s.id = a.student_id
       ${studentJoins('s')}
       LEFT JOIN hostel_allocations al ON al.admission_id = a.id AND al.to_date IS NULL
       LEFT JOIN hostel_beds bd ON bd.id = al.bed_id
       LEFT JOIN hostel_rooms r ON r.id = al.room_id
       LEFT JOIN hostel_blocks b ON b.id = r.block_id
       LEFT JOIN hostel_floors f ON f.id = r.floor_id
       LEFT JOIN LATERAL (
         SELECT g.name, g.mobile, sg.relation FROM student_guardians sg
         JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
         WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC, sg.id LIMIT 1
       ) pg ON true`;
  }

  private toApplication(row: Record<string, unknown>): ApplicationDto {
    return {
      id: row.id as number,
      application_no: row.application_no as string,
      student: studentFromRow(row),
      hostel_id: (row.hostel_id as number | null) ?? null,
      hostel_name: (row.hostel_name as string | null) ?? null,
      room_type_id: (row.room_type_id as number | null) ?? null,
      room_type_name: (row.room_type_name as string | null) ?? null,
      source: row.source as ApplicationDto['source'],
      status: row.status as ApplicationDto['status'],
      priority: row.priority as number,
      wanted_from: (row.wanted_from as string | null) ?? null,
      reason: (row.reason as string | null) ?? null,
      decision_note: (row.decision_note as string | null) ?? null,
      decided_at: (row.decided_at as Date | null) ?? null,
      admission_id: (row.admission_id as number | null) ?? null,
      created_at: row.created_at as Date,
    };
  }

  private toAdmission(row: Record<string, unknown>): AdmissionDto {
    return {
      id: row.id as number,
      admission_no: row.admission_no as string,
      student: studentFromRow(row),
      hostel_id: row.hostel_id as number,
      hostel_name: row.hostel_name as string,
      status: row.status as AdmissionDto['status'],
      admitted_on: row.admitted_on as string,
      checked_out_on: (row.checked_out_on as string | null) ?? null,
      diet: row.diet as AdmissionDto['diet'],
      bed: row.bed_id
        ? {
            bed_id: row.bed_id as number,
            bed_no: row.bed_no as string,
            room_id: row.room_id as number,
            room_no: row.room_no as string,
            block_name: row.block_name as string,
            floor_name: row.floor_name as string,
            from_date: row.bed_from_date as string,
          }
        : null,
      primary_guardian: row.guardian_mobile
        ? {
            name: row.guardian_name as string,
            mobile: row.guardian_mobile as string,
            relation: row.guardian_relation as string,
          }
        : null,
      local_guardian_name: (row.local_guardian_name as string | null) ?? null,
      local_guardian_mobile: (row.local_guardian_mobile as string | null) ?? null,
      local_guardian_relation: (row.local_guardian_relation as string | null) ?? null,
      local_guardian_address: (row.local_guardian_address as string | null) ?? null,
      medical_notes: (row.medical_notes as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
    };
  }
}
