import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException, AuthUser, Paginated, paginate } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { QrTokens } from '../security/qr-tokens';
import {
  MessAttendanceEntryDto,
  MessAttendanceSheetDto,
  MessDayDto,
  MessFeedbackDto,
  MessFeedbackQueryDto,
  MessFeedbackSummaryDto,
  MessFeedbackSummaryQueryDto,
  MessHeadcountDto,
  MessMarkDto,
  MessMenuInputDto,
  MessOverrideDto,
  MessOverrideInputDto,
  MessOverrideQueryDto,
  MessScanDto,
  MessScanResultDto,
  MessSkipDto,
  MessSkipQueryDto,
  MessWeekDto,
  ParentMessFeedbackInputDto,
  ParentMessSkipInputDto,
} from './dto/hostel-care.dto';
import { HostelMealSkip, HostelMenuOverride, HostelMessMenu, Meal, MEALS } from './entities/hostel-care.entity';
import {
  averageRating,
  DAY_NAMES,
  dayOfWeek,
  duplicateIds,
  duplicateSlots,
  FEEDBACK_BACK_DAYS,
  headcount,
  MEAL_BACK_DAYS,
  MenuRow,
  OverrideRow,
  resolveDay,
  skipErrors,
  skipsOverlap,
  weekGrid,
  withinBackDays,
} from './hostel-care.logic';
import { careAdmission, careHostel, mealOrder, pageClause, sortColumn } from './hostel-care-sql';
import { escapeLike, STUDENT_COLUMNS, studentFromRow, studentJoins } from './hostel-sql';
import { HostelAuditService } from './hostel-audit.service';
import { addDays } from './hostel.logic';

const SKIP_SORTS: Record<string, string> = { from_date: 'k.from_date', created_at: 'k.created_at' };
const FEEDBACK_SORTS: Record<string, string> = {
  created_at: 'f.created_at',
  meal_date: 'f.meal_date',
  rating: 'f.rating',
};
const OVERRIDE_RANGE_DAYS = 366;

@Injectable()
export class HostelMessService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly qr: QrTokens,
    private readonly audit: HostelAuditService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  today(): string {
    return todayIn(this.app.timeZone);
  }

  async week(schoolId: number, hostelId?: number): Promise<MessWeekDto> {
    if (hostelId) await careHostel(this.dataSource, schoolId, hostelId);
    return { hostel_id: hostelId ?? null, days: weekGrid(await this.menuRows(schoolId, hostelId ?? null)) };
  }

  async saveWeek(schoolId: number, dto: MessMenuInputDto, actor: AuthUser): Promise<MessWeekDto> {
    if (dto.hostel_id) await careHostel(this.dataSource, schoolId, dto.hostel_id);
    const duplicates = duplicateSlots(dto.entries);
    if (duplicates.length) {
      throw AppException.validation([{ field: 'entries', message: `Listed twice: ${duplicates.join(', ')}` }]);
    }
    const hostelId = dto.hostel_id ?? null;
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `DELETE FROM hostel_mess_menus WHERE school_id = $1 AND hostel_id IS NOT DISTINCT FROM $2::int`,
        [schoolId, hostelId],
      );
      if (!dto.entries.length) return;
      await manager.save(
        dto.entries.map((entry) =>
          manager.create(HostelMessMenu, {
            school_id: schoolId,
            hostel_id: hostelId,
            day_of_week: entry.day_of_week,
            meal: entry.meal,
            items: entry.items,
            non_veg_items: entry.non_veg_items ?? null,
            created_by: actor.id,
          }),
        ),
      );
    });
    return this.week(schoolId, dto.hostel_id);
  }

  async overrides(schoolId: number, query: MessOverrideQueryDto): Promise<MessOverrideDto[]> {
    const from = query.from ?? this.today();
    const to = query.to ?? addDays(from, 30);
    if (to < from) throw AppException.validation([{ field: 'to', message: 'Must be on or after from' }]);
    if (to > addDays(from, OVERRIDE_RANGE_DAYS)) {
      throw AppException.validation([{ field: 'to', message: `At most ${OVERRIDE_RANGE_DAYS} days at a time` }]);
    }
    const params: unknown[] = [schoolId, from, to];
    const where = ['o.school_id = $1', 'o.deleted_at IS NULL', 'o.menu_date BETWEEN $2::date AND $3::date'];
    if (query.hostel_id) where.push(`(o.hostel_id IS NULL OR o.hostel_id = $${params.push(query.hostel_id)})`);
    return this.dataSource.query(
      `${this.overrideSelect()} WHERE ${where.join(' AND ')}
       ORDER BY o.menu_date, ${mealOrder('o.meal')}, o.hostel_id NULLS FIRST`,
      params,
    );
  }

  async saveOverride(schoolId: number, dto: MessOverrideInputDto, actor: AuthUser): Promise<MessOverrideDto> {
    if (dto.hostel_id) await careHostel(this.dataSource, schoolId, dto.hostel_id);
    if (dto.menu_date < this.today()) {
      throw AppException.validation([{ field: 'menu_date', message: 'Cannot be before today' }]);
    }
    const hostelId = dto.hostel_id ?? null;
    const id = await this.dataSource.transaction(async (manager) => {
      const [existing] = await manager.query(
        `SELECT id FROM hostel_menu_overrides
         WHERE school_id = $1 AND hostel_id IS NOT DISTINCT FROM $2::int AND menu_date = $3::date AND meal = $4
           AND deleted_at IS NULL
         FOR UPDATE`,
        [schoolId, hostelId, dto.menu_date, dto.meal],
      );
      const values = { items: dto.items, non_veg_items: dto.non_veg_items ?? null, note: dto.note ?? null };
      if (existing) {
        await manager.update(HostelMenuOverride, { id: existing.id }, values);
        return Number(existing.id);
      }
      const saved = await manager.save(
        manager.create(HostelMenuOverride, {
          school_id: schoolId,
          hostel_id: hostelId,
          menu_date: dto.menu_date,
          meal: dto.meal,
          ...values,
          created_by: actor.id,
        }),
      );
      return saved.id;
    });
    const [row] = await this.dataSource.query(`${this.overrideSelect()} WHERE o.id = $1`, [id]);
    return row;
  }

  async removeOverride(schoolId: number, id: number): Promise<void> {
    const row = await this.dataSource.manager.findOneBy(HostelMenuOverride, { school_id: schoolId, id });
    if (!row) throw AppException.notFound('Menu change not found', 'HOSTEL_MENU_OVERRIDE_NOT_FOUND');
    await this.dataSource.manager.softDelete(HostelMenuOverride, { id });
  }

  async day(schoolId: number, date: string | undefined, hostelId?: number): Promise<MessDayDto> {
    const value = date ?? this.today();
    if (hostelId) await careHostel(this.dataSource, schoolId, hostelId);
    const day = dayOfWeek(value);
    const params: unknown[] = [schoolId, value];
    const scope = hostelId ? `(o.hostel_id IS NULL OR o.hostel_id = $${params.push(hostelId)})` : 'o.hostel_id IS NULL';
    const overrides: OverrideRow[] = await this.dataSource.query(
      `SELECT o.id, o.hostel_id, o.meal, o.items, o.non_veg_items, o.note FROM hostel_menu_overrides o
       WHERE o.school_id = $1 AND o.menu_date = $2::date AND o.deleted_at IS NULL AND ${scope}`,
      params,
    );
    const menus = await this.menuRows(schoolId, hostelId ?? null, day);
    return {
      date: value,
      day_of_week: day,
      day_name: DAY_NAMES[day],
      hostel_id: hostelId ?? null,
      meals: resolveDay(value, menus, overrides),
    };
  }

  async headcount(schoolId: number, hostelId: number, date: string | undefined, meal: Meal): Promise<MessHeadcountDto> {
    const value = date ?? this.today();
    await careHostel(this.dataSource, schoolId, hostelId);
    const residents = await this.mealResidents(schoolId, hostelId, value, meal);
    return { hostel_id: hostelId, date: value, meal, ...headcount(residents) };
  }

  async sheet(
    schoolId: number,
    hostelId: number,
    date: string | undefined,
    meal: Meal,
  ): Promise<MessAttendanceSheetDto> {
    const value = date ?? this.today();
    await careHostel(this.dataSource, schoolId, hostelId);
    const students = await this.mealResidents(schoolId, hostelId, value, meal);
    const counts = headcount(students);
    return {
      hostel_id: hostelId,
      date: value,
      meal,
      counts: {
        total: counts.residents,
        ate: counts.ate,
        skipped: counts.skipped,
        unmarked: counts.unmarked,
        on_leave: counts.on_leave,
        skip_requested: students.filter((student) => student.skip_id).length,
      },
      students,
    };
  }

  async mark(schoolId: number, dto: MessMarkDto, actor: AuthUser): Promise<MessAttendanceSheetDto> {
    const date = dto.date ?? this.today();
    if (!withinBackDays(date, this.today(), MEAL_BACK_DAYS)) {
      throw AppException.validation([{ field: 'date', message: 'Meals can be marked for today or yesterday' }]);
    }
    await careHostel(this.dataSource, schoolId, dto.hostel_id);
    const ids = dto.entries.map((entry) => entry.admission_id);
    const twice = duplicateIds(ids);
    if (twice.length) {
      throw AppException.badRequest(`Listed twice: admission ${twice.join(', ')}`, 'HOSTEL_MEAL_DUPLICATE');
    }
    const students = await this.residentStudents(schoolId, dto.hostel_id, date, ids);
    await this.saveMarks(
      schoolId,
      dto.hostel_id,
      date,
      dto.meal,
      dto.entries.map((entry) => ({ ...entry, student_id: students.get(entry.admission_id)! })),
      'manual',
      actor,
    );
    return this.sheet(schoolId, dto.hostel_id, date, dto.meal);
  }

  async scan(schoolId: number, dto: MessScanDto, actor: AuthUser): Promise<MessScanResultDto> {
    const date = this.today();
    await careHostel(this.dataSource, schoolId, dto.hostel_id);
    const token = this.qr.readStudent(dto.qr);
    if (!token) throw AppException.badRequest('This is not a valid student ID card QR', 'HOSTEL_QR_INVALID');
    const [student] = await this.dataSource.query(
      `SELECT card_version FROM students WHERE school_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [schoolId, token.student_id],
    );
    if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    if (Number(student.card_version) !== token.version) {
      throw AppException.conflict('This ID card was replaced. Use the new card.', 'HOSTEL_QR_OLD_CARD');
    }
    const [admission] = await this.dataSource.query(
      `SELECT id FROM hostel_admissions WHERE school_id = $1 AND hostel_id = $2 AND student_id = $3
         AND status <> 'checked_out' AND deleted_at IS NULL AND admitted_on <= $4::date`,
      [schoolId, dto.hostel_id, token.student_id, date],
    );
    if (!admission) throw AppException.notFound('This student does not stay in this hostel', 'HOSTEL_NOT_RESIDENT');
    const admissionId = Number(admission.id);
    const [before] = await this.mealResidents(schoolId, dto.hostel_id, date, dto.meal, admissionId);
    await this.saveMarks(
      schoolId,
      dto.hostel_id,
      date,
      dto.meal,
      [{ admission_id: admissionId, student_id: token.student_id, status: 'ate' }],
      'qr',
      actor,
    );
    const [entry] = await this.mealResidents(schoolId, dto.hostel_id, date, dto.meal, admissionId);
    return { entry: entry!, already_marked: before?.status === 'ate' };
  }

  async skips(schoolId: number, query: MessSkipQueryDto): Promise<Paginated<MessSkipDto>> {
    const sort = sortColumn(SKIP_SORTS, query.sort, 'from_date');
    const params: unknown[] = [schoolId];
    const where = ['k.school_id = $1', 'k.deleted_at IS NULL'];
    if (query.hostel_id) where.push(`a.hostel_id = $${params.push(query.hostel_id)}`);
    if (query.admission_id) where.push(`k.admission_id = $${params.push(query.admission_id)}`);
    if (query.active !== undefined) {
      const today = `$${params.push(this.today())}::date`;
      where.push(
        query.active
          ? `k.status = 'active' AND k.to_date >= ${today}`
          : `(k.status <> 'active' OR k.to_date < ${today})`,
      );
    }
    for (const word of (query.search ?? '').split(/\s+/).filter(Boolean)) {
      const slot = `$${params.push(`%${escapeLike(word)}%`)}`;
      where.push(
        `(s.first_name ILIKE ${slot} OR s.last_name ILIKE ${slot} OR s.admission_no ILIKE ${slot} OR k.reason ILIKE ${slot})`,
      );
    }
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const from = `${this.skipFrom()} WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    const rows = await this.dataSource.query(
      `SELECT ${this.skipColumns()} ${from} ORDER BY ${sort} ${order}, k.id ${order} ${pageClause(query)}`,
      params,
    );
    return paginate([rows.map((row: Record<string, unknown>) => this.toSkip(row)), total], query.page, query.limit);
  }

  async skip(schoolId: number, id: number): Promise<MessSkipDto> {
    const rows = await this.dataSource.query(
      `SELECT ${this.skipColumns()} ${this.skipFrom()} WHERE k.school_id = $1 AND k.id = $2 AND k.deleted_at IS NULL`,
      [schoolId, id],
    );
    if (!rows.length) throw AppException.notFound('Meal skip not found', 'HOSTEL_MEAL_SKIP_NOT_FOUND');
    return this.toSkip(rows[0]);
  }

  async createSkip(
    schoolId: number,
    admissionId: number,
    dto: ParentMessSkipInputDto,
    source: 'parent' | 'warden',
    actor: AuthUser,
  ): Promise<MessSkipDto> {
    const errors = skipErrors(dto.from_date, dto.to_date, this.today());
    if (errors.length) throw AppException.validation(errors);
    const id = await this.dataSource.transaction(async (manager) => {
      const admission = await careAdmission(manager, schoolId, admissionId, true);
      const current: { from_date: string; to_date: string; meals: Meal[]; status: string }[] = await manager.query(
        `SELECT from_date::text AS from_date, to_date::text AS to_date, meals, status FROM hostel_meal_skips
         WHERE admission_id = $1 AND status = 'active' AND deleted_at IS NULL
           AND to_date >= $2::date AND from_date <= $3::date`,
        [admission.id, dto.from_date, dto.to_date],
      );
      const wanted = { from_date: dto.from_date, to_date: dto.to_date, meals: dto.meals, status: 'active' };
      if (current.some((skip) => skipsOverlap(skip, wanted))) {
        throw AppException.conflict(
          'A meal skip already covers some of these days and meals. Cancel it first.',
          'HOSTEL_MEAL_SKIP_OVERLAP',
        );
      }
      const saved = await manager.save(
        manager.create(HostelMealSkip, {
          school_id: schoolId,
          admission_id: admission.id,
          student_id: admission.student_id,
          from_date: dto.from_date,
          to_date: dto.to_date,
          meals: MEALS.filter((meal) => dto.meals.includes(meal)),
          reason: dto.reason ?? null,
          source,
          status: 'active',
          created_by: actor.id,
        }),
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'mess_skip',
        entity_id: saved.id,
        action: 'create',
        student_id: admission.student_id,
        changes: { from_date: dto.from_date, to_date: dto.to_date, meals: saved.meals, source },
        note: dto.reason ?? null,
      });
      return saved.id;
    });
    return this.skip(schoolId, id);
  }

  async cancelSkip(schoolId: number, id: number, actor: AuthUser, admissionId?: number): Promise<MessSkipDto> {
    await this.dataSource.transaction(async (manager) => {
      const skip = await manager.findOne(HostelMealSkip, {
        where: { school_id: schoolId, id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!skip || (admissionId && skip.admission_id !== admissionId)) {
        throw AppException.notFound('Meal skip not found', 'HOSTEL_MEAL_SKIP_NOT_FOUND');
      }
      if (skip.status !== 'active') {
        throw AppException.conflict('This meal skip is already cancelled', 'HOSTEL_MEAL_SKIP_STATE');
      }
      if (skip.to_date < this.today()) {
        throw AppException.conflict('This meal skip is already over', 'HOSTEL_MEAL_SKIP_STATE');
      }
      await manager.update(HostelMealSkip, { id }, { status: 'cancelled' });
      await this.audit.record(manager, schoolId, actor, {
        entity: 'mess_skip',
        entity_id: id,
        action: 'cancel',
        student_id: skip.student_id,
      });
    });
    return this.skip(schoolId, id);
  }

  async addFeedback(
    schoolId: number,
    hostelId: number,
    admissionId: number | null,
    dto: ParentMessFeedbackInputDto,
    actor: AuthUser,
  ): Promise<MessFeedbackDto> {
    if (!withinBackDays(dto.date, this.today(), FEEDBACK_BACK_DAYS)) {
      throw AppException.validation([
        { field: 'date', message: `Feedback can be given for today or the last ${FEEDBACK_BACK_DAYS} days` },
      ]);
    }
    if (!admissionId) await careHostel(this.dataSource, schoolId, hostelId);
    const [row] = await this.dataSource.query(
      `INSERT INTO hostel_mess_feedback (school_id, hostel_id, admission_id, meal_date, meal, rating, comment, by_role, created_by)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9)
       ON CONFLICT (admission_id, meal_date, meal) WHERE admission_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        schoolId,
        hostelId,
        admissionId,
        dto.date,
        dto.meal,
        dto.rating,
        dto.comment ?? null,
        admissionId ? 'parent' : 'staff',
        actor.id,
      ],
    );
    if (!row) {
      throw AppException.conflict('Feedback for this meal was already given', 'HOSTEL_MESS_FEEDBACK_EXISTS');
    }
    const [item] = await this.dataSource.query(
      `SELECT ${this.feedbackColumns()} ${this.feedbackFrom()} WHERE f.id = $1`,
      [row.id],
    );
    return item;
  }

  async feedback(schoolId: number, query: MessFeedbackQueryDto): Promise<Paginated<MessFeedbackDto>> {
    const sort = sortColumn(FEEDBACK_SORTS, query.sort, 'created_at');
    const params: unknown[] = [schoolId];
    const where = ['f.school_id = $1'];
    if (query.hostel_id) where.push(`f.hostel_id = $${params.push(query.hostel_id)}`);
    if (query.meal) where.push(`f.meal = $${params.push(query.meal)}`);
    if (query.by_role) where.push(`f.by_role = $${params.push(query.by_role)}`);
    if (query.max_rating) where.push(`f.rating <= $${params.push(query.max_rating)}`);
    if (query.from) where.push(`f.meal_date >= $${params.push(query.from)}::date`);
    if (query.to) where.push(`f.meal_date <= $${params.push(query.to)}::date`);
    for (const word of (query.search ?? '').split(/\s+/).filter(Boolean)) {
      const slot = `$${params.push(`%${escapeLike(word)}%`)}`;
      where.push(`(f.comment ILIKE ${slot} OR s.first_name ILIKE ${slot} OR s.last_name ILIKE ${slot})`);
    }
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const from = `${this.feedbackFrom()} WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    const rows = await this.dataSource.query(
      `SELECT ${this.feedbackColumns()} ${from} ORDER BY ${sort} ${order}, f.id ${order} ${pageClause(query)}`,
      params,
    );
    return paginate([rows, total], query.page, query.limit);
  }

  async feedbackSummary(schoolId: number, query: MessFeedbackSummaryQueryDto): Promise<MessFeedbackSummaryDto> {
    const to = query.to ?? this.today();
    const from = query.from ?? addDays(to, -30);
    if (from > to) throw AppException.validation([{ field: 'from', message: 'Must be on or before to' }]);
    const params: unknown[] = [schoolId, from, to];
    const where = ['f.school_id = $1', 'f.meal_date BETWEEN $2::date AND $3::date'];
    if (query.hostel_id) where.push(`f.hostel_id = $${params.push(query.hostel_id)}`);
    const rows: { meal: Meal; count: number; total: number; low: number }[] = await this.dataSource.query(
      `SELECT f.meal, COUNT(*)::int AS count, SUM(f.rating)::int AS total,
         COUNT(*) FILTER (WHERE f.rating <= 2)::int AS low
       FROM hostel_mess_feedback f WHERE ${where.join(' AND ')} GROUP BY f.meal`,
      params,
    );
    const meals = MEALS.map((meal) => {
      const row = rows.find((item) => item.meal === meal);
      return {
        meal,
        average: averageRating(row?.total ?? 0, row?.count ?? 0),
        count: row?.count ?? 0,
        low: row?.low ?? 0,
      };
    });
    const count = rows.reduce((sum, row) => sum + row.count, 0);
    const total = rows.reduce((sum, row) => sum + row.total, 0);
    return { from, to, average: averageRating(total, count), count, meals };
  }

  private async menuRows(schoolId: number, hostelId: number | null, day?: number): Promise<MenuRow[]> {
    const params: unknown[] = [schoolId];
    const where = ['school_id = $1', 'deleted_at IS NULL'];
    where.push(hostelId ? `(hostel_id IS NULL OR hostel_id = $${params.push(hostelId)})` : 'hostel_id IS NULL');
    if (day !== undefined) where.push(`day_of_week = $${params.push(day)}`);
    return this.dataSource.query(
      `SELECT hostel_id, day_of_week, meal, items, non_veg_items FROM hostel_mess_menus WHERE ${where.join(' AND ')}`,
      params,
    );
  }

  private async residentStudents(
    schoolId: number,
    hostelId: number,
    date: string,
    ids: number[],
  ): Promise<Map<number, number>> {
    const live: { id: number; student_id: number }[] = await this.dataSource.query(
      `SELECT id, student_id FROM hostel_admissions
       WHERE school_id = $1 AND hostel_id = $2 AND id = ANY($3::int[]) AND deleted_at IS NULL
         AND admitted_on <= $4::date AND (status <> 'checked_out' OR checked_out_on > $4::date)`,
      [schoolId, hostelId, ids, date],
    );
    const students = new Map(live.map((row) => [Number(row.id), Number(row.student_id)]));
    const missing = ids.filter((id) => !students.has(id));
    if (missing.length) {
      throw AppException.badRequest(
        `Not residents of this hostel on ${date}: admission ${missing.join(', ')}`,
        'HOSTEL_NOT_RESIDENT',
      );
    }
    return students;
  }

  private async saveMarks(
    schoolId: number,
    hostelId: number,
    date: string,
    meal: Meal,
    entries: { admission_id: number; student_id: number; status: string }[],
    method: 'manual' | 'qr',
    actor: AuthUser,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO hostel_meal_attendance
         (school_id, hostel_id, meal_date, meal, admission_id, student_id, status, method, marked_by, marked_at)
       SELECT $1, $2, $3::date, $4, x.admission_id, x.student_id, x.status, $5, $6, now()
       FROM unnest($7::int[], $8::int[], $9::varchar[]) AS x(admission_id, student_id, status)
       ON CONFLICT (admission_id, meal_date, meal) DO UPDATE SET
         hostel_id = EXCLUDED.hostel_id, status = EXCLUDED.status, method = EXCLUDED.method,
         marked_by = EXCLUDED.marked_by, marked_at = now()`,
      [
        schoolId,
        hostelId,
        date,
        meal,
        method,
        actor.id,
        entries.map((entry) => entry.admission_id),
        entries.map((entry) => entry.student_id),
        entries.map((entry) => entry.status),
      ],
    );
  }

  private async mealResidents(
    schoolId: number,
    hostelId: number,
    date: string,
    meal: Meal,
    admissionId?: number,
  ): Promise<MessAttendanceEntryDto[]> {
    const params: unknown[] = [schoolId, hostelId, date, meal, this.app.timeZone];
    const where = [
      'a.school_id = $1',
      'a.hostel_id = $2',
      'a.deleted_at IS NULL',
      'a.admitted_on <= $3::date',
      `(a.status <> 'checked_out' OR a.checked_out_on > $3::date)`,
    ];
    if (admissionId) where.push(`a.id = $${params.push(admissionId)}`);
    const rows = await this.dataSource.query(
      `SELECT a.id AS admission_id, a.diet, ${STUDENT_COLUMNS}, r.room_no, bd.bed_no,
         m.status, m.method, m.marked_at, sk.id AS skip_id, (lv.id IS NOT NULL) AS on_leave
       FROM hostel_admissions a
       JOIN students s ON s.id = a.student_id
       ${studentJoins('s')}
       LEFT JOIN hostel_allocations al ON al.admission_id = a.id AND al.to_date IS NULL
       LEFT JOIN hostel_rooms r ON r.id = al.room_id
       LEFT JOIN hostel_beds bd ON bd.id = al.bed_id
       LEFT JOIN hostel_blocks b ON b.id = r.block_id
       LEFT JOIN hostel_meal_attendance m ON m.admission_id = a.id AND m.meal_date = $3::date AND m.meal = $4::varchar
       LEFT JOIN LATERAL (
         SELECT k.id FROM hostel_meal_skips k
         WHERE k.admission_id = a.id AND k.deleted_at IS NULL AND k.status = 'active'
           AND $3::date BETWEEN k.from_date AND k.to_date AND $4::varchar = ANY(k.meals)
         ORDER BY k.id DESC LIMIT 1
       ) sk ON true
       LEFT JOIN LATERAL (
         SELECT l.id FROM hostel_leaves l
         WHERE l.admission_id = a.id AND l.deleted_at IS NULL AND l.kind <> 'outing' AND l.departed_at IS NOT NULL
           AND (l.departed_at AT TIME ZONE $5)::date <= $3::date
           AND (l.returned_at IS NULL OR (l.returned_at AT TIME ZONE $5)::date > $3::date)
         LIMIT 1
       ) lv ON true
       WHERE ${where.join(' AND ')}
       ORDER BY b.sort_order NULLS LAST, r.room_no NULLS LAST, bd.bed_no, s.first_name`,
      params,
    );
    return rows.map((row: Record<string, unknown>) => ({
      admission_id: row.admission_id as number,
      student: studentFromRow(row),
      room_no: (row.room_no as string | null) ?? null,
      bed_no: (row.bed_no as string | null) ?? null,
      diet: row.diet as MessAttendanceEntryDto['diet'],
      status: (row.status as MessAttendanceEntryDto['status']) ?? null,
      method: (row.method as MessAttendanceEntryDto['method']) ?? null,
      marked_at: (row.marked_at as Date | null) ?? null,
      skip_id: (row.skip_id as number | null) ?? null,
      on_leave: Boolean(row.on_leave),
    }));
  }

  private overrideSelect(): string {
    return `SELECT o.id, o.hostel_id, h.name AS hostel_name, o.menu_date::text AS menu_date, o.meal, o.items,
         o.non_veg_items, o.note, o.created_at
       FROM hostel_menu_overrides o LEFT JOIN hostels h ON h.id = o.hostel_id`;
  }

  private skipColumns(): string {
    return `k.id, k.admission_id, h.name AS hostel_name, k.from_date::text AS from_date, k.to_date::text AS to_date,
         k.meals, k.reason, k.source, k.status, u.name AS created_by_name, k.created_at, ${STUDENT_COLUMNS}`;
  }

  private skipFrom(): string {
    return `FROM hostel_meal_skips k
       JOIN hostel_admissions a ON a.id = k.admission_id
       JOIN hostels h ON h.id = a.hostel_id
       JOIN students s ON s.id = k.student_id
       ${studentJoins('s')}
       LEFT JOIN users u ON u.id = k.created_by`;
  }

  private toSkip(row: Record<string, unknown>): MessSkipDto {
    return {
      id: row.id as number,
      admission_id: row.admission_id as number,
      student: studentFromRow(row),
      hostel_name: row.hostel_name as string,
      from_date: row.from_date as string,
      to_date: row.to_date as string,
      meals: row.meals as Meal[],
      reason: (row.reason as string | null) ?? null,
      source: row.source as MessSkipDto['source'],
      status: row.status as MessSkipDto['status'],
      created_by_name: (row.created_by_name as string | null) ?? null,
      created_at: row.created_at as Date,
    };
  }

  private feedbackColumns(): string {
    return `f.id, f.hostel_id, h.name AS hostel_name, f.admission_id,
         NULLIF(TRIM(CONCAT(s.first_name, ' ', s.last_name)), '') AS student_name,
         f.meal_date::text AS meal_date, f.meal, f.rating, f.comment, f.by_role, u.name AS created_by_name, f.created_at`;
  }

  private feedbackFrom(): string {
    return `FROM hostel_mess_feedback f
       JOIN hostels h ON h.id = f.hostel_id
       LEFT JOIN hostel_admissions a ON a.id = f.admission_id
       LEFT JOIN students s ON s.id = a.student_id
       LEFT JOIN users u ON u.id = f.created_by`;
  }
}
