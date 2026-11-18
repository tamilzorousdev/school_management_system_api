import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException, AuthUser, paginate, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { addDays } from '../../shared/school-days';
import { yearWhere } from '../../shared/year-context';
import { FilesService } from '../files/files.service';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { SequencesService } from '../schools/sequences.service';
import { QrTokens } from '../security/qr-tokens';
import { AcademicYear } from '../setup/entities/academic-year.entity';
import {
  BusFeeFacts,
  busPassState,
  BusPassState,
  crewLabel,
  feeStanding,
  graceEnds,
  HoldKind,
  isIssued,
  PASS_MESSAGES,
  passNumber,
} from './bus-pass.logic';
import { STOP_FEE_SQL } from './transport.logic';
import {
  BusPassActionDto,
  BusPassActionResultDto,
  BusPassDto,
  BusPassInsightsDto,
  BusPassQueryDto,
  BusPassSettingsDto,
  BusPassSettingsInputDto,
  CrewHeldPassDto,
  ParentBusPassDto,
} from './dto/bus-pass.dto';
import { BusFeeReminder, BusPass, BusPassSettings } from './entities/bus-pass.entity';
import { StudentTransport } from './entities/student-transport.entity';

interface RiderRow {
  student_id: number;
  route_id: number;
  route_name: string;
  mode: 'both' | 'pickup' | 'drop';
  pass_status: 'active' | 'on_hold';
  pass_note: string | null;
  hold_kind: HoldKind | null;
  first_name: string;
  last_name: string | null;
  admission_no: string;
  photo_file_id: number | null;
  card_version: number;
  class_name: string | null;
  section_name: string | null;
  pickup_id: number;
  pickup_name: string;
  pickup_time: string | null;
  pickup_drop_time: string | null;
  pickup_fee: string;
  drop_id: number | null;
  drop_name: string | null;
  drop_time: string | null;
  drop_fee: string | null;
  bus_id: number | null;
  bus_name: string | null;
  bus_registration_no: string | null;
  today_only: boolean;
}

interface FeeRow extends BusFeeFacts {
  student_id: number;
  pending_amount: string;
}

const MONEY = (value: string | number | null | undefined) => Math.round(Number(value ?? 0) * 100) / 100;
const fullName = (first: string, last: string | null) => [first, last].filter(Boolean).join(' ');

@Injectable()
export class BusPassService {
  private readonly logger = new Logger('BusPass');
  private syncing = false;

  constructor(
    @InjectRepository(BusPass) private readonly passes: Repository<BusPass>,
    @InjectRepository(BusPassSettings) private readonly settingsRepo: Repository<BusPassSettings>,
    @InjectRepository(BusFeeReminder) private readonly reminders: Repository<BusFeeReminder>,
    @InjectRepository(StudentTransport) private readonly assignments: Repository<StudentTransport>,
    private readonly sequences: SequencesService,
    private readonly files: FilesService,
    private readonly qr: QrTokens,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async settings(schoolId: number): Promise<BusPassSettingsDto> {
    const [row, year] = await Promise.all([this.settingsRepo.findOneBy({ school_id: schoolId }), this.year(schoolId)]);
    return { grace_days: row?.grace_days ?? 7, valid_until: row?.valid_until ?? null, year_ends: year.end_date };
  }

  async updateSettings(schoolId: number, dto: BusPassSettingsInputDto, actor: AuthUser): Promise<BusPassSettingsDto> {
    const year = await this.year(schoolId);
    if (dto.valid_until && (dto.valid_until < year.start_date || dto.valid_until > addDays(year.end_date, 120))) {
      throw AppException.validation([
        { field: 'valid_until', message: 'Pick a date in this academic year or up to 4 months after it ends' },
      ]);
    }
    const row =
      (await this.settingsRepo.findOneBy({ school_id: schoolId })) ?? this.settingsRepo.create({ school_id: schoolId });
    if (dto.grace_days !== undefined) row.grace_days = dto.grace_days;
    if (dto.valid_until !== undefined) row.valid_until = dto.valid_until;
    row.updated_by = actor.id;
    await this.settingsRepo.save(row);
    return this.settings(schoolId);
  }

  async list(schoolId: number, query: BusPassQueryDto): Promise<Paginated<BusPassDto>> {
    let rows = await this.build(schoolId);
    if (query.state) rows = rows.filter((row) => row.state === query.state);
    if (query.fee) rows = rows.filter((row) => row.fee.standing === query.fee);
    if (query.route_id) rows = rows.filter((row) => row.route.id === query.route_id);
    const words = (query.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) {
      rows = rows.filter((row) => {
        const text = `${row.student.full_name} ${row.student.admission_no} ${row.pass_no}`.toLowerCase();
        return words.every((word) => text.includes(word));
      });
    }
    const start = (query.page - 1) * query.limit;
    return paginate([rows.slice(start, start + query.limit), rows.length], query.page, query.limit);
  }

  async insights(schoolId: number): Promise<BusPassInsightsDto> {
    const rows = await this.build(schoolId);
    const count = (state: BusPassState) => rows.filter((row) => row.state === state).length;
    return {
      total: rows.length,
      active: count('active'),
      awaiting_payment: count('awaiting_payment'),
      on_hold: count('on_hold'),
      expired: count('expired'),
      fee_due: rows.filter((row) => row.fee.standing === 'due').length,
      fee_past_grace: rows.filter((row) => row.fee.standing === 'past_grace' && row.state !== 'on_hold').length,
    };
  }

  async forStudent(schoolId: number, studentId: number): Promise<BusPassDto> {
    const [row] = await this.build(schoolId, [studentId]);
    if (!row) throw AppException.notFound('This student has no bus', 'TRANSPORT_NOT_FOUND');
    return row;
  }

  async forParent(schoolId: number, studentId: number): Promise<ParentBusPassDto | null> {
    const [row] = await this.build(schoolId, [studentId]);
    if (!row) return null;
    const [[school], [student]]: [{ name: string }[], { card_version: number }[]] = await Promise.all([
      this.dataSource.query(`SELECT name FROM schools WHERE id = $1`, [schoolId]),
      this.dataSource.query(`SELECT card_version FROM students WHERE id = $1`, [studentId]),
    ]);
    return {
      ...row,
      hold_note: row.state === 'on_hold' ? row.hold_note : null,
      school: school?.name ?? '',
      message: PASS_MESSAGES[row.state],
      qr: row.state === 'active' ? this.qr.student(studentId, Number(student?.card_version ?? 1)) : null,
    };
  }

  async setValidity(schoolId: number, studentId: number, validUntil: string): Promise<BusPassDto> {
    await this.forStudent(schoolId, studentId);
    const year = await this.year(schoolId);
    const pass = await this.passes.findOneByOrFail({ student_id: studentId, academic_year_id: year.id });
    if (validUntil < pass.valid_from) {
      throw AppException.validation([{ field: 'valid_until', message: 'Pick a date after the pass starts' }]);
    }
    await this.passes.update(pass.id, { valid_until: validUntil });
    return this.forStudent(schoolId, studentId);
  }

  async restrict(schoolId: number, dto: BusPassActionDto, actor: AuthUser): Promise<BusPassActionResultDto> {
    const rows = await this.build(schoolId, dto.student_ids);
    let changed = 0;
    let told = 0;
    for (const row of rows) {
      if (row.state === 'on_hold') continue;
      const kind: HoldKind = row.fee.standing === 'clear' ? 'office' : 'fee';
      await this.assignments.update(
        { school_id: schoolId, student_id: row.student.id },
        {
          pass_status: 'on_hold',
          hold_kind: kind,
          pass_note: dto.note?.trim() || null,
          pass_changed_at: new Date(),
          pass_changed_by: actor.id,
        },
      );
      await this.history(
        schoolId,
        row,
        `Bus pass for ${row.student.full_name} put on hold${kind === 'fee' ? ' (bus fee pending)' : ''}`,
        actor.id,
      );
      told += await this.tell(row.student.id, TEMPLATES.BUS_PASS_HELD, {
        student: row.student.full_name,
        reason:
          kind === 'fee'
            ? `The bus pass for ${row.student.full_name} is on hold as the bus fee is pending.`
            : `The bus pass for ${row.student.full_name} is on hold.${dto.note ? ` ${dto.note.trim()}.` : ''}`,
        reason_ta:
          kind === 'fee'
            ? `பேருந்துக் கட்டணம் நிலுவையில் உள்ளதால் ${row.student.full_name} பேருந்து அனுமதிச் சீட்டு நிறுத்திவைக்கப்பட்டுள்ளது.`
            : `${row.student.full_name} பேருந்து அனுமதிச் சீட்டு நிறுத்திவைக்கப்பட்டுள்ளது.`,
        student_id: String(row.student.id),
      });
      changed += 1;
    }
    return { changed, parents_told: told };
  }

  async activate(schoolId: number, dto: BusPassActionDto, actor: AuthUser): Promise<BusPassActionResultDto> {
    const rows = await this.build(schoolId, dto.student_ids);
    let changed = 0;
    let told = 0;
    for (const row of rows) {
      const current = await this.assignments.findOneBy({ school_id: schoolId, student_id: row.student.id });
      if (!current || current.pass_status !== 'on_hold') continue;
      told += await this.lift(schoolId, row, actor.id);
      changed += 1;
    }
    return { changed, parents_told: told };
  }

  async crewHeld(schoolId: number, vehicleId: number): Promise<CrewHeldPassDto[]> {
    const rows = (await this.riders(schoolId, await this.year(schoolId), null)).filter(
      (row) => row.bus_id === vehicleId && row.pass_status === 'on_hold',
    );
    return rows.map((row) => ({
      id: Number(row.student_id),
      full_name: fullName(row.first_name, row.last_name),
      class_section: row.class_name ? [row.class_name, row.section_name].filter(Boolean).join(' - ') : null,
      photo_url: this.files.linkFor(row.photo_file_id === null ? null : Number(row.photo_file_id)),
      route: { id: Number(row.route_id), name: row.route_name },
      stop: row.mode === 'drop' ? (row.drop_name ?? row.pickup_name) : row.pickup_name,
      label: crewLabel(row.pass_status, row.hold_kind)!,
    }));
  }

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'bus-pass-sync' })
  async sync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const schools: { school_id: number }[] = await this.dataSource.query(
        `SELECT DISTINCT school_id FROM student_transport WHERE deleted_at IS NULL`,
      );
      for (const { school_id: schoolId } of schools) await this.syncSchool(Number(schoolId));
    } catch (error) {
      this.logger.error(`Bus pass round failed: ${(error as Error).message}`);
    } finally {
      this.syncing = false;
    }
  }

  async syncSchool(schoolId: number): Promise<{ issued: number; reminded: number; reactivated: number }> {
    const year = await this.dataSource.getRepository(AcademicYear).findOneBy({ school_id: schoolId, is_current: true });
    if (!year) return { issued: 0, reminded: 0, reactivated: 0 };
    const rows = await this.build(schoolId, undefined, year);
    const settings = await this.settings(schoolId);
    const today = todayIn(this.app.timeZone);
    let issued = 0;
    let reminded = 0;
    let reactivated = 0;
    for (const row of rows) {
      if (row.issued_at === null && row.state !== 'awaiting_payment' && row.state !== 'expired') {
        await this.passes.update({ student_id: row.student.id, academic_year_id: year.id }, { issued_at: new Date() });
        await this.tell(row.student.id, TEMPLATES.BUS_PASS_ISSUED, {
          student: row.student.full_name,
          pass_no: row.pass_no,
          valid_until: row.valid_until,
          student_id: String(row.student.id),
        });
        issued += 1;
      }
      const current = await this.assignments.findOneBy({ school_id: schoolId, student_id: row.student.id });
      if (current?.pass_status === 'on_hold' && current.hold_kind === 'fee' && row.fee.standing !== 'past_grace') {
        await this.lift(schoolId, row, null);
        reactivated += 1;
      }
    }
    const due: { invoice_id: number; student_id: number; due_date: string }[] = await this.dataSource.query(
      `SELECT DISTINCT i.id AS invoice_id, i.student_id, i.due_date::text AS due_date
       FROM fee_invoices i
       JOIN fee_invoice_lines l ON l.invoice_id = i.id
       JOIN fee_heads h ON h.id = l.fee_head_id AND h.is_transport = true
       JOIN student_transport t ON t.student_id = i.student_id AND t.deleted_at IS NULL
       WHERE i.school_id = $1 AND i.academic_year_id = $2 AND i.deleted_at IS NULL
         AND i.status <> 'cancelled' AND i.balance > 0
         AND (i.due_date + $3::int - 1) = $4::date
         AND NOT EXISTS (SELECT 1 FROM bus_fee_reminders r WHERE r.invoice_id = i.id AND r.kind = 'grace_ending')`,
      [schoolId, year.id, settings.grace_days, today],
    );
    for (const item of due) {
      const row = rows.find((candidate) => candidate.student.id === Number(item.student_id));
      if (!row) continue;
      const claimed = await this.reminders
        .createQueryBuilder()
        .insert()
        .values({ school_id: schoolId, invoice_id: Number(item.invoice_id), kind: 'grace_ending' })
        .orIgnore()
        .execute();
      if (!(claimed.raw as unknown[]).length) continue;
      await this.tell(row.student.id, TEMPLATES.BUS_FEE_REMINDER, {
        student: row.student.full_name,
        grace_ends: graceEnds(item.due_date, settings.grace_days),
        student_id: String(row.student.id),
      });
      reminded += 1;
    }
    if (issued || reminded || reactivated) {
      this.logger.log(`School ${schoolId}: ${issued} passes issued, ${reminded} reminders, ${reactivated} reactivated`);
    }
    return { issued, reminded, reactivated };
  }

  private async lift(schoolId: number, row: BusPassDto, actorId: number | null): Promise<number> {
    await this.assignments.update(
      { school_id: schoolId, student_id: row.student.id },
      {
        pass_status: 'active',
        hold_kind: null,
        pass_note: null,
        pass_changed_at: new Date(),
        pass_changed_by: actorId,
      },
    );
    await this.history(schoolId, row, `Bus pass for ${row.student.full_name} is active again`, actorId);
    return this.tell(row.student.id, TEMPLATES.BUS_PASS_ACTIVE, {
      student: row.student.full_name,
      student_id: String(row.student.id),
    });
  }

  private async history(schoolId: number, row: BusPassDto, summary: string, actorId: number | null): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO route_changes (school_id, route_id, student_id, kind, summary, parents_told, changed_by)
       VALUES ($1, $2, $3, 'pass_changed', $4, 0, $5)`,
      [schoolId, row.route.id, row.student.id, summary.slice(0, 255), actorId],
    );
  }

  private async tell(studentId: number, template: string, data: Record<string, string>): Promise<number> {
    const parents: { user_id: number }[] = await this.dataSource.query(
      `SELECT DISTINCT g.user_id FROM student_guardians sg
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL AND g.user_id IS NOT NULL
       WHERE sg.student_id = $1 AND sg.receives_alerts = true`,
      [studentId],
    );
    if (!parents.length) return 0;
    return this.notifications
      .dispatch({ template, audience: { user_ids: parents.map((row) => Number(row.user_id)) }, data })
      .then((result) => result.recipients)
      .catch((error: Error) => {
        this.logger.warn(`Bus pass notice for student ${studentId} failed: ${error.message}`);
        return 0;
      });
  }

  private async build(schoolId: number, studentIds?: number[], givenYear?: AcademicYear): Promise<BusPassDto[]> {
    const year = givenYear ?? (await this.year(schoolId));
    const riders = await this.riders(schoolId, year, studentIds ?? null);
    if (!riders.length) return [];
    const ids = riders.map((row) => Number(row.student_id));
    const [passes, fees, settings] = await Promise.all([
      this.ensurePasses(schoolId, year, ids),
      this.fees(schoolId, year.id, ids),
      this.settings(schoolId),
    ]);
    const today = todayIn(this.app.timeZone);
    return riders.map((row) => {
      const id = Number(row.student_id);
      const pass = passes.get(id)!;
      const fee = fees.get(id) ?? { oldest_unpaid_due: null, any_paid: false, any_billed: false, pending_amount: '0' };
      const standing = feeStanding(fee, settings.grace_days, today);
      const freeRide = MONEY(row.pickup_fee) <= 0 && MONEY(row.drop_fee) <= 0;
      const issued = isIssued(fee, freeRide, Boolean(pass.issued_at));
      const state = busPassState({
        today,
        valid_until: pass.valid_until,
        issued,
        hold: row.pass_status,
        hold_kind: row.hold_kind,
        standing,
      });
      return {
        pass_no: pass.pass_no,
        state,
        hold_kind: state === 'on_hold' ? (row.hold_kind ?? 'office') : null,
        hold_note: state === 'on_hold' ? row.pass_note : null,
        student: {
          id,
          full_name: fullName(row.first_name, row.last_name),
          admission_no: row.admission_no,
          class_section: row.class_name ? [row.class_name, row.section_name].filter(Boolean).join(' - ') : null,
          photo_url: this.files.linkFor(row.photo_file_id === null ? null : Number(row.photo_file_id)),
        },
        valid_from: pass.valid_from,
        valid_until: pass.valid_until,
        issued_at: pass.issued_at,
        route: { id: Number(row.route_id), name: row.route_name },
        pickup:
          row.mode === 'drop' ? null : { id: Number(row.pickup_id), name: row.pickup_name, time: row.pickup_time },
        drop:
          row.mode === 'pickup'
            ? null
            : row.drop_id
              ? { id: Number(row.drop_id), name: row.drop_name!, time: row.drop_time }
              : { id: Number(row.pickup_id), name: row.pickup_name, time: row.pickup_drop_time },
        bus: row.bus_id
          ? {
              id: Number(row.bus_id),
              name: row.bus_name!,
              registration_no: row.bus_registration_no!,
              today_only: Boolean(row.today_only),
            }
          : null,
        fee: {
          standing,
          oldest_due: fee.oldest_unpaid_due,
          grace_ends: fee.oldest_unpaid_due ? graceEnds(fee.oldest_unpaid_due, settings.grace_days) : null,
          pending_amount: MONEY(fee.pending_amount),
          billed: fees.has(id),
        },
      };
    });
  }

  private riders(schoolId: number, year: AcademicYear, studentIds: number[] | null): Promise<RiderRow[]> {
    return this.dataSource.query(
      `SELECT t.student_id, t.route_id, r.name AS route_name, t.mode, t.pass_status, t.pass_note, t.hold_kind,
              s.first_name, s.last_name, s.admission_no, s.photo_file_id, s.card_version,
              c.name AS class_name, sec.name AS section_name,
              ps.id AS pickup_id, ps.name AS pickup_name, ps.pickup_time, ps.drop_time AS pickup_drop_time,
              ${STOP_FEE_SQL('ps', 'r')} AS pickup_fee,
              ds.id AS drop_id, ds.name AS drop_name, ds.drop_time,
              CASE WHEN ds.id IS NULL THEN NULL ELSE ${STOP_FEE_SQL('ds', 'r')} END AS drop_fee,
              v.id AS bus_id, v.name AS bus_name, v.registration_no AS bus_registration_no, (w.id IS NOT NULL) AS today_only
       FROM student_transport t
       JOIN students s ON s.id = t.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       JOIN transport_routes r ON r.id = t.route_id AND r.deleted_at IS NULL
       JOIN route_stops ps ON ps.id = t.stop_id
       LEFT JOIN route_stops ds ON ds.id = t.drop_stop_id
       LEFT JOIN route_bus_swaps w ON w.route_id = r.id AND w.swap_date = $3 AND w.deleted_at IS NULL
       LEFT JOIN vehicles v ON v.id = COALESCE(w.vehicle_id, r.vehicle_id) AND v.deleted_at IS NULL
       LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $2
       LEFT JOIN sections sec ON sec.id = e.section_id
       LEFT JOIN classes c ON c.id = COALESCE(e.class_id, sec.class_id)
       WHERE t.school_id = $1 AND t.deleted_at IS NULL ${studentIds ? 'AND t.student_id = ANY($4)' : ''}
       ORDER BY s.first_name, s.last_name, s.id`,
      studentIds
        ? [schoolId, year.id, todayIn(this.app.timeZone), studentIds]
        : [schoolId, year.id, todayIn(this.app.timeZone)],
    );
  }

  private async fees(schoolId: number, yearId: number, studentIds: number[]): Promise<Map<number, FeeRow>> {
    const rows: FeeRow[] = await this.dataSource.query(
      `SELECT i.student_id,
              (MIN(i.due_date) FILTER (WHERE i.balance > 0))::text AS oldest_unpaid_due,
              bool_or(i.status = 'paid') AS any_paid,
              true AS any_billed,
              COALESCE(SUM(l.amount) FILTER (WHERE i.balance > 0), 0) AS pending_amount
       FROM fee_invoices i
       JOIN fee_invoice_lines l ON l.invoice_id = i.id
       JOIN fee_heads h ON h.id = l.fee_head_id AND h.is_transport = true
       WHERE i.school_id = $1 AND i.academic_year_id = $2 AND i.student_id = ANY($3)
         AND i.deleted_at IS NULL AND i.status <> 'cancelled'
       GROUP BY i.student_id`,
      [schoolId, yearId, studentIds],
    );
    return new Map(rows.map((row) => [Number(row.student_id), row]));
  }

  private async ensurePasses(
    schoolId: number,
    year: AcademicYear,
    studentIds: number[],
  ): Promise<Map<number, BusPass>> {
    const existing = await this.passes
      .createQueryBuilder('p')
      .where('p.academic_year_id = :year AND p.student_id IN (:...ids)', { year: year.id, ids: studentIds })
      .getMany();
    const missing = studentIds.filter((id) => !existing.some((pass) => pass.student_id === id));
    if (missing.length) {
      const [settings, [school]] = await Promise.all([
        this.settings(schoolId),
        this.dataSource.query(`SELECT code FROM schools WHERE id = $1`, [schoolId]) as Promise<{ code: string }[]>,
      ]);
      const validUntil = settings.valid_until ?? year.end_date;
      const yearStart = Number(year.start_date.slice(0, 4));
      await this.dataSource.transaction(async (manager) => {
        for (const studentId of missing) {
          const number = await this.sequences.next(manager, schoolId, `bus_pass:${yearStart}`);
          await manager
            .createQueryBuilder()
            .insert()
            .into(BusPass)
            .values({
              school_id: schoolId,
              student_id: studentId,
              academic_year_id: year.id,
              pass_no: passNumber(school?.code ?? 'SCH', yearStart, number),
              valid_from: year.start_date,
              valid_until: validUntil,
            })
            .orIgnore()
            .execute();
        }
      });
      existing.push(
        ...(await this.passes
          .createQueryBuilder('p')
          .where('p.academic_year_id = :year AND p.student_id IN (:...ids)', { year: year.id, ids: missing })
          .getMany()),
      );
    }
    return new Map(existing.map((pass) => [pass.student_id, pass]));
  }

  private async year(schoolId: number): Promise<AcademicYear> {
    const year = await this.dataSource.getRepository(AcademicYear).findOneBy(yearWhere(schoolId));
    if (!year) throw AppException.badRequest('Set the current academic year first', 'NO_CURRENT_YEAR');
    return year;
  }
}
