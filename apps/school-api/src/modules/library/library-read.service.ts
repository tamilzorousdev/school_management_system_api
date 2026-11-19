import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { escapeLike, paginate, Paginated, searchTerms } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { holidaySet } from '../../shared/school-days';
import { yearClause } from '../../shared/year-context';
import { FilesService } from '../files/files.service';
import { CopyDto, MemberRefDto } from './dto/catalogue.dto';
import { FollowUpDto, LoanDto, MemberFineDto } from './dto/circulation.dto';
import { FineDto } from './dto/desk.dto';
import { CopyCondition, CopySource, CopyStatus } from './entities/book.entity';
import { FineKind, FineStatus } from './entities/library-fine.entity';
import { FollowUpAction, IssuePurpose, IssueStatus } from './entities/library-issue.entity';
import { MemberType } from './entities/library-member.entity';
import { chargeableDays, daysBetween, finesApply, loanState, LoanRules, overdueFine } from './library.logic';
import { LibrarySettingsService } from './library-settings.service';

export interface SqlFilter {
  where: string[];
  params: unknown[];
}

export const param = (filter: SqlFilter, value: unknown): string => {
  filter.params.push(value);
  return `$${filter.params.length}`;
};

export function addSearch(filter: SqlFilter, search: string | undefined, columns: string[]): void {
  for (const term of searchTerms(search)) {
    const key = param(filter, `%${escapeLike(term)}%`);
    filter.where.push(`(${columns.map((column) => `${column} ILIKE ${key}`).join(' OR ')})`);
  }
}

export const MEMBER_JOINS = (m: string, p: string) => `
  LEFT JOIN students ${p}s ON ${p}s.id = ${m}.student_id
  LEFT JOIN users ${p}u ON ${p}u.id = ${m}.user_id
  LEFT JOIN staff ${p}st ON ${p}st.user_id = ${m}.user_id AND ${p}st.school_id = ${m}.school_id AND ${p}st.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT c.id AS class_id, c.name AS class_name, sec.id AS section_id, sec.name AS section_name
    FROM student_enrollments e
    JOIN academic_years y ON y.id = e.academic_year_id AND ${yearClause('y')}
    JOIN classes c ON c.id = e.class_id
    LEFT JOIN sections sec ON sec.id = e.section_id
    WHERE e.student_id = ${m}.student_id
    ORDER BY e.id DESC LIMIT 1
  ) ${p}e ON true`;

export const MEMBER_NAME = (m: string, p: string) =>
  `(CASE WHEN ${m}.member_type = 'student' THEN ${p}s.first_name || COALESCE(' ' || ${p}s.last_name, '') ELSE ${p}u.name END)`;

export const MEMBER_COLUMNS = (m: string, p: string) => `
  ${m}.id AS ${p}_id, ${m}.member_type AS ${p}_type, ${m}.card_no AS ${p}_card, ${m}.student_id AS ${p}_student_id,
  ${m}.user_id AS ${p}_user_id, ${MEMBER_NAME(m, p)} AS ${p}_name,
  (CASE WHEN ${m}.member_type = 'student'
     THEN NULLIF(CONCAT_WS(' - ', ${p}e.class_name, ${p}e.section_name), '')
     ELSE ${p}st.designation END) AS ${p}_detail,
  COALESCE(${p}s.photo_file_id, ${p}u.photo_file_id) AS ${p}_photo,
  (CASE WHEN ${m}.member_type = 'student'
     THEN (SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
           WHERE sg.student_id = ${m}.student_id ORDER BY sg.receives_alerts DESC, sg.id LIMIT 1)
     ELSE ${p}u.mobile END) AS ${p}_phone`;

export type Row = Record<string, unknown>;

const num = (value: unknown): number => Number(value ?? 0);
const numOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
const str = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

export interface LoanContext {
  rules: LoanRules;
  today: string;
  holidays: Set<string>;
}

@Injectable()
export class LibraryReadService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly files: FilesService,
    private readonly settings: LibrarySettingsService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  today(): string {
    return todayIn(this.app.timeZone);
  }

  zone(): string {
    return this.app.timeZone;
  }

  link(fileId: unknown): string | null {
    return this.files.linkFor(fileId === null || fileId === undefined ? null : Number(fileId));
  }

  memberRef(row: Row, p: string): MemberRefDto {
    return {
      id: num(row[`${p}_id`]),
      member_type: row[`${p}_type`] as MemberType,
      card_no: String(row[`${p}_card`]),
      name: String(row[`${p}_name`] ?? ''),
      detail: str(row[`${p}_detail`]),
      student_id: numOrNull(row[`${p}_student_id`]),
      user_id: numOrNull(row[`${p}_user_id`]),
      photo_url: this.link(row[`${p}_photo`]),
      phone: str(row[`${p}_phone`]),
    };
  }

  async loanContext(schoolId: number, earliestDue?: string | null, manager?: EntityManager): Promise<LoanContext> {
    const rules = await this.settings.rules(schoolId);
    const today = this.today();
    const from = earliestDue && earliestDue < today ? earliestDue : today;
    const holidays = rules.skip_holidays
      ? await holidaySet(manager ?? this.dataSource.manager, schoolId, from, today)
      : new Set<string>();
    return { rules, today, holidays };
  }

  runningFine(
    context: LoanContext,
    loan: { status: IssueStatus; due_date: string; member_type: MemberType },
    on?: string,
  ) {
    const day = on ?? context.today;
    const late = loan.status === 'issued' ? Math.max(0, daysBetween(loan.due_date, day)) : 0;
    if (!late || !finesApply(context.rules, loan.member_type)) return { days_overdue: late, running_fine: 0 };
    const days = chargeableDays(
      loan.due_date,
      day,
      context.rules.grace_days,
      context.rules.skip_holidays,
      context.holidays,
    );
    return {
      days_overdue: late,
      running_fine: overdueFine(days, context.rules.fine_per_day, context.rules.max_fine_per_book),
    };
  }

  private loanSql(filter: SqlFilter, tail: string): string {
    return `
      SELECT i.id, i.status, i.purpose, i.issued_at, i.due_date::text AS due_date, i.returned_at, i.return_condition,
             i.renew_count, i.remarks, i.member_id,
             b.id AS book_id, b.title, b.authors, b.isbn, b.cover_file_id,
             c.id AS copy_id, c.accession_no, c.barcode,
             ss.id AS set_section_id, CONCAT_WS(' - ', sc.name, ss.name) AS set_section_name,
             ib.name AS issued_by_name, rb.name AS returned_by_name,
             f.id AS f_id, f.action AS f_action, f.note AS f_note, f.promised_on::text AS f_promised_on,
             f.next_follow_up_on::text AS f_next, f.created_at AS f_created_at, fu.name AS f_by,
             ${MEMBER_COLUMNS('m', 'mm')}
      FROM library_issues i
      JOIN book_copies c ON c.id = i.copy_id
      JOIN books b ON b.id = i.book_id
      JOIN library_members m ON m.id = i.member_id
      ${MEMBER_JOINS('m', 'mm')}
      LEFT JOIN sections ss ON i.purpose = 'class_set' AND ss.id = i.section_id
      LEFT JOIN classes sc ON sc.id = ss.class_id
      LEFT JOIN users ib ON ib.id = i.issued_by
      LEFT JOIN users rb ON rb.id = i.returned_by
      LEFT JOIN LATERAL (
        SELECT * FROM library_follow_ups x WHERE x.issue_id = i.id AND x.deleted_at IS NULL
        ORDER BY x.created_at DESC LIMIT 1
      ) f ON true
      LEFT JOIN users fu ON fu.id = f.created_by
      WHERE i.deleted_at IS NULL ${filter.where.length ? `AND ${filter.where.join(' AND ')}` : ''}
      ${tail}`;
  }

  presentLoan(row: Row, context: LoanContext): LoanDto {
    const status = row.status as IssueStatus;
    const dueDate = String(row.due_date);
    const member = this.memberRef(row, 'mm');
    const fine = this.runningFine(context, { status, due_date: dueDate, member_type: member.member_type });
    const followUp: FollowUpDto | null = row.f_id
      ? {
          id: num(row.f_id),
          action: row.f_action as FollowUpAction,
          note: str(row.f_note),
          promised_on: str(row.f_promised_on),
          next_follow_up_on: str(row.f_next),
          by: str(row.f_by),
          created_at: row.f_created_at as Date,
        }
      : null;
    return {
      id: num(row.id),
      status,
      state: loanState({ status, due_date: dueDate }, context.today, context.rules.due_soon_days),
      purpose: row.purpose as IssuePurpose,
      book: {
        id: num(row.book_id),
        title: String(row.title),
        authors: str(row.authors),
        isbn: str(row.isbn),
        cover_url: this.link(row.cover_file_id),
      },
      copy: { id: num(row.copy_id), accession_no: String(row.accession_no), barcode: String(row.barcode) },
      member,
      section: row.set_section_id ? { id: num(row.set_section_id), name: String(row.set_section_name) } : null,
      issued_at: row.issued_at as Date,
      due_date: dueDate,
      returned_at: (row.returned_at as Date | null) ?? null,
      return_condition: (row.return_condition as CopyCondition | null) ?? null,
      renew_count: num(row.renew_count),
      days_overdue: fine.days_overdue,
      running_fine: fine.running_fine,
      remarks: str(row.remarks),
      issued_by: str(row.issued_by_name),
      returned_by: str(row.returned_by_name),
      last_follow_up: followUp,
    };
  }

  async loans(
    schoolId: number,
    filter: SqlFilter,
    order = 'i.issued_at DESC, i.id DESC',
    limit?: number,
    manager?: EntityManager,
  ): Promise<LoanDto[]> {
    const runner = manager ?? this.dataSource.manager;
    const scoped: SqlFilter = { where: [...filter.where], params: [...filter.params] };
    scoped.where.unshift(`i.school_id = ${param(scoped, schoolId)}`);
    const rows: Row[] = await runner.query(
      this.loanSql(scoped, `ORDER BY ${order}${limit ? ` LIMIT ${Number(limit)}` : ''}`),
      scoped.params,
    );
    const context = await this.loanContext(schoolId, this.earliestOpenDue(rows), runner);
    return rows.map((row) => this.presentLoan(row, context));
  }

  async loanPage(
    schoolId: number,
    filter: SqlFilter,
    order: string,
    page: number,
    limit: number,
  ): Promise<Paginated<LoanDto>> {
    const scoped: SqlFilter = { where: [...filter.where], params: [...filter.params] };
    scoped.where.unshift(`i.school_id = ${param(scoped, schoolId)}`);
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM (${this.loanSql(scoped, '')}) counted`,
      scoped.params,
    );
    const rows: Row[] = await this.dataSource.query(
      this.loanSql(scoped, `ORDER BY ${order} LIMIT ${Number(limit)} OFFSET ${(page - 1) * limit}`),
      scoped.params,
    );
    const context = await this.loanContext(schoolId, this.earliestOpenDue(rows));
    return paginate([rows.map((row) => this.presentLoan(row, context)), Number(total)], page, limit);
  }

  private earliestLoanDue(rows: Row[]): string | null {
    const dues = rows.filter((row) => row.loan_due).map((row) => String(row.loan_due));
    return dues.length ? dues.sort()[0]! : null;
  }

  private earliestOpenDue(rows: Row[]): string | null {
    const dues = rows.filter((row) => row.status === 'issued').map((row) => String(row.due_date));
    return dues.length ? dues.sort()[0]! : null;
  }

  copySql(filter: SqlFilter, tail: string): string {
    return `
      SELECT c.id, c.book_id, c.accession_no, c.barcode, c.status, c.condition, c.source, c.vendor, c.bill_no,
             c.acquired_on::text AS acquired_on, c.price, c.notes, c.created_at,
             b.title, b.authors, b.isbn, b.rack, b.shelf, b.cover_file_id,
             cat.id AS category_id, cat.name AS category_name, COALESCE(cat.is_reference, false) AS is_reference,
             i.id AS loan_id, i.due_date::text AS loan_due, i.status AS loan_status,
             ${MEMBER_COLUMNS('m', 'mm')}
      FROM book_copies c
      JOIN books b ON b.id = c.book_id AND b.deleted_at IS NULL
      LEFT JOIN book_categories cat ON cat.id = b.category_id
      LEFT JOIN library_issues i ON i.copy_id = c.id AND i.status = 'issued' AND i.deleted_at IS NULL
      LEFT JOIN library_members m ON m.id = i.member_id
      ${MEMBER_JOINS('m', 'mm')}
      WHERE c.deleted_at IS NULL ${filter.where.length ? `AND ${filter.where.join(' AND ')}` : ''}
      ${tail}`;
  }

  presentCopy(row: Row, context: LoanContext): CopyDto {
    const location = [row.rack, row.shelf].filter(Boolean).join(' / ') || null;
    return {
      id: num(row.id),
      book_id: num(row.book_id),
      book: {
        id: num(row.book_id),
        title: String(row.title),
        authors: str(row.authors),
        isbn: str(row.isbn),
        category: row.category_id ? { id: num(row.category_id), name: String(row.category_name) } : null,
        is_reference: Boolean(row.is_reference),
        cover_url: this.link(row.cover_file_id),
      },
      accession_no: String(row.accession_no),
      barcode: String(row.barcode),
      status: row.status as CopyStatus,
      condition: row.condition as CopyCondition,
      source: row.source as CopySource,
      vendor: str(row.vendor),
      bill_no: str(row.bill_no),
      acquired_on: str(row.acquired_on),
      price: numOrNull(row.price),
      notes: str(row.notes),
      location,
      current_loan: row.loan_id
        ? {
            issue_id: num(row.loan_id),
            member: this.memberRef(row, 'mm'),
            due_date: String(row.loan_due),
            state: loanState(
              { status: 'issued', due_date: String(row.loan_due) },
              context.today,
              context.rules.due_soon_days,
            ),
            ...this.runningFine(context, {
              status: 'issued',
              due_date: String(row.loan_due),
              member_type: row.mm_type as MemberType,
            }),
          }
        : null,
      created_at: row.created_at as Date,
    };
  }

  async copies(schoolId: number, filter: SqlFilter, order = 'c.accession_no', manager?: EntityManager) {
    const scoped: SqlFilter = { where: [...filter.where], params: [...filter.params] };
    scoped.where.unshift(`c.school_id = ${param(scoped, schoolId)}`);
    const rows: Row[] = await (manager ?? this.dataSource.manager).query(
      this.copySql(scoped, `ORDER BY ${order}`),
      scoped.params,
    );
    const context = await this.loanContext(schoolId, this.earliestLoanDue(rows), manager);
    return rows.map((row) => this.presentCopy(row, context));
  }

  async copyPage(schoolId: number, filter: SqlFilter, order: string, page: number, limit: number) {
    const scoped: SqlFilter = { where: [...filter.where], params: [...filter.params] };
    scoped.where.unshift(`c.school_id = ${param(scoped, schoolId)}`);
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM (${this.copySql(scoped, '')}) counted`,
      scoped.params,
    );
    const rows: Row[] = await this.dataSource.query(
      this.copySql(scoped, `ORDER BY ${order} LIMIT ${Number(limit)} OFFSET ${(page - 1) * limit}`),
      scoped.params,
    );
    const context = await this.loanContext(schoolId, this.earliestLoanDue(rows));
    return paginate([rows.map((row) => this.presentCopy(row, context)), Number(total)], page, limit);
  }

  fineSql(filter: SqlFilter, tail: string): string {
    return `
      SELECT f.id, f.kind, f.status, f.amount, f.waived, f.paid, f.balance, f.days_late, f.reason,
             f.waive_reason, f.created_at, wu.name AS waived_by_name,
             i.id AS loan_id, i.due_date::text AS loan_due, b.title AS book_title, c.accession_no,
             ${MEMBER_COLUMNS('m', 'mm')}
      FROM library_fines f
      JOIN library_members m ON m.id = f.member_id
      ${MEMBER_JOINS('m', 'mm')}
      LEFT JOIN library_issues i ON i.id = f.issue_id
      LEFT JOIN book_copies c ON c.id = i.copy_id
      LEFT JOIN books b ON b.id = i.book_id
      LEFT JOIN users wu ON wu.id = f.waived_by
      WHERE f.deleted_at IS NULL ${filter.where.length ? `AND ${filter.where.join(' AND ')}` : ''}
      ${tail}`;
  }

  presentFine(row: Row): FineDto {
    return {
      id: num(row.id),
      kind: row.kind as FineKind,
      status: row.status as FineStatus,
      amount: num(row.amount),
      waived: num(row.waived),
      paid: num(row.paid),
      balance: num(row.balance),
      days_late: numOrNull(row.days_late),
      reason: String(row.reason),
      member: this.memberRef(row, 'mm'),
      loan: row.loan_id
        ? {
            id: num(row.loan_id),
            book_title: String(row.book_title),
            accession_no: String(row.accession_no),
            due_date: String(row.loan_due),
          }
        : null,
      waive_reason: str(row.waive_reason),
      waived_by: str(row.waived_by_name),
      created_at: row.created_at as Date,
    };
  }

  async fines(schoolId: number, filter: SqlFilter, order = 'f.created_at DESC', manager?: EntityManager) {
    const scoped: SqlFilter = { where: [...filter.where], params: [...filter.params] };
    scoped.where.unshift(`f.school_id = ${param(scoped, schoolId)}`);
    const rows: Row[] = await (manager ?? this.dataSource.manager).query(
      this.fineSql(scoped, `ORDER BY ${order}`),
      scoped.params,
    );
    return rows.map((row) => this.presentFine(row));
  }

  async finePage(schoolId: number, filter: SqlFilter, order: string, page: number, limit: number) {
    const scoped: SqlFilter = { where: [...filter.where], params: [...filter.params] };
    scoped.where.unshift(`f.school_id = ${param(scoped, schoolId)}`);
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM (${this.fineSql(scoped, '')}) counted`,
      scoped.params,
    );
    const rows: Row[] = await this.dataSource.query(
      this.fineSql(scoped, `ORDER BY ${order} LIMIT ${Number(limit)} OFFSET ${(page - 1) * limit}`),
      scoped.params,
    );
    return paginate([rows.map((row) => this.presentFine(row)), Number(total)], page, limit);
  }

  memberFine(fine: FineDto): MemberFineDto {
    return {
      id: fine.id,
      kind: fine.kind,
      status: fine.status,
      amount: fine.amount,
      balance: fine.balance,
      reason: fine.reason,
      created_at: fine.created_at,
    };
  }
}
