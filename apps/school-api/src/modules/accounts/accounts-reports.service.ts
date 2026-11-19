import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { yearClause } from '../../shared/year-context';
import { PERMISSIONS } from '../access/access.catalog';
import { cashTotals, groupMovements } from '../fees/cashbook.logic';
import { FeeReportDto, ReportColumnDto } from '../fees/dto/fees.dto';
import { FeeReportsService } from '../fees/fee-reports.service';
import { monthLabel, monthsBetween } from './accounts.logic';
import { AccountsService } from './accounts.service';
import { AccountReportQueryDto, AccountReportType } from './dto/accounts.dto';
import { AccountKind } from './entities/account-category.entity';

type Row = Record<string, string | number | null>;

const round2 = (value: number) => Math.round(value * 100) / 100;
const money = (key: string, label: string): ReportColumnDto => ({ key, label, kind: 'money' });
const text = (key: string, label: string): ReportColumnDto => ({ key, label, kind: 'text' });

const MODE_TEXT: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
};

interface Period {
  from: string;
  to: string;
  year: string;
}

interface MonthAmount {
  month: string;
  amount: number;
}

@Injectable()
export class AccountsReportsService {
  constructor(
    private readonly accounts: AccountsService,
    private readonly feeReports: FeeReportsService,
    private readonly dataSource: DataSource,
  ) {}

  async report(
    schoolId: number,
    type: AccountReportType,
    query: AccountReportQueryDto,
    actor: AuthUser,
  ): Promise<FeeReportDto> {
    const period = await this.period(schoolId, query);
    switch (type) {
      case 'monthly':
        return this.monthly(schoolId, period, this.canSeeSalaries(actor));
      case 'categories':
        return this.categories(schoolId, period, this.canSeeSalaries(actor));
      case 'register':
        return this.register(schoolId, period, query.kind);
      default:
        throw AppException.notFound('Report not found', 'REPORT_NOT_FOUND');
    }
  }

  private canSeeSalaries(actor: AuthUser): boolean {
    return actor.permissions.includes(PERMISSIONS.PAYROLL_VIEW);
  }

  private async period(schoolId: number, query: AccountReportQueryDto): Promise<Period> {
    const [year]: { name: string; start_date: string }[] = await this.dataSource.query(
      `SELECT y.name, to_char(y.start_date, 'YYYY-MM-DD') AS start_date FROM academic_years y
       WHERE y.school_id = $1 AND y.deleted_at IS NULL AND ${yearClause('y')} LIMIT 1`,
      [schoolId],
    );
    const today = this.accounts.today();
    const from = query.from ?? year?.start_date ?? `${today.slice(0, 7)}-01`;
    const to = query.to ?? today;
    if (from > to) throw AppException.validation([{ field: 'from', message: 'from must be on or before to' }]);
    return { from, to, year: year?.name ?? '' };
  }

  private async fees(schoolId: number, period: Period) {
    const movements = await this.feeReports.movements(schoolId, period.from, period.to, {});
    return [...groupMovements(movements, (row) => row.paid_on.slice(0, 7)).entries()].map(([month, rows]) => {
      const totals = cashTotals(rows);
      return {
        month,
        fees: round2(totals.fees + totals.advance - totals.refunds),
        library: totals.library_fines,
      };
    });
  }

  private async entries(schoolId: number, period: Period, kind: AccountKind) {
    const rows: { month: string; category: string; entries: number; amount: number }[] = await this.dataSource.query(
      `SELECT to_char(e.entry_date, 'YYYY-MM') AS month, c.name AS category, count(*)::int AS entries,
              sum(e.amount)::float AS amount
       FROM account_entries e JOIN account_categories c ON c.id = e.category_id
       WHERE e.school_id = $1 AND e.deleted_at IS NULL AND e.status = 'approved' AND e.kind = $2
         AND e.entry_date BETWEEN $3 AND $4
       GROUP BY 1, 2`,
      [schoolId, kind, period.from, period.to],
    );
    return rows.map((row) => ({ ...row, entries: Number(row.entries), amount: Number(row.amount) }));
  }

  private async busCosts(schoolId: number, period: Period): Promise<(MonthAmount & { entries: number })[]> {
    const rows: { month: string; entries: number; amount: number }[] = await this.dataSource.query(
      `SELECT month, sum(entries)::int AS entries, sum(amount)::float AS amount FROM (
         SELECT to_char(spent_on, 'YYYY-MM') AS month, count(*) AS entries, sum(amount) AS amount FROM vehicle_expenses
         WHERE school_id = $1 AND deleted_at IS NULL AND spent_on BETWEEN $2 AND $3 GROUP BY 1
         UNION ALL
         SELECT to_char(filled_on, 'YYYY-MM'), count(*), sum(amount) FROM fuel_logs
         WHERE school_id = $1 AND deleted_at IS NULL AND status = 'approved' AND filled_on BETWEEN $2 AND $3 GROUP BY 1
       ) t GROUP BY month`,
      [schoolId, period.from, period.to],
    );
    return rows.map((row) => ({ month: row.month, entries: Number(row.entries), amount: Number(row.amount) }));
  }

  private async salaries(schoolId: number, period: Period): Promise<(MonthAmount & { entries: number })[]> {
    const rows: { month: string; entries: number; amount: number }[] = await this.dataSource.query(
      `SELECT month, staff_count AS entries, total_net::float AS amount FROM payroll_runs
       WHERE school_id = $1 AND deleted_at IS NULL AND status = 'finalized' AND month BETWEEN $2 AND $3`,
      [schoolId, period.from.slice(0, 7), period.to.slice(0, 7)],
    );
    return rows.map((row) => ({ month: row.month, entries: Number(row.entries), amount: Number(row.amount) }));
  }

  private async monthly(schoolId: number, period: Period, withSalaries: boolean): Promise<FeeReportDto> {
    const [fees, income, expense, bus, salaries] = await Promise.all([
      this.fees(schoolId, period),
      this.entries(schoolId, period, 'income'),
      this.entries(schoolId, period, 'expense'),
      this.busCosts(schoolId, period),
      withSalaries ? this.salaries(schoolId, period) : Promise.resolve([]),
    ]);
    const sum = (rows: { month: string; amount: number }[], month: string) =>
      round2(rows.filter((row) => row.month === month).reduce((total, row) => total + Number(row.amount), 0));
    const rows: Row[] = monthsBetween(period.from, period.to).map((month) => {
      const feeRow = fees.find((row) => row.month === month);
      const values = {
        fees: feeRow?.fees ?? 0,
        library_fines: feeRow?.library ?? 0,
        other_income: sum(income, month),
        school_expenses: sum(expense, month),
        bus_costs: sum(bus, month),
        salaries: sum(salaries, month),
      };
      const totalIncome = round2(values.fees + values.library_fines + values.other_income);
      const totalExpense = round2(values.school_expenses + values.bus_costs + values.salaries);
      return {
        month: monthLabel(month),
        ...values,
        total_income: totalIncome,
        total_expense: totalExpense,
        net: round2(totalIncome - totalExpense),
      };
    });
    const columns: ReportColumnDto[] = [
      text('month', 'Month'),
      money('fees', 'Fees (less refunds)'),
      money('library_fines', 'Library fines'),
      money('other_income', 'Other income'),
      money('total_income', 'Total income'),
      money('school_expenses', 'School expenses'),
      money('bus_costs', 'Bus fuel and expenses'),
      ...(withSalaries ? [money('salaries', 'Salaries')] : []),
      money('total_expense', 'Total expense'),
      money('net', 'Surplus'),
    ];
    return this.build('Income and expense by month', period, columns, rows, 'month', this.note(withSalaries));
  }

  private async categories(schoolId: number, period: Period, withSalaries: boolean): Promise<FeeReportDto> {
    const [fees, income, expense, bus, salaries] = await Promise.all([
      this.feeReports.movements(schoolId, period.from, period.to, {}),
      this.entries(schoolId, period, 'income'),
      this.entries(schoolId, period, 'expense'),
      this.busCosts(schoolId, period),
      withSalaries ? this.salaries(schoolId, period) : Promise.resolve([]),
    ]);
    const totals = cashTotals(fees);
    const byCategory = (rows: { category: string; entries: number; amount: number }[]) => {
      const merged = new Map<string, { entries: number; amount: number }>();
      for (const row of rows) {
        const found = merged.get(row.category) ?? { entries: 0, amount: 0 };
        merged.set(row.category, { entries: found.entries + row.entries, amount: found.amount + row.amount });
      }
      return [...merged.entries()]
        .map(([category, value]) => ({ category, entries: value.entries, amount: round2(value.amount) }))
        .sort((a, b) => b.amount - a.amount);
    };
    const total = (rows: { entries: number; amount: number }[]) => ({
      entries: rows.reduce((sum, row) => sum + row.entries, 0),
      amount: round2(rows.reduce((sum, row) => sum + row.amount, 0)),
    });
    const incomeRows = [
      {
        category: 'Fees (less refunds)',
        entries: totals.receipts,
        amount: round2(totals.fees + totals.advance - totals.refunds),
      },
      ...(totals.library_fines > 0 ? [{ category: 'Library fines', entries: 0, amount: totals.library_fines }] : []),
      ...byCategory(income),
    ].filter((row) => row.amount !== 0);
    const expenseRows = [
      ...byCategory(expense),
      ...(bus.length ? [{ category: 'Bus fuel and expenses', ...total(bus) }] : []),
      ...(salaries.length ? [{ category: 'Salaries (net pay)', ...total(salaries) }] : []),
    ].filter((row) => row.amount !== 0);
    const incomeTotal = total(incomeRows).amount;
    const expenseTotal = total(expenseRows).amount;
    const share = (amount: number, whole: number) => (whole > 0 ? round2((amount / whole) * 100) : null);
    const rows: Row[] = [
      ...incomeRows.map((row) => ({
        section: 'Income',
        category: row.category,
        amount: row.amount,
        share: share(row.amount, incomeTotal),
      })),
      ...expenseRows.map((row) => ({
        section: 'Expense',
        category: row.category,
        amount: row.amount,
        share: share(row.amount, expenseTotal),
      })),
    ];
    const report = this.build(
      'Income and expense by category',
      period,
      [
        text('section', 'Type'),
        text('category', 'Category'),
        money('amount', 'Amount'),
        { key: 'share', label: 'Share %', kind: 'percent' },
      ],
      rows,
      'section',
      this.note(withSalaries),
    );
    return {
      ...report,
      totals: rows.length
        ? {
            section: 'Surplus',
            category: 'Income less expense',
            amount: round2(incomeTotal - expenseTotal),
            share: null,
          }
        : null,
    };
  }

  private async register(schoolId: number, period: Period, kind?: AccountKind): Promise<FeeReportDto> {
    const params: unknown[] = [schoolId, period.from, period.to];
    if (kind) params.push(kind);
    const rows: Row[] = await this.dataSource.query(
      `SELECT to_char(e.entry_date, 'YYYY-MM-DD') AS entry_date, e.entry_no,
              CASE WHEN e.kind = 'income' THEN 'Income' ELSE 'Expense' END AS kind, c.name AS category,
              e.party, e.payment_mode, e.reference, u.name AS added_by,
              CASE WHEN e.kind = 'income' THEN e.amount::float ELSE 0 END AS income,
              CASE WHEN e.kind = 'expense' THEN e.amount::float ELSE 0 END AS expense
       FROM account_entries e JOIN account_categories c ON c.id = e.category_id
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.school_id = $1 AND e.deleted_at IS NULL AND e.status = 'approved' AND e.entry_date BETWEEN $2 AND $3
         ${kind ? 'AND e.kind = $4' : ''}
       ORDER BY e.entry_date, e.id`,
      params,
    );
    const shaped = rows.map((row) => ({
      ...row,
      payment_mode: MODE_TEXT[String(row.payment_mode)] ?? row.payment_mode,
      income: Number(row.income),
      expense: Number(row.expense),
    }));
    const report = this.build(
      kind === 'income'
        ? 'Other income register'
        : kind === 'expense'
          ? 'Expense register'
          : 'Expense and income register',
      period,
      [
        { key: 'entry_date', label: 'Date', kind: 'date' },
        text('entry_no', 'Entry no.'),
        text('kind', 'Type'),
        text('category', 'Category'),
        text('party', 'Paid to / received from'),
        text('payment_mode', 'Mode'),
        text('reference', 'Reference'),
        text('added_by', 'Added by'),
        money('income', 'Income'),
        money('expense', 'Expense'),
      ],
      shaped,
      'entry_date',
      'Approved entries only. Pending, rejected and voided entries are left out.',
    );
    return report;
  }

  private note(withSalaries: boolean): string {
    return [
      'Only approved expense and income entries are counted. Fees are money received (with advances) less refunds paid out. Bus costs are approved fuel and bus expenses.',
      withSalaries
        ? 'Salaries are the net pay of finalised payroll runs, in the payroll month.'
        : 'Salaries are not shown because you do not have payroll access.',
    ].join(' ');
  }

  private build(
    title: string,
    period: Period,
    columns: ReportColumnDto[],
    rows: Row[],
    labelKey: string,
    note: string,
  ): FeeReportDto {
    const totals: Row = { [labelKey]: 'Total' };
    for (const column of columns) {
      if (column.kind === 'money') {
        totals[column.key] = round2(rows.reduce((sum, row) => sum + Number(row[column.key] ?? 0), 0));
      }
    }
    return {
      title,
      academic_year: period.year,
      note,
      from: period.from,
      to: period.to,
      columns,
      rows,
      totals: rows.length ? totals : null,
    };
  }
}
