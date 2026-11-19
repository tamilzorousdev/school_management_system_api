import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { monthStartIn, todayIn } from '../../shared/dates';
import { DaySheetQueryDto, FeeReportDto, FeeReportQueryDto, ReportColumnDto } from './dto/fees.dto';
import {
  CASHBOOK_MODE_LABELS,
  CASHBOOK_MODES,
  cashTotals,
  flatTotals,
  groupMovements,
  Movement,
  MovementSource,
} from './cashbook.logic';
import { DAY_SHEET_SECTIONS, DaySheetLine, daySheetPdf, DaySheetSection } from './day-sheet.pdf';
import { FeeYear } from './fee-ledger';
import { daysBetween, round2, sumAmounts } from './fees.logic';
import { FeesService } from './fees.service';

export const FEE_REPORT_TYPES = [
  'classes',
  'heads',
  'installments',
  'benefits',
  'defaulters',
  'collections',
  'collectors',
] as const;
export type FeeReportType = (typeof FEE_REPORT_TYPES)[number];

type Row = Record<string, string | number | null>;

const money = (key: string, label: string): ReportColumnDto => ({ key, label, kind: 'money' });
const count = (key: string, label: string): ReportColumnDto => ({ key, label, kind: 'number' });
const text = (key: string, label: string): ReportColumnDto => ({ key, label, kind: 'text' });

const CASH_COLUMNS: ReportColumnDto[] = [
  count('receipts', 'Receipts'),
  ...CASHBOOK_MODES.map((mode) => money(mode, CASHBOOK_MODE_LABELS[mode])),
  money('fees', 'Fees'),
  money('advance', 'Advance'),
  money('library_fines', 'Library fines'),
  money('refunds', 'Refunds'),
  money('net', 'Net'),
  money('cash_in_hand', 'Cash in hand'),
];

const COLLECTION_NOTE =
  'Reversed payments and payments from advance credit are left out. Advance is money paid ahead and kept as credit. Library fines are left out when a class or installment is chosen. Refunds are approved refunds paid out. Cash in hand is cash received less cash refunded.';

const ONLINE_COLLECTOR = 'Online (parent app)';

const CONCESSION_NOTE = 'Concessions include scholarships.';

const AMOUNT_COLUMNS = [
  money('billed', 'Billed'),
  money('benefit', 'Concessions'),
  money('discount', 'Discounts'),
  money('net', 'Net due'),
  money('collected', 'Collected'),
  money('outstanding', 'Outstanding'),
  money('overdue', 'Overdue'),
  { key: 'collection_percent', label: 'Collected %', kind: 'percent' } satisfies ReportColumnDto,
];

@Injectable()
export class FeeReportsService {
  constructor(
    private readonly fees: FeesService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async report(schoolId: number, type: FeeReportType, query: FeeReportQueryDto): Promise<FeeReportDto> {
    const year = await this.fees.year(schoolId, query.academic_year_id);
    switch (type) {
      case 'classes':
        return this.classes(schoolId, year, query);
      case 'heads':
        return this.heads(schoolId, year, query);
      case 'installments':
        return this.installments(schoolId, year, query);
      case 'benefits':
        return this.benefits(schoolId, year, query);
      case 'defaulters':
        return this.defaulters(schoolId, year, query);
      case 'collections':
        return this.collections(schoolId, year, query);
      case 'collectors':
        return this.collectors(schoolId, year, query);
      default:
        throw AppException.notFound('Report not found', 'REPORT_NOT_FOUND');
    }
  }

  private today(): string {
    return todayIn(this.app.timeZone);
  }

  private invoiceFilter(query: FeeReportQueryDto, params: unknown[], alias = 'i'): string {
    const parts: string[] = [];
    if (query.class_id) {
      params.push(query.class_id);
      parts.push(`${alias}.class_id = $${params.length}`);
    }
    if (query.section_id) {
      params.push(query.section_id);
      parts.push(`${alias}.section_id = $${params.length}`);
    }
    if (query.installment) {
      params.push(query.installment);
      parts.push(`${alias}.installment = $${params.length}`);
    }
    return parts.map((part) => ` AND ${part}`).join('');
  }

  private async classes(schoolId: number, year: FeeYear, query: FeeReportQueryDto): Promise<FeeReportDto> {
    const params: unknown[] = [schoolId, year.id, this.today()];
    const rows: Row[] = await this.dataSource.query(
      `SELECT c.name AS class_name, count(DISTINCT i.student_id)::int AS students, count(*)::int AS invoices,
              sum(i.gross) AS billed, sum(i.benefit) AS benefit, sum(i.discount) AS discount, sum(i.total) AS net,
              sum(i.paid) AS collected, sum(i.balance) AS outstanding,
              sum(CASE WHEN i.due_date < $3 THEN i.balance ELSE 0 END) AS overdue
       FROM fee_invoices i JOIN classes c ON c.id = i.class_id
       WHERE i.school_id = $1 AND i.academic_year_id = $2 AND i.deleted_at IS NULL AND i.status <> 'cancelled'
       ${this.invoiceFilter(query, params)}
       GROUP BY c.id, c.name, c.grade_level ORDER BY c.grade_level, c.name`,
      params,
    );
    return report(
      'Class-wise collection',
      year,
      [text('class_name', 'Class'), count('students', 'Students'), count('invoices', 'Invoices'), ...AMOUNT_COLUMNS],
      rows.map((row) => withPercent({ ...numbers(row, ['class_name']), class_name: `Class ${row.class_name}` })),
      'class_name',
      CONCESSION_NOTE,
    );
  }

  private async heads(schoolId: number, year: FeeYear, query: FeeReportQueryDto): Promise<FeeReportDto> {
    const params: unknown[] = [schoolId, year.id, this.today()];
    const filter = this.invoiceFilter(query, params);
    if (query.fee_head_id) params.push(query.fee_head_id);
    const rows: Row[] = await this.dataSource.query(
      `WITH given AS (
         SELECT invoice_id, fee_head_id, sum(amount) AS amount FROM fee_invoice_benefits
         WHERE deleted_at IS NULL GROUP BY invoice_id, fee_head_id
       ), parts AS (
         SELECT coalesce(h.name, l.head_name) AS head_name, l.amount AS billed, coalesce(g.amount, 0) AS benefit,
                CASE WHEN i.gross > 0 THEN i.discount * l.amount / i.gross ELSE 0 END AS discount,
                i.total, i.paid, i.due_date, i.student_id
         FROM fee_invoice_lines l
         JOIN fee_invoices i ON i.id = l.invoice_id AND i.deleted_at IS NULL AND i.status <> 'cancelled'
         LEFT JOIN fee_heads h ON h.id = l.fee_head_id
         LEFT JOIN given g ON g.invoice_id = i.id AND g.fee_head_id IS NOT DISTINCT FROM l.fee_head_id
         WHERE i.school_id = $1 AND i.academic_year_id = $2 AND l.deleted_at IS NULL ${filter}
           ${query.fee_head_id ? `AND l.fee_head_id = $${params.length}` : ''}
       ), shares AS (
         SELECT *, billed - benefit - discount AS net,
                CASE WHEN total > 0 THEN (billed - benefit - discount) * paid / total ELSE 0 END AS collected
         FROM parts
       )
       SELECT head_name, count(DISTINCT student_id)::int AS students, sum(billed) AS billed, sum(benefit) AS benefit,
              sum(discount) AS discount, sum(net) AS net, sum(collected) AS collected,
              sum(net - collected) AS outstanding,
              sum(CASE WHEN due_date < $3 THEN net - collected ELSE 0 END) AS overdue
       FROM shares GROUP BY head_name ORDER BY sum(billed) DESC, head_name`,
      params,
    );
    return report(
      'Fee head-wise collection',
      year,
      [text('head_name', 'Fee head'), count('students', 'Students'), ...AMOUNT_COLUMNS],
      rows.map((row) => withPercent(rounded(numbers(row, ['head_name'])))),
      'head_name',
      `${CONCESSION_NOTE} Discounts and payments are shared across an invoice’s fee heads in proportion to their amounts.`,
    );
  }

  private async installments(schoolId: number, year: FeeYear, query: FeeReportQueryDto): Promise<FeeReportDto> {
    const params: unknown[] = [schoolId, year.id, this.today()];
    const rows: Row[] = await this.dataSource.query(
      `SELECT CASE WHEN i.kind = 'fine' THEN 'Fines' ELSE i.installment END AS installment,
              to_char(max(i.due_date), 'YYYY-MM-DD') AS due_date, count(*)::int AS invoices,
              count(*) FILTER (WHERE i.status = 'paid')::int AS paid_invoices,
              sum(i.gross) AS billed, sum(i.benefit) AS benefit, sum(i.discount) AS discount, sum(i.total) AS net,
              sum(i.paid) AS collected, sum(i.balance) AS outstanding,
              sum(CASE WHEN i.due_date < $3 THEN i.balance ELSE 0 END) AS overdue
       FROM fee_invoices i
       WHERE i.school_id = $1 AND i.academic_year_id = $2 AND i.deleted_at IS NULL AND i.status <> 'cancelled'
       ${this.invoiceFilter(query, params)}
       GROUP BY 1 ORDER BY max(i.due_date), 1`,
      params,
    );
    return report(
      'Installment-wise collection',
      year,
      [
        text('installment', 'Installment'),
        { key: 'due_date', label: 'Due date', kind: 'date' },
        count('invoices', 'Invoices'),
        count('paid_invoices', 'Fully paid'),
        ...AMOUNT_COLUMNS,
      ],
      rows.map((row) => withPercent(numbers(row, ['installment', 'due_date']))),
      'installment',
      CONCESSION_NOTE,
    );
  }

  private async benefits(schoolId: number, year: FeeYear, query: FeeReportQueryDto): Promise<FeeReportDto> {
    const params: unknown[] = [schoolId, year.id];
    let kindFilter = '';
    if (query.kind) {
      params.push(query.kind);
      kindFilter = `AND b.kind = $${params.length}`;
    }
    const invoiceFilter = this.invoiceFilter(query, params);
    const rows: Row[] = await this.dataSource.query(
      `SELECT b.name, b.kind, b.calc_type, b.value, b.is_active,
              (SELECT count(*) FROM student_fee_benefits a
               WHERE a.benefit_id = b.id AND a.status = 'active' AND a.deleted_at IS NULL)::int AS active_students,
              count(DISTINCT x.student_id)::int AS students_benefited,
              count(DISTINCT x.invoice_id)::int AS invoices,
              coalesce(sum(x.amount), 0) AS amount
       FROM fee_benefits b
       LEFT JOIN (
         SELECT fb.benefit_id, fb.amount, i.student_id, i.id AS invoice_id
         FROM fee_invoice_benefits fb
         JOIN fee_invoices i ON i.id = fb.invoice_id AND i.deleted_at IS NULL AND i.status <> 'cancelled'
         WHERE fb.deleted_at IS NULL ${invoiceFilter}
       ) x ON x.benefit_id = b.id
       WHERE b.school_id = $1 AND b.academic_year_id = $2 AND b.deleted_at IS NULL ${kindFilter}
       GROUP BY b.id ORDER BY b.kind, coalesce(sum(x.amount), 0) DESC, b.name`,
      params,
    );
    return report(
      'Concessions and scholarships',
      year,
      [
        text('name', 'Name'),
        text('kind', 'Kind'),
        text('value', 'Off'),
        count('active_students', 'Students who have it'),
        count('students_benefited', 'Students billed with it'),
        count('invoices', 'Invoices'),
        money('amount', 'Taken off'),
      ],
      rows.map((row) => ({
        name: `${row.name}${row.is_active ? '' : ' (switched off)'}`,
        kind: row.kind === 'scholarship' ? 'Scholarship' : 'Concession',
        value: row.calc_type === 'percent' ? `${Number(row.value)}%` : `Rs. ${Number(row.value).toFixed(2)} a year`,
        active_students: Number(row.active_students),
        students_benefited: Number(row.students_benefited),
        invoices: Number(row.invoices),
        amount: Number(row.amount),
      })),
      'name',
    );
  }

  private async defaulters(schoolId: number, year: FeeYear, query: FeeReportQueryDto): Promise<FeeReportDto> {
    const today = this.today();
    const params: unknown[] = [schoolId, year.id, today];
    const filter = this.invoiceFilter(query, params);
    const rows: Row[] = await this.dataSource.query(
      `SELECT s.id AS student_id, concat_ws(' ', s.first_name, s.last_name) AS student, s.admission_no,
              concat_ws(' - ', c.name, sec.name) AS class_section,
              count(*) FILTER (WHERE i.balance > 0)::int AS invoices_due,
              sum(i.total) AS net, sum(i.paid) AS collected, sum(i.balance) AS outstanding,
              sum(CASE WHEN i.due_date < $3 THEN i.balance ELSE 0 END) AS overdue,
              to_char(min(i.due_date) FILTER (WHERE i.balance > 0), 'YYYY-MM-DD') AS oldest_due
       FROM fee_invoices i
       JOIN students s ON s.id = i.student_id
       LEFT JOIN classes c ON c.id = i.class_id
       LEFT JOIN sections sec ON sec.id = i.section_id
       WHERE i.school_id = $1 AND i.academic_year_id = $2 AND i.deleted_at IS NULL AND i.status <> 'cancelled'
       ${filter}
       GROUP BY s.id, s.first_name, s.last_name, s.admission_no, c.name, sec.name, c.grade_level
       HAVING sum(i.balance) > 0 ${query.overdue_only ? 'AND sum(CASE WHEN i.due_date < $3 THEN i.balance ELSE 0 END) > 0' : ''}
       ORDER BY sum(CASE WHEN i.due_date < $3 THEN i.balance ELSE 0 END) DESC, sum(i.balance) DESC, s.first_name`,
      params,
    );
    return report(
      query.overdue_only ? 'Students with overdue fees' : 'Students with fees due',
      year,
      [
        text('student', 'Student'),
        text('admission_no', 'Admission no.'),
        text('class_section', 'Class'),
        count('invoices_due', 'Invoices due'),
        money('net', 'Net due'),
        money('collected', 'Paid'),
        money('outstanding', 'Balance'),
        money('overdue', 'Overdue'),
        { key: 'oldest_due', label: 'Oldest due date', kind: 'date' },
        count('days_overdue', 'Days overdue'),
      ],
      rows.map((row) => {
        const oldest = row.oldest_due as string | null;
        return {
          ...numbers(row, ['student', 'admission_no', 'class_section', 'oldest_due']),
          days_overdue: oldest && oldest < today ? daysBetween(oldest, today) : 0,
        };
      }),
      'student',
    );
  }

  private range(query: FeeReportQueryDto): { from: string; to: string } {
    const from = query.from ?? monthStartIn(this.app.timeZone);
    const to = query.to ?? this.today();
    if (from > to) throw AppException.validation([{ field: 'from', message: 'from must be on or before to' }]);
    return { from, to };
  }

  async movements(schoolId: number, from: string, to: string, query: FeeReportQueryDto): Promise<Movement[]> {
    const params: unknown[] = [schoolId, from, to];
    const filter = this.invoiceFilter(query, params);
    const collector = (column: string) => {
      if (!query.received_by) return '';
      params.push(query.received_by);
      return `AND ${column} = $${params.length}`;
    };
    const parts = [
      `SELECT to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on, p.received_by AS collector_id, p.mode::text AS mode,
              'fees' AS source, count(*)::int AS receipts, sum(p.amount) AS amount
       FROM fee_payments p JOIN fee_invoices i ON i.id = p.invoice_id
       WHERE p.school_id = $1 AND p.paid_on BETWEEN $2 AND $3 AND p.deleted_at IS NULL AND p.status = 'success'
         AND p.mode <> 'credit' ${filter} ${collector('p.received_by')}
       GROUP BY p.paid_on, p.received_by, p.mode`,
      `SELECT to_char(r.paid_on, 'YYYY-MM-DD') AS paid_on, r.created_by AS collector_id, r.mode::text AS mode,
              'refund' AS source, count(*)::int AS receipts, sum(r.amount) AS amount
       FROM fee_refunds r JOIN fee_invoices i ON i.id = r.invoice_id
       WHERE r.school_id = $1 AND r.paid_on BETWEEN $2 AND $3 AND r.deleted_at IS NULL ${filter} ${collector('r.created_by')}
       GROUP BY r.paid_on, r.created_by, r.mode`,
    ];
    if (!query.installment) {
      let advanceFilter = '';
      if (query.class_id || query.section_id) {
        params.push(query.section_id ?? query.class_id);
        advanceFilter = `AND EXISTS (SELECT 1 FROM student_enrollments e JOIN academic_years y ON y.id = e.academic_year_id
          AND y.is_current = true WHERE e.student_id = c.student_id AND e.${query.section_id ? 'section_id' : 'class_id'} = $${params.length})`;
      }
      parts.push(
        `SELECT to_char(c.paid_on, 'YYYY-MM-DD') AS paid_on, c.created_by AS collector_id, c.mode::text AS mode,
                'advance' AS source, count(*)::int AS receipts, sum(c.advance_amount) AS amount
         FROM fee_collections c
         WHERE c.school_id = $1 AND c.paid_on BETWEEN $2 AND $3 AND c.deleted_at IS NULL AND c.advance_amount > 0
         ${advanceFilter} ${collector('c.created_by')}
         GROUP BY c.paid_on, c.created_by, c.mode`,
      );
    }
    if (!query.class_id && !query.section_id && !query.installment) {
      parts.push(
        `SELECT to_char(lp.paid_on, 'YYYY-MM-DD') AS paid_on, lp.received_by AS collector_id, lp.mode::text AS mode,
                'library' AS source, count(*)::int AS receipts, sum(lp.amount) AS amount
         FROM library_fine_payments lp
         WHERE lp.school_id = $1 AND lp.paid_on BETWEEN $2 AND $3 AND lp.deleted_at IS NULL ${collector('lp.received_by')}
         GROUP BY lp.paid_on, lp.received_by, lp.mode`,
      );
    }
    const rows: {
      paid_on: string;
      collector_id: number | null;
      mode: string;
      source: MovementSource;
      receipts: number;
      amount: string;
    }[] = await this.dataSource.query(parts.join('\nUNION ALL\n'), params);
    return rows.map((row) => ({
      paid_on: row.paid_on,
      collector_id: row.collector_id === null ? null : Number(row.collector_id),
      mode: row.mode,
      source: row.source,
      receipts: Number(row.receipts),
      amount: Number(row.amount),
    }));
  }

  private async collections(schoolId: number, year: FeeYear, query: FeeReportQueryDto): Promise<FeeReportDto> {
    const { from, to } = this.range(query);
    const days = groupMovements(await this.movements(schoolId, from, to, query), (row) => row.paid_on);
    const rows = [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([paidOn, movements]): Row => ({ paid_on: paidOn, ...flatTotals(cashTotals(movements)) }));
    const result = report(
      'Daily collection',
      year,
      [{ key: 'paid_on', label: 'Date', kind: 'date' }, ...CASH_COLUMNS],
      rows,
      'paid_on',
      COLLECTION_NOTE,
    );
    return { ...result, from, to };
  }

  private async collectors(schoolId: number, year: FeeYear, query: FeeReportQueryDto): Promise<FeeReportDto> {
    const { from, to } = this.range(query);
    const people = groupMovements(await this.movements(schoolId, from, to, query), (row) => row.collector_id);
    const names = await this.fees.userNames([...people.keys()].filter((id): id is number => id !== null));
    const rows = [...people.entries()]
      .map(([collectorId, movements]): Row => ({
        collector: collectorId === null ? ONLINE_COLLECTOR : (names.get(collectorId) ?? `User ${collectorId}`),
        ...flatTotals(cashTotals(movements)),
      }))
      .sort((a, b) => Number(b.net) - Number(a.net));
    const result = report(
      'Collection by staff',
      year,
      [text('collector', 'Collected by'), ...CASH_COLUMNS],
      rows,
      'collector',
      COLLECTION_NOTE,
    );
    return { ...result, from, to };
  }

  async collectorOptions(schoolId: number): Promise<{ id: number; name: string }[]> {
    const rows: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT u.id, u.name FROM users u
       WHERE u.id IN (
         SELECT received_by FROM fee_payments WHERE school_id = $1 AND received_by IS NOT NULL
         UNION SELECT created_by FROM fee_collections WHERE school_id = $1 AND created_by IS NOT NULL
         UNION SELECT received_by FROM library_fine_payments WHERE school_id = $1 AND received_by IS NOT NULL
         UNION SELECT created_by FROM fee_refunds WHERE school_id = $1 AND created_by IS NOT NULL)
       ORDER BY u.name`,
      [schoolId],
    );
    return rows.map((row) => ({ id: Number(row.id), name: row.name }));
  }

  async daySheet(schoolId: number, query: DaySheetQueryDto): Promise<{ name: string; pdf: Buffer }> {
    const date = query.date ?? this.today();
    const params: unknown[] = [schoolId, date];
    const by = (column: string) => {
      if (!query.received_by) return '';
      params.push(query.received_by);
      return `AND ${column} = $${params.length}`;
    };
    const lines: (DaySheetLine & { section: DaySheetSection })[] = await this.dataSource.query(
      `SELECT 'fees' AS section, p.receipt_no, concat_ws(' ', s.first_name, s.last_name) AS name,
              concat_ws(' · ', NULLIF(concat_ws(' - ', c.name, sec.name), ''), i.installment) AS detail,
              p.mode::text AS mode, p.reference, p.amount::float AS amount, u.name AS collector, p.id AS sort_id
       FROM fee_payments p JOIN fee_invoices i ON i.id = p.invoice_id JOIN students s ON s.id = p.student_id
       LEFT JOIN classes c ON c.id = i.class_id LEFT JOIN sections sec ON sec.id = i.section_id
       LEFT JOIN users u ON u.id = p.received_by
       WHERE p.school_id = $1 AND p.paid_on = $2 AND p.deleted_at IS NULL AND p.status = 'success' AND p.mode <> 'credit'
         ${by('p.received_by')}
       UNION ALL
       SELECT 'advance', fc.advance_receipt_no, concat_ws(' ', s.first_name, s.last_name), 'Advance kept as credit',
              fc.mode::text, fc.reference, fc.advance_amount::float, u.name, fc.id
       FROM fee_collections fc JOIN students s ON s.id = fc.student_id LEFT JOIN users u ON u.id = fc.created_by
       WHERE fc.school_id = $1 AND fc.paid_on = $2 AND fc.deleted_at IS NULL AND fc.advance_amount > 0 ${by('fc.created_by')}
       UNION ALL
       SELECT 'library', lp.receipt_no,
              CASE WHEN st.id IS NOT NULL THEN concat_ws(' ', st.first_name, st.last_name) ELSE mu.name END,
              concat_ws(' · ', 'Library fine', m.card_no), lp.mode::text, lp.reference, lp.amount::float, u.name, lp.id
       FROM library_fine_payments lp JOIN library_members m ON m.id = lp.member_id
       LEFT JOIN students st ON st.id = m.student_id LEFT JOIN users mu ON mu.id = m.user_id
       LEFT JOIN users u ON u.id = lp.received_by
       WHERE lp.school_id = $1 AND lp.paid_on = $2 AND lp.deleted_at IS NULL ${by('lp.received_by')}
       UNION ALL
       SELECT 'refund', r.refund_no, concat_ws(' ', s.first_name, s.last_name), concat_ws(' · ', i.invoice_no, r.reason),
              r.mode::text, r.reference, r.amount::float, u.name, r.id
       FROM fee_refunds r JOIN fee_invoices i ON i.id = r.invoice_id JOIN students s ON s.id = r.student_id
       LEFT JOIN users u ON u.id = r.created_by
       WHERE r.school_id = $1 AND r.paid_on = $2 AND r.deleted_at IS NULL ${by('r.created_by')}
       ORDER BY section, sort_id`,
      params,
    );
    const [school, names, movements] = await Promise.all([
      this.fees.pdfSchool(schoolId),
      this.fees.userNames(query.received_by ? [query.received_by] : []),
      this.movements(schoolId, date, date, { received_by: query.received_by }),
    ]);
    const collector = query.received_by ? (names.get(query.received_by) ?? null) : null;
    const pdf = await daySheetPdf({
      ...school,
      date,
      collector,
      sections: DAY_SHEET_SECTIONS.map((section) => ({
        section,
        lines: lines.filter((line) => line.section === section),
      })),
      totals: cashTotals(movements),
    });
    const suffix = collector ? `-${collector.replace(/\s+/g, '-').toLowerCase()}` : '';
    return { name: `day-sheet-${date}${suffix}`, pdf };
  }
}

function numbers(row: Row, textKeys: string[] = []): Row {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      textKeys.includes(key) || value === null || typeof value === 'number' || Number.isNaN(Number(value))
        ? value
        : Number(value),
    ]),
  );
}

function rounded(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, typeof value === 'number' ? round2(value) : value]),
  );
}

function withPercent(row: Row): Row {
  const net = Number(row.net ?? 0);
  return { ...row, collection_percent: net > 0 ? round2((Number(row.collected ?? 0) / net) * 100) : null };
}

function report(
  title: string,
  year: FeeYear,
  columns: ReportColumnDto[],
  rows: Row[],
  labelKey: string,
  note: string | null = null,
): FeeReportDto {
  const totals: Row = { [labelKey]: 'Total' };
  for (const column of columns) {
    if (column.kind === 'money' || column.kind === 'number') {
      const sum = sumAmounts(rows.map((row) => Number(row[column.key] ?? 0)));
      totals[column.key] = column.kind === 'number' && /students/.test(column.key) ? null : sum;
    }
  }
  if (columns.some((column) => column.key === 'collection_percent')) Object.assign(totals, withPercent(totals));
  if (columns.some((column) => column.key === 'days_overdue')) totals.days_overdue = null;
  return {
    title,
    academic_year: year.name,
    note,
    from: null,
    to: null,
    columns,
    rows,
    totals: rows.length ? totals : null,
  };
}
