import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException, AuthUser, Paginated, paginate } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { FeeFinesService } from '../fees/fee-fines.service';
import { HOSTEL_TEMPLATES } from '../notifications/hostel-templates.catalog';
import { SequencesService } from '../schools/sequences.service';
import { CaseActionDto, CaseCloseDto, CaseDto, CaseInputDto, CaseQueryDto } from './dto/hostel-conduct.dto';
import { HostelAdmission } from './entities/hostel-admission.entity';
import { HostelDisciplineCase } from './entities/hostel-conduct.entity';
import { STUDENT_COLUMNS, studentFromRow, studentJoins, escapeLike } from './hostel-sql';
import { HostelAuditService } from './hostel-audit.service';
import { HostelNotifyService } from './hostel-notify.service';
import { serialNumber } from './hostel.logic';

const CASE_SORTS: Record<string, string> = {
  created_at: 'c.created_at',
  incident_at: 'c.incident_at',
  severity: 'c.severity',
};
@Injectable()
export class HostelDisciplineService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sequences: SequencesService,
    private readonly fines: FeeFinesService,
    private readonly notify: HostelNotifyService,
    private readonly audit: HostelAuditService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async list(schoolId: number, query: CaseQueryDto, parentView = false): Promise<Paginated<CaseDto>> {
    const params: unknown[] = [schoolId];
    const where = ['c.school_id = $1', 'c.deleted_at IS NULL'];
    if (parentView) where.push(`c.visible_to_parent = true AND c.status <> 'withdrawn'`);
    if (query.hostel_id) where.push(`c.hostel_id = $${params.push(query.hostel_id)}`);
    if (query.admission_id) where.push(`c.admission_id = $${params.push(query.admission_id)}`);
    if (query.status) where.push(`c.status = $${params.push(query.status)}`);
    if (query.category) where.push(`c.category = $${params.push(query.category)}`);
    if (query.severity) where.push(`c.severity = $${params.push(query.severity)}`);
    for (const word of (query.search ?? '').split(/\s+/).filter(Boolean)) {
      const slot = `$${params.push(`%${escapeLike(word)}%`)}`;
      where.push(
        `(c.case_no ILIKE ${slot} OR s.first_name ILIKE ${slot} OR s.last_name ILIKE ${slot} OR c.description ILIKE ${slot})`,
      );
    }
    const sort = CASE_SORTS[query.sort ?? 'created_at'];
    if (!sort)
      throw AppException.badRequest(`sort must be one of ${Object.keys(CASE_SORTS).join(', ')}`, 'INVALID_SORT');
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const from = `${this.caseFrom()} WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    const rows = await this.dataSource.query(
      `SELECT ${this.caseColumns()} ${from} ORDER BY ${sort} ${order}, c.id ${order}
       LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    return paginate([rows.map((row: Record<string, unknown>) => this.toCase(row)), total], query.page, query.limit);
  }

  async get(schoolId: number, id: number): Promise<CaseDto> {
    const rows = await this.dataSource.query(
      `SELECT ${this.caseColumns()} ${this.caseFrom()} WHERE c.school_id = $1 AND c.id = $2 AND c.deleted_at IS NULL`,
      [schoolId, id],
    );
    if (!rows.length) throw AppException.notFound('Discipline case not found', 'HOSTEL_CASE_NOT_FOUND');
    return this.toCase(rows[0]);
  }

  async create(schoolId: number, dto: CaseInputDto, actor: AuthUser): Promise<CaseDto> {
    const admission = await this.dataSource.manager.findOneBy(HostelAdmission, {
      school_id: schoolId,
      id: dto.admission_id,
    });
    if (!admission) throw AppException.notFound('Hostel admission not found', 'HOSTEL_ADMISSION_NOT_FOUND');
    if (admission.status === 'checked_out') {
      throw AppException.conflict('This student has checked out of the hostel', 'HOSTEL_ADMISSION_CLOSED');
    }
    if (dto.leave_id) {
      const [leave] = await this.dataSource.query(
        `SELECT 1 FROM hostel_leaves WHERE id = $1 AND admission_id = $2 AND deleted_at IS NULL`,
        [dto.leave_id, admission.id],
      );
      if (!leave) throw AppException.notFound('Hostel leave not found', 'HOSTEL_LEAVE_NOT_FOUND');
    }
    const incidentAt = dto.incident_at ? new Date(dto.incident_at) : new Date();
    if (incidentAt.getTime() > Date.now() + 60000) {
      throw AppException.validation([{ field: 'incident_at', message: 'Cannot be in the future' }]);
    }
    const year = todayIn(this.app.timeZone).slice(0, 4);
    const id = await this.dataSource.transaction(async (manager) => {
      const value = await this.sequences.next(manager, schoolId, `hostel_case:${year}`);
      const saved = await manager.save(
        manager.create(HostelDisciplineCase, {
          school_id: schoolId,
          case_no: serialNumber('HDC', year, value),
          admission_id: admission.id,
          student_id: admission.student_id,
          hostel_id: admission.hostel_id,
          leave_id: dto.leave_id ?? null,
          category: dto.category,
          severity: dto.severity,
          incident_at: incidentAt,
          location: dto.location ?? null,
          description: dto.description,
          witnesses: dto.witnesses ?? null,
          status: 'open',
          visible_to_parent: dto.visible_to_parent ?? true,
          created_by: actor.id,
        }),
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'discipline',
        entity_id: saved.id,
        action: 'create',
        student_id: admission.student_id,
        changes: { category: dto.category, severity: dto.severity },
      });
      return saved.id;
    });
    const result = await this.get(schoolId, id);
    if (result.visible_to_parent) await this.tell(result, 'recorded');
    return result;
  }

  async act(schoolId: number, id: number, dto: CaseActionDto, actor: AuthUser): Promise<CaseDto> {
    const current = await this.lockless(schoolId, id);
    if (current.status !== 'open') {
      throw AppException.conflict(`This case is already ${current.status}`, 'HOSTEL_CASE_STATE');
    }
    if (dto.action === 'hostel_suspension' && dto.suspended_from! > dto.suspended_to!) {
      throw AppException.validation([{ field: 'suspended_to', message: 'Must be on or after suspended_from' }]);
    }
    let fineId: number | null = null;
    if (dto.action === 'fine') {
      const fine = await this.fines.raise(
        schoolId,
        {
          student_id: current.student_id,
          title: `Hostel discipline ${current.case_no}`.slice(0, 120),
          amount: dto.fine_amount,
          incident_on: todayIn(this.app.timeZone, current.incident_at),
          details: current.description.slice(0, 500),
        },
        actor,
      );
      fineId = fine.id;
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        HostelDisciplineCase,
        { id },
        {
          status: 'action_taken',
          action: dto.action,
          action_note: dto.action_note ?? null,
          fine_amount: dto.action === 'fine' ? dto.fine_amount! : null,
          fee_fine_id: fineId,
          suspended_from: dto.action === 'hostel_suspension' ? dto.suspended_from! : null,
          suspended_to: dto.action === 'hostel_suspension' ? dto.suspended_to! : null,
          decided_by: actor.id,
          decided_at: new Date(),
        },
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'discipline',
        entity_id: id,
        action: 'action',
        student_id: current.student_id,
        changes: { action: dto.action, fine_amount: dto.fine_amount ?? null, fee_fine_id: fineId },
        note: dto.action_note ?? null,
      });
    });
    const result = await this.get(schoolId, id);
    if (result.visible_to_parent) await this.tell(result, `action: ${dto.action.replace(/_/g, ' ')}`);
    return result;
  }

  async close(schoolId: number, id: number, dto: CaseCloseDto, actor: AuthUser, withdraw: boolean): Promise<CaseDto> {
    const current = await this.lockless(schoolId, id);
    if (withdraw ? current.status !== 'open' : !['open', 'action_taken'].includes(current.status)) {
      throw AppException.conflict(`This case is already ${current.status}`, 'HOSTEL_CASE_STATE');
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        HostelDisciplineCase,
        { id },
        {
          status: withdraw ? 'withdrawn' : 'closed',
          closed_at: new Date(),
          ...(dto.note
            ? { action_note: [current.action_note, dto.note].filter(Boolean).join(' · ').slice(0, 500) }
            : {}),
        },
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'discipline',
        entity_id: id,
        action: withdraw ? 'withdraw' : 'close',
        student_id: current.student_id,
        note: dto.note ?? null,
      });
    });
    return this.get(schoolId, id);
  }

  private async lockless(schoolId: number, id: number): Promise<HostelDisciplineCase> {
    const row = await this.dataSource.manager.findOneBy(HostelDisciplineCase, { school_id: schoolId, id });
    if (!row) throw AppException.notFound('Discipline case not found', 'HOSTEL_CASE_NOT_FOUND');
    return row;
  }

  private async tell(item: CaseDto, what: string): Promise<void> {
    await this.notify.tellParents(item.admission_id, HOSTEL_TEMPLATES.HOSTEL_DISCIPLINE, {
      case_no: item.case_no,
      category: item.category.replace(/_/g, ' '),
      what,
      case_id: String(item.id),
    });
  }

  private caseColumns(): string {
    return `c.id, c.case_no, c.admission_id, c.leave_id, h.name AS hostel_name, c.category, c.severity, c.incident_at,
         c.location, c.description, c.witnesses, c.status, c.action, c.action_note,
         c.suspended_from::text AS suspended_from, c.suspended_to::text AS suspended_to,
         c.fine_amount::float AS fine_amount, c.fee_fine_id, ff.status AS fine_status, c.visible_to_parent,
         ru.name AS reported_by_name, du.name AS decided_by_name, c.created_at, ${STUDENT_COLUMNS},
         CASE WHEN r.id IS NULL THEN NULL ELSE CONCAT(r.room_no, ' / ', bd.bed_no) END AS bed,
         (SELECT COUNT(*) FROM hostel_discipline_cases x
            WHERE x.admission_id = c.admission_id AND x.deleted_at IS NULL AND x.status <> 'withdrawn'
              AND x.incident_at::date BETWEEN ay.start_date AND ay.end_date)::int AS strikes`;
  }

  private caseFrom(): string {
    return `FROM hostel_discipline_cases c
       JOIN hostels h ON h.id = c.hostel_id
       JOIN students s ON s.id = c.student_id
       ${studentJoins('s')}
       LEFT JOIN fee_fines ff ON ff.id = c.fee_fine_id
       LEFT JOIN users ru ON ru.id = c.created_by
       LEFT JOIN users du ON du.id = c.decided_by
       LEFT JOIN hostel_allocations al ON al.admission_id = c.admission_id AND al.to_date IS NULL
       LEFT JOIN hostel_rooms r ON r.id = al.room_id
       LEFT JOIN hostel_beds bd ON bd.id = al.bed_id`;
  }

  private toCase(row: Record<string, unknown>): CaseDto {
    return {
      id: row.id as number,
      case_no: row.case_no as string,
      admission_id: row.admission_id as number,
      student: studentFromRow(row),
      hostel_name: row.hostel_name as string,
      bed: (row.bed as string | null) ?? null,
      leave_id: (row.leave_id as number | null) ?? null,
      category: row.category as CaseDto['category'],
      severity: row.severity as CaseDto['severity'],
      incident_at: row.incident_at as Date,
      location: (row.location as string | null) ?? null,
      description: row.description as string,
      witnesses: (row.witnesses as string | null) ?? null,
      status: row.status as CaseDto['status'],
      action: (row.action as CaseDto['action']) ?? null,
      action_note: (row.action_note as string | null) ?? null,
      suspended_from: (row.suspended_from as string | null) ?? null,
      suspended_to: (row.suspended_to as string | null) ?? null,
      fine_amount: (row.fine_amount as number | null) ?? null,
      fee_fine_id: (row.fee_fine_id as number | null) ?? null,
      fine_status: (row.fine_status as string | null) ?? null,
      visible_to_parent: Boolean(row.visible_to_parent),
      reported_by_name: (row.reported_by_name as string | null) ?? null,
      decided_by_name: (row.decided_by_name as string | null) ?? null,
      strikes: Number(row.strikes ?? 0),
      created_at: row.created_at as Date,
    };
  }
}
