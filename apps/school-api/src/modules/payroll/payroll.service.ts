import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated, paginate } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { datesBetween, holidaySet, monthRange, workingDays } from '../../shared/school-days';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Staff } from '../staff/entities/staff.entity';
import {
  MissingSalaryDto,
  PayrollRunDetailDto,
  PayrollRunDto,
  PayslipDto,
  PayslipPeriodsDto,
  PayslipPreviewDto,
  RunQueryDto,
  SalaryQueryDto,
  SalaryStaffDto,
  SalaryStructureDto,
  SalaryStructureInputDto,
} from './dto/payroll.dto';
import { PayrollRun } from './entities/payroll-run.entity';
import { Payslip } from './entities/payslip.entity';
import { SalaryStructure } from './entities/salary-structure.entity';
import { computePay, monthLabel, monthlyGross, rupees } from './payroll.calc';
import { payslipPdf } from './payslip.pdf';
import { groupByYear, monthPattern, payslipLines } from './payslip-view';

interface DayMark {
  user_id: number;
  date: string;
  weight: number;
}

export function lopDays(
  dates: string[],
  joiningDate: string,
  unpaidLeave: DayMark[],
  absences: DayMark[],
  coveredByLeave: Set<string>,
): number {
  const inMonth = new Set(dates);
  const beforeJoining = dates.filter((date) => date < joiningDate).length;
  const unpaid = unpaidLeave.filter((mark) => inMonth.has(mark.date) && mark.date >= joiningDate);
  const absent = absences.filter(
    (mark) => inMonth.has(mark.date) && mark.date >= joiningDate && !coveredByLeave.has(mark.date),
  );
  return beforeJoining + [...unpaid, ...absent].reduce((sum, mark) => sum + mark.weight, 0);
}

const EARNING_LABELS: [keyof Payslip, string][] = [
  ['basic', 'Basic'],
  ['da', 'Dearness allowance'],
  ['hra', 'House rent allowance'],
  ['conveyance', 'Conveyance'],
  ['special_allowance', 'Special allowance'],
  ['other_allowance', 'Other allowance'],
];
const DEDUCTION_LABELS: [keyof Payslip, string][] = [
  ['pf', 'Provident fund'],
  ['esi', 'ESI'],
  ['professional_tax', 'Professional tax'],
  ['tds', 'Income tax (TDS)'],
  ['other_deduction', 'Other deduction'],
];

@Injectable()
export class PayrollService {
  private readonly logger = new Logger('Payroll');

  constructor(
    @InjectRepository(SalaryStructure) private readonly structures: Repository<SalaryStructure>,
    @InjectRepository(PayrollRun) private readonly runs: Repository<PayrollRun>,
    @InjectRepository(Payslip) private readonly payslips: Repository<Payslip>,
    private readonly notifications: NotificationsService,
    private readonly files: FilesService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async listSalaries(schoolId: number, query: SalaryQueryDto): Promise<Paginated<SalaryStaffDto>> {
    const qb = this.dataSource
      .getRepository(Staff)
      .createQueryBuilder('st')
      .innerJoinAndSelect('st.user', 'u')
      .where('st.school_id = :schoolId', { schoolId })
      .andWhere("st.status <> 'resigned'");
    if (query.has_structure !== undefined) {
      qb.andWhere(
        `${query.has_structure ? '' : 'NOT '}EXISTS (SELECT 1 FROM salary_structures ss WHERE ss.user_id = st.user_id AND ss.deleted_at IS NULL)`,
      );
    }
    const page = await listQuery(qb, query, {
      searchable: ['u.name', 'st.employee_no', 'st.designation', 'st.department'],
      sortable: { name: 'u.name', employee_no: 'st.employee_no', created_at: 'st.created_at' },
      defaultSort: 'name',
    });
    const structures = page.items.length
      ? await this.structures.findBy({ user_id: In(page.items.map((row) => row.user_id)) })
      : [];
    const byUser = new Map(structures.map((row) => [row.user_id, row]));
    return {
      ...page,
      items: page.items.map((row) => this.presentStaff(row, byUser.get(row.user_id) ?? null)),
    };
  }

  async getSalary(schoolId: number, userId: number): Promise<SalaryStaffDto> {
    const staff = await this.staff(schoolId, userId);
    return this.presentStaff(staff, await this.structures.findOneBy({ user_id: userId }));
  }

  async setSalary(schoolId: number, userId: number, dto: SalaryStructureInputDto): Promise<SalaryStaffDto> {
    const staff = await this.staff(schoolId, userId);
    const existing = await this.structures.findOneBy({ user_id: userId });
    const saved = await this.structures.save(
      this.structures.merge(existing ?? this.structures.create(), {
        school_id: schoolId,
        user_id: userId,
        effective_from: dto.effective_from,
        basic: dto.basic,
        da: dto.da ?? 0,
        hra: dto.hra ?? 0,
        conveyance: dto.conveyance ?? 0,
        special_allowance: dto.special_allowance ?? 0,
        other_allowance: dto.other_allowance ?? 0,
        pf_enabled: dto.pf_enabled ?? true,
        esi_enabled: dto.esi_enabled ?? false,
        professional_tax: dto.professional_tax ?? 0,
        tds: dto.tds ?? 0,
        other_deduction: dto.other_deduction ?? 0,
      }),
    );
    return this.presentStaff(staff, saved);
  }

  async listRuns(schoolId: number, query: RunQueryDto): Promise<Paginated<PayrollRunDto>> {
    const qb = this.runs.createQueryBuilder('r').where('r.school_id = :schoolId', { schoolId });
    if (query.status) qb.andWhere('r.status = :status', { status: query.status });
    const page = await listQuery(qb, query, {
      searchable: ['r.month'],
      sortable: { month: 'r.month', created_at: 'r.created_at' },
      defaultSort: 'month',
    });
    return { ...page, items: page.items.map((run) => this.presentRun(run)) };
  }

  async run(schoolId: number, month: string, actor: AuthUser): Promise<PayrollRunDetailDto> {
    if (month > todayIn(this.app.timeZone).slice(0, 7)) {
      throw AppException.validation([{ field: 'month', message: 'Payroll can be run for this month or earlier' }]);
    }
    const existing = await this.runs.findOneBy({ school_id: schoolId, month });
    if (existing?.status === 'finalized') {
      throw AppException.conflict(`Payroll for ${monthLabel(month)} is already final`, 'RUN_FINALIZED');
    }
    const range = monthRange(month);
    const dates = workingDays(
      range.from,
      range.to,
      await holidaySet(this.dataSource.manager, schoolId, range.from, range.to),
    );
    if (!dates.length) throw AppException.badRequest('That month has no working days', 'NO_WORKING_DAYS');

    const staff = await this.dataSource
      .getRepository(Staff)
      .createQueryBuilder('st')
      .innerJoinAndSelect('st.user', 'u')
      .addSelect('st.pan_last4')
      .where('st.school_id = :schoolId', { schoolId })
      .andWhere("st.status <> 'resigned'")
      .andWhere('st.joining_date <= :to', { to: range.to })
      .orderBy('u.name')
      .getMany();
    const structures = staff.length
      ? await this.structures.findBy({ user_id: In(staff.map((row) => row.user_id)) })
      : [];
    const byUser = new Map(structures.filter((row) => row.effective_from <= range.to).map((row) => [row.user_id, row]));
    const marks = await this.dayMarks(schoolId, range.from, range.to);

    const result = await this.dataSource.transaction(async (manager) => {
      const run = await manager.save(
        manager.merge(PayrollRun, existing ?? manager.create(PayrollRun), {
          school_id: schoolId,
          month,
          status: 'draft' as const,
          working_days: dates.length,
          created_by: existing?.created_by ?? actor.id,
        }),
      );
      await manager.delete(Payslip, { run_id: run.id });
      const slips = staff
        .filter((member) => byUser.has(member.user_id))
        .map((member) => {
          const structure = byUser.get(member.user_id)!;
          const own = (rows: DayMark[]) => rows.filter((mark) => mark.user_id === member.user_id);
          const lop = lopDays(
            dates,
            member.joining_date,
            own(marks.unpaid),
            own(marks.absent),
            new Set(own(marks.leave).map((mark) => mark.date)),
          );
          const pay = computePay(structure, dates.length, lop);
          return manager.create(Payslip, {
            school_id: schoolId,
            run_id: run.id,
            user_id: member.user_id,
            employee_no: member.employee_no,
            name: member.user?.name ?? '',
            designation: member.designation,
            department: member.department,
            bank_name: member.bank_name,
            bank_account_last4: member.bank_account_last4,
            pan_last4: member.pan_last4,
            working_days: dates.length,
            lop_days: Math.min(lop, dates.length),
            ...pay,
          });
        });
      if (slips.length) await manager.save(slips);
      run.staff_count = slips.length;
      run.total_gross = Math.round(slips.reduce((sum, slip) => sum + slip.gross, 0) * 100) / 100;
      run.total_deductions = Math.round(slips.reduce((sum, slip) => sum + slip.total_deductions, 0) * 100) / 100;
      run.total_net = Math.round(slips.reduce((sum, slip) => sum + slip.net, 0) * 100) / 100;
      return manager.save(run);
    });
    return this.detail(schoolId, result.id);
  }

  async detail(schoolId: number, id: number): Promise<PayrollRunDetailDto> {
    const run = await this.runs.findOneBy({ id, school_id: schoolId });
    if (!run) throw AppException.notFound('Payroll run not found', 'RUN_NOT_FOUND');
    const slips = await this.payslips.find({ where: { run_id: id }, order: { name: 'ASC' } });
    const missing: MissingSalaryDto[] = (
      await this.dataSource.query(
        `SELECT st.user_id, u.name, st.employee_no FROM staff st JOIN users u ON u.id = st.user_id
         WHERE st.school_id = $1 AND st.deleted_at IS NULL AND st.status <> 'resigned' AND st.joining_date <= $2
           AND NOT EXISTS (SELECT 1 FROM salary_structures ss WHERE ss.user_id = st.user_id AND ss.deleted_at IS NULL
             AND ss.effective_from <= $2)
         ORDER BY u.name`,
        [schoolId, monthRange(run.month).to],
      )
    ).map((row: MissingSalaryDto) => ({ ...row, user_id: Number(row.user_id) }));
    return {
      ...this.presentRun(run),
      payslips: slips.map((slip) => this.presentSlip(slip, run)),
      missing,
    };
  }

  async finalize(schoolId: number, id: number, actor: AuthUser): Promise<PayrollRunDetailDto> {
    const run = await this.runs.findOneBy({ id, school_id: schoolId });
    if (!run) throw AppException.notFound('Payroll run not found', 'RUN_NOT_FOUND');
    if (run.status === 'finalized') {
      throw AppException.conflict(`Payroll for ${monthLabel(run.month)} is already final`, 'RUN_FINALIZED');
    }
    if (!run.staff_count) throw AppException.badRequest('There are no payslips in this run', 'RUN_EMPTY');
    Object.assign(run, { status: 'finalized', finalized_at: new Date(), finalized_by: actor.id });
    await this.runs.save(run);
    const slips = await this.payslips.findBy({ run_id: id });
    for (const slip of slips) {
      await this.notifications
        .dispatch({
          template: 'PAYSLIP_READY',
          audience: { user_ids: [slip.user_id] },
          data: { month: monthLabel(run.month), net: rupees(slip.net) },
        })
        .catch((error: Error) => this.logger.warn(`Payslip alert ${slip.id} not sent: ${error.message}`));
    }
    return this.detail(schoolId, id);
  }

  async remove(schoolId: number, id: number): Promise<void> {
    const run = await this.runs.findOneBy({ id, school_id: schoolId });
    if (!run) throw AppException.notFound('Payroll run not found', 'RUN_NOT_FOUND');
    if (run.status === 'finalized') {
      throw AppException.conflict('A final payroll cannot be deleted', 'RUN_FINALIZED');
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(Payslip, { run_id: id });
      await manager.softDelete(PayrollRun, id);
    });
  }

  async mine(
    user: AuthUser,
    page: number,
    limit: number,
    filter: { year?: number; month?: number } = {},
  ): Promise<Paginated<PayslipDto>> {
    const qb = this.myFinalSlips(user);
    const pattern = monthPattern(filter.year, filter.month);
    if (pattern) qb.andWhere('r.month LIKE :pattern', { pattern });
    const [rows, total] = await qb
      .orderBy('r.month', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return paginate(
      [rows.map((row) => this.presentSlip(row, (row as Payslip & { run: PayrollRun }).run)), total],
      page,
      limit,
    );
  }

  async myPayslip(user: AuthUser, id: number, pdfBase: string): Promise<PayslipPreviewDto> {
    const row = await this.myFinalSlips(user).andWhere('p.id = :id', { id }).getOne();
    if (!row) throw AppException.notFound('Payslip not found', 'PAYSLIP_NOT_FOUND');
    const slip = this.presentSlip(row, (row as Payslip & { run: PayrollRun }).run);
    return { ...slip, ...payslipLines(slip), pdf_path: `${pdfBase}/${slip.id}/pdf` };
  }

  async myPeriods(user: AuthUser): Promise<PayslipPeriodsDto> {
    const rows = await this.myFinalSlips(user).orderBy('r.month', 'DESC').getMany();
    return {
      years: groupByYear(
        rows.map((row) => {
          const run = (row as Payslip & { run: PayrollRun }).run;
          return { id: row.id, month: run.month, month_label: monthLabel(run.month), net: Number(row.net) };
        }),
      ),
    };
  }

  private myFinalSlips(user: AuthUser) {
    return this.payslips
      .createQueryBuilder('p')
      .innerJoinAndMapOne(
        'p.run',
        PayrollRun,
        'r',
        "r.id = p.run_id AND r.status = 'finalized' AND r.deleted_at IS NULL",
      )
      .where('p.user_id = :userId', { userId: user.id });
  }

  async pdf(schoolId: number | null, id: number, ownerId?: number): Promise<{ name: string; pdf: Buffer }> {
    const slip = await this.payslips.findOneBy({ id });
    const run = slip ? await this.runs.findOneBy({ id: slip.run_id }) : null;
    const allowed =
      slip && run && (ownerId ? slip.user_id === ownerId && run.status === 'finalized' : slip.school_id === schoolId);
    if (!allowed) throw AppException.notFound('Payslip not found', 'PAYSLIP_NOT_FOUND');
    const [school] = await this.dataSource.query(
      `SELECT name, code, address, city, state, pincode, phone, email, logo_file_id, signature_file_id, seal_file_id FROM schools WHERE id = $1`,
      [slip.school_id],
    );
    const pick = (labels: [keyof Payslip, string][]) =>
      labels
        .map(([key, label]): [string, number] => [label, Number(slip[key])])
        .filter(([label, value]) => value > 0 || label === 'Basic');
    const pdf = await payslipPdf({
      school_name: school?.name ?? '',
      school_code: school?.code ?? null,
      school_phone: school?.phone ?? null,
      school_email: school?.email ?? null,
      school_address:
        [school?.address, school?.city, school?.state, school?.pincode].filter(Boolean).join(', ') || null,
      school_logo: await this.files.readImage(school?.logo_file_id ?? null),
      school_signature: await this.files.readImage(school?.signature_file_id ?? null),
      school_seal: await this.files.readImage(school?.seal_file_id ?? null),
      month_label: monthLabel(run.month),
      employee_no: slip.employee_no,
      name: slip.name,
      designation: slip.designation,
      department: slip.department,
      bank: slip.bank_name
        ? `${slip.bank_name}${slip.bank_account_last4 ? ` ····${slip.bank_account_last4}` : ''}`
        : null,
      pan_last4: slip.pan_last4,
      working_days: slip.working_days,
      lop_days: slip.lop_days,
      paid_days: slip.paid_days,
      earnings: pick(EARNING_LABELS),
      deductions: pick(DEDUCTION_LABELS),
      gross: slip.gross,
      total_deductions: slip.total_deductions,
      net: slip.net,
      draft: run.status !== 'finalized',
    });
    return { name: `Payslip-${run.month}-${slip.employee_no}`, pdf };
  }

  private async dayMarks(
    schoolId: number,
    from: string,
    to: string,
  ): Promise<{ unpaid: DayMark[]; leave: DayMark[]; absent: DayMark[] }> {
    const [leaves, absences]: [
      { user_id: number; from_date: string; to_date: string; half_day: boolean; is_paid: boolean }[],
      { user_id: number; date: string; status: string }[],
    ] = await Promise.all([
      this.dataSource.query(
        `SELECT l.user_id, to_char(l.from_date, 'YYYY-MM-DD') AS from_date, to_char(l.to_date, 'YYYY-MM-DD') AS to_date,
                l.half_day, lt.is_paid
         FROM staff_leave_requests l JOIN leave_types lt ON lt.id = l.leave_type_id
         WHERE l.school_id = $1 AND l.status = 'approved' AND l.deleted_at IS NULL AND l.from_date <= $3 AND l.to_date >= $2`,
        [schoolId, from, to],
      ),
      this.dataSource.query(
        `SELECT user_id, to_char(date, 'YYYY-MM-DD') AS date, status FROM staff_attendance
         WHERE school_id = $1 AND date BETWEEN $2 AND $3 AND status IN ('absent', 'half_day')`,
        [schoolId, from, to],
      ),
    ]);
    const leave: DayMark[] = [];
    const unpaid: DayMark[] = [];
    for (const row of leaves) {
      for (const date of datesBetween(row.from_date, row.to_date)) {
        const mark = { user_id: Number(row.user_id), date, weight: row.half_day ? 0.5 : 1 };
        leave.push(mark);
        if (!row.is_paid) unpaid.push(mark);
      }
    }
    const absent = absences.map((row) => ({
      user_id: Number(row.user_id),
      date: row.date,
      weight: row.status === 'half_day' ? 0.5 : 1,
    }));
    return { unpaid, leave, absent };
  }

  private async staff(schoolId: number, userId: number): Promise<Staff> {
    const staff = await this.dataSource
      .getRepository(Staff)
      .findOne({ where: { school_id: schoolId, user_id: userId }, relations: { user: true } });
    if (!staff) throw AppException.notFound('Staff member not found', 'STAFF_NOT_FOUND');
    return staff;
  }

  private presentStaff(staff: Staff, structure: SalaryStructure | null): SalaryStaffDto {
    return {
      user_id: staff.user_id,
      name: staff.user?.name ?? '',
      employee_no: staff.employee_no,
      designation: staff.designation,
      department: staff.department,
      staff_type: staff.staff_type,
      structure: structure ? this.presentStructure(structure) : null,
    };
  }

  private presentStructure(row: SalaryStructure): SalaryStructureDto {
    const full = computePay(row, 1, 0);
    return {
      effective_from: row.effective_from,
      basic: row.basic,
      da: row.da,
      hra: row.hra,
      conveyance: row.conveyance,
      special_allowance: row.special_allowance,
      other_allowance: row.other_allowance,
      pf_enabled: row.pf_enabled,
      esi_enabled: row.esi_enabled,
      professional_tax: row.professional_tax,
      tds: row.tds,
      other_deduction: row.other_deduction,
      monthly_gross: monthlyGross(row),
      monthly_deductions: full.total_deductions,
      monthly_net: full.net,
    };
  }

  private presentRun(run: PayrollRun): PayrollRunDto {
    return {
      id: run.id,
      month: run.month,
      month_label: monthLabel(run.month),
      status: run.status,
      working_days: run.working_days,
      staff_count: run.staff_count,
      total_gross: run.total_gross,
      total_deductions: run.total_deductions,
      total_net: run.total_net,
      finalized_at: run.finalized_at,
      created_at: run.created_at,
    };
  }

  private presentSlip(slip: Payslip, run: PayrollRun): PayslipDto {
    return {
      id: slip.id,
      run_id: slip.run_id,
      month: run.month,
      month_label: monthLabel(run.month),
      status: run.status,
      user_id: slip.user_id,
      employee_no: slip.employee_no,
      name: slip.name,
      designation: slip.designation,
      department: slip.department,
      bank_name: slip.bank_name,
      bank_account_last4: slip.bank_account_last4,
      working_days: slip.working_days,
      lop_days: slip.lop_days,
      paid_days: slip.paid_days,
      basic: slip.basic,
      da: slip.da,
      hra: slip.hra,
      conveyance: slip.conveyance,
      special_allowance: slip.special_allowance,
      other_allowance: slip.other_allowance,
      gross: slip.gross,
      pf: slip.pf,
      esi: slip.esi,
      professional_tax: slip.professional_tax,
      tds: slip.tds,
      other_deduction: slip.other_deduction,
      total_deductions: slip.total_deductions,
      net: slip.net,
    };
  }
}
