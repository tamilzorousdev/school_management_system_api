import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException, AuthUser, Paginated, paginate } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { HOSTEL_TEMPLATES } from '../notifications/hostel-templates.catalog';
import { SequencesService } from '../schools/sequences.service';
import {
  ApprovedVisitorDto,
  ApprovedVisitorInputDto,
  BlocklistDto,
  BlocklistInputDto,
  VisitDto,
  VisitInputDto,
  VisitorLookupDto,
  VisitQueryDto,
} from './dto/hostel-movement.dto';
import { HostelAdmission } from './entities/hostel-admission.entity';
import { HostelApprovedVisitor, HostelBlocklist, HostelVisit } from './entities/hostel-movement.entity';
import { STUDENT_COLUMNS, studentFromRow, studentJoins } from './hostel-admissions.service';
import { HostelAuditService } from './hostel-audit.service';
import { HostelNotifyService } from './hostel-notify.service';
import { serialNumber } from './hostel.logic';

const VISIT_SORTS: Record<string, string> = { created_at: 'v.created_at', in_at: 'v.in_at', out_at: 'v.out_at' };
const MAX_APPROVED_VISITORS = 10;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`);

@Injectable()
export class HostelVisitorsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sequences: SequencesService,
    private readonly notify: HostelNotifyService,
    private readonly audit: HostelAuditService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async list(schoolId: number, query: VisitQueryDto): Promise<Paginated<VisitDto>> {
    const params: unknown[] = [schoolId, this.app.timeZone];
    const where = ['v.school_id = $1'];
    if (query.hostel_id) where.push(`v.hostel_id = $${params.push(query.hostel_id)}`);
    if (query.admission_id) where.push(`v.admission_id = $${params.push(query.admission_id)}`);
    if (query.status) where.push(`v.status = $${params.push(query.status)}`);
    if (query.date) where.push(`(v.created_at AT TIME ZONE $2)::date = $${params.push(query.date)}`);
    for (const word of (query.search ?? '').split(/\s+/).filter(Boolean)) {
      const slot = `$${params.push(`%${escapeLike(word)}%`)}`;
      where.push(
        `(v.visit_no ILIKE ${slot} OR v.visitor_name ILIKE ${slot} OR v.mobile ILIKE ${slot} OR s.first_name ILIKE ${slot} OR s.last_name ILIKE ${slot})`,
      );
    }
    const sort = VISIT_SORTS[query.sort ?? 'created_at'];
    if (!sort)
      throw AppException.badRequest(`sort must be one of ${Object.keys(VISIT_SORTS).join(', ')}`, 'INVALID_SORT');
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const from = `${this.visitFrom()} WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    const rows = await this.dataSource.query(
      `SELECT ${this.visitColumns()} ${from} ORDER BY ${sort} ${order} NULLS LAST, v.id ${order}
       LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    return paginate([rows.map((row: Record<string, unknown>) => this.toVisit(row)), total], query.page, query.limit);
  }

  async get(schoolId: number, id: number): Promise<VisitDto> {
    const rows = await this.dataSource.query(
      `SELECT ${this.visitColumns()} ${this.visitFrom()} WHERE v.school_id = $1 AND v.id = $2`,
      [schoolId, id],
    );
    if (!rows.length) throw AppException.notFound('Visit not found', 'HOSTEL_VISIT_NOT_FOUND');
    return this.toVisit(rows[0]);
  }

  async lookup(schoolId: number, mobile: string, admissionId?: number): Promise<VisitorLookupDto> {
    const [blocked] = await this.dataSource.query(
      `SELECT reason FROM hostel_blocklist WHERE school_id = $1 AND mobile = $2 AND deleted_at IS NULL`,
      [schoolId, mobile],
    );
    const known = admissionId ? await this.knownVisitor(schoolId, admissionId, mobile) : null;
    const [last] = await this.dataSource.query(
      `SELECT in_at FROM hostel_visits WHERE school_id = $1 AND mobile = $2 AND in_at IS NOT NULL ORDER BY in_at DESC LIMIT 1`,
      [schoolId, mobile],
    );
    return {
      blocked: Boolean(blocked),
      blocked_reason: blocked?.reason ?? null,
      known: Boolean(known),
      known_name: known?.name ?? null,
      known_relation: known?.relation ?? null,
      photo_file_id: known?.photo_file_id ?? null,
      last_visit_at: last?.in_at ?? null,
    };
  }

  async checkIn(schoolId: number, dto: VisitInputDto, actor: AuthUser): Promise<VisitDto> {
    const admission = await this.dataSource.manager.findOneBy(HostelAdmission, {
      school_id: schoolId,
      id: dto.admission_id,
    });
    if (!admission) throw AppException.notFound('Hostel admission not found', 'HOSTEL_ADMISSION_NOT_FOUND');
    if (!['active', 'on_leave', 'checking_out'].includes(admission.status)) {
      throw AppException.conflict('This student is not staying in the hostel', 'HOSTEL_ADMISSION_CLOSED');
    }
    const [blocked] = await this.dataSource.query(
      `SELECT reason FROM hostel_blocklist WHERE school_id = $1 AND mobile = $2 AND deleted_at IS NULL`,
      [schoolId, dto.mobile],
    );
    if (blocked && !dto.deny) {
      throw AppException.forbidden(`This visitor is blocked: ${blocked.reason}`, 'HOSTEL_VISITOR_BLOCKED');
    }
    const known = await this.knownVisitor(schoolId, admission.id, dto.mobile);
    const year = todayIn(this.app.timeZone).slice(0, 4);
    const id = await this.dataSource.transaction(async (manager) => {
      const value = await this.sequences.next(manager, schoolId, `hostel_visit:${year}`);
      const visit = await manager.save(
        manager.create(HostelVisit, {
          school_id: schoolId,
          visit_no: serialNumber('HVS', year, value),
          hostel_id: admission.hostel_id,
          admission_id: admission.id,
          student_id: admission.student_id,
          visitor_name: dto.visitor_name,
          relation: dto.relation,
          mobile: dto.mobile,
          people_count: dto.people_count ?? 1,
          id_proof_type: dto.id_proof_type ?? null,
          id_proof_last4: dto.id_proof_last4 ?? null,
          photo_file_id: dto.photo_file_id ?? null,
          purpose: dto.purpose ?? null,
          is_known: Boolean(known),
          status: dto.deny ? 'denied' : 'inside',
          note: dto.note ?? null,
          in_at: dto.deny ? null : new Date(),
          in_by: dto.deny ? null : actor.id,
        }),
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'visit',
        entity_id: visit.id,
        action: dto.deny ? 'deny' : 'in',
        student_id: admission.student_id,
        changes: { visitor: dto.visitor_name, mobile: dto.mobile, known: Boolean(known) },
        note: dto.note ?? null,
      });
      return visit.id;
    });
    const visit = await this.get(schoolId, id);
    if (!dto.deny) {
      await this.notify.tellParents(admission.id, HOSTEL_TEMPLATES.HOSTEL_VISITOR_ARRIVED, {
        visitor: dto.visitor_name,
        relation: dto.relation,
        time: new Intl.DateTimeFormat('en-IN', {
          timeZone: this.app.timeZone,
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date()),
        visit_id: String(id),
      });
    }
    return visit;
  }

  async checkOut(schoolId: number, id: number, actor: AuthUser): Promise<VisitDto> {
    await this.dataSource.transaction(async (manager) => {
      const visit = await manager.findOne(HostelVisit, {
        where: { school_id: schoolId, id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!visit) throw AppException.notFound('Visit not found', 'HOSTEL_VISIT_NOT_FOUND');
      if (visit.status !== 'inside')
        throw AppException.conflict('This visitor is not inside', 'HOSTEL_VISIT_NOT_INSIDE');
      Object.assign(visit, { status: 'left', out_at: new Date(), out_by: actor.id });
      await manager.save(visit);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'visit',
        entity_id: id,
        action: 'out',
        student_id: visit.student_id,
      });
    });
    return this.get(schoolId, id);
  }

  async approvedVisitors(schoolId: number, studentId: number): Promise<ApprovedVisitorDto[]> {
    const rows = await this.dataSource.manager.find(HostelApprovedVisitor, {
      where: { school_id: schoolId, student_id: studentId },
      order: { name: 'ASC' },
    });
    return rows.map((row) => this.toApproved(row));
  }

  async addApprovedVisitor(
    schoolId: number,
    studentId: number,
    dto: ApprovedVisitorInputDto,
    actor: AuthUser,
    role: 'parent' | 'staff',
  ): Promise<ApprovedVisitorDto> {
    const repo = this.dataSource.getRepository(HostelApprovedVisitor);
    const existing = await repo.findBy({ school_id: schoolId, student_id: studentId });
    if (existing.some((row) => row.mobile === dto.mobile)) {
      throw AppException.conflict('This mobile number is already on the list', 'HOSTEL_VISITOR_EXISTS');
    }
    if (existing.length >= MAX_APPROVED_VISITORS) {
      throw AppException.conflict(
        `At most ${MAX_APPROVED_VISITORS} approved visitors per student`,
        'HOSTEL_VISITOR_LIMIT',
      );
    }
    const saved = await repo.save(
      repo.create({
        school_id: schoolId,
        student_id: studentId,
        name: dto.name,
        relation: dto.relation,
        mobile: dto.mobile,
        photo_file_id: dto.photo_file_id ?? null,
        added_by_role: role,
        created_by: actor.id,
      }),
    );
    await this.audit.record(this.dataSource.manager, schoolId, actor, {
      entity: 'approved_visitor',
      entity_id: saved.id,
      action: 'add',
      student_id: studentId,
      changes: { name: dto.name, mobile: dto.mobile, by: role },
    });
    return this.toApproved(saved);
  }

  async removeApprovedVisitor(schoolId: number, studentId: number, id: number, actor: AuthUser): Promise<void> {
    const repo = this.dataSource.getRepository(HostelApprovedVisitor);
    const row = await repo.findOneBy({ school_id: schoolId, student_id: studentId, id });
    if (!row) throw AppException.notFound('Approved visitor not found', 'HOSTEL_VISITOR_NOT_FOUND');
    await repo.softDelete(id);
    await this.audit.record(this.dataSource.manager, schoolId, actor, {
      entity: 'approved_visitor',
      entity_id: id,
      action: 'remove',
      student_id: studentId,
      changes: { name: row.name, mobile: row.mobile },
    });
  }

  async blocklist(schoolId: number): Promise<BlocklistDto[]> {
    const rows = await this.dataSource.manager.find(HostelBlocklist, {
      where: { school_id: schoolId },
      order: { created_at: 'DESC' },
    });
    return rows.map((row) => ({
      id: row.id,
      mobile: row.mobile,
      name: row.name,
      reason: row.reason,
      created_at: row.created_at,
    }));
  }

  async block(schoolId: number, dto: BlocklistInputDto, actor: AuthUser): Promise<BlocklistDto> {
    const repo = this.dataSource.getRepository(HostelBlocklist);
    if (await repo.existsBy({ school_id: schoolId, mobile: dto.mobile })) {
      throw AppException.conflict('This mobile number is already blocked', 'HOSTEL_ALREADY_BLOCKED');
    }
    const saved = await repo.save(
      repo.create({
        school_id: schoolId,
        mobile: dto.mobile,
        name: dto.name ?? null,
        reason: dto.reason,
        created_by: actor.id,
      }),
    );
    await this.audit.record(this.dataSource.manager, schoolId, actor, {
      entity: 'blocklist',
      entity_id: saved.id,
      action: 'block',
      changes: { mobile: dto.mobile, reason: dto.reason },
    });
    return { id: saved.id, mobile: saved.mobile, name: saved.name, reason: saved.reason, created_at: saved.created_at };
  }

  async unblock(schoolId: number, id: number, actor: AuthUser): Promise<void> {
    const repo = this.dataSource.getRepository(HostelBlocklist);
    const row = await repo.findOneBy({ school_id: schoolId, id });
    if (!row) throw AppException.notFound('Blocked number not found', 'HOSTEL_BLOCK_NOT_FOUND');
    await repo.softDelete(id);
    await this.audit.record(this.dataSource.manager, schoolId, actor, {
      entity: 'blocklist',
      entity_id: id,
      action: 'unblock',
      changes: { mobile: row.mobile },
    });
  }

  private async knownVisitor(
    schoolId: number,
    admissionId: number,
    mobile: string,
  ): Promise<{ name: string; relation: string; photo_file_id: number | null } | null> {
    const [row] = await this.dataSource.query(
      `SELECT g.name, sg.relation, g.photo_file_id FROM hostel_admissions a
       JOIN student_guardians sg ON sg.student_id = a.student_id
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
       WHERE a.school_id = $1 AND a.id = $2 AND (g.mobile = $3 OR g.alt_mobile = $3)
       UNION ALL
       SELECT v.name, v.relation, v.photo_file_id FROM hostel_admissions a
       JOIN hostel_approved_visitors v ON v.student_id = a.student_id AND v.deleted_at IS NULL
       WHERE a.school_id = $1 AND a.id = $2 AND v.mobile = $3
       LIMIT 1`,
      [schoolId, admissionId, mobile],
    );
    return row ?? null;
  }

  private visitColumns(): string {
    return `v.id, v.visit_no, v.admission_id, h.name AS hostel_name, v.visitor_name, v.relation, v.mobile, v.people_count,
         v.id_proof_type, v.id_proof_last4, v.photo_file_id, v.purpose, v.is_known, v.status, v.note, v.in_at, v.out_at,
         ${STUDENT_COLUMNS}`;
  }

  private visitFrom(): string {
    return `FROM hostel_visits v
       JOIN hostels h ON h.id = v.hostel_id
       JOIN students s ON s.id = v.student_id
       ${studentJoins('s')}`;
  }

  private toVisit(row: Record<string, unknown>): VisitDto {
    return {
      id: row.id as number,
      visit_no: row.visit_no as string,
      admission_id: row.admission_id as number,
      student: studentFromRow(row),
      hostel_name: row.hostel_name as string,
      visitor_name: row.visitor_name as string,
      relation: row.relation as string,
      mobile: row.mobile as string,
      people_count: row.people_count as number,
      id_proof_type: (row.id_proof_type as VisitDto['id_proof_type']) ?? null,
      id_proof_last4: (row.id_proof_last4 as string | null) ?? null,
      photo_file_id: (row.photo_file_id as number | null) ?? null,
      purpose: (row.purpose as string | null) ?? null,
      is_known: Boolean(row.is_known),
      status: row.status as VisitDto['status'],
      note: (row.note as string | null) ?? null,
      in_at: (row.in_at as Date | null) ?? null,
      out_at: (row.out_at as Date | null) ?? null,
    };
  }

  private toApproved(row: HostelApprovedVisitor): ApprovedVisitorDto {
    return {
      id: row.id,
      student_id: row.student_id,
      name: row.name,
      relation: row.relation,
      mobile: row.mobile,
      photo_file_id: row.photo_file_id,
      added_by_role: row.added_by_role,
      created_at: row.created_at,
    };
  }
}
