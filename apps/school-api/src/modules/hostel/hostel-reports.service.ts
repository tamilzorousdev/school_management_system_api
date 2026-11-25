import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { yearClause } from '../../shared/year-context';
import {
  AttendanceCountsDto,
  AttendanceReportDto,
  ComplaintsReportDto,
  DisciplineReportDto,
  FeesReportDto,
  FeesTotalsDto,
  HealthReportDto,
  HostelReportQueryDto,
  LeavesReportDto,
  MessReportDto,
  OccupancyCountsDto,
  OccupancyReportDto,
  SummaryReportDto,
  VisitorsReportDto,
} from './dto/hostel-reports.dto';
import { DOSE_STATUSES, HEALTH_KINDS, MEALS, SKIP_SOURCES } from './entities/hostel-care.entity';
import {
  CASE_STATUSES,
  COMPLAINT_CATEGORIES,
  COMPLAINT_STATES,
  DISCIPLINE_ACTIONS,
  DISCIPLINE_CATEGORIES,
  MAINTENANCE_CATEGORIES,
  SEVERITIES,
  TICKET_STATES,
} from './entities/hostel-conduct.entity';
import { LEAVE_KINDS, LEAVE_SOURCES, LEAVE_STATES } from './entities/hostel-movement.entity';
import { careHostel } from './hostel-care-sql';
import {
  attendanceRate,
  averageOf,
  bucketByMonth,
  countsFor,
  dayKeys,
  DEFAULT_TOP,
  defaultRange,
  fillBy,
  percent,
  rangeErrors,
  REPEAT_CASE_THRESHOLD,
  ReportRange,
  reportRange,
  round,
  sumCounts,
  tally,
} from './hostel-reports.logic';
import { STUDENT_COLUMNS, studentFromRow, studentJoins } from './hostel-sql';
import { OPEN_LEAVE_STATES, ROLL_SLOTS } from './hostel.logic';

type Row = Record<string, unknown>;

export interface ReportScope {
  schoolId: number;
  hostelId: number | null;
  from: string;
  to: string;
  zone: string;
  top: number;
  period: ReportRange;
}

const OPEN_LEAVES = OPEN_LEAVE_STATES.map((state) => `'${state}'`).join(', ');
const OPEN_COMPLAINTS = `'open', 'in_progress'`;
const CLOSED_TICKETS = `'done', 'cancelled'`;
const IN_SICK_BAY = `hl.sick_bay_from IS NOT NULL AND hl.sick_bay_to IS NULL AND hl.status = 'open'`;

const BED_COUNTS = `COUNT(bd.id)::int AS beds,
       COUNT(bd.id) FILTER (WHERE bd.status = 'occupied')::int AS occupied,
       COUNT(bd.id) FILTER (WHERE bd.status = 'vacant')::int AS vacant,
       COUNT(bd.id) FILTER (WHERE bd.status = 'reserved')::int AS reserved,
       COUNT(bd.id) FILTER (WHERE bd.status = 'blocked')::int AS blocked,
       COUNT(bd.id) FILTER (WHERE bd.status = 'maintenance')::int AS maintenance`;

const ROLL_COUNTS = `COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE r.status = 'present')::int AS present,
       COUNT(*) FILTER (WHERE r.status = 'late')::int AS late,
       COUNT(*) FILTER (WHERE r.status = 'absent')::int AS absent,
       COUNT(*) FILTER (WHERE r.status IN ('on_leave', 'outing'))::int AS away,
       COUNT(*) FILTER (WHERE r.status = 'sick')::int AS sick`;

const RESIDENT_COLUMNS = `x.admission_id, h.name AS hostel_name, ${STUDENT_COLUMNS}`;

const residentJoins = () => `JOIN hostel_admissions a ON a.id = x.admission_id
       JOIN hostels h ON h.id = a.hostel_id
       JOIN students s ON s.id = x.student_id
       ${studentJoins('s')}`;

const int = (value: unknown): number => Number(value ?? 0);
const money = (value: unknown): number => round(Number(value ?? 0));

class ReportSql {
  readonly params: unknown[];
  private readonly slots = new Map<string, string>();

  constructor(private readonly scope: ReportScope) {
    this.params = [scope.schoolId];
  }

  private slot(name: string, value: unknown): string {
    const existing = this.slots.get(name);
    if (existing) return existing;
    const slot = `$${this.params.push(value)}`;
    this.slots.set(name, slot);
    return slot;
  }

  hostel(column: string): string {
    return this.scope.hostelId ? ` AND ${column} = ${this.slot('hostel', this.scope.hostelId)}` : '';
  }

  dates(column: string): string {
    return `${column} BETWEEN ${this.slot('from', this.scope.from)}::date AND ${this.slot('to', this.scope.to)}::date`;
  }

  day(column: string): string {
    return `(${column} AT TIME ZONE ${this.slot('zone', this.scope.zone)})::date`;
  }

  localDates(column: string): string {
    return this.dates(this.day(column));
  }

  get from(): string {
    return `${this.slot('from', this.scope.from)}::date`;
  }

  get to(): string {
    return `${this.slot('to', this.scope.to)}::date`;
  }
}

function resident(row: Row) {
  return {
    admission_id: int(row.admission_id),
    student: studentFromRow(row),
    hostel_name: row.hostel_name as string,
  };
}

function occupancyCounts(row: Row): OccupancyCountsDto {
  const counts = {
    rooms: int(row.rooms),
    beds: int(row.beds),
    occupied: int(row.occupied),
    vacant: int(row.vacant),
    reserved: int(row.reserved),
    blocked: int(row.blocked),
    maintenance: int(row.maintenance),
  };
  return { ...counts, occupancy_percent: percent(counts.occupied, counts.beds) };
}

function addOccupancy(rows: OccupancyCountsDto[]): OccupancyCountsDto {
  const total = { rooms: 0, beds: 0, occupied: 0, vacant: 0, reserved: 0, blocked: 0, maintenance: 0 };
  for (const row of rows) {
    for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += row[key];
  }
  return occupancyCounts(total);
}

function attendanceCounts(row: Row): AttendanceCountsDto {
  const counts = {
    total: int(row.total),
    present: int(row.present),
    late: int(row.late),
    absent: int(row.absent),
    away: int(row.away),
    sick: int(row.sick),
  };
  return { ...counts, present_percent: attendanceRate(counts) };
}

function feesTotals(row: Row): FeesTotalsDto {
  const billed = money(row.billed);
  const collected = money(row.collected);
  return {
    billed,
    collected,
    outstanding: money(row.outstanding),
    collection_percent: percent(collected, billed),
    residents_with_dues: int(row.residents_with_dues),
  };
}

const countRows = (rows: Row[]): (Row & { count: number })[] => rows.map((row) => ({ ...row, count: int(row.count) }));

@Injectable()
export class HostelReportsService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async scope(schoolId: number, query: HostelReportQueryDto): Promise<ReportScope> {
    const { from, to } = defaultRange(query, todayIn(this.app.timeZone));
    const errors = rangeErrors(from, to);
    if (errors.length) throw AppException.validation(errors);
    if (query.hostel_id) await careHostel(this.dataSource, schoolId, query.hostel_id);
    return {
      schoolId,
      hostelId: query.hostel_id ?? null,
      from,
      to,
      zone: this.app.timeZone,
      top: query.top ?? DEFAULT_TOP,
      period: reportRange(from, to),
    };
  }

  async schoolName(schoolId: number): Promise<string> {
    const [school] = await this.dataSource.query(`SELECT name FROM schools WHERE id = $1`, [schoolId]);
    return school?.name ?? 'School';
  }

  async hostelName(scope: ReportScope): Promise<string> {
    if (!scope.hostelId) return 'All hostels';
    return (await careHostel(this.dataSource, scope.schoolId, scope.hostelId)).name;
  }

  private run(text: string, sql: ReportSql): Promise<Row[]> {
    return this.dataSource.query(text, sql.params);
  }

  async occupancy(schoolId: number, query: HostelReportQueryDto): Promise<OccupancyReportDto> {
    const scope = await this.scope(schoolId, query);
    const blocksSql = new ReportSql(scope);
    const typesSql = new ReportSql(scope);
    const [blockRows, typeRows] = await Promise.all([
      this.run(
        `SELECT h.id AS hostel_id, h.name AS hostel_name, b.id AS block_id, b.name AS block_name,
           COUNT(DISTINCT r.id)::int AS rooms, ${BED_COUNTS}
         FROM hostels h
         LEFT JOIN hostel_blocks b ON b.hostel_id = h.id AND b.deleted_at IS NULL
         LEFT JOIN hostel_rooms r ON r.block_id = b.id AND r.deleted_at IS NULL
         LEFT JOIN hostel_beds bd ON bd.room_id = r.id AND bd.deleted_at IS NULL
         WHERE h.school_id = $1 AND h.deleted_at IS NULL${blocksSql.hostel('h.id')}
         GROUP BY h.id, b.id
         ORDER BY h.name, h.id, b.sort_order, b.name`,
        blocksSql,
      ),
      this.run(
        `SELECT t.id AS room_type_id, t.name AS room_type_name, COUNT(DISTINCT r.id)::int AS rooms,
           COUNT(bd.id)::int AS beds, COUNT(bd.id) FILTER (WHERE bd.status = 'occupied')::int AS occupied
         FROM hostel_room_types t
         JOIN hostel_rooms r ON r.room_type_id = t.id AND r.deleted_at IS NULL
         JOIN hostels h ON h.id = r.hostel_id AND h.deleted_at IS NULL
         LEFT JOIN hostel_beds bd ON bd.room_id = r.id AND bd.deleted_at IS NULL
         WHERE t.school_id = $1 AND t.deleted_at IS NULL${typesSql.hostel('r.hostel_id')}
         GROUP BY t.id
         ORDER BY t.name`,
        typesSql,
      ),
    ]);
    const hostels = new Map<number, { hostel_id: number; hostel_name: string; blocks: Row[] }>();
    for (const row of blockRows) {
      const id = int(row.hostel_id);
      const hostel = hostels.get(id) ?? { hostel_id: id, hostel_name: row.hostel_name as string, blocks: [] };
      if (row.block_id !== null) hostel.blocks.push(row);
      hostels.set(id, hostel);
    }
    const hostelRows = [...hostels.values()].map((hostel) => {
      const blocks = hostel.blocks.map((row) => ({
        block_id: int(row.block_id),
        block_name: row.block_name as string,
        ...occupancyCounts(row),
      }));
      return { hostel_id: hostel.hostel_id, hostel_name: hostel.hostel_name, ...addOccupancy(blocks), blocks };
    });
    return {
      as_of: todayIn(this.app.timeZone),
      totals: addOccupancy(hostelRows),
      hostels: hostelRows,
      room_types: typeRows.map((row) => ({
        room_type_id: int(row.room_type_id),
        room_type_name: row.room_type_name as string,
        rooms: int(row.rooms),
        beds: int(row.beds),
        occupied: int(row.occupied),
        occupancy_percent: percent(int(row.occupied), int(row.beds)),
      })),
    };
  }

  private rollFrom(sql: ReportSql): string {
    return `FROM hostel_roll_call_records r
       JOIN hostel_roll_calls rc ON rc.id = r.roll_call_id
       WHERE rc.school_id = $1 AND ${sql.dates('rc.roll_date')}${sql.hostel('rc.hostel_id')}`;
  }

  async attendance(schoolId: number, query: HostelReportQueryDto): Promise<AttendanceReportDto> {
    const scope = await this.scope(schoolId, query);
    const slotSql = new ReportSql(scope);
    const daySql = new ReportSql(scope);
    const topSql = new ReportSql(scope);
    const [slotRows, dayRows, topRows] = await Promise.all([
      this.run(`SELECT rc.slot, ${ROLL_COUNTS} ${this.rollFrom(slotSql)} GROUP BY rc.slot`, slotSql),
      this.run(
        `SELECT rc.roll_date::text AS date, COUNT(DISTINCT rc.id)::int AS roll_calls, ${ROLL_COUNTS}
         ${this.rollFrom(daySql)}
         GROUP BY rc.roll_date ORDER BY rc.roll_date`,
        daySql,
      ),
      this.run(
        `SELECT ${RESIDENT_COLUMNS}, x.absent, x.late, x.marked
         FROM (
           SELECT r.admission_id, r.student_id,
             COUNT(*) FILTER (WHERE r.status = 'absent')::int AS absent,
             COUNT(*) FILTER (WHERE r.status = 'late')::int AS late,
             COUNT(*)::int AS marked
           ${this.rollFrom(topSql)}
           GROUP BY r.admission_id, r.student_id
           HAVING COUNT(*) FILTER (WHERE r.status IN ('absent', 'late')) > 0
           ORDER BY absent DESC, late DESC, r.admission_id
           LIMIT ${scope.top}
         ) x
         ${residentJoins()}
         ORDER BY x.absent DESC, x.late DESC, x.admission_id`,
        topSql,
      ),
    ]);
    const slots = fillBy(
      [...ROLL_SLOTS],
      slotRows.map((row) => ({ slot: row.slot as string, ...attendanceCounts(row) })),
      (row) => row.slot,
      (slot) => ({ slot, ...attendanceCounts({}) }),
    );
    const totals = attendanceCounts(
      Object.fromEntries(
        (['total', 'present', 'late', 'absent', 'away', 'sick'] as const).map((key) => [
          key,
          slots.reduce((sum, slot) => sum + slot[key], 0),
        ]),
      ),
    );
    return {
      period: scope.period,
      totals,
      slots,
      days: dayRows.map((row) => {
        const counts = attendanceCounts(row);
        return {
          date: row.date as string,
          roll_calls: int(row.roll_calls),
          present: counts.present + counts.late,
          absent: counts.absent,
          present_percent: counts.present_percent,
        };
      }),
      top_absentees: topRows.map((row) => ({
        ...resident(row),
        absent: int(row.absent),
        late: int(row.late),
        marked: int(row.marked),
      })),
    };
  }

  async leaves(schoolId: number, query: HostelReportQueryDto): Promise<LeavesReportDto> {
    const scope = await this.scope(schoolId, query);
    const countSql = new ReportSql(scope);
    const nowSql = new ReportSql(scope);
    const lateSql = new ReportSql(scope);
    const topSql = new ReportSql(scope);
    const lateWhere = (sql: ReportSql) =>
      `l.school_id = $1 AND l.deleted_at IS NULL AND l.late_minutes > 0 AND l.returned_at IS NOT NULL
       AND ${sql.localDates('l.returned_at')}${sql.hostel('l.hostel_id')}`;
    const [countRowsRaw, [now], [late], topRows] = await Promise.all([
      this.run(
        `SELECT l.kind, l.status, l.source, COUNT(*)::int AS count FROM hostel_leaves l
         WHERE l.school_id = $1 AND l.deleted_at IS NULL AND ${countSql.dates('l.from_date')}${countSql.hostel('l.hostel_id')}
         GROUP BY l.kind, l.status, l.source`,
        countSql,
      ),
      this.run(
        `SELECT COUNT(*)::int AS open_now, COUNT(*) FILTER (WHERE l.status = 'out')::int AS out_now
         FROM hostel_leaves l
         WHERE l.school_id = $1 AND l.deleted_at IS NULL AND l.status IN (${OPEN_LEAVES})${nowSql.hostel('l.hostel_id')}`,
        nowSql,
      ),
      this.run(
        `SELECT COUNT(*)::int AS count, AVG(l.late_minutes)::float AS average, MAX(l.late_minutes)::int AS longest
         FROM hostel_leaves l WHERE ${lateWhere(lateSql)}`,
        lateSql,
      ),
      this.run(
        `SELECT ${RESIDENT_COLUMNS}, x.late_returns, x.total_late_minutes, x.max_late_minutes
         FROM (
           SELECT l.admission_id, l.student_id, COUNT(*)::int AS late_returns,
             SUM(l.late_minutes)::int AS total_late_minutes, MAX(l.late_minutes)::int AS max_late_minutes
           FROM hostel_leaves l WHERE ${lateWhere(topSql)}
           GROUP BY l.admission_id, l.student_id
           ORDER BY late_returns DESC, total_late_minutes DESC, l.admission_id
           LIMIT ${scope.top}
         ) x
         ${residentJoins()}
         ORDER BY x.late_returns DESC, x.total_late_minutes DESC, x.admission_id`,
        topSql,
      ),
    ]);
    const rows = countRows(countRowsRaw);
    const bySource = countsFor(
      LEAVE_SOURCES,
      tally(rows, (row) => row.source as string),
    );
    const sourceCount = (source: string) => bySource.find((row) => row.key === source)?.count ?? 0;
    const byKind = countsFor(
      LEAVE_KINDS,
      tally(rows, (row) => row.kind as string),
    );
    const total = sumCounts(byKind);
    const outings = byKind.find((row) => row.key === 'outing')?.count ?? 0;
    return {
      period: scope.period,
      total,
      outings,
      overnight_leaves: total - outings,
      parent_initiated: sourceCount('parent'),
      warden_initiated: sourceCount('warden'),
      office_initiated: sourceCount('office'),
      by_kind: byKind,
      by_status: countsFor(
        LEAVE_STATES,
        tally(rows, (row) => row.status as string),
      ),
      by_source: bySource,
      open_now: int(now?.open_now),
      out_now: int(now?.out_now),
      late_returns: {
        count: int(late?.count),
        average_late_minutes: averageOf(late?.average),
        max_late_minutes: late?.longest === null || late?.longest === undefined ? null : int(late.longest),
        residents: topRows.map((row) => ({
          ...resident(row),
          late_returns: int(row.late_returns),
          total_late_minutes: int(row.total_late_minutes),
          max_late_minutes: int(row.max_late_minutes),
        })),
      },
    };
  }

  async visitors(schoolId: number, query: HostelReportQueryDto): Promise<VisitorsReportDto> {
    const scope = await this.scope(schoolId, query);
    const where = (sql: ReportSql) =>
      `v.school_id = $1 AND ${sql.localDates('v.created_at')}${sql.hostel('v.hostel_id')}`;
    const totalSql = new ReportSql(scope);
    const daySql = new ReportSql(scope);
    const relationSql = new ReportSql(scope);
    const insideSql = new ReportSql(scope);
    const [[totals], dayRows, relationRows, [inside]] = await Promise.all([
      this.run(
        `SELECT COUNT(*)::int AS visits, COALESCE(SUM(v.people_count), 0)::int AS people,
           COUNT(*) FILTER (WHERE v.status = 'denied')::int AS denied,
           COUNT(*) FILTER (WHERE NOT v.is_known)::int AS unknown_visitors,
           AVG(EXTRACT(EPOCH FROM (v.out_at - v.in_at)) / 60)
             FILTER (WHERE v.in_at IS NOT NULL AND v.out_at IS NOT NULL)::float AS average_minutes
         FROM hostel_visits v WHERE ${where(totalSql)}`,
        totalSql,
      ),
      this.run(
        `SELECT ${daySql.day('v.created_at')}::text AS date, COUNT(*)::int AS visits,
           COALESCE(SUM(v.people_count), 0)::int AS people, COUNT(*) FILTER (WHERE v.status = 'denied')::int AS denied
         FROM hostel_visits v WHERE ${where(daySql)}
         GROUP BY 1 ORDER BY 1`,
        daySql,
      ),
      this.run(
        `SELECT LOWER(TRIM(v.relation)) AS key, COUNT(*)::int AS count
         FROM hostel_visits v WHERE ${where(relationSql)}
         GROUP BY 1 ORDER BY count DESC, key`,
        relationSql,
      ),
      this.run(
        `SELECT COUNT(*)::int AS inside FROM hostel_visits v
         WHERE v.school_id = $1 AND v.status = 'inside'${insideSql.hostel('v.hostel_id')}`,
        insideSql,
      ),
    ]);
    return {
      period: scope.period,
      visits: int(totals?.visits),
      people: int(totals?.people),
      denied: int(totals?.denied),
      unknown_visitors: int(totals?.unknown_visitors),
      inside_now: int(inside?.inside),
      average_visit_minutes: averageOf(totals?.average_minutes),
      by_relation: relationRows.map((row) => ({ key: row.key as string, count: int(row.count) })),
      by_day: fillBy(
        dayKeys(scope.from, scope.to),
        dayRows.map((row) => ({
          date: row.date as string,
          visits: int(row.visits),
          people: int(row.people),
          denied: int(row.denied),
        })),
        (row) => row.date,
        (date) => ({ date, visits: 0, people: 0, denied: 0 }),
      ),
    };
  }

  private chargesFrom(sql: ReportSql, kind: 'rent' | 'deposit'): string {
    return `FROM hostel_charges c
       JOIN academic_years fy ON fy.id = c.academic_year_id AND ${yearClause('fy')}
       JOIN fee_invoices i ON i.id = c.invoice_id AND i.status <> 'cancelled'
       JOIN hostel_admissions a ON a.id = c.admission_id
       JOIN hostels h ON h.id = a.hostel_id
       WHERE c.school_id = $1 AND c.kind = '${kind}'${sql.hostel('a.hostel_id')}`;
  }

  async fees(schoolId: number, query: HostelReportQueryDto): Promise<FeesReportDto> {
    const scope = await this.scope(schoolId, query);
    const hostelSql = new ReportSql(scope);
    const depositSql = new ReportSql(scope);
    const topSql = new ReportSql(scope);
    const [hostelRows, [deposit], topRows, [year]] = await Promise.all([
      this.run(
        `SELECT h.id AS hostel_id, h.name AS hostel_name, COUNT(DISTINCT c.admission_id)::int AS residents_billed,
           COALESCE(SUM(i.total), 0)::float AS billed, COALESCE(SUM(i.paid), 0)::float AS collected,
           COALESCE(SUM(i.balance), 0)::float AS outstanding,
           COUNT(DISTINCT c.admission_id) FILTER (WHERE i.balance > 0)::int AS residents_with_dues
         ${this.chargesFrom(hostelSql, 'rent')}
         GROUP BY h.id ORDER BY h.name, h.id`,
        hostelSql,
      ),
      this.run(
        `SELECT COALESCE(SUM(i.total), 0)::float AS billed,
           COALESCE(SUM(i.paid) FILTER (WHERE c.settled_at IS NULL), 0)::float AS held,
           COUNT(*) FILTER (WHERE c.settled_at IS NULL AND i.paid > 0)::int AS held_count,
           COALESCE(SUM(i.paid) FILTER (WHERE c.settled_at IS NOT NULL), 0)::float AS settled,
           COUNT(*) FILTER (WHERE c.settled_at IS NOT NULL)::int AS settled_count,
           COALESCE(SUM(c.deduction_amount), 0)::float AS deductions,
           COALESCE(SUM(c.refund_amount), 0)::float AS refunded,
           COALESCE(SUM(i.balance), 0)::float AS unpaid
         ${this.chargesFrom(depositSql, 'deposit')}`,
        depositSql,
      ),
      this.run(
        `SELECT ${RESIDENT_COLUMNS}, a.status AS admission_status, x.billed, x.paid, x.balance
         FROM (
           SELECT c.admission_id, c.student_id, SUM(i.total)::float AS billed, SUM(i.paid)::float AS paid,
             SUM(i.balance)::float AS balance
           ${this.chargesFrom(topSql, 'rent')}
           GROUP BY c.admission_id, c.student_id
           HAVING SUM(i.balance) > 0
           ORDER BY balance DESC, c.admission_id
           LIMIT ${scope.top}
         ) x
         ${residentJoins()}
         ORDER BY x.balance DESC, x.admission_id`,
        topSql,
      ),
      this.dataSource.query(
        `SELECT fy.name FROM academic_years fy
         WHERE fy.school_id = $1 AND fy.deleted_at IS NULL AND ${yearClause('fy')} LIMIT 1`,
        [schoolId],
      ),
    ]);
    const hostels = hostelRows.map((row) => ({
      hostel_id: int(row.hostel_id),
      hostel_name: row.hostel_name as string,
      residents_billed: int(row.residents_billed),
      ...feesTotals(row),
    }));
    const sum = (key: 'billed' | 'collected' | 'outstanding' | 'residents_with_dues') =>
      hostels.reduce((total, row) => total + row[key], 0);
    return {
      academic_year: (year?.name as string | undefined) ?? null,
      totals: feesTotals({
        billed: sum('billed'),
        collected: sum('collected'),
        outstanding: sum('outstanding'),
        residents_with_dues: sum('residents_with_dues'),
      }),
      hostels,
      deposits: {
        billed: money(deposit?.billed),
        held: money(deposit?.held),
        held_count: int(deposit?.held_count),
        settled: money(deposit?.settled),
        settled_count: int(deposit?.settled_count),
        deductions: money(deposit?.deductions),
        refunded: money(deposit?.refunded),
        unpaid: money(deposit?.unpaid),
      },
      top_dues: topRows.map((row) => ({
        ...resident(row),
        admission_status: row.admission_status as string,
        billed: money(row.billed),
        paid: money(row.paid),
        balance: money(row.balance),
      })),
    };
  }

  private casesWhere(sql: ReportSql): string {
    return `dc.school_id = $1 AND dc.deleted_at IS NULL AND ${sql.localDates('dc.incident_at')}${sql.hostel('dc.hostel_id')}`;
  }

  async discipline(schoolId: number, query: HostelReportQueryDto): Promise<DisciplineReportDto> {
    const scope = await this.scope(schoolId, query);
    const groupSql = new ReportSql(scope);
    const daySql = new ReportSql(scope);
    const fineSql = new ReportSql(scope);
    const repeatSql = new ReportSql(scope);
    const [groupRows, dayRows, fineRows, repeatRows] = await Promise.all([
      this.run(
        `SELECT dc.category, dc.severity, dc.status, dc.action, COUNT(*)::int AS count
         FROM hostel_discipline_cases dc WHERE ${this.casesWhere(groupSql)}
         GROUP BY dc.category, dc.severity, dc.status, dc.action`,
        groupSql,
      ),
      this.run(
        `SELECT ${daySql.day('dc.incident_at')}::text AS date, COUNT(*)::int AS count
         FROM hostel_discipline_cases dc WHERE ${this.casesWhere(daySql)} AND dc.status <> 'withdrawn'
         GROUP BY 1 ORDER BY 1`,
        daySql,
      ),
      this.run(
        `SELECT COALESCE(ff.status, 'not_raised') AS key, COUNT(*)::int AS count,
           COALESCE(SUM(dc.fine_amount), 0)::float AS amount
         FROM hostel_discipline_cases dc
         LEFT JOIN fee_fines ff ON ff.id = dc.fee_fine_id
         WHERE ${this.casesWhere(fineSql)} AND dc.fine_amount IS NOT NULL
         GROUP BY 1 ORDER BY 1`,
        fineSql,
      ),
      this.run(
        `SELECT ${RESIDENT_COLUMNS}, x.cases, x.major_or_critical, x.last_incident_on, x.categories
         FROM (
           SELECT dc.admission_id, dc.student_id, COUNT(*)::int AS cases,
             COUNT(*) FILTER (WHERE dc.severity IN ('major', 'critical'))::int AS major_or_critical,
             MAX(${repeatSql.day('dc.incident_at')})::text AS last_incident_on,
             ARRAY_AGG(DISTINCT dc.category) AS categories
           FROM hostel_discipline_cases dc
           WHERE ${this.casesWhere(repeatSql)} AND dc.status <> 'withdrawn'
           GROUP BY dc.admission_id, dc.student_id
           HAVING COUNT(*) >= ${REPEAT_CASE_THRESHOLD}
           ORDER BY cases DESC, last_incident_on DESC, dc.admission_id
           LIMIT ${scope.top}
         ) x
         ${residentJoins()}
         ORDER BY x.cases DESC, x.last_incident_on DESC, x.admission_id`,
        repeatSql,
      ),
    ]);
    const rows = countRows(groupRows);
    const live = (row: Row) => row.status !== 'withdrawn';
    const byCategory = countsFor(
      DISCIPLINE_CATEGORIES,
      tally(rows, (row) => row.category as string, live),
    );
    const fines = fineRows.map((row) => ({ key: row.key as string, count: int(row.count), amount: money(row.amount) }));
    return {
      period: scope.period,
      total: sumCounts(byCategory),
      open: sumCounts(tally(rows, (row) => (row.status === 'open' ? 'open' : null))),
      by_category: byCategory,
      by_severity: countsFor(
        SEVERITIES,
        tally(rows, (row) => row.severity as string, live),
      ),
      by_status: countsFor(
        CASE_STATUSES,
        tally(rows, (row) => row.status as string),
      ),
      by_month: bucketByMonth(
        dayRows.map((row) => ({ date: row.date as string, count: int(row.count) })),
        scope.from,
        scope.to,
      ),
      actions: countsFor(
        DISCIPLINE_ACTIONS,
        tally(rows, (row) => (row.action as string | null) ?? null),
      ),
      fines: {
        count: fines.reduce((total, row) => total + row.count, 0),
        amount: round(fines.reduce((total, row) => total + row.amount, 0)),
        by_status: fines,
      },
      repeat_residents: repeatRows.map((row) => ({
        ...resident(row),
        cases: int(row.cases),
        major_or_critical: int(row.major_or_critical),
        last_incident_on: row.last_incident_on as string,
        categories: (row.categories as string[] | null) ?? [],
      })),
    };
  }

  async complaints(schoolId: number, query: HostelReportQueryDto): Promise<ComplaintsReportDto> {
    const scope = await this.scope(schoolId, query);
    const complaintWhere = (sql: ReportSql) =>
      `hc.school_id = $1 AND hc.deleted_at IS NULL AND ${sql.localDates('hc.created_at')}${sql.hostel('hc.hostel_id')}`;
    const ticketWhere = (sql: ReportSql) =>
      `mt.school_id = $1 AND mt.deleted_at IS NULL AND ${sql.localDates('mt.created_at')}${sql.hostel('mt.hostel_id')}`;
    const complaintGroupSql = new ReportSql(scope);
    const complaintStatsSql = new ReportSql(scope);
    const ticketGroupSql = new ReportSql(scope);
    const ticketStatsSql = new ReportSql(scope);
    const roomSql = new ReportSql(scope);
    const [complaintGroups, [complaintStats], ticketGroups, [ticketStats], [rooms]] = await Promise.all([
      this.run(
        `SELECT hc.category, hc.status, COUNT(*)::int AS count FROM hostel_complaints hc
         WHERE ${complaintWhere(complaintGroupSql)} GROUP BY hc.category, hc.status`,
        complaintGroupSql,
      ),
      this.run(
        `SELECT COUNT(*) FILTER (WHERE hc.resolved_at IS NOT NULL)::int AS resolved,
           COUNT(*) FILTER (WHERE hc.resolved_at IS NOT NULL AND hc.resolved_at <= hc.due_at)::int AS sla_met,
           AVG(EXTRACT(EPOCH FROM (hc.resolved_at - hc.created_at)) / 3600)
             FILTER (WHERE hc.resolved_at IS NOT NULL)::float AS average_hours,
           AVG(hc.rating)::float AS average_rating, COUNT(hc.rating)::int AS rated
         FROM hostel_complaints hc WHERE ${complaintWhere(complaintStatsSql)}`,
        complaintStatsSql,
      ),
      this.run(
        `SELECT mt.category, mt.status, COUNT(*)::int AS count FROM hostel_maintenance_tickets mt
         WHERE ${ticketWhere(ticketGroupSql)} GROUP BY mt.category, mt.status`,
        ticketGroupSql,
      ),
      this.run(
        `SELECT COALESCE(SUM(mt.cost), 0)::float AS total_cost,
           AVG(EXTRACT(EPOCH FROM (mt.completed_at - mt.created_at)) / 86400)
             FILTER (WHERE mt.status = 'done' AND mt.completed_at IS NOT NULL)::float AS average_days
         FROM hostel_maintenance_tickets mt WHERE ${ticketWhere(ticketStatsSql)}`,
        ticketStatsSql,
      ),
      this.run(
        `SELECT COUNT(*)::int AS blocked FROM hostel_rooms r
         WHERE r.school_id = $1 AND r.deleted_at IS NULL AND r.status = 'maintenance'${roomSql.hostel('r.hostel_id')}`,
        roomSql,
      ),
    ]);
    const complaintRows = countRows(complaintGroups);
    const ticketRows = countRows(ticketGroups);
    const complaintStatus = countsFor(
      COMPLAINT_STATES,
      tally(complaintRows, (row) => row.status as string),
    );
    const ticketStatus = countsFor(
      TICKET_STATES,
      tally(ticketRows, (row) => row.status as string),
    );
    const countOf = (rows: { key: string; count: number }[], keys: string[]) =>
      rows.filter((row) => keys.includes(row.key)).reduce((total, row) => total + row.count, 0);
    const resolved = int(complaintStats?.resolved);
    return {
      period: scope.period,
      complaints: {
        total: sumCounts(complaintStatus),
        open: countOf(complaintStatus, ['open', 'in_progress']),
        resolved,
        by_category: countsFor(
          COMPLAINT_CATEGORIES,
          tally(complaintRows, (row) => row.category as string),
        ),
        by_status: complaintStatus,
        average_resolution_hours: averageOf(complaintStats?.average_hours),
        sla_met_percent: percent(int(complaintStats?.sla_met), resolved),
        average_rating: averageOf(complaintStats?.average_rating),
        rated: int(complaintStats?.rated),
      },
      maintenance: {
        total: sumCounts(ticketStatus),
        open: countOf(ticketStatus, ['open', 'assigned', 'in_progress', 'on_hold']),
        done: countOf(ticketStatus, ['done']),
        by_category: countsFor(
          MAINTENANCE_CATEGORIES,
          tally(ticketRows, (row) => row.category as string),
        ),
        by_status: ticketStatus,
        total_cost: money(ticketStats?.total_cost),
        average_days_to_done: averageOf(ticketStats?.average_days),
        rooms_blocked_now: int(rooms?.blocked),
      },
    };
  }

  async mess(schoolId: number, query: HostelReportQueryDto): Promise<MessReportDto> {
    const scope = await this.scope(schoolId, query);
    const skipWhere = (sql: ReportSql) =>
      `k.school_id = $1 AND k.deleted_at IS NULL AND k.status <> 'cancelled'
       AND k.from_date <= ${sql.to} AND k.to_date >= ${sql.from}${sql.hostel('a.hostel_id')}`;
    const mealSql = new ReportSql(scope);
    const feedbackSql = new ReportSql(scope);
    const sourceSql = new ReportSql(scope);
    const skipMealSql = new ReportSql(scope);
    const [mealRows, feedbackRows, sourceRows, skipMealRows] = await Promise.all([
      this.run(
        `SELECT m.meal, COUNT(*) FILTER (WHERE m.status = 'ate')::int AS ate,
           COUNT(*) FILTER (WHERE m.status = 'skipped')::int AS skipped
         FROM hostel_meal_attendance m
         WHERE m.school_id = $1 AND ${mealSql.dates('m.meal_date')}${mealSql.hostel('m.hostel_id')}
         GROUP BY m.meal`,
        mealSql,
      ),
      this.run(
        `SELECT f.meal, COUNT(*)::int AS count, COALESCE(SUM(f.rating), 0)::int AS rating_sum
         FROM hostel_mess_feedback f
         WHERE f.school_id = $1 AND ${feedbackSql.dates('f.meal_date')}${feedbackSql.hostel('f.hostel_id')}
         GROUP BY f.meal`,
        feedbackSql,
      ),
      this.run(
        `SELECT k.source AS key, COUNT(*)::int AS count
         FROM hostel_meal_skips k JOIN hostel_admissions a ON a.id = k.admission_id
         WHERE ${skipWhere(sourceSql)} GROUP BY k.source`,
        sourceSql,
      ),
      this.run(
        `SELECT u.meal, COUNT(*)::int AS count
         FROM hostel_meal_skips k JOIN hostel_admissions a ON a.id = k.admission_id
         CROSS JOIN LATERAL unnest(k.meals) AS u(meal)
         WHERE ${skipWhere(skipMealSql)} GROUP BY u.meal`,
        skipMealSql,
      ),
    ]);
    const byMeal = <T>(rows: Row[], meal: string, read: (row: Row | undefined) => T) =>
      read(rows.find((row) => row.meal === meal));
    const meals = MEALS.map((meal) => {
      const ate = byMeal(mealRows, meal, (row) => int(row?.ate));
      const skipped = byMeal(mealRows, meal, (row) => int(row?.skipped));
      const feedbackCount = byMeal(feedbackRows, meal, (row) => int(row?.count));
      const ratingSum = byMeal(feedbackRows, meal, (row) => int(row?.rating_sum));
      return {
        meal,
        ate,
        skipped,
        ate_percent: percent(ate, ate + skipped),
        skip_requests: byMeal(skipMealRows, meal, (row) => int(row?.count)),
        feedback_count: feedbackCount,
        feedback_average: feedbackCount ? round(ratingSum / feedbackCount, 1) : null,
      };
    });
    const feedbackCount = feedbackRows.reduce((total, row) => total + int(row.count), 0);
    const ratingSum = feedbackRows.reduce((total, row) => total + int(row.rating_sum), 0);
    const bySource = countsFor(
      SKIP_SOURCES,
      sourceRows.map((row) => ({ key: row.key as string, count: int(row.count) })),
    );
    return {
      period: scope.period,
      meals,
      ate: meals.reduce((total, row) => total + row.ate, 0),
      skipped: meals.reduce((total, row) => total + row.skipped, 0),
      feedback_count: feedbackCount,
      feedback_average: feedbackCount ? round(ratingSum / feedbackCount, 1) : null,
      meal_skips: sumCounts(bySource),
      meal_skips_by_source: bySource,
    };
  }

  async health(schoolId: number, query: HostelReportQueryDto): Promise<HealthReportDto> {
    const scope = await this.scope(schoolId, query);
    const kindSql = new ReportSql(scope);
    const baySql = new ReportSql(scope);
    const nowSql = new ReportSql(scope);
    const doseSql = new ReportSql(scope);
    const [kindRows, [bay], [now], doseRows] = await Promise.all([
      this.run(
        `SELECT hl.kind AS key, COUNT(*)::int AS count, COUNT(*) FILTER (WHERE hl.hospital_visit)::int AS hospital
         FROM hostel_health_logs hl
         WHERE hl.school_id = $1 AND hl.deleted_at IS NULL AND ${kindSql.localDates('hl.logged_at')}${kindSql.hostel('hl.hostel_id')}
         GROUP BY hl.kind`,
        kindSql,
      ),
      this.run(
        `SELECT COUNT(*)::int AS admissions,
           AVG(EXTRACT(EPOCH FROM (hl.sick_bay_to - hl.sick_bay_from)) / 3600)
             FILTER (WHERE hl.sick_bay_to IS NOT NULL)::float AS average_hours
         FROM hostel_health_logs hl
         WHERE hl.school_id = $1 AND hl.deleted_at IS NULL AND hl.sick_bay_from IS NOT NULL
           AND ${baySql.localDates('hl.sick_bay_from')}${baySql.hostel('hl.hostel_id')}`,
        baySql,
      ),
      this.run(
        `SELECT COUNT(*)::int AS count FROM hostel_health_logs hl
         WHERE hl.school_id = $1 AND hl.deleted_at IS NULL AND ${IN_SICK_BAY}${nowSql.hostel('hl.hostel_id')}`,
        nowSql,
      ),
      this.run(
        `SELECT d.status AS key, COUNT(*)::int AS count
         FROM hostel_medication_doses d JOIN hostel_admissions a ON a.id = d.admission_id
         WHERE d.school_id = $1 AND ${doseSql.dates('d.dose_date')}${doseSql.hostel('a.hostel_id')}
         GROUP BY d.status`,
        doseSql,
      ),
    ]);
    const byKind = countsFor(
      HEALTH_KINDS,
      kindRows.map((row) => ({ key: row.key as string, count: int(row.count) })),
    );
    const doses = countsFor(
      DOSE_STATUSES,
      doseRows.map((row) => ({ key: row.key as string, count: int(row.count) })),
    );
    const dose = (status: string) => doses.find((row) => row.key === status)?.count ?? 0;
    return {
      period: scope.period,
      total_logs: sumCounts(byKind),
      by_kind: byKind,
      hospital_visits: kindRows.reduce((total, row) => total + int(row.hospital), 0),
      sick_bay_admissions: int(bay?.admissions),
      average_sick_bay_hours: averageOf(bay?.average_hours),
      sick_bay_now: int(now?.count),
      doses: {
        given: dose('given'),
        missed: dose('missed'),
        refused: dose('refused'),
        given_percent: percent(dose('given'), sumCounts(doses)),
      },
    };
  }

  async summary(schoolId: number, query: HostelReportQueryDto): Promise<SummaryReportDto> {
    const scope = await this.scope(schoolId, query);
    const sql = new ReportSql(scope);
    const [row] = await this.run(
      `WITH beds AS (
         SELECT COUNT(bd.id)::int AS beds, COUNT(bd.id) FILTER (WHERE bd.status = 'occupied')::int AS occupied_beds
         FROM hostel_beds bd
         JOIN hostel_rooms r ON r.id = bd.room_id AND r.deleted_at IS NULL
         JOIN hostels h ON h.id = bd.hostel_id AND h.deleted_at IS NULL
         WHERE bd.school_id = $1 AND bd.deleted_at IS NULL${sql.hostel('bd.hostel_id')}
       ), roll AS (
         SELECT COUNT(*) FILTER (WHERE r.status IN ('present', 'late'))::int AS attended,
           COUNT(*) FILTER (WHERE r.status IN ('present', 'late', 'absent'))::int AS expected
         ${this.rollFrom(sql)}
       ), leaves AS (
         SELECT COUNT(*)::int AS open_leaves, COUNT(*) FILTER (WHERE l.status = 'out')::int AS out_now
         FROM hostel_leaves l
         WHERE l.school_id = $1 AND l.deleted_at IS NULL AND l.status IN (${OPEN_LEAVES})${sql.hostel('l.hostel_id')}
       ), fees AS (
         SELECT COALESCE(SUM(i.balance), 0)::float AS outstanding_fees,
           COUNT(DISTINCT c.admission_id) FILTER (WHERE i.balance > 0)::int AS residents_with_dues
         ${this.chargesFrom(sql, 'rent')}
       )
       SELECT beds.*, roll.*, leaves.*, fees.*,
         (SELECT COUNT(*) FROM hostel_admissions a
           WHERE a.school_id = $1 AND a.deleted_at IS NULL AND a.status <> 'checked_out'${sql.hostel('a.hostel_id')})::int AS residents,
         (SELECT COUNT(*) FROM hostel_leaves l
           WHERE l.school_id = $1 AND l.deleted_at IS NULL AND l.late_minutes > 0 AND l.returned_at IS NOT NULL
             AND ${sql.localDates('l.returned_at')}${sql.hostel('l.hostel_id')})::int AS late_returns,
         (SELECT COUNT(*) FROM hostel_complaints hc
           WHERE hc.school_id = $1 AND hc.deleted_at IS NULL AND hc.status IN (${OPEN_COMPLAINTS})${sql.hostel('hc.hostel_id')})::int AS open_complaints,
         (SELECT COUNT(*) FROM hostel_maintenance_tickets mt
           WHERE mt.school_id = $1 AND mt.deleted_at IS NULL AND mt.status NOT IN (${CLOSED_TICKETS})${sql.hostel('mt.hostel_id')})::int AS open_tickets,
         (SELECT COUNT(*) FROM hostel_discipline_cases dc
           WHERE ${this.casesWhere(sql)} AND dc.status <> 'withdrawn')::int AS discipline_cases,
         (SELECT COUNT(*) FROM hostel_health_logs hl
           WHERE hl.school_id = $1 AND hl.deleted_at IS NULL AND ${IN_SICK_BAY}${sql.hostel('hl.hostel_id')})::int AS sick_bay_now,
         (SELECT COUNT(*) FROM hostel_visits v
           WHERE v.school_id = $1 AND v.status = 'inside'${sql.hostel('v.hostel_id')})::int AS visitors_inside
       FROM beds, roll, leaves, fees`,
      sql,
    );
    return {
      period: scope.period,
      residents: int(row?.residents),
      beds: int(row?.beds),
      occupied_beds: int(row?.occupied_beds),
      occupancy_percent: percent(int(row?.occupied_beds), int(row?.beds)),
      attendance_percent: percent(int(row?.attended), int(row?.expected)),
      open_leaves: int(row?.open_leaves),
      out_now: int(row?.out_now),
      late_returns: int(row?.late_returns),
      outstanding_fees: money(row?.outstanding_fees),
      residents_with_dues: int(row?.residents_with_dues),
      open_complaints: int(row?.open_complaints),
      open_tickets: int(row?.open_tickets),
      discipline_cases: int(row?.discipline_cases),
      sick_bay_now: int(row?.sick_bay_now),
      visitors_inside: int(row?.visitors_inside),
    };
  }
}
