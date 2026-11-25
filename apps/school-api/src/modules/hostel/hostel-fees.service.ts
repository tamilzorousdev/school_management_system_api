import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { AppException, AuthUser, Paginated, paginate } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { applyCredit } from '../fees/fee-credits';
import { createOneOffInvoice, FeeYear } from '../fees/fee-ledger';
import { HOSTEL_TEMPLATES } from '../notifications/hostel-templates.catalog';
import { rupees } from '../payroll/payroll.calc';
import {
  BillDto,
  BillResultDto,
  BillSkipDto,
  ChargeDto,
  DepositSettleDto,
  DuesQueryDto,
  DuesRowDto,
  FeesInsightsDto,
  ResidentFeesDto,
  ScheduleDto,
  ScheduleInputDto,
} from './dto/hostel-conduct.dto';
import { HostelCheckoutItem } from './entities/hostel-admission.entity';
import { HostelCharge, HostelFeeSchedule } from './entities/hostel-conduct.entity';
import { STUDENT_COLUMNS, studentFromRow, studentJoins, escapeLike } from './hostel-sql';
import { HostelAuditService } from './hostel-audit.service';
import { HostelNotifyService } from './hostel-notify.service';
import { HostelSettingsService } from './hostel-settings.service';
import { billableItems, depositRefund, scheduleErrors, shareOf } from './hostel.logic';

interface Resident {
  admission_id: number;
  student_id: number;
  student_name: string;
  admitted_on: string;
  room_type: string | null;
  annual_fee: number | null;
  has_bed: boolean;
}

const DUES_SORTS: Record<string, string> = { balance: 'balance', name: 'student_name', billed: 'billed' };
@Injectable()
export class HostelFeesService {
  private readonly logger = new Logger('HostelFees');

  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: HostelSettingsService,
    private readonly notify: HostelNotifyService,
    private readonly audit: HostelAuditService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async schedule(schoolId: number): Promise<ScheduleDto> {
    const year = await this.year(schoolId);
    const items = await this.items(this.dataSource.manager, schoolId, year.id);
    const counts: { schedule_id: number; total: number }[] = await this.dataSource.query(
      `SELECT schedule_id, COUNT(*)::int AS total FROM hostel_charges
       WHERE school_id = $1 AND academic_year_id = $2 AND kind = 'rent' GROUP BY schedule_id`,
      [schoolId, year.id],
    );
    const invoiced = new Map(counts.map((row) => [Number(row.schedule_id), row.total]));
    return {
      academic_year_id: year.id,
      year_name: year.name,
      items: items.map((item) => ({
        id: item.id,
        label: item.label,
        due_date: item.due_date,
        share_percent: Number(item.share_percent),
        invoiced: invoiced.get(item.id) ?? 0,
      })),
      locked: counts.length > 0,
    };
  }

  async saveSchedule(schoolId: number, dto: ScheduleInputDto, actor: AuthUser): Promise<ScheduleDto> {
    const year = await this.year(schoolId);
    const errors = scheduleErrors(dto.items, year);
    if (errors.length) throw AppException.validation(errors);
    const current = await this.schedule(schoolId);
    const sorted = [...dto.items].sort((a, b) => a.due_date.localeCompare(b.due_date));
    await this.dataSource.transaction(async (manager) => {
      if (current.locked) {
        const same =
          current.items.length === sorted.length &&
          current.items.every(
            (item, index) =>
              item.due_date === sorted[index]!.due_date && item.share_percent === sorted[index]!.share_percent,
          );
        if (!same) {
          throw AppException.conflict(
            'Instalments are already billed. Only their names can change this year.',
            'HOSTEL_SCHEDULE_LOCKED',
          );
        }
        for (const [index, item] of current.items.entries()) {
          await manager.update(HostelFeeSchedule, { id: item.id }, { label: sorted[index]!.label });
        }
      } else {
        await manager.softDelete(HostelFeeSchedule, { school_id: schoolId, academic_year_id: year.id });
        await manager.save(
          sorted.map((item, index) =>
            manager.create(HostelFeeSchedule, {
              school_id: schoolId,
              academic_year_id: year.id,
              label: item.label,
              due_date: item.due_date,
              share_percent: item.share_percent,
              sort_order: index,
              created_by: actor.id,
            }),
          ),
        );
      }
      await this.audit.record(manager, schoolId, actor, {
        entity: 'fee_schedule',
        entity_id: year.id,
        action: 'save',
        changes: { items: sorted },
      });
    });
    return this.schedule(schoolId);
  }

  async bill(schoolId: number, dto: BillDto, actor: AuthUser): Promise<BillResultDto> {
    const year = await this.year(schoolId);
    const residents = await this.residents(schoolId, dto.admission_ids, dto.hostel_id);
    const result: BillResultDto = { invoices_created: 0, deposits_created: 0, amount: 0, skipped: [] };
    for (const resident of residents) {
      try {
        const done = await this.billResident(schoolId, year, resident, actor);
        result.invoices_created += done.invoices;
        result.deposits_created += done.deposits;
        result.amount = Math.round((result.amount + done.amount) * 100) / 100;
        if (done.skip) result.skipped.push(this.skip(resident, done.skip));
      } catch (error) {
        result.skipped.push(this.skip(resident, (error as Error).message));
      }
    }
    return result;
  }

  async billAdmission(schoolId: number, admissionId: number, actor: AuthUser): Promise<void> {
    try {
      const settings = await this.settings.get(schoolId);
      if (!settings.bill_on_admission) return;
      await this.bill(schoolId, { admission_ids: [admissionId] }, actor);
    } catch (error) {
      this.logger.warn(`Hostel billing for admission ${admissionId} failed: ${(error as Error).message}`);
    }
  }

  async residentFees(schoolId: number, admissionId: number): Promise<ResidentFeesDto> {
    const [row] = await this.dataSource.query(
      `SELECT a.id AS admission_id, ${STUDENT_COLUMNS}, t.name AS room_type, t.annual_fee::float AS annual_fee
       FROM hostel_admissions a
       JOIN students s ON s.id = a.student_id
       ${studentJoins('s')}
       LEFT JOIN hostel_allocations al ON al.admission_id = a.id AND al.to_date IS NULL
       LEFT JOIN hostel_rooms r ON r.id = al.room_id
       LEFT JOIN hostel_room_types t ON t.id = r.room_type_id
       WHERE a.school_id = $1 AND a.id = $2 AND a.deleted_at IS NULL`,
      [schoolId, admissionId],
    );
    if (!row) throw AppException.notFound('Hostel admission not found', 'HOSTEL_ADMISSION_NOT_FOUND');
    const charges = await this.charges(this.dataSource.manager, [admissionId]);
    const own = charges.get(admissionId) ?? [];
    const live = own.filter((charge) => charge.invoice_status !== 'cancelled');
    const sum = (values: number[]) => Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;
    return {
      admission_id: admissionId,
      student: studentFromRow(row),
      room_type: row.room_type ?? null,
      annual_fee: row.annual_fee ?? null,
      billed: sum(live.map((charge) => charge.amount)),
      paid: sum(live.map((charge) => charge.paid)),
      balance: sum(live.map((charge) => charge.balance)),
      dues: sum(live.filter((charge) => charge.kind === 'rent').map((charge) => charge.balance)),
      charges: own,
    };
  }

  async dues(manager: EntityManager, admissionId: number): Promise<number> {
    const [row] = await manager.query(
      `SELECT COALESCE(SUM(i.balance), 0)::float AS dues FROM hostel_charges c
       JOIN fee_invoices i ON i.id = c.invoice_id AND i.status <> 'cancelled'
       WHERE c.admission_id = $1 AND c.kind = 'rent'`,
      [admissionId],
    );
    return Number(row.dues);
  }

  async heldDeposit(manager: EntityManager, admissionId: number): Promise<{ paid: number; settled: boolean } | null> {
    const [row] = await manager.query(
      `SELECT i.paid::float AS paid, c.settled_at FROM hostel_charges c
       JOIN fee_invoices i ON i.id = c.invoice_id AND i.status <> 'cancelled'
       WHERE c.admission_id = $1 AND c.kind = 'deposit'`,
      [admissionId],
    );
    if (!row || Number(row.paid) <= 0) return null;
    return { paid: Number(row.paid), settled: Boolean(row.settled_at) };
  }

  async duesList(schoolId: number, query: DuesQueryDto): Promise<Paginated<DuesRowDto>> {
    const params: unknown[] = [schoolId];
    const where = ['a.school_id = $1', 'a.deleted_at IS NULL', `a.status <> 'checked_out'`];
    if (query.hostel_id) where.push(`a.hostel_id = $${params.push(query.hostel_id)}`);
    for (const word of (query.search ?? '').split(/\s+/).filter(Boolean)) {
      const slot = `$${params.push(`%${escapeLike(word)}%`)}`;
      where.push(`(s.first_name ILIKE ${slot} OR s.last_name ILIKE ${slot} OR s.admission_no ILIKE ${slot})`);
    }
    const sortKey = query.sort ?? 'balance';
    const sort = DUES_SORTS[sortKey];
    if (!sort)
      throw AppException.badRequest(`sort must be one of ${Object.keys(DUES_SORTS).join(', ')}`, 'INVALID_SORT');
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const base = `SELECT a.id AS admission_id, a.admitted_on::text AS admitted_on, h.name AS hostel_name, ${STUDENT_COLUMNS},
         CASE WHEN r.id IS NULL THEN NULL ELSE CONCAT(r.room_no, ' / ', bd.bed_no) END AS bed,
         COALESCE(f.billed, 0)::float AS billed, COALESCE(f.paid, 0)::float AS paid, COALESCE(f.balance, 0)::float AS balance,
         CASE WHEN d.id IS NULL THEN 'none' WHEN d.settled_at IS NOT NULL THEN 'settled'
              WHEN d.paid > 0 THEN 'paid' ELSE 'unpaid' END AS deposit_status,
         (SELECT COUNT(*) FROM hostel_charges x WHERE x.admission_id = a.id AND x.kind = 'rent')::int AS rent_count
       FROM hostel_admissions a
       JOIN hostels h ON h.id = a.hostel_id
       JOIN students s ON s.id = a.student_id
       ${studentJoins('s')}
       LEFT JOIN hostel_allocations al ON al.admission_id = a.id AND al.to_date IS NULL
       LEFT JOIN hostel_rooms r ON r.id = al.room_id
       LEFT JOIN hostel_beds bd ON bd.id = al.bed_id
       LEFT JOIN LATERAL (
         SELECT SUM(i.total) AS billed, SUM(i.paid) AS paid, SUM(i.balance) AS balance
         FROM hostel_charges c JOIN fee_invoices i ON i.id = c.invoice_id AND i.status <> 'cancelled'
         WHERE c.admission_id = a.id
       ) f ON true
       LEFT JOIN LATERAL (
         SELECT c.id, c.settled_at, i.paid FROM hostel_charges c JOIN fee_invoices i ON i.id = c.invoice_id
         WHERE c.admission_id = a.id AND c.kind = 'deposit' LIMIT 1
       ) d ON true
       WHERE ${where.join(' AND ')}`;
    const outer = query.with_balance ? 'WHERE balance > 0' : '';
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total FROM (${base}) x ${outer}`, params);
    const rows = await this.dataSource.query(
      `SELECT * FROM (${base}) x ${outer} ORDER BY ${sort} ${order}, admission_id
       LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    const year = await this.year(schoolId).catch(() => null);
    const items = year ? await this.items(this.dataSource.manager, schoolId, year.id) : [];
    const today = todayIn(this.app.timeZone);
    return paginate(
      [
        rows.map((row: Record<string, unknown>) => ({
          admission_id: row.admission_id as number,
          student: studentFromRow(row),
          hostel_name: row.hostel_name as string,
          bed: (row.bed as string | null) ?? null,
          billed: Number(row.billed),
          paid: Number(row.paid),
          balance: Number(row.balance),
          unbilled: year
            ? Math.max(
                0,
                billableItems(items, row.admitted_on as string, year.end_date).filter((item) => item.due_date <= today)
                  .length - Number(row.rent_count),
              )
            : 0,
          deposit_status: row.deposit_status as string,
        })),
        total,
      ],
      query.page,
      query.limit,
    );
  }

  async insights(schoolId: number, hostelId?: number): Promise<FeesInsightsDto> {
    const params: unknown[] = [schoolId];
    const filter = hostelId ? ` AND a.hostel_id = $${params.push(hostelId)}` : '';
    const [money] = await this.dataSource.query(
      `SELECT
         COALESCE(SUM(i.total) FILTER (WHERE c.kind = 'rent'), 0)::float AS billed,
         COALESCE(SUM(i.paid) FILTER (WHERE c.kind = 'rent'), 0)::float AS collected,
         COALESCE(SUM(i.balance) FILTER (WHERE c.kind = 'rent'), 0)::float AS outstanding,
         COUNT(DISTINCT c.admission_id) FILTER (WHERE c.kind = 'rent' AND i.balance > 0)::int AS residents_with_dues,
         COALESCE(SUM(i.paid) FILTER (WHERE c.kind = 'deposit' AND c.settled_at IS NULL), 0)::float AS deposits_held
       FROM hostel_charges c
       JOIN fee_invoices i ON i.id = c.invoice_id AND i.status <> 'cancelled'
       JOIN hostel_admissions a ON a.id = c.admission_id
       WHERE c.school_id = $1${filter}`,
      params,
    );
    const unbilled = await this.unbilledResidents(schoolId, hostelId);
    return { ...money, unbilled_residents: unbilled };
  }

  async settleDeposit(
    schoolId: number,
    admissionId: number,
    dto: DepositSettleDto,
    actor: AuthUser,
  ): Promise<ResidentFeesDto> {
    await this.dataSource.transaction(async (manager) => {
      const charge = await manager.findOne(HostelCharge, {
        where: { school_id: schoolId, admission_id: admissionId, kind: 'deposit' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!charge) throw AppException.notFound('No caution deposit for this resident', 'HOSTEL_DEPOSIT_NOT_FOUND');
      if (charge.settled_at) throw AppException.conflict('The deposit is already settled', 'HOSTEL_DEPOSIT_SETTLED');
      const [invoice] = await manager.query(`SELECT paid::float AS paid FROM fee_invoices WHERE id = $1`, [
        charge.invoice_id,
      ]);
      const paid = Number(invoice?.paid ?? 0);
      if (paid <= 0) throw AppException.conflict('The deposit was never paid', 'HOSTEL_DEPOSIT_UNPAID');
      const deduction = dto.deduction_amount ?? 0;
      if (deduction > paid) {
        throw AppException.validation([
          { field: 'deduction_amount', message: `Cannot be more than the deposit paid (${paid})` },
        ]);
      }
      if (deduction > 0 && !dto.deduction_reason) {
        throw AppException.validation([{ field: 'deduction_reason', message: 'Say why money is kept' }]);
      }
      const refund = depositRefund(paid, deduction);
      Object.assign(charge, {
        settled_at: new Date(),
        settled_by: actor.id,
        deduction_amount: deduction,
        deduction_reason: dto.deduction_reason ?? null,
        refund_amount: refund,
        refund_mode: dto.refund_mode,
        refund_reference: dto.refund_reference ?? null,
      });
      await manager.save(charge);
      await manager.query(
        `UPDATE hostel_checkout_items i SET status = 'cleared', amount = $3, note = $4, cleared_by = $5, cleared_at = now()
         FROM hostel_checkouts k
         WHERE i.checkout_id = k.id AND k.admission_id = $1 AND k.school_id = $2 AND k.status = 'open'
           AND i.code = 'deposit_refund' AND i.status = 'pending'`,
        [admissionId, schoolId, refund, `Refunded ${rupees(refund)} by ${dto.refund_mode}`, actor.id],
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'admission',
        entity_id: admissionId,
        action: 'deposit_settle',
        student_id: charge.student_id,
        changes: { paid, deduction, refund, mode: dto.refund_mode },
        note: dto.deduction_reason ?? null,
      });
    });
    return this.residentFees(schoolId, admissionId);
  }

  async clearCheckoutFees(
    manager: EntityManager,
    checkoutId: number,
    admissionId: number,
    actorId: number,
  ): Promise<void> {
    if ((await this.dues(manager, admissionId)) <= 0) {
      await manager.update(
        HostelCheckoutItem,
        { checkout_id: checkoutId, code: 'fee_dues', status: 'pending' },
        { status: 'cleared', note: 'No hostel fee due', cleared_by: actorId, cleared_at: new Date() },
      );
    }
    if (!(await this.heldDeposit(manager, admissionId))) {
      await manager.update(
        HostelCheckoutItem,
        { checkout_id: checkoutId, code: 'deposit_refund', status: 'pending' },
        { status: 'cleared', note: 'No deposit held', cleared_by: actorId, cleared_at: new Date() },
      );
    }
  }

  private async billResident(
    schoolId: number,
    year: FeeYear & { end_date: string },
    resident: Resident,
    actor: AuthUser,
  ): Promise<{ invoices: number; deposits: number; amount: number; skip: string | null }> {
    const settings = await this.settings.get(schoolId);
    const today = todayIn(this.app.timeZone);
    const done = await this.dataSource.transaction(async (manager) => {
      const created: number[] = [];
      let amount = 0;
      let deposits = 0;
      let skip: string | null = null;
      const existing = await manager.find(HostelCharge, { where: { admission_id: resident.admission_id } });
      if (!resident.has_bed) skip = 'No bed yet';
      else if (!resident.annual_fee) skip = 'The room type has no annual fee';
      else {
        const items = await this.items(manager, schoolId, year.id);
        if (!items.length) skip = 'No hostel fee schedule for this year';
        for (const item of billableItems(items, resident.admitted_on, year.end_date)) {
          if (existing.some((charge) => charge.kind === 'rent' && charge.schedule_id === item.id)) continue;
          const value = shareOf(resident.annual_fee, Number(item.share_percent));
          if (value <= 0) continue;
          const label = `Hostel fee · ${item.label}`.slice(0, 80);
          const invoice = await createOneOffInvoice(manager, {
            school_id: schoolId,
            year,
            student_id: resident.student_id,
            installment: `Hostel ${item.label}`.slice(0, 40),
            due_date:
              item.due_date < resident.admitted_on
                ? resident.admitted_on
                : item.due_date < today
                  ? today
                  : item.due_date,
            kind: 'fee',
            lines: [
              {
                head_name: 'Hostel fee',
                description: `${resident.room_type ?? 'Room'} · ${item.label}`.slice(0, 160),
                amount: value,
              },
            ],
            created_by: actor.id,
          });
          await manager.insert(HostelCharge, {
            school_id: schoolId,
            admission_id: resident.admission_id,
            student_id: resident.student_id,
            academic_year_id: year.id,
            kind: 'rent',
            schedule_id: item.id,
            invoice_id: invoice.id,
            label,
            amount: value,
            created_by: actor.id,
          });
          created.push(invoice.id);
          amount += value;
        }
      }
      if (settings.caution_deposit > 0 && !existing.some((charge) => charge.kind === 'deposit')) {
        const invoice = await createOneOffInvoice(manager, {
          school_id: schoolId,
          year,
          student_id: resident.student_id,
          installment: 'Hostel deposit',
          due_date: today,
          kind: 'fee',
          lines: [
            {
              head_name: 'Hostel caution deposit',
              description: 'Refundable at checkout',
              amount: settings.caution_deposit,
            },
          ],
          created_by: actor.id,
        });
        await manager.insert(HostelCharge, {
          school_id: schoolId,
          admission_id: resident.admission_id,
          student_id: resident.student_id,
          academic_year_id: year.id,
          kind: 'deposit',
          schedule_id: null,
          invoice_id: invoice.id,
          label: 'Hostel caution deposit',
          amount: settings.caution_deposit,
          created_by: actor.id,
        });
        created.push(invoice.id);
        amount += settings.caution_deposit;
        deposits += 1;
      }
      if (created.length) {
        await applyCredit(manager, schoolId, resident.student_id, actor.id, today, created);
        await this.audit.record(manager, schoolId, actor, {
          entity: 'admission',
          entity_id: resident.admission_id,
          action: 'bill',
          student_id: resident.student_id,
          changes: { invoices: created, amount },
        });
      }
      return {
        invoices: created.length - deposits,
        deposits,
        amount: Math.round(amount * 100) / 100,
        skip: created.length ? null : skip,
      };
    });
    if (done.amount > 0) {
      await this.notify.tellParents(resident.admission_id, HOSTEL_TEMPLATES.HOSTEL_FEE_BILLED, {
        amount: rupees(done.amount),
      });
    }
    return done;
  }

  private skip(resident: Resident, reason: string): BillSkipDto {
    return { admission_id: resident.admission_id, student_name: resident.student_name, reason };
  }

  private async residents(schoolId: number, admissionIds?: number[], hostelId?: number): Promise<Resident[]> {
    const params: unknown[] = [schoolId];
    const where = ['a.school_id = $1', 'a.deleted_at IS NULL', `a.status IN ('active', 'on_leave')`];
    if (admissionIds?.length) where.push(`a.id = ANY($${params.push(admissionIds)})`);
    if (hostelId) where.push(`a.hostel_id = $${params.push(hostelId)}`);
    const rows = await this.dataSource.query(
      `SELECT a.id AS admission_id, a.student_id, a.admitted_on::text AS admitted_on,
         TRIM(CONCAT(s.first_name, ' ', s.last_name)) AS student_name,
         t.name AS room_type, t.annual_fee::float AS annual_fee, al.id IS NOT NULL AS has_bed
       FROM hostel_admissions a
       JOIN students s ON s.id = a.student_id
       LEFT JOIN hostel_allocations al ON al.admission_id = a.id AND al.to_date IS NULL
       LEFT JOIN hostel_rooms r ON r.id = al.room_id
       LEFT JOIN hostel_room_types t ON t.id = r.room_type_id
       WHERE ${where.join(' AND ')} ORDER BY a.id`,
      params,
    );
    return rows.map((row: Record<string, unknown>) => ({
      admission_id: Number(row.admission_id),
      student_id: Number(row.student_id),
      student_name: row.student_name as string,
      admitted_on: row.admitted_on as string,
      room_type: (row.room_type as string | null) ?? null,
      annual_fee: row.annual_fee === null ? null : Number(row.annual_fee),
      has_bed: Boolean(row.has_bed),
    }));
  }

  private async unbilledResidents(schoolId: number, hostelId?: number): Promise<number> {
    const year = await this.year(schoolId).catch(() => null);
    if (!year) return 0;
    const items = await this.items(this.dataSource.manager, schoolId, year.id);
    if (!items.length) return 0;
    const today = todayIn(this.app.timeZone);
    const residents = (await this.residents(schoolId, undefined, hostelId)).filter((row) => row.has_bed);
    if (!residents.length) return 0;
    const charges = await this.dataSource.manager.find(HostelCharge, {
      where: { admission_id: In(residents.map((row) => row.admission_id)), kind: 'rent' },
    });
    return residents.filter((resident) => {
      const due = billableItems(items, resident.admitted_on, year.end_date).filter((item) => item.due_date <= today);
      return due.some(
        (item) => !charges.some((c) => c.admission_id === resident.admission_id && c.schedule_id === item.id),
      );
    }).length;
  }

  private async charges(manager: EntityManager, admissionIds: number[]): Promise<Map<number, ChargeDto[]>> {
    const rows = await manager.query(
      `SELECT c.admission_id, c.id, c.kind, c.label, c.amount::float AS amount, c.invoice_id, i.invoice_no,
         i.due_date::text AS due_date, i.status AS invoice_status, i.paid::float AS paid, i.balance::float AS balance,
         c.settled_at, c.deduction_amount::float AS deduction_amount, c.deduction_reason,
         c.refund_amount::float AS refund_amount, c.refund_mode, c.refund_reference
       FROM hostel_charges c JOIN fee_invoices i ON i.id = c.invoice_id
       WHERE c.admission_id = ANY($1) ORDER BY i.due_date, c.id`,
      [admissionIds],
    );
    const map = new Map<number, ChargeDto[]>();
    for (const { admission_id, ...charge } of rows) {
      map.set(Number(admission_id), [...(map.get(Number(admission_id)) ?? []), charge]);
    }
    return map;
  }

  private async items(manager: EntityManager, schoolId: number, yearId: number) {
    return manager.find(HostelFeeSchedule, {
      where: { school_id: schoolId, academic_year_id: yearId },
      order: { due_date: 'ASC' },
    });
  }

  private async year(schoolId: number): Promise<FeeYear & { end_date: string }> {
    const [year] = await this.dataSource.query(
      `SELECT id, name, start_date::text AS start_date, end_date::text AS end_date, status FROM academic_years
       WHERE school_id = $1 AND is_current = true AND deleted_at IS NULL`,
      [schoolId],
    );
    if (!year) throw AppException.badRequest('Set the current academic year first', 'NO_CURRENT_YEAR');
    return year;
  }
}
