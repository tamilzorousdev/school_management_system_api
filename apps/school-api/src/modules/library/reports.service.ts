import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { yearClause } from '../../shared/year-context';
import { CatalogueService } from './catalogue.service';
import { CirculationService } from './circulation.service';
import {
  CategoryReportDto,
  ClassReportDto,
  LibraryDashboardDto,
  MostBorrowedDto,
  ReportQueryDto,
  StockReportDto,
  TopReaderDto,
} from './dto/desk.dto';
import { FinesService } from './fines.service';
import { LibraryReadService, MEMBER_COLUMNS, MEMBER_JOINS, param, Row, SqlFilter } from './library-read.service';
import { VisitsService } from './visits.service';

@Injectable()
export class ReportsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly read: LibraryReadService,
    private readonly catalogue: CatalogueService,
    private readonly circulation: CirculationService,
    private readonly fines: FinesService,
    private readonly visits: VisitsService,
  ) {}

  private async range(schoolId: number, query: ReportQueryDto): Promise<{ from: string; to: string }> {
    if (query.from && query.to) return { from: query.from, to: query.to };
    const [year]: { start_date: string; end_date: string }[] = await this.dataSource.query(
      `SELECT start_date::text AS start_date, end_date::text AS end_date FROM academic_years y
       WHERE y.school_id = $1 AND ${yearClause('y')} AND y.deleted_at IS NULL LIMIT 1`,
      [schoolId],
    );
    const today = this.read.today();
    return { from: query.from ?? year?.start_date ?? `${today.slice(0, 4)}-01-01`, to: query.to ?? today };
  }

  private loanRange(filter: SqlFilter, range: { from: string; to: string }, alias = 'i'): void {
    const zone = param(filter, this.read.zone());
    filter.where.push(
      `(${alias}.issued_at AT TIME ZONE ${zone})::date BETWEEN ${param(filter, range.from)}::date AND ${param(filter, range.to)}::date`,
    );
  }

  async mostBorrowed(schoolId: number, query: ReportQueryDto): Promise<MostBorrowedDto[]> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`i.school_id = ${param(filter, schoolId)}`, 'i.deleted_at IS NULL');
    this.loanRange(filter, await this.range(schoolId, query));
    if (query.member_type) filter.where.push(`m.member_type = ${param(filter, query.member_type)}`);
    const rows: Row[] = await this.dataSource.query(
      `SELECT b.id, b.title, b.authors, cat.name AS category, COUNT(*)::int AS loans, COUNT(DISTINCT i.member_id)::int AS readers
       FROM library_issues i JOIN books b ON b.id = i.book_id JOIN library_members m ON m.id = i.member_id
       LEFT JOIN book_categories cat ON cat.id = b.category_id
       WHERE ${filter.where.join(' AND ')}
       GROUP BY b.id, cat.name ORDER BY loans DESC, b.title LIMIT ${query.limit ?? 10}`,
      filter.params,
    );
    return rows.map((row) => ({
      book_id: Number(row.id),
      title: String(row.title),
      authors: (row.authors as string | null) ?? null,
      category: (row.category as string | null) ?? null,
      loans: Number(row.loans),
      readers: Number(row.readers),
    }));
  }

  async categories(schoolId: number, query: ReportQueryDto): Promise<CategoryReportDto[]> {
    const range = await this.range(schoolId, query);
    const rows: Row[] = await this.dataSource.query(
      `SELECT cat.id AS category_id, COALESCE(cat.name, 'No category') AS category,
              COUNT(DISTINCT b.id)::int AS titles,
              COUNT(DISTINCT c.id)::int AS copies,
              COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'available')::int AS available,
              (SELECT COALESCE(SUM(COALESCE(x.price, bx.price, 0)), 0) FROM book_copies x JOIN books bx ON bx.id = x.book_id
                 WHERE x.deleted_at IS NULL AND bx.deleted_at IS NULL AND x.status NOT IN ('lost', 'withdrawn')
                   AND bx.school_id = $1 AND bx.category_id IS NOT DISTINCT FROM cat.id) AS stock_value,
              (SELECT COUNT(*) FROM library_issues i JOIN books bi ON bi.id = i.book_id
                 WHERE i.school_id = $1 AND i.deleted_at IS NULL AND bi.category_id IS NOT DISTINCT FROM cat.id
                   AND (i.issued_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date)::int AS loans,
              (SELECT COUNT(DISTINCT i.member_id) FROM library_issues i JOIN books bi ON bi.id = i.book_id
                 WHERE i.school_id = $1 AND i.deleted_at IS NULL AND bi.category_id IS NOT DISTINCT FROM cat.id
                   AND (i.issued_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date)::int AS readers
       FROM books b
       LEFT JOIN book_categories cat ON cat.id = b.category_id
       LEFT JOIN book_copies c ON c.book_id = b.id AND c.deleted_at IS NULL
       WHERE b.school_id = $1 AND b.deleted_at IS NULL
       GROUP BY cat.id, cat.name ORDER BY loans DESC, category`,
      [schoolId, range.from, range.to, this.read.zone()],
    );
    return rows.map((row) => ({
      category_id: row.category_id === null ? null : Number(row.category_id),
      category: String(row.category),
      titles: Number(row.titles),
      copies: Number(row.copies),
      available: Number(row.available),
      loans: Number(row.loans),
      readers: Number(row.readers),
      stock_value: Number(row.stock_value),
    }));
  }

  async topReaders(schoolId: number, query: ReportQueryDto): Promise<TopReaderDto[]> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`i.school_id = ${param(filter, schoolId)}`, 'i.deleted_at IS NULL');
    this.loanRange(filter, await this.range(schoolId, query));
    if (query.member_type) filter.where.push(`m.member_type = ${param(filter, query.member_type)}`);
    const rows: Row[] = await this.dataSource.query(
      `SELECT t.loans, t.late_returns, ${MEMBER_COLUMNS('m', 'mm')}
       FROM (
         SELECT i.member_id, COUNT(*)::int AS loans,
                COUNT(*) FILTER (WHERE i.returned_at IS NOT NULL AND (i.returned_at AT TIME ZONE ${param(filter, this.read.zone())})::date > i.due_date)::int AS late_returns
         FROM library_issues i JOIN library_members m ON m.id = i.member_id
         WHERE ${filter.where.join(' AND ')} GROUP BY i.member_id
       ) t
       JOIN library_members m ON m.id = t.member_id
       ${MEMBER_JOINS('m', 'mm')}
       ORDER BY t.loans DESC, t.late_returns ASC LIMIT ${query.limit ?? 10}`,
      filter.params,
    );
    return rows.map((row) => ({
      member: this.read.memberRef(row, 'mm'),
      loans: Number(row.loans),
      late_returns: Number(row.late_returns),
    }));
  }

  async classes(schoolId: number, query: ReportQueryDto): Promise<ClassReportDto[]> {
    const range = await this.range(schoolId, query);
    const rows: Row[] = await this.dataSource.query(
      `SELECT sec.id AS section_id, c.name || ' - ' || sec.name AS section,
              (SELECT COUNT(*) FROM student_enrollments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
                 WHERE e.section_id = sec.id AND e.status = 'studying')::int AS students,
              (SELECT COUNT(*) FROM student_enrollments e JOIN library_members m ON m.student_id = e.student_id AND m.deleted_at IS NULL
                 WHERE e.section_id = sec.id AND e.status = 'studying')::int AS members,
              (SELECT COUNT(*) FROM library_issues i WHERE i.section_id = sec.id AND i.purpose = 'personal' AND i.deleted_at IS NULL
                 AND (i.issued_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date)::int AS loans,
              (SELECT COUNT(*) FROM library_issues i WHERE i.section_id = sec.id AND i.purpose = 'personal' AND i.deleted_at IS NULL
                 AND i.status = 'issued' AND i.due_date < $5::date)::int AS overdue,
              (SELECT COUNT(*) FROM library_visits v WHERE v.section_id = sec.id AND v.kind = 'walk_in' AND v.deleted_at IS NULL
                 AND v.visit_date BETWEEN $2::date AND $3::date)::int AS visits,
              (SELECT COUNT(*) FROM library_visits v WHERE v.section_id = sec.id AND v.kind = 'period' AND v.present AND v.deleted_at IS NULL
                 AND v.visit_date BETWEEN $2::date AND $3::date)::int AS period_present,
              (SELECT COUNT(*) FROM library_visits v WHERE v.section_id = sec.id AND v.kind = 'period' AND NOT v.present AND v.deleted_at IS NULL
                 AND v.visit_date BETWEEN $2::date AND $3::date)::int AS period_absent
       FROM sections sec
       JOIN academic_years y ON y.id = sec.academic_year_id AND ${yearClause('y')}
       JOIN classes c ON c.id = sec.class_id
       WHERE sec.school_id = $1 AND sec.deleted_at IS NULL
       ORDER BY c.grade_level, sec.name`,
      [schoolId, range.from, range.to, this.read.zone(), this.read.today()],
    );
    return rows.map((row) => ({
      section_id: Number(row.section_id),
      section: String(row.section),
      students: Number(row.students),
      members: Number(row.members),
      loans: Number(row.loans),
      overdue: Number(row.overdue),
      visits: Number(row.visits),
      period_present: Number(row.period_present),
      period_absent: Number(row.period_absent),
    }));
  }

  async stock(schoolId: number): Promise<StockReportDto> {
    const statuses: Row[] = await this.dataSource.query(
      `SELECT c.status, COUNT(*)::int AS copies, COALESCE(SUM(COALESCE(c.price, b.price, 0)), 0) AS value
       FROM book_copies c JOIN books b ON b.id = c.book_id AND b.deleted_at IS NULL
       WHERE c.school_id = $1 AND c.deleted_at IS NULL GROUP BY c.status ORDER BY copies DESC`,
      [schoolId],
    );
    const [titles]: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS count FROM books WHERE school_id = $1 AND deleted_at IS NULL`,
      [schoolId],
    );
    const byCategory = await this.categories(schoolId, {});
    const byStatus = statuses.map((row) => ({
      status: String(row.status),
      copies: Number(row.copies),
      value: Number(row.value),
    }));
    return {
      titles: Number(titles?.count ?? 0),
      copies: byStatus.reduce((sum, row) => sum + row.copies, 0),
      value:
        Math.round(
          byStatus
            .filter((row) => !['lost', 'withdrawn'].includes(row.status))
            .reduce((sum, row) => sum + row.value, 0) * 100,
        ) / 100,
      by_status: byStatus,
      by_category: byCategory,
    };
  }

  async dashboard(schoolId: number): Promise<LibraryDashboardDto> {
    const today = this.read.today();
    const dueToday: SqlFilter = { where: [`i.status = 'issued'`], params: [] };
    dueToday.where.push(`i.due_date = ${param(dueToday, today)}::date`);
    const recent: SqlFilter = { where: [], params: [] };
    const [books, loans, fines, visits, due, followUps, latest, periods] = await Promise.all([
      this.catalogue.insights(schoolId),
      this.circulation.insights(schoolId),
      this.fines.insights(schoolId),
      this.visits.insights(schoolId, today),
      this.read.loans(schoolId, dueToday, 'i.issued_at', 10),
      this.circulation.followUpQueue(schoolId, { page: 1, limit: 10, order: 'desc', show: 'due' }),
      this.read.loans(
        schoolId,
        recent,
        'GREATEST(i.issued_at, COALESCE(i.returned_at, i.issued_at)) DESC, i.id DESC',
        10,
      ),
      this.visits.periods(schoolId, today),
    ]);
    return {
      books,
      loans,
      fines,
      visits,
      due_today: due,
      follow_ups: followUps.items,
      recent: latest,
      periods_today: periods,
    };
  }
}
