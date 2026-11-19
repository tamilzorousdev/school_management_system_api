import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException, paginate, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { RIDER_FEE_SQL, stopFee } from '../transport/transport.logic';
import {
  ParentTransportFeeDto,
  TransportFeeFiguresDto,
  TransportFeeQueryDto,
  TransportFeeRowDto,
  TransportFeeSummaryDto,
  TransportFeeSummaryQueryDto,
} from './dto/transport-fees.dto';
import { round2, transportFeeStatus } from './fees.logic';

const LINES_SQL = `
  SELECT i.student_id,
         COALESCE(l.route_id, t.route_id) AS route_id,
         COALESCE(l.stop_id, t.stop_id) AS stop_id,
         l.amount::numeric AS billed,
         CASE WHEN i.gross > 0 THEN round(l.amount * i.paid / i.gross, 2) ELSE 0 END AS paid,
         i.due_date, i.balance
  FROM fee_invoice_lines l
  JOIN fee_invoices i ON i.id = l.invoice_id AND i.deleted_at IS NULL AND i.status <> 'cancelled'
  LEFT JOIN student_transport t ON t.student_id = i.student_id AND t.deleted_at IS NULL
  WHERE l.deleted_at IS NULL AND l.kind IN ('transport', 'transport_adjustment')
    AND i.school_id = $1 AND i.academic_year_id = $2`;

interface Figures {
  students: number;
  billed: number;
  collected: number;
  pending: number;
  overdue: number;
}

const empty = (): Figures => ({ students: 0, billed: 0, collected: 0, pending: 0, overdue: 0 });

const add = (target: Figures, row: Figures) => {
  target.students += row.students;
  target.billed = round2(target.billed + row.billed);
  target.collected = round2(target.collected + row.collected);
  target.pending = round2(target.pending + row.pending);
  target.overdue = round2(target.overdue + row.overdue);
};

@Injectable()
export class TransportFeesReportService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async summary(schoolId: number, query: TransportFeeSummaryQueryDto): Promise<TransportFeeSummaryDto> {
    const yearId = await this.yearId(schoolId);
    const today = todayIn(this.app.timeZone);
    const groups: {
      route_id: number | null;
      stop_id: number | null;
      students: string;
      billed: string;
      collected: string;
      overdue: string;
    }[] = yearId
      ? await this.dataSource.query(
          `WITH lines AS (${LINES_SQL})
           SELECT route_id, stop_id, COUNT(DISTINCT student_id) AS students, SUM(billed) AS billed,
                  SUM(paid) AS collected,
                  SUM(CASE WHEN due_date < $3 THEN billed - paid ELSE 0 END) AS overdue
           FROM lines ${query.route_id ? 'WHERE route_id = $4' : ''}
           GROUP BY route_id, stop_id`,
          query.route_id ? [schoolId, yearId, today, query.route_id] : [schoolId, yearId, today],
        )
      : [];
    const routes: { id: number; code: string; name: string; monthly_fee: string; riders: string }[] =
      await this.dataSource.query(
        `SELECT r.id, r.code, r.name, r.monthly_fee,
                (SELECT COUNT(*) FROM student_transport t WHERE t.route_id = r.id AND t.deleted_at IS NULL) AS riders
         FROM transport_routes r
         WHERE r.school_id = $1 AND (r.deleted_at IS NULL OR r.id = ANY($2)) ${query.route_id ? 'AND r.id = $3' : ''}
         ORDER BY r.code`,
        query.route_id
          ? [schoolId, groups.map((row) => row.route_id).filter(Boolean), query.route_id]
          : [schoolId, groups.map((row) => row.route_id).filter(Boolean)],
      );
    const stops: { id: number; route_id: number; name: string; sequence: number; monthly_fee: string | null }[] =
      routes.length
        ? await this.dataSource.query(
            `SELECT id, route_id, name, sequence, monthly_fee FROM route_stops
             WHERE route_id = ANY($1) AND (deleted_at IS NULL OR id = ANY($2)) ORDER BY sequence`,
            [routes.map((route) => route.id), groups.map((row) => row.stop_id).filter(Boolean)],
          )
        : [];
    const figures = (row: (typeof groups)[number]): Figures => {
      const billed = Number(row.billed);
      const collected = Number(row.collected);
      return {
        students: Number(row.students),
        billed,
        collected,
        pending: round2(billed - collected),
        overdue: round2(Number(row.overdue)),
      };
    };
    const totals = empty();
    const result = routes.map((route) => {
      const own = groups.filter((row) => Number(row.route_id) === Number(route.id));
      const routeTotals = empty();
      const routeFee = Number(route.monthly_fee);
      const stopRows = stops
        .filter((stop) => Number(stop.route_id) === Number(route.id))
        .map((stop) => {
          const stopTotals = empty();
          own.filter((row) => Number(row.stop_id) === Number(stop.id)).forEach((row) => add(stopTotals, figures(row)));
          return {
            id: Number(stop.id),
            name: stop.name,
            sequence: Number(stop.sequence),
            monthly_fee: stopFee(stop.monthly_fee === null ? null : Number(stop.monthly_fee), routeFee),
            ...stopTotals,
          };
        });
      own.forEach((row) => add(routeTotals, figures(row)));
      add(totals, routeTotals);
      return {
        id: Number(route.id),
        code: route.code,
        name: route.name,
        monthly_fee: routeFee,
        riders: Number(route.riders),
        ...routeTotals,
        stops: stopRows,
      };
    });
    return { totals: totals as TransportFeeFiguresDto, routes: result };
  }

  async students(schoolId: number, query: TransportFeeQueryDto): Promise<Paginated<TransportFeeRowDto>> {
    const yearId = (await this.yearId(schoolId)) ?? 0;
    const today = todayIn(this.app.timeZone);
    const params: unknown[] = [schoolId, yearId, today];
    const where: string[] = ['t.school_id = $1', 't.deleted_at IS NULL'];
    if (query.route_id) {
      params.push(query.route_id);
      where.push(`t.route_id = $${params.length}`);
    }
    if (query.stop_id) {
      params.push(query.stop_id);
      where.push(`(t.stop_id = $${params.length} OR t.drop_stop_id = $${params.length})`);
    }
    if (query.student_id) {
      params.push(query.student_id);
      where.push(`t.student_id = $${params.length}`);
    }
    if (query.search) {
      params.push(`%${query.search.trim().replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
      where.push(
        `(s.first_name ILIKE $${params.length} OR s.last_name ILIKE $${params.length} OR s.admission_no ILIKE $${params.length})`,
      );
    }
    const statusSql: Record<string, string> = {
      not_billed: 'COALESCE(f.billed, 0) <= 0',
      overdue: 'COALESCE(f.billed, 0) > 0 AND COALESCE(f.overdue, 0) > 0',
      pending: 'COALESCE(f.billed, 0) > 0 AND COALESCE(f.overdue, 0) <= 0 AND COALESCE(f.billed - f.paid, 0) > 0',
      paid: 'COALESCE(f.billed, 0) > 0 AND COALESCE(f.billed - f.paid, 0) <= 0',
    };
    if (query.status) where.push(statusSql[query.status]!);
    const order = query.sort === 'pending' ? 'pending' : query.sort === 'billed' ? 'billed' : 's.first_name';
    const direction = query.order === 'desc' ? 'DESC' : 'ASC';
    const base = `
      FROM student_transport t
      JOIN students s ON s.id = t.student_id AND s.deleted_at IS NULL
      JOIN transport_routes r ON r.id = t.route_id
      JOIN route_stops rs ON rs.id = t.stop_id
      LEFT JOIN route_stops ds ON ds.id = t.drop_stop_id
      LEFT JOIN student_enrollments e ON e.student_id = s.id
        AND e.academic_year_id = (SELECT id FROM academic_years y WHERE y.school_id = s.school_id AND y.is_current LIMIT 1)
      LEFT JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN classes c ON c.id = COALESCE(e.class_id, sec.class_id)
      LEFT JOIN (
        SELECT student_id, SUM(billed) AS billed, SUM(paid) AS paid,
               SUM(CASE WHEN due_date < $3 THEN billed - paid ELSE 0 END) AS overdue,
               MIN(CASE WHEN balance > 0 THEN due_date END) AS next_due
        FROM (${LINES_SQL}) lines GROUP BY student_id
      ) f ON f.student_id = t.student_id
      WHERE ${where.join(' AND ')}`;
    const [count] = await this.dataSource.query(`SELECT COUNT(*) AS total ${base}`, params);
    if (!['name', 'pending', 'billed', undefined].includes(query.sort)) {
      throw AppException.badRequest('sort must be one of: name, pending, billed', 'INVALID_SORT');
    }
    const rows: {
      student_id: number;
      first_name: string;
      last_name: string | null;
      admission_no: string;
      class_name: string | null;
      section_name: string | null;
      route_id: number;
      route_name: string;
      stop_id: number;
      stop_name: string;
      drop_id: number | null;
      drop_name: string | null;
      monthly_fee: string;
      billed: string | null;
      paid: string | null;
      overdue: string | null;
      next_due: string | null;
    }[] = await this.dataSource.query(
      `SELECT t.student_id, s.first_name, s.last_name, s.admission_no, c.name AS class_name, sec.name AS section_name,
              r.id AS route_id, r.name AS route_name, rs.id AS stop_id, rs.name AS stop_name,
              ds.id AS drop_id, ds.name AS drop_name, ${RIDER_FEE_SQL('rs', 'ds', 'r')} AS monthly_fee,
              f.billed, f.paid, f.overdue, to_char(f.next_due, 'YYYY-MM-DD') AS next_due,
              COALESCE(f.billed - f.paid, 0) AS pending, COALESCE(f.billed, 0) AS billed_sort
       ${base}
       ORDER BY ${order === 'billed' ? 'billed_sort' : order} ${direction} NULLS LAST, t.student_id
       LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    const items = rows.map((row) => {
      const billed = Number(row.billed ?? 0);
      const paid = Number(row.paid ?? 0);
      const pending = round2(billed - paid);
      const overdue = round2(Number(row.overdue ?? 0));
      return {
        student: {
          id: Number(row.student_id),
          full_name: [row.first_name, row.last_name].filter(Boolean).join(' '),
          admission_no: row.admission_no,
          class_section: row.class_name ? [row.class_name, row.section_name].filter(Boolean).join(' - ') : null,
        },
        route: { id: Number(row.route_id), name: row.route_name },
        stop: { id: Number(row.stop_id), name: row.stop_name },
        drop_stop:
          row.drop_id && Number(row.drop_id) !== Number(row.stop_id)
            ? { id: Number(row.drop_id), name: row.drop_name! }
            : null,
        monthly_fee: Number(row.monthly_fee),
        billed,
        paid,
        pending,
        overdue,
        next_due_date: row.next_due,
        status: transportFeeStatus(billed, pending, overdue),
      };
    });
    return paginate([items, Number(count?.total ?? 0)], query.page, query.limit);
  }

  async forStudent(schoolId: number, studentId: number, monthlyFee: number): Promise<ParentTransportFeeDto> {
    const yearId = await this.yearId(schoolId);
    const today = todayIn(this.app.timeZone);
    const [row]: { billed: string | null; paid: string | null; overdue: string | null; next_due: string | null }[] =
      yearId
        ? await this.dataSource.query(
            `SELECT SUM(billed) AS billed, SUM(paid) AS paid,
                    SUM(CASE WHEN due_date < $3 THEN billed - paid ELSE 0 END) AS overdue,
                    to_char(MIN(CASE WHEN balance > 0 THEN due_date END), 'YYYY-MM-DD') AS next_due
             FROM (${LINES_SQL}) lines WHERE student_id = $4`,
            [schoolId, yearId, today, studentId],
          )
        : [];
    const billed = Number(row?.billed ?? 0);
    const paid = Number(row?.paid ?? 0);
    const pending = round2(billed - paid);
    return {
      monthly_fee: monthlyFee,
      billed,
      paid,
      pending,
      next_due_date: row?.next_due ?? null,
      status: transportFeeStatus(billed, pending, Number(row?.overdue ?? 0)),
    };
  }

  private async yearId(schoolId: number): Promise<number | null> {
    const [year] = await this.dataSource.query(
      `SELECT id FROM academic_years WHERE school_id = $1 AND is_current = true AND deleted_at IS NULL LIMIT 1`,
      [schoolId],
    );
    return year ? Number(year.id) : null;
  }
}
