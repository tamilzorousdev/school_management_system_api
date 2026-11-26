import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuthUser } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { yearClause } from '../../shared/year-context';
import { ROLES } from '../access/access.catalog';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QrTokens } from '../security/qr-tokens';
import {
  GateEventDto,
  GatePassDto,
  GateSettingsDto,
  GateStudentDto,
  PickupPersonDto,
  RefDto,
  UpdateGateSettingsDto,
  VisitDto,
} from './dto/gate.dto';
import { GateEvent, GateEventKind, GatePass, GateSettings, GateVisit } from './entities/gate.entity';
import { isLateFor, newCode, serialNo } from './gate.logic';

export const OFFICE_ROLES = [ROLES.ADMIN, ROLES.PRINCIPAL, ROLES.AO];

export const EVENT_LABELS: Record<GateEventKind, string> = {
  pass_requested: 'Gate pass requested',
  pass_approved: 'Gate pass approved',
  pass_rejected: 'Gate pass rejected',
  pass_cancelled: 'Gate pass cancelled',
  pass_expired: 'Gate pass expired unused',
  emergency_raised: 'Emergency release asked',
  emergency_escalated: 'Emergency not answered: gate told to call the office',
  consent_asked: 'Parent asked to agree',
  consent_approved: 'Parent agreed',
  consent_rejected: 'Parent refused',
  consent_verified: 'Parent’s code checked at the gate',
  pass_checked: 'Pass checked at the gate',
  check_failed: 'Pass refused at the gate',
  released: 'Student released',
  visitor_registered: 'Visitor registered',
  visitor_invited: 'Visitor invited',
  visitor_allowed: 'Visitor allowed',
  visitor_declined: 'Visitor not allowed',
  visitor_in: 'Visitor came in',
  visitor_out: 'Visitor went out',
  visitor_overstay: 'Visitor stayed too long',
  blocked_person: 'Blocked person at the gate',
};

export interface StudentRow {
  id: number;
  name: string;
  admission_no: string;
  photo_file_id: number | null;
  class_section: string | null;
  section_id: number | null;
  class_id: number | null;
  class_teacher_user_id: number | null;
}

export interface PersonRow {
  kind: 'guardian' | 'authorised';
  id: number;
  student_id: number;
  name: string;
  relation: string | null;
  mobile: string | null;
  photo_file_id: number | null;
  valid_until: string | null;
  user_id: number | null;
}

@Injectable()
export class GateCoreService {
  private readonly logger = new Logger('Gate');

  constructor(
    @InjectRepository(GateSettings) private readonly settingsRepo: Repository<GateSettings>,
    @InjectRepository(GateEvent) private readonly events: Repository<GateEvent>,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly qr: QrTokens,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  get timeZone(): string {
    return this.app.timeZone;
  }

  today(): string {
    return todayIn(this.app.timeZone);
  }

  nowTime(): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: this.app.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
  }

  async settings(schoolId: number): Promise<GateSettings> {
    const found = await this.settingsRepo.findOneBy({ school_id: schoolId });
    if (found) return found;
    await this.settingsRepo.createQueryBuilder().insert().values({ school_id: schoolId }).orIgnore().execute();
    return this.settingsRepo.findOneByOrFail({ school_id: schoolId });
  }

  async viewSettings(schoolId: number): Promise<GateSettingsDto> {
    const row = await this.settings(schoolId);
    return {
      grace_minutes: row.grace_minutes,
      emergency_wait_minutes: row.emergency_wait_minutes,
      office_escalate_minutes: row.office_escalate_minutes,
      visitor_photo_required: row.visitor_photo_required,
      visitor_id_required: row.visitor_id_required,
      visitor_checkout_time: row.visitor_checkout_time,
      notify_office_on_manual: row.notify_office_on_manual,
    };
  }

  async updateSettings(schoolId: number, dto: UpdateGateSettingsDto, actor: AuthUser): Promise<GateSettingsDto> {
    const row = await this.settings(schoolId);
    const changes: Partial<GateSettings> = {};
    for (const key of [
      'grace_minutes',
      'emergency_wait_minutes',
      'office_escalate_minutes',
      'visitor_photo_required',
      'visitor_id_required',
      'visitor_checkout_time',
      'notify_office_on_manual',
    ] as const) {
      if (dto[key] !== undefined) Object.assign(changes, { [key]: dto[key] });
    }
    await this.settingsRepo.update(row.id, { ...changes, updated_by: actor.id, updated_at: new Date() });
    return this.viewSettings(schoolId);
  }

  async log(
    schoolId: number,
    kind: GateEventKind,
    refs: { pass_id?: number | null; visit_id?: number | null; student_id?: number | null },
    actorId: number | null,
    note: string | null = null,
    method: string | null = null,
  ): Promise<void> {
    await this.events.insert({
      school_id: schoolId,
      kind,
      pass_id: refs.pass_id ?? null,
      visit_id: refs.visit_id ?? null,
      student_id: refs.student_id ?? null,
      actor_id: actorId,
      method,
      note: note?.slice(0, 300) ?? null,
    });
  }

  async presentEvents(rows: GateEvent[]): Promise<GateEventDto[]> {
    const people = await this.people(rows.map((row) => row.actor_id));
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      label: EVENT_LABELS[row.kind],
      at: row.created_at,
      actor: row.actor_id ? (people.get(row.actor_id) ?? null) : null,
      method: row.method,
      note: row.note,
      pass_id: row.pass_id,
      visit_id: row.visit_id,
    }));
  }

  async students(schoolId: number, ids: number[]): Promise<Map<number, StudentRow>> {
    const wanted = [...new Set(ids)];
    if (!wanted.length) return new Map();
    const rows: StudentRow[] = await this.dataSource.query(
      `SELECT s.id, concat_ws(' ', s.first_name, s.last_name) AS name, s.admission_no, s.photo_file_id,
              CASE WHEN c.id IS NULL THEN NULL ELSE c.name || COALESCE(' - ' || sec.name, '') END AS class_section,
              e.section_id, e.class_id, sec.class_teacher_user_id
       FROM students s
       LEFT JOIN academic_years ay ON ay.school_id = s.school_id AND ay.deleted_at IS NULL AND ${yearClause('ay')}
       LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ay.id
       LEFT JOIN classes c ON c.id = e.class_id
       LEFT JOIN sections sec ON sec.id = e.section_id
       WHERE s.school_id = $1 AND s.id = ANY($2)`,
      [schoolId, wanted],
    );
    return new Map(
      rows.map((row) => [
        Number(row.id),
        {
          ...row,
          id: Number(row.id),
          section_id: row.section_id === null ? null : Number(row.section_id),
          class_id: row.class_id === null ? null : Number(row.class_id),
          class_teacher_user_id: row.class_teacher_user_id === null ? null : Number(row.class_teacher_user_id),
        },
      ]),
    );
  }

  async searchStudents(schoolId: number, search: string): Promise<number[]> {
    const words = search.split(/\s+/).filter(Boolean).slice(0, 4);
    const params: unknown[] = [schoolId];
    const where = words.map((word) => {
      params.push(`%${word.replace(/[\\%_]/g, (match) => `\\${match}`)}%`);
      const p = `$${params.length}`;
      return `(s.first_name ILIKE ${p} OR s.last_name ILIKE ${p} OR s.admission_no ILIKE ${p}
               OR replace(c.name || COALESCE(sec.name, ''), ' ', '') ILIKE replace(${p}, ' ', ''))`;
    });
    const rows: { id: number }[] = await this.dataSource.query(
      `SELECT s.id FROM students s
       JOIN academic_years ay ON ay.school_id = s.school_id AND ay.deleted_at IS NULL AND ${yearClause('ay')}
       JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ay.id
       LEFT JOIN classes c ON c.id = e.class_id
       LEFT JOIN sections sec ON sec.id = e.section_id
       WHERE s.school_id = $1 AND s.deleted_at IS NULL AND s.status = 'active' AND ${where.join(' AND ')}
       ORDER BY s.first_name, s.last_name LIMIT 20`,
      params,
    );
    return rows.map((row) => Number(row.id));
  }

  async peopleFor(schoolId: number, studentIds: number[], onDate: string): Promise<PersonRow[]> {
    if (!studentIds.length) return [];
    const rows: PersonRow[] = await this.dataSource.query(
      `SELECT 'guardian' AS kind, g.id, sg.student_id, g.name, sg.relation, g.mobile, g.photo_file_id,
              NULL AS valid_until, g.user_id
       FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
       WHERE sg.student_id = ANY($1) AND sg.can_pickup = true
       UNION ALL
       SELECT 'authorised', a.id, a.student_id, a.name, a.relation, a.mobile, a.photo_file_id,
              to_char(a.valid_until, 'YYYY-MM-DD'), NULL
       FROM authorised_pickups a
       WHERE a.school_id = $2 AND a.student_id = ANY($1) AND a.deleted_at IS NULL AND a.is_active = true
         AND (a.valid_until IS NULL OR a.valid_until >= $3)
       ORDER BY 1, 2`,
      [studentIds, schoolId, onDate],
    );
    return rows.map((row) => ({
      ...row,
      id: Number(row.id),
      student_id: Number(row.student_id),
      user_id: row.user_id === null ? null : Number(row.user_id),
    }));
  }

  async parentUsers(studentId: number): Promise<number[]> {
    const rows: { user_id: number }[] = await this.dataSource.query(
      `SELECT DISTINCT g.user_id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
       WHERE sg.student_id = $1 AND g.user_id IS NOT NULL AND sg.receives_alerts = true`,
      [studentId],
    );
    return rows.map((row) => Number(row.user_id));
  }

  async absentToday(studentId: number): Promise<boolean> {
    const [latest] = await this.dataSource.query(
      `SELECT status FROM attendance_records WHERE student_id = $1 AND date = $2 ORDER BY period DESC LIMIT 1`,
      [studentId, this.today()],
    );
    return latest?.status === 'absent';
  }

  async takenCodes(schoolId: number, date: string): Promise<Set<string>> {
    const rows: { code: string }[] = await this.dataSource.query(
      `SELECT code FROM gate_passes WHERE school_id = $1 AND pass_date = $2 AND deleted_at IS NULL
       UNION SELECT code FROM gate_visits WHERE school_id = $1 AND visit_date = $2 AND deleted_at IS NULL`,
      [schoolId, date],
    );
    return new Set(rows.map((row) => row.code));
  }

  async freeCode(schoolId: number, date: string): Promise<string> {
    return newCode(await this.takenCodes(schoolId, date));
  }

  async nextNumber(
    schoolId: number,
    table: 'gate_passes' | 'gate_visits',
    prefix: string,
    date: string,
  ): Promise<string> {
    const year = Number(date.slice(0, 4));
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM ${table} WHERE school_id = $1 AND ${table === 'gate_passes' ? 'pass_no' : 'visit_no'} LIKE $2`,
      [schoolId, `${prefix}-${year}-%`],
    );
    return serialNo(prefix, year, Number(row.count) + 1);
  }

  async notify(
    template: string,
    audience: { user_ids: number[] } | { roles: string[]; school_id: number },
    data: Record<string, string | number>,
  ): Promise<void> {
    if ('user_ids' in audience && !audience.user_ids.length) return;
    await this.notifications
      .dispatch({ template, audience, data })
      .catch((error: Error) => this.logger.warn(`${template} not sent: ${error.message}`));
  }

  async people(ids: (number | null)[]): Promise<Map<number, RefDto>> {
    const wanted = [...new Set(ids.filter((id): id is number => typeof id === 'number'))];
    if (!wanted.length) return new Map();
    const rows: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT id, name FROM users WHERE id = ANY($1)`,
      [wanted],
    );
    return new Map(rows.map((row) => [Number(row.id), { id: Number(row.id), name: row.name }]));
  }

  async presentPasses(schoolId: number, rows: GatePass[], reveal: boolean): Promise<GatePassDto[]> {
    if (!rows.length) return [];
    const [students, people, persons] = await Promise.all([
      this.students(
        schoolId,
        rows.map((row) => row.student_id),
      ),
      this.people(rows.flatMap((row) => [row.requested_by, row.decided_by, row.released_by])),
      this.peopleFor(
        schoolId,
        rows.map((row) => row.student_id),
        '1900-01-01',
      ),
    ]);
    const files = await this.files.presentMany([
      ...rows.flatMap((row) => [row.pickup_photo_file_id, row.release_photo_file_id]),
      ...[...students.values()].map((row) => row.photo_file_id),
      ...persons.map((row) => row.photo_file_id),
    ]);
    return rows.map((row) => {
      const person =
        row.pickup_kind === 'guardian'
          ? persons.find((item) => item.kind === 'guardian' && item.id === row.guardian_id)
          : row.pickup_kind === 'authorised'
            ? persons.find((item) => item.kind === 'authorised' && item.id === row.authorised_id)
            : undefined;
      const photoId = row.pickup_photo_file_id ?? person?.photo_file_id ?? null;
      const live = reveal && row.status === 'approved';
      return {
        id: row.id,
        pass_no: row.pass_no,
        student: this.studentView(students.get(row.student_id), row.student_id, files),
        pass_date: row.pass_date,
        from_time: row.from_time,
        until_time: row.until_time,
        reason: row.reason,
        pass_type: row.pass_type,
        pickup:
          row.pickup_kind && row.pickup_name
            ? {
                kind: row.pickup_kind,
                id: row.guardian_id ?? row.authorised_id,
                name: row.pickup_name,
                relation: row.pickup_relation,
                mobile: row.pickup_mobile,
                photo: photoId ? (files.get(photoId) ?? null) : null,
                valid_until: person?.valid_until ?? null,
              }
            : null,
        status: row.status,
        source: row.source,
        is_emergency: row.is_emergency,
        needs_consent: row.needs_consent,
        consent_status: row.consent_status,
        consent_verified: Boolean(row.consent_verified_at),
        requested_by: row.requested_by ? (people.get(row.requested_by) ?? null) : null,
        decided_by: row.decided_by ? (people.get(row.decided_by) ?? null) : null,
        decided_at: row.decided_at,
        decision_note: row.decision_note,
        released_at: row.released_at,
        released_by: row.released_by ? (people.get(row.released_by) ?? null) : null,
        release_method: row.release_method,
        release_photo: row.release_photo_file_id ? (files.get(row.release_photo_file_id) ?? null) : null,
        id_proof_kind: row.id_proof_kind,
        id_proof_last4: row.id_proof_last4,
        escalated: Boolean(row.escalated_at),
        escalated_to_head_ao: Boolean(row.office_escalated_at),
        qr_token: live ? this.qr.gate('p', row.id, row.qr_version) : null,
        code: live ? row.code : null,
        created_at: row.created_at,
      };
    });
  }

  async presentVisits(schoolId: number, rows: GateVisit[], reveal: boolean): Promise<VisitDto[]> {
    if (!rows.length) return [];
    const settings = await this.settings(schoolId);
    const [people, students] = await Promise.all([
      this.people(rows.flatMap((row) => [row.host_user_id, row.invited_by, row.decided_by])),
      this.students(
        schoolId,
        rows.map((row) => row.student_id).filter((id): id is number => id !== null),
      ),
    ]);
    const files = await this.files.presentMany([
      ...rows.map((row) => row.photo_file_id),
      ...[...students.values()].map((row) => row.photo_file_id),
    ]);
    const today = this.today();
    const now = this.nowTime();
    return rows.map((row) => {
      const live = reveal && ['expected', 'allowed', 'inside'].includes(row.status);
      return {
        id: row.id,
        visit_no: row.visit_no,
        visit_date: row.visit_date,
        name: row.name,
        mobile: row.mobile,
        photo: row.photo_file_id ? (files.get(row.photo_file_id) ?? null) : null,
        id_proof_kind: row.id_proof_kind,
        id_proof_last4: row.id_proof_last4,
        purpose: row.purpose,
        purpose_note: row.purpose_note,
        company: row.company,
        people_count: row.people_count,
        vehicle_no: row.vehicle_no,
        host: row.host_user_id ? (people.get(row.host_user_id) ?? null) : null,
        student: row.student_id ? this.studentView(students.get(row.student_id), row.student_id, files) : null,
        status: row.status,
        expected_from: row.expected_from,
        expected_until: row.expected_until,
        invited_by: row.invited_by ? (people.get(row.invited_by) ?? null) : null,
        decided_by: row.decided_by ? (people.get(row.decided_by) ?? null) : null,
        decision_note: row.decision_note,
        checked_in_at: row.checked_in_at,
        check_in_method: row.check_in_method,
        checked_out_at: row.checked_out_at,
        check_out_method: row.check_out_method,
        overstay:
          Boolean(row.overstay_alerted_at) ||
          (row.visit_date === today && isLateFor(row, now, settings.visitor_checkout_time)),
        blocked: row.blocked_hit,
        qr_token: live ? this.qr.gate('v', row.id, row.qr_version) : null,
        code: live ? row.code : null,
        created_at: row.created_at,
      };
    });
  }

  personView(row: PersonRow, files: Map<number, { id: number }>): PickupPersonDto {
    return {
      kind: row.kind,
      id: row.id,
      name: row.name,
      relation: row.relation,
      mobile: row.mobile,
      photo: row.photo_file_id ? ((files.get(row.photo_file_id) as PickupPersonDto['photo']) ?? null) : null,
      valid_until: row.valid_until,
    };
  }

  studentView(
    row: StudentRow | undefined,
    id: number,
    files: Map<number, GateStudentDto['photo'] & object>,
  ): GateStudentDto {
    return {
      id,
      name: row?.name ?? '',
      admission_no: row?.admission_no ?? '',
      class_section: row?.class_section ?? null,
      photo: row?.photo_file_id ? (files.get(row.photo_file_id) ?? null) : null,
    };
  }

  readQr(token: string) {
    return this.qr.readGate(token);
  }

  async presentFiles(ids: (number | null)[]) {
    return this.files.presentMany(ids);
  }

  async assertFile(fileId: number | null | undefined, schoolId: number, field: string): Promise<void> {
    if (fileId) await this.files.assertAttachable(fileId, schoolId, field);
  }
}
