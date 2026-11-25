import { createHash } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, AuthUser, ListQueryDto, Paginated, paginate } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { ROLES } from '../access/access.catalog';
import { HOSTEL_TEMPLATES } from '../notifications/hostel-templates.catalog';
import { SequencesService } from '../schools/sequences.service';
import { ApplicationDto } from './dto/hostel-admission.dto';
import {
  ParentApplicationInputDto,
  ParentHostelOptionsDto,
  RuleAckQueryDto,
  RuleAckRowDto,
  RuleAckSummaryDto,
  RulesDto,
  SosCloseDto,
  SosCountsDto,
  SosDetailDto,
  SosDto,
  SosEntryDto,
  SosInputDto,
  SosMarkDto,
  SosQueryDto,
} from './dto/hostel-safety.dto';
import { HostelAdmission } from './entities/hostel-admission.entity';
import { HostelSosEvent, SosMark } from './entities/hostel-safety.entity';
import { Hostel } from './entities/hostel.entity';
import { HostelAdmissionsService } from './hostel-admissions.service';
import { HostelAuditService } from './hostel-audit.service';
import { HostelNotifyService } from './hostel-notify.service';
import { HostelParentService } from './hostel-parent.service';
import { HostelSettingsService } from './hostel-settings.service';
import { escapeLike, STUDENT_COLUMNS, studentFromRow, studentJoins } from './hostel-sql';
import { genderAllowed, serialNumber } from './hostel.logic';

const SOS_LABEL: Record<string, string> = {
  fire: 'FIRE ALERT',
  medical: 'MEDICAL EMERGENCY',
  security: 'SECURITY ALERT',
  missing_student: 'MISSING STUDENT',
  natural_disaster: 'EMERGENCY',
  drill: 'DRILL',
  other: 'EMERGENCY',
};

const ESCALATE_TO = [ROLES.WARDEN, ROLES.ASSISTANT_WARDEN, ROLES.ADMIN, ROLES.PRINCIPAL];

export function rulesVersion(rules: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(rules)).digest('hex');
}

@Injectable()
export class HostelSafetyService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sequences: SequencesService,
    private readonly settings: HostelSettingsService,
    private readonly notify: HostelNotifyService,
    private readonly audit: HostelAuditService,
    private readonly admissions: HostelAdmissionsService,
    private readonly parents: HostelParentService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async list(schoolId: number, query: SosQueryDto): Promise<Paginated<SosDto>> {
    if (query.sort && query.sort !== 'created_at')
      throw AppException.badRequest('sort must be created_at', 'INVALID_SORT');
    const params: unknown[] = [schoolId];
    const where = ['e.school_id = $1', 'e.deleted_at IS NULL'];
    if (query.hostel_id) where.push(`e.hostel_id = $${params.push(query.hostel_id)}`);
    if (query.status) where.push(`e.status = $${params.push(query.status)}`);
    for (const word of (query.search ?? '').split(/\s+/).filter(Boolean)) {
      const slot = `$${params.push(`%${escapeLike(word)}%`)}`;
      where.push(`(e.sos_no ILIKE ${slot} OR e.message ILIKE ${slot})`);
    }
    const from = `FROM hostel_sos_events e WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const ids: { id: number }[] = await this.dataSource.query(
      `SELECT e.id ${from} ORDER BY e.created_at ${order}, e.id ${order}
       LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    const items = await Promise.all(ids.map((row) => this.summary(schoolId, row.id)));
    return paginate([items, total], query.page, query.limit);
  }

  async active(schoolId: number, hostelId?: number): Promise<SosDto[]> {
    const params: unknown[] = [schoolId];
    const filter = hostelId ? ` AND hostel_id = $${params.push(hostelId)}` : '';
    const rows: { id: number }[] = await this.dataSource.query(
      `SELECT id FROM hostel_sos_events WHERE school_id = $1 AND status = 'open' AND deleted_at IS NULL${filter}
       ORDER BY created_at DESC`,
      params,
    );
    return Promise.all(rows.map((row) => this.summary(schoolId, row.id)));
  }

  async get(schoolId: number, id: number): Promise<SosDetailDto> {
    const event = await this.summary(schoolId, id);
    return { ...event, students: await this.entries(schoolId, event.hostel_id, id) };
  }

  async raise(schoolId: number, dto: SosInputDto, actor: AuthUser): Promise<SosDetailDto> {
    const hostel = await this.dataSource.manager.findOneBy(Hostel, { school_id: schoolId, id: dto.hostel_id });
    if (!hostel) throw AppException.notFound('Hostel not found', 'HOSTEL_NOT_FOUND');
    if (dto.admission_id) {
      const admission = await this.dataSource.manager.findOneBy(HostelAdmission, {
        school_id: schoolId,
        id: dto.admission_id,
      });
      if (!admission || admission.hostel_id !== hostel.id) {
        throw AppException.notFound('This student does not stay in this hostel', 'HOSTEL_NOT_RESIDENT');
      }
    }
    const drill = dto.is_drill === true || dto.kind === 'drill';
    const year = todayIn(this.app.timeZone).slice(0, 4);
    const id = await this.dataSource.transaction(async (manager) => {
      const value = await this.sequences.next(manager, schoolId, `hostel_sos:${year}`);
      const saved = await manager.save(
        manager.create(HostelSosEvent, {
          school_id: schoolId,
          sos_no: serialNumber('SOS', year, value),
          hostel_id: hostel.id,
          kind: dto.kind,
          message: dto.message,
          admission_id: dto.admission_id ?? null,
          is_drill: drill,
          notify_parents: !drill && Boolean(dto.notify_parents),
          status: 'open',
          created_by: actor.id,
        }),
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'sos',
        entity_id: saved.id,
        action: 'raise',
        changes: { kind: dto.kind, drill, notify_parents: saved.notify_parents },
        note: dto.message,
      });
      return saved.id;
    });
    const event = await this.get(schoolId, id);
    const data = {
      sos_no: event.sos_no,
      hostel: hostel.name,
      kind: dto.kind.replace(/_/g, ' '),
      label: SOS_LABEL[dto.kind] ?? 'EMERGENCY',
      message: dto.message,
      raised_by: actor.name,
      sos_id: String(id),
    };
    await this.notify.tellRoles(schoolId, ESCALATE_TO, HOSTEL_TEMPLATES.HOSTEL_SOS, data);
    if (event.notify_parents) {
      await this.notify.tellHostelParents(schoolId, hostel.id, HOSTEL_TEMPLATES.HOSTEL_SOS_PARENT, {
        ...data,
        warden_phone: hostel.phone ?? '-',
      });
    }
    return event;
  }

  async mark(schoolId: number, id: number, dto: SosMarkDto, actor: AuthUser): Promise<SosDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      const event = await this.lockOpen(manager, schoolId, id);
      const ids = [...new Set(dto.entries.map((entry) => entry.admission_id))];
      const live: { id: number; student_id: number }[] = await manager.query(
        `SELECT id, student_id FROM hostel_admissions
         WHERE school_id = $1 AND hostel_id = $2 AND id = ANY($3) AND status <> 'checked_out' AND deleted_at IS NULL`,
        [schoolId, event.hostel_id, ids],
      );
      const students = new Map(live.map((row) => [Number(row.id), Number(row.student_id)]));
      const missing = ids.filter((admissionId) => !students.has(admissionId));
      if (missing.length) {
        throw AppException.badRequest(
          `Not residents of this hostel: admission ${missing.join(', ')}`,
          'HOSTEL_NOT_RESIDENT',
        );
      }
      for (const entry of dto.entries) {
        await manager.query(
          `INSERT INTO hostel_sos_marks (school_id, sos_id, admission_id, student_id, status, marked_by, marked_at)
           VALUES ($1, $2, $3, $4, $5, $6, now())
           ON CONFLICT (sos_id, admission_id) DO UPDATE SET status = EXCLUDED.status,
             marked_by = EXCLUDED.marked_by, marked_at = now()`,
          [schoolId, id, entry.admission_id, students.get(entry.admission_id), entry.status, actor.id],
        );
      }
    });
    return this.get(schoolId, id);
  }

  async close(schoolId: number, id: number, dto: SosCloseDto, actor: AuthUser, cancel: boolean): Promise<SosDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      const event = await this.lockOpen(manager, schoolId, id);
      Object.assign(event, {
        status: cancel ? 'cancelled' : 'resolved',
        resolved_by: actor.id,
        resolved_at: new Date(),
        resolution: dto.note ?? null,
      });
      await manager.save(event);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'sos',
        entity_id: id,
        action: cancel ? 'cancel' : 'resolve',
        note: dto.note ?? null,
      });
    });
    return this.get(schoolId, id);
  }

  async rules(schoolId: number, admissionId: number | null, userId: number | null): Promise<RulesDto> {
    const settings = await this.settings.get(schoolId);
    const body = {
      rules: settings.rules,
      wake_up_time: settings.wake_up_time,
      study_start_time: settings.study_start_time,
      study_end_time: settings.study_end_time,
      in_time: settings.in_time,
      lights_out_time: settings.lights_out_time,
      outing_from_time: settings.outing_from_time,
      outing_until_time: settings.outing_until_time,
    };
    const version = rulesVersion(body);
    let acknowledgedAt: Date | null = null;
    if (admissionId && userId) {
      const [row] = await this.dataSource.query(
        `SELECT acknowledged_at FROM hostel_rule_acks WHERE admission_id = $1 AND user_id = $2 AND rules_hash = $3`,
        [admissionId, userId, version],
      );
      acknowledgedAt = row?.acknowledged_at ?? null;
    }
    return { ...body, version, acknowledged: Boolean(acknowledgedAt), acknowledged_at: acknowledgedAt };
  }

  async acknowledges(schoolId: number, query: RuleAckQueryDto): Promise<Paginated<RuleAckRowDto>> {
    const { version } = await this.rules(schoolId, null, null);
    const params: unknown[] = [schoolId, version];
    const where = ['a.school_id = $1', 'a.deleted_at IS NULL', `a.status <> 'checked_out'`];
    if (query.hostel_id) where.push(`a.hostel_id = $${params.push(query.hostel_id)}`);
    if (query.acknowledged === true) where.push('ack.acknowledged_at IS NOT NULL');
    if (query.acknowledged === false) where.push('ack.acknowledged_at IS NULL');
    for (const word of (query.search ?? '').split(/\s+/).filter(Boolean)) {
      const slot = `$${params.push(`%${escapeLike(word)}%`)}`;
      where.push(`(s.first_name ILIKE ${slot} OR s.last_name ILIKE ${slot} OR s.admission_no ILIKE ${slot})`);
    }
    const from = `FROM hostel_admissions a
       JOIN hostels h ON h.id = a.hostel_id
       JOIN students s ON s.id = a.student_id
       ${studentJoins('s')}
       LEFT JOIN LATERAL (
         SELECT r.acknowledged_at, u.name FROM hostel_rule_acks r JOIN users u ON u.id = r.user_id
         WHERE r.admission_id = a.id AND r.rules_hash = $2 ORDER BY r.acknowledged_at LIMIT 1
       ) ack ON true
       WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    const rows = await this.dataSource.query(
      `SELECT a.id AS admission_id, h.name AS hostel_name, ${STUDENT_COLUMNS},
         ack.acknowledged_at, ack.name AS acknowledged_by
       ${from} ORDER BY ack.acknowledged_at NULLS FIRST, s.first_name
       LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    return paginate(
      [
        rows.map((row: Record<string, unknown>) => ({
          admission_id: row.admission_id as number,
          student: studentFromRow(row),
          hostel_name: row.hostel_name as string,
          acknowledged: Boolean(row.acknowledged_at),
          acknowledged_at: (row.acknowledged_at as Date | null) ?? null,
          acknowledged_by: (row.acknowledged_by as string | null) ?? null,
        })),
        total,
      ],
      query.page,
      query.limit,
    );
  }

  async acknowledgeSummary(schoolId: number, hostelId?: number): Promise<RuleAckSummaryDto> {
    const { version } = await this.rules(schoolId, null, null);
    const params: unknown[] = [schoolId, version];
    const filter = hostelId ? ` AND a.hostel_id = $${params.push(hostelId)}` : '';
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS residents,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM hostel_rule_acks r WHERE r.admission_id = a.id AND r.rules_hash = $2))::int AS acknowledged
       FROM hostel_admissions a
       WHERE a.school_id = $1 AND a.deleted_at IS NULL AND a.status <> 'checked_out'${filter}`,
      params,
    );
    return { version, residents: row.residents, acknowledged: row.acknowledged };
  }

  async parentRules(user: AuthUser, studentId: number): Promise<RulesDto> {
    const stay = await this.parents.resident(user, studentId);
    return this.rules(stay.school_id, stay.admission_id, user.id);
  }

  async parentAcknowledge(user: AuthUser, studentId: number): Promise<RulesDto> {
    const stay = await this.parents.resident(user, studentId);
    const current = await this.rules(stay.school_id, stay.admission_id, user.id);
    if (!current.acknowledged) {
      await this.dataSource.query(
        `INSERT INTO hostel_rule_acks (school_id, admission_id, user_id, rules_hash, acknowledged_at)
         VALUES ($1, $2, $3, $4, now()) ON CONFLICT (admission_id, user_id, rules_hash) DO NOTHING`,
        [stay.school_id, stay.admission_id, user.id, current.version],
      );
    }
    return this.rules(stay.school_id, stay.admission_id, user.id);
  }

  async parentOptions(user: AuthUser, studentId: number): Promise<ParentHostelOptionsDto> {
    const stay = await this.parents.child(user, studentId);
    const [student] = await this.dataSource.query(`SELECT gender FROM students WHERE id = $1`, [studentId]);
    const hostels: { id: number; name: string; gender: 'boys' | 'girls' | 'mixed'; vacant_beds: number }[] =
      await this.dataSource.query(
        `SELECT h.id, h.name, h.gender,
           (SELECT COUNT(*) FROM hostel_beds b JOIN hostel_rooms r ON r.id = b.room_id AND r.status = 'active' AND r.deleted_at IS NULL
            WHERE b.hostel_id = h.id AND b.status = 'vacant' AND b.deleted_at IS NULL)::int AS vacant_beds
         FROM hostels h WHERE h.school_id = $1 AND h.status = 'active' AND h.deleted_at IS NULL ORDER BY h.name`,
        [stay.school_id],
      );
    const roomTypes = await this.dataSource.query(
      `SELECT id, name, default_beds, is_ac, attached_bathroom, annual_fee::float AS annual_fee, amenities
       FROM hostel_room_types WHERE school_id = $1 AND deleted_at IS NULL ORDER BY annual_fee, name`,
      [stay.school_id],
    );
    const settings = await this.settings.get(stay.school_id);
    return {
      hostels: hostels.filter((hostel) => genderAllowed(hostel.gender, student?.gender ?? '')),
      room_types: roomTypes,
      caution_deposit: settings.caution_deposit,
      in_hostel: Boolean(stay.admission_id),
    };
  }

  async parentApplications(user: AuthUser, studentId: number, query: ListQueryDto): Promise<Paginated<ApplicationDto>> {
    const stay = await this.parents.child(user, studentId);
    return this.admissions.listApplications(
      stay.school_id,
      Object.assign(query, { student_id: studentId, sort: 'created_at' }),
    );
  }

  async parentApply(user: AuthUser, studentId: number, dto: ParentApplicationInputDto): Promise<ApplicationDto> {
    const stay = await this.parents.child(user, studentId);
    const application = await this.admissions.createApplication(
      stay.school_id,
      {
        student_id: studentId,
        hostel_id: dto.hostel_id ?? null,
        room_type_id: dto.room_type_id ?? null,
        wanted_from: dto.wanted_from,
        reason: dto.reason ?? null,
      },
      user,
      'parent',
    );
    await this.notify.tellRoles(stay.school_id, [ROLES.WARDEN, ROLES.ADMIN], HOSTEL_TEMPLATES.HOSTEL_APPLICATION_NEW, {
      student: application.student.name,
      class: [application.student.class_name, application.student.section_name].filter(Boolean).join(' ') || '-',
      hostel: application.hostel_name ?? 'the hostel',
      reason: application.reason ?? '',
      application_id: String(application.id),
    });
    return application;
  }

  private async summary(schoolId: number, id: number): Promise<SosDto> {
    const [row] = await this.dataSource.query(
      `SELECT e.id, e.sos_no, e.hostel_id, h.name AS hostel_name, e.kind, e.message, e.admission_id, e.is_drill,
         e.notify_parents, e.status, ru.name AS raised_by_name, cu.name AS resolved_by_name, e.resolved_at,
         e.resolution, e.created_at, ${STUDENT_COLUMNS}
       FROM hostel_sos_events e
       JOIN hostels h ON h.id = e.hostel_id
       LEFT JOIN users ru ON ru.id = e.created_by
       LEFT JOIN users cu ON cu.id = e.resolved_by
       LEFT JOIN hostel_admissions ad ON ad.id = e.admission_id
       LEFT JOIN students s ON s.id = ad.student_id
       ${studentJoins('s')}
       WHERE e.school_id = $1 AND e.id = $2 AND e.deleted_at IS NULL`,
      [schoolId, id],
    );
    if (!row) throw AppException.notFound('Alert not found', 'HOSTEL_SOS_NOT_FOUND');
    return {
      id: row.id,
      sos_no: row.sos_no,
      hostel_id: row.hostel_id,
      hostel_name: row.hostel_name,
      kind: row.kind,
      message: row.message,
      student: row.student_id ? studentFromRow(row) : null,
      is_drill: row.is_drill,
      notify_parents: row.notify_parents,
      status: row.status,
      raised_by_name: row.raised_by_name ?? null,
      resolved_by_name: row.resolved_by_name ?? null,
      resolved_at: row.resolved_at ?? null,
      resolution: row.resolution ?? null,
      counts: await this.counts(schoolId, row.hostel_id, id),
      created_at: row.created_at,
    };
  }

  private async counts(schoolId: number, hostelId: number, id: number): Promise<SosCountsDto> {
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE m.status = 'safe')::int AS safe,
         COUNT(*) FILTER (WHERE m.status = 'missing')::int AS missing,
         COUNT(*) FILTER (WHERE m.status = 'injured')::int AS injured,
         COUNT(*) FILTER (WHERE m.status = 'away')::int AS away,
         COUNT(*) FILTER (WHERE m.id IS NULL)::int AS unmarked
       FROM hostel_admissions a
       LEFT JOIN hostel_sos_marks m ON m.admission_id = a.id AND m.sos_id = $3
       WHERE a.school_id = $1 AND a.hostel_id = $2 AND a.status <> 'checked_out' AND a.deleted_at IS NULL`,
      [schoolId, hostelId, id],
    );
    return row;
  }

  private async entries(schoolId: number, hostelId: number, id: number): Promise<SosEntryDto[]> {
    const rows = await this.dataSource.query(
      `SELECT a.id AS admission_id, ${STUDENT_COLUMNS}, r.room_no, b.name AS block_name, m.status, m.marked_at,
         EXISTS (SELECT 1 FROM hostel_leaves l WHERE l.admission_id = a.id AND l.status = 'out' AND l.deleted_at IS NULL) AS away
       FROM hostel_admissions a
       JOIN students s ON s.id = a.student_id
       ${studentJoins('s')}
       LEFT JOIN hostel_allocations al ON al.admission_id = a.id AND al.to_date IS NULL
       LEFT JOIN hostel_rooms r ON r.id = al.room_id
       LEFT JOIN hostel_blocks b ON b.id = r.block_id
       LEFT JOIN hostel_sos_marks m ON m.admission_id = a.id AND m.sos_id = $3
       WHERE a.school_id = $1 AND a.hostel_id = $2 AND a.status <> 'checked_out' AND a.deleted_at IS NULL
       ORDER BY (m.status = 'missing') DESC NULLS FIRST, b.sort_order NULLS LAST, r.room_no NULLS LAST, s.first_name`,
      [schoolId, hostelId, id],
    );
    return rows.map((row: Record<string, unknown>) => ({
      admission_id: row.admission_id as number,
      student: studentFromRow(row),
      room_no: (row.room_no as string | null) ?? null,
      block_name: (row.block_name as string | null) ?? null,
      status: (row.status as SosMark | null) ?? null,
      suggested_status: row.away ? 'away' : null,
      marked_at: (row.marked_at as Date | null) ?? null,
    }));
  }

  private async lockOpen(manager: EntityManager, schoolId: number, id: number): Promise<HostelSosEvent> {
    const event = await manager.findOne(HostelSosEvent, {
      where: { school_id: schoolId, id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!event) throw AppException.notFound('Alert not found', 'HOSTEL_SOS_NOT_FOUND');
    if (event.status !== 'open')
      throw AppException.conflict(`This alert is already ${event.status}`, 'HOSTEL_SOS_CLOSED');
    return event;
  }
}
