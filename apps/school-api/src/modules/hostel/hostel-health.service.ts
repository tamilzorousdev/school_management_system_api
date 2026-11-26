import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, AuthUser, Paginated, paginate } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { HOSTEL_TEMPLATES } from '../notifications/hostel-templates.catalog';
import {
  DoseDto,
  DoseInputDto,
  HealthLogDto,
  HealthLogInputDto,
  HealthLogNoteDto,
  HealthLogPatchDto,
  HealthLogQueryDto,
  MedicationDto,
  MedicationDueDto,
  MedicationDueQueryDto,
  MedicationInputDto,
  MedicationQueryDto,
} from './dto/hostel-care.dto';
import { HostelHealthLog, HostelMedication } from './entities/hostel-care.entity';
import {
  appendNote,
  DOSE_BACK_DAYS,
  doseOverdue,
  healthMessage,
  medicationRunsOn,
  timeIn,
  uniqueTimes,
  withinBackDays,
} from './hostel-care.logic';
import { BED_COLUMN, bedJoins, careAdmission, pageClause, sortColumn } from './hostel-care-sql';
import { escapeLike, STUDENT_COLUMNS, studentFromRow, studentJoins } from './hostel-sql';
import { HostelAuditService } from './hostel-audit.service';
import { HostelNotifyService } from './hostel-notify.service';

const HEALTH_SORTS: Record<string, string> = { logged_at: 'hl.logged_at', created_at: 'hl.created_at' };
const MEDICATION_SORTS: Record<string, string> = { created_at: 'm.created_at', from_date: 'm.from_date' };
const IN_SICK_BAY = `hl.sick_bay_from IS NOT NULL AND hl.sick_bay_to IS NULL AND hl.status = 'open'`;

@Injectable()
export class HostelHealthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly notify: HostelNotifyService,
    private readonly audit: HostelAuditService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  today(): string {
    return todayIn(this.app.timeZone);
  }

  async inSickBay(schoolId: number, hostelId: number): Promise<Set<number>> {
    const rows: { admission_id: number }[] = await this.dataSource.query(
      `SELECT DISTINCT hl.admission_id FROM hostel_health_logs hl
       WHERE hl.school_id = $1 AND hl.hostel_id = $2 AND hl.deleted_at IS NULL AND ${IN_SICK_BAY}`,
      [schoolId, hostelId],
    );
    return new Set(rows.map((row) => Number(row.admission_id)));
  }

  async logs(schoolId: number, query: HealthLogQueryDto): Promise<Paginated<HealthLogDto>> {
    const sort = sortColumn(HEALTH_SORTS, query.sort, 'logged_at');
    const params: unknown[] = [schoolId];
    const where = ['hl.school_id = $1', 'hl.deleted_at IS NULL'];
    if (query.hostel_id) where.push(`hl.hostel_id = $${params.push(query.hostel_id)}`);
    if (query.admission_id) where.push(`hl.admission_id = $${params.push(query.admission_id)}`);
    if (query.status) where.push(`hl.status = $${params.push(query.status)}`);
    if (query.kind) where.push(`hl.kind = $${params.push(query.kind)}`);
    if (query.in_sick_bay !== undefined) where.push(query.in_sick_bay ? `(${IN_SICK_BAY})` : `NOT (${IN_SICK_BAY})`);
    for (const word of (query.search ?? '').split(/\s+/).filter(Boolean)) {
      const slot = `$${params.push(`%${escapeLike(word)}%`)}`;
      where.push(
        `(s.first_name ILIKE ${slot} OR s.last_name ILIKE ${slot} OR s.admission_no ILIKE ${slot} OR hl.symptoms ILIKE ${slot})`,
      );
    }
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const from = `${this.logFrom()} WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    const rows = await this.dataSource.query(
      `SELECT ${this.logColumns()} ${from} ORDER BY ${sort} ${order}, hl.id ${order} ${pageClause(query)}`,
      params,
    );
    return paginate([rows.map((row: Record<string, unknown>) => this.toLog(row)), total], query.page, query.limit);
  }

  async log(schoolId: number, id: number, admissionId?: number): Promise<HealthLogDto> {
    const params: unknown[] = [schoolId, id];
    const own = admissionId ? ` AND hl.admission_id = $${params.push(admissionId)}` : '';
    const rows = await this.dataSource.query(
      `SELECT ${this.logColumns()} ${this.logFrom()}
       WHERE hl.school_id = $1 AND hl.id = $2 AND hl.deleted_at IS NULL${own}`,
      params,
    );
    if (!rows.length) throw AppException.notFound('Health record not found', 'HOSTEL_HEALTH_NOT_FOUND');
    return this.toLog(rows[0]);
  }

  async createLog(schoolId: number, dto: HealthLogInputDto, actor: AuthUser): Promise<HealthLogDto> {
    const admission = await careAdmission(this.dataSource, schoolId, dto.admission_id);
    const loggedAt = dto.logged_at ? new Date(dto.logged_at) : new Date();
    if (loggedAt.getTime() > Date.now() + 60000) {
      throw AppException.validation([{ field: 'logged_at', message: 'Cannot be in the future' }]);
    }
    const sickBay = Boolean(dto.sick_bay) || dto.kind === 'sick_bay';
    const id = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(
        manager.create(HostelHealthLog, {
          school_id: schoolId,
          admission_id: admission.id,
          student_id: admission.student_id,
          hostel_id: admission.hostel_id,
          kind: dto.kind,
          logged_at: loggedAt,
          symptoms: dto.symptoms,
          temperature: dto.temperature ?? null,
          action_taken: dto.action_taken ?? null,
          doctor_name: dto.doctor_name ?? null,
          hospital_visit: dto.hospital_visit ?? false,
          parent_informed: false,
          status: 'open',
          sick_bay_from: sickBay ? new Date() : null,
          sick_bay_to: null,
          closed_at: null,
          created_by: actor.id,
        }),
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'health',
        entity_id: saved.id,
        action: 'create',
        student_id: admission.student_id,
        changes: { kind: dto.kind, sick_bay: sickBay, hospital_visit: dto.hospital_visit ?? false },
      });
      return saved.id;
    });
    if (dto.notify_parent ?? true) await this.tellParents(schoolId, id);
    return this.log(schoolId, id);
  }

  async patchLog(schoolId: number, id: number, dto: HealthLogPatchDto, actor: AuthUser): Promise<HealthLogDto> {
    await this.dataSource.transaction(async (manager) => {
      const row = await this.lockLog(manager, schoolId, id);
      if (row.status !== 'open') {
        throw AppException.conflict('This health record is closed', 'HOSTEL_HEALTH_CLOSED');
      }
      const changes: Partial<HostelHealthLog> = {};
      if (dto.kind !== undefined) changes.kind = dto.kind;
      if (dto.symptoms !== undefined) changes.symptoms = dto.symptoms;
      if (dto.temperature !== undefined) changes.temperature = dto.temperature;
      if (dto.action_taken !== undefined) changes.action_taken = dto.action_taken;
      if (dto.doctor_name !== undefined) changes.doctor_name = dto.doctor_name;
      if (dto.hospital_visit !== undefined) changes.hospital_visit = dto.hospital_visit;
      const inBay = Boolean(row.sick_bay_from) && !row.sick_bay_to;
      if (dto.sick_bay === true && !inBay) Object.assign(changes, { sick_bay_from: new Date(), sick_bay_to: null });
      if (dto.sick_bay === false && inBay) changes.sick_bay_to = new Date();
      if (!Object.keys(changes).length) return;
      await manager.update(HostelHealthLog, { id }, changes);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'health',
        entity_id: id,
        action: 'update',
        student_id: row.student_id,
        changes: { ...changes },
      });
    });
    if (dto.notify_parent) await this.tellParents(schoolId, id);
    return this.log(schoolId, id);
  }

  async discharge(schoolId: number, id: number, dto: HealthLogNoteDto, actor: AuthUser): Promise<HealthLogDto> {
    await this.dataSource.transaction(async (manager) => {
      const row = await this.lockLog(manager, schoolId, id);
      if (row.status !== 'open' || !row.sick_bay_from || row.sick_bay_to) {
        throw AppException.conflict('This student is not in the sick bay', 'HOSTEL_SICK_BAY_STATE');
      }
      await manager.update(
        HostelHealthLog,
        { id },
        { sick_bay_to: new Date(), action_taken: appendNote(row.action_taken, dto.note) },
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'health',
        entity_id: id,
        action: 'discharge',
        student_id: row.student_id,
        note: dto.note ?? null,
      });
    });
    if (dto.notify_parent) await this.tellParents(schoolId, id);
    return this.log(schoolId, id);
  }

  async close(schoolId: number, id: number, dto: HealthLogNoteDto, actor: AuthUser): Promise<HealthLogDto> {
    await this.dataSource.transaction(async (manager) => {
      const row = await this.lockLog(manager, schoolId, id);
      if (row.status !== 'open') {
        throw AppException.conflict('This health record is already closed', 'HOSTEL_HEALTH_CLOSED');
      }
      const now = new Date();
      await manager.update(
        HostelHealthLog,
        { id },
        {
          status: 'closed',
          closed_at: now,
          sick_bay_to: row.sick_bay_from && !row.sick_bay_to ? now : row.sick_bay_to,
          action_taken: appendNote(row.action_taken, dto.note),
        },
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'health',
        entity_id: id,
        action: 'close',
        student_id: row.student_id,
        note: dto.note ?? null,
      });
    });
    if (dto.notify_parent) await this.tellParents(schoolId, id);
    return this.log(schoolId, id);
  }

  async medications(schoolId: number, query: MedicationQueryDto): Promise<Paginated<MedicationDto>> {
    const sort = sortColumn(MEDICATION_SORTS, query.sort, 'created_at');
    const today = this.today();
    const params: unknown[] = [schoolId];
    const where = ['m.school_id = $1', 'm.deleted_at IS NULL'];
    if (query.hostel_id) where.push(`a.hostel_id = $${params.push(query.hostel_id)}`);
    if (query.admission_id) where.push(`m.admission_id = $${params.push(query.admission_id)}`);
    if (query.active !== undefined) {
      const slot = `$${params.push(today)}::date`;
      where.push(
        query.active
          ? `m.active = true AND (m.to_date IS NULL OR m.to_date >= ${slot})`
          : `(m.active = false OR m.to_date < ${slot})`,
      );
    }
    for (const word of (query.search ?? '').split(/\s+/).filter(Boolean)) {
      const slot = `$${params.push(`%${escapeLike(word)}%`)}`;
      where.push(`(s.first_name ILIKE ${slot} OR s.last_name ILIKE ${slot} OR m.medicine ILIKE ${slot})`);
    }
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const from = `${this.medicationFrom()} WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    const rows = await this.dataSource.query(
      `SELECT ${this.medicationColumns()} ${from} ORDER BY ${sort} ${order}, m.id ${order} ${pageClause(query)}`,
      params,
    );
    return paginate(
      [rows.map((row: Record<string, unknown>) => this.toMedication(row)), total],
      query.page,
      query.limit,
    );
  }

  async medication(schoolId: number, id: number): Promise<MedicationDto> {
    const rows = await this.dataSource.query(
      `SELECT ${this.medicationColumns()} ${this.medicationFrom()}
       WHERE m.school_id = $1 AND m.id = $2 AND m.deleted_at IS NULL`,
      [schoolId, id],
    );
    if (!rows.length) throw AppException.notFound('Medication not found', 'HOSTEL_MEDICATION_NOT_FOUND');
    return this.toMedication(rows[0]);
  }

  async createMedication(schoolId: number, dto: MedicationInputDto, actor: AuthUser): Promise<MedicationDto> {
    const admission = await careAdmission(this.dataSource, schoolId, dto.admission_id);
    if (dto.to_date && dto.to_date < dto.from_date) {
      throw AppException.validation([{ field: 'to_date', message: 'Must be on or after from_date' }]);
    }
    const id = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(
        manager.create(HostelMedication, {
          school_id: schoolId,
          admission_id: admission.id,
          student_id: admission.student_id,
          medicine: dto.medicine,
          dose: dto.dose,
          times: uniqueTimes(dto.times),
          from_date: dto.from_date,
          to_date: dto.to_date ?? null,
          instructions: dto.instructions ?? null,
          prescribed_by: dto.prescribed_by ?? null,
          active: true,
          created_by: actor.id,
        }),
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'medication',
        entity_id: saved.id,
        action: 'create',
        student_id: admission.student_id,
        changes: { medicine: dto.medicine, dose: dto.dose, times: saved.times, from_date: dto.from_date },
      });
      return saved.id;
    });
    return this.medication(schoolId, id);
  }

  async stopMedication(schoolId: number, id: number, actor: AuthUser): Promise<MedicationDto> {
    await this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(HostelMedication, {
        where: { school_id: schoolId, id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw AppException.notFound('Medication not found', 'HOSTEL_MEDICATION_NOT_FOUND');
      if (!row.active) throw AppException.conflict('This medication is already stopped', 'HOSTEL_MEDICATION_STOPPED');
      await manager.update(HostelMedication, { id }, { active: false });
      await this.audit.record(manager, schoolId, actor, {
        entity: 'medication',
        entity_id: id,
        action: 'stop',
        student_id: row.student_id,
      });
    });
    return this.medication(schoolId, id);
  }

  async due(schoolId: number, query: MedicationDueQueryDto): Promise<MedicationDueDto[]> {
    const today = this.today();
    const date = query.date ?? today;
    const params: unknown[] = [schoolId, date];
    const where = [
      'm.school_id = $1',
      'm.deleted_at IS NULL',
      'm.active = true',
      'm.from_date <= $2::date',
      '(m.to_date IS NULL OR m.to_date >= $2::date)',
      `(a.status <> 'checked_out' OR a.checked_out_on > $2::date)`,
    ];
    if (query.hostel_id) where.push(`a.hostel_id = $${params.push(query.hostel_id)}`);
    const rows = await this.dataSource.query(
      `SELECT m.id AS medication_id, m.admission_id, m.medicine, m.dose, m.instructions, t.dose_time,
         d.status, d.note, d.given_at, gu.name AS given_by_name, ${BED_COLUMN}, ${STUDENT_COLUMNS}
       FROM hostel_medications m
       CROSS JOIN LATERAL unnest(m.times) AS t(dose_time)
       JOIN hostel_admissions a ON a.id = m.admission_id AND a.deleted_at IS NULL
       JOIN students s ON s.id = m.student_id
       ${studentJoins('s')}
       ${bedJoins('a.id')}
       LEFT JOIN hostel_medication_doses d ON d.medication_id = m.id AND d.dose_date = $2::date
         AND d.dose_time = t.dose_time
       LEFT JOIN users gu ON gu.id = d.given_by
       WHERE ${where.join(' AND ')}
       ORDER BY t.dose_time, r.room_no NULLS LAST, bd.bed_no, s.first_name, m.id`,
      params,
    );
    const nowTime = timeIn(this.app.timeZone);
    return rows.map((row: Record<string, unknown>) => {
      const status = (row.status as MedicationDueDto['status'] | null) ?? 'pending';
      return {
        medication_id: row.medication_id as number,
        admission_id: row.admission_id as number,
        student: studentFromRow(row),
        bed: (row.bed as string | null) ?? null,
        medicine: row.medicine as string,
        dose: row.dose as string,
        instructions: (row.instructions as string | null) ?? null,
        dose_date: date,
        dose_time: row.dose_time as string,
        status,
        overdue: doseOverdue(status, date, row.dose_time as string, today, nowTime),
        note: (row.note as string | null) ?? null,
        given_by_name: (row.given_by_name as string | null) ?? null,
        given_at: (row.given_at as Date | null) ?? null,
      };
    });
  }

  async recordDose(schoolId: number, id: number, dto: DoseInputDto, actor: AuthUser): Promise<DoseDto> {
    const medication = await this.dataSource.manager.findOneBy(HostelMedication, { school_id: schoolId, id });
    if (!medication) throw AppException.notFound('Medication not found', 'HOSTEL_MEDICATION_NOT_FOUND');
    if (!medication.times.includes(dto.dose_time)) {
      throw AppException.validation([{ field: 'dose_time', message: `Must be one of ${medication.times.join(', ')}` }]);
    }
    if (!withinBackDays(dto.dose_date, this.today(), DOSE_BACK_DAYS)) {
      throw AppException.validation([
        { field: 'dose_date', message: `Doses can be recorded for today or the last ${DOSE_BACK_DAYS} days` },
      ]);
    }
    if (!medicationRunsOn(medication, dto.dose_date)) {
      throw AppException.conflict('This medication is not running on that date', 'HOSTEL_MEDICATION_NOT_DUE');
    }
    const doseId = await this.dataSource.transaction(async (manager) => {
      const [row] = await manager.query(
        `INSERT INTO hostel_medication_doses
           (school_id, medication_id, admission_id, dose_date, dose_time, status, note, given_by, given_at)
         VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, now())
         ON CONFLICT (medication_id, dose_date, dose_time) DO UPDATE SET
           status = EXCLUDED.status, note = EXCLUDED.note, given_by = EXCLUDED.given_by, given_at = now()
         RETURNING id`,
        [schoolId, id, medication.admission_id, dto.dose_date, dto.dose_time, dto.status, dto.note ?? null, actor.id],
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'medication',
        entity_id: id,
        action: 'dose',
        student_id: medication.student_id,
        changes: { dose_date: dto.dose_date, dose_time: dto.dose_time, status: dto.status },
        note: dto.note ?? null,
      });
      return Number(row.id);
    });
    const [dose] = await this.dataSource.query(
      `SELECT d.id, d.medication_id, d.admission_id, d.dose_date::text AS dose_date, d.dose_time, d.status, d.note,
         u.name AS given_by_name, d.given_at
       FROM hostel_medication_doses d LEFT JOIN users u ON u.id = d.given_by WHERE d.id = $1`,
      [doseId],
    );
    return dose;
  }

  private async lockLog(manager: EntityManager, schoolId: number, id: number): Promise<HostelHealthLog> {
    const row = await manager.findOne(HostelHealthLog, {
      where: { school_id: schoolId, id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!row) throw AppException.notFound('Health record not found', 'HOSTEL_HEALTH_NOT_FOUND');
    return row;
  }

  private async tellParents(schoolId: number, id: number): Promise<void> {
    const log = await this.log(schoolId, id);
    const message = healthMessage(log);
    const sent = await this.notify.tellParents(log.admission_id, HOSTEL_TEMPLATES.HOSTEL_HEALTH, {
      ...message,
      health_id: String(log.id),
    });
    if (sent > 0 && !log.parent_informed) {
      await this.dataSource.manager.update(HostelHealthLog, { id }, { parent_informed: true });
    }
  }

  private logColumns(): string {
    return `hl.id, hl.admission_id, hl.hostel_id, h.name AS hostel_name, hl.kind, hl.logged_at, hl.symptoms,
         hl.temperature::float AS temperature, hl.action_taken, hl.doctor_name, hl.hospital_visit, hl.parent_informed,
         hl.status, hl.sick_bay_from, hl.sick_bay_to, hl.closed_at, u.name AS logged_by_name, hl.created_at,
         (${IN_SICK_BAY}) AS in_sick_bay, ${BED_COLUMN}, ${STUDENT_COLUMNS}`;
  }

  private logFrom(): string {
    return `FROM hostel_health_logs hl
       JOIN hostels h ON h.id = hl.hostel_id
       JOIN students s ON s.id = hl.student_id
       ${studentJoins('s')}
       ${bedJoins('hl.admission_id')}
       LEFT JOIN users u ON u.id = hl.created_by`;
  }

  private toLog(row: Record<string, unknown>): HealthLogDto {
    return {
      id: row.id as number,
      admission_id: row.admission_id as number,
      student: studentFromRow(row),
      hostel_id: row.hostel_id as number,
      hostel_name: row.hostel_name as string,
      bed: (row.bed as string | null) ?? null,
      kind: row.kind as HealthLogDto['kind'],
      logged_at: row.logged_at as Date,
      symptoms: row.symptoms as string,
      temperature: (row.temperature as number | null) ?? null,
      action_taken: (row.action_taken as string | null) ?? null,
      doctor_name: (row.doctor_name as string | null) ?? null,
      hospital_visit: Boolean(row.hospital_visit),
      parent_informed: Boolean(row.parent_informed),
      status: row.status as HealthLogDto['status'],
      in_sick_bay: Boolean(row.in_sick_bay),
      sick_bay_from: (row.sick_bay_from as Date | null) ?? null,
      sick_bay_to: (row.sick_bay_to as Date | null) ?? null,
      closed_at: (row.closed_at as Date | null) ?? null,
      logged_by_name: (row.logged_by_name as string | null) ?? null,
      created_at: row.created_at as Date,
    };
  }

  private medicationColumns(): string {
    return `m.id, m.admission_id, h.name AS hostel_name, m.medicine, m.dose, m.times,
         m.from_date::text AS from_date, m.to_date::text AS to_date, m.instructions, m.prescribed_by, m.active,
         u.name AS created_by_name, m.created_at, ${BED_COLUMN}, ${STUDENT_COLUMNS}`;
  }

  private medicationFrom(): string {
    return `FROM hostel_medications m
       JOIN hostel_admissions a ON a.id = m.admission_id
       JOIN hostels h ON h.id = a.hostel_id
       JOIN students s ON s.id = m.student_id
       ${studentJoins('s')}
       ${bedJoins('m.admission_id')}
       LEFT JOIN users u ON u.id = m.created_by`;
  }

  private toMedication(row: Record<string, unknown>): MedicationDto {
    return {
      id: row.id as number,
      admission_id: row.admission_id as number,
      student: studentFromRow(row),
      hostel_name: row.hostel_name as string,
      bed: (row.bed as string | null) ?? null,
      medicine: row.medicine as string,
      dose: row.dose as string,
      times: row.times as string[],
      from_date: row.from_date as string,
      to_date: (row.to_date as string | null) ?? null,
      instructions: (row.instructions as string | null) ?? null,
      prescribed_by: (row.prescribed_by as string | null) ?? null,
      active: Boolean(row.active),
      created_by_name: (row.created_by_name as string | null) ?? null,
      created_at: row.created_at as Date,
    };
  }
}
