import { Injectable, StreamableFile } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import { DataSource, Repository } from 'typeorm';
import { listQuery, Paginated } from '@app/common';
import { yearClause } from '../../shared/year-context';
import {
  EventQueryDto,
  GateEventDto,
  GateReportDto,
  GateTodayDto,
  PassQueryDto,
  RangeDto,
  VisitQueryDto,
} from './dto/gate.dto';
import { GateEvent, GatePass } from './entities/gate.entity';
import { GateCoreService } from './gate-core.service';
import { GatePassesService } from './gate-passes.service';
import { GateVisitsService, PURPOSE_LABELS } from './gate-visits.service';

export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const METHOD_LABELS: Record<string, string> = { qr: 'QR scan', code: '4-digit code', manual: 'Checked by hand' };

@Injectable()
export class GateBoardService {
  constructor(
    @InjectRepository(GatePass) private readonly passes: Repository<GatePass>,
    @InjectRepository(GateEvent) private readonly eventRows: Repository<GateEvent>,
    private readonly core: GateCoreService,
    private readonly passService: GatePassesService,
    private readonly visits: GateVisitsService,
    private readonly dataSource: DataSource,
  ) {}

  async today(schoolId: number): Promise<GateTodayDto> {
    const today = this.core.today();
    const [due, emergencies, visitors, [counts], recent] = await Promise.all([
      this.passes.find({
        where: { school_id: schoolId, pass_date: today, status: 'approved' },
        order: { from_time: 'ASC' },
      }),
      this.passes.find({ where: { school_id: schoolId, is_emergency: true, status: 'pending' }, order: { id: 'ASC' } }),
      this.visits.today(schoolId),
      this.dataSource.query(
        `SELECT
           (SELECT COUNT(*) FROM gate_passes WHERE school_id = $1 AND deleted_at IS NULL AND pass_date = $2 AND status = 'approved')::int AS waiting_release,
           (SELECT COUNT(*) FROM gate_passes WHERE school_id = $1 AND deleted_at IS NULL AND status = 'released' AND (released_at AT TIME ZONE $3)::date = $2)::int AS released_today,
           (SELECT COUNT(*) FROM gate_passes WHERE school_id = $1 AND deleted_at IS NULL AND status = 'pending')::int AS pending_approvals,
           (SELECT COUNT(*) FROM gate_passes WHERE school_id = $1 AND deleted_at IS NULL AND status = 'pending' AND is_emergency = true)::int AS emergencies_waiting,
           (SELECT COUNT(*) FROM gate_passes WHERE school_id = $1 AND deleted_at IS NULL AND release_method = 'manual' AND (released_at AT TIME ZONE $3)::date = $2)::int AS manual_today,
           (SELECT COUNT(*) FROM gate_visits WHERE school_id = $1 AND deleted_at IS NULL AND status = 'inside')::int AS visitors_inside,
           (SELECT COUNT(*) FROM gate_visits WHERE school_id = $1 AND deleted_at IS NULL AND visit_date = $2 AND status = 'expected')::int AS visitors_expected,
           (SELECT COUNT(*) FROM gate_visits WHERE school_id = $1 AND deleted_at IS NULL AND status = 'waiting')::int AS visitors_waiting,
           (SELECT COUNT(*) FROM gate_visits WHERE school_id = $1 AND deleted_at IS NULL AND status = 'inside' AND overstay_alerted_at IS NOT NULL)::int AS overstays,
           (SELECT COUNT(*) FROM gate_events WHERE school_id = $1 AND kind = 'blocked_person' AND (created_at AT TIME ZONE $3)::date = $2)::int AS blocked_today`,
        [schoolId, today, this.core.timeZone],
      ),
      this.eventRows.find({ where: { school_id: schoolId }, order: { id: 'DESC' }, take: 20 }),
    ]);
    return {
      date: today,
      counts,
      due: await this.core.presentPasses(schoolId, due, false),
      emergencies: await this.core.presentPasses(schoolId, emergencies, false),
      inside: visitors.inside,
      coming: visitors.coming,
      recent: await this.core.presentEvents(recent),
    };
  }

  async events(schoolId: number, query: EventQueryDto): Promise<Paginated<GateEventDto>> {
    const qb = this.eventRows
      .createQueryBuilder('e')
      .leftJoin('users', 'u', 'u.id = e.actor_id')
      .where('e.school_id = :schoolId', { schoolId });
    if (query.kind) qb.andWhere('e.kind = :kind', { kind: query.kind });
    if (query.pass_id) qb.andWhere('e.pass_id = :passId', { passId: query.pass_id });
    if (query.visit_id) qb.andWhere('e.visit_id = :visitId', { visitId: query.visit_id });
    if (query.from)
      qb.andWhere(`(e.created_at AT TIME ZONE :tz)::date >= :from`, { tz: this.core.timeZone, from: query.from });
    if (query.to) qb.andWhere(`(e.created_at AT TIME ZONE :tz)::date <= :to`, { tz: this.core.timeZone, to: query.to });
    const page = await listQuery(qb, query, {
      searchable: ['e.note', 'e.kind', 'u.name'],
      sortable: { created_at: 'e.created_at' },
      defaultSort: 'created_at',
    });
    return { ...page, items: await this.core.presentEvents(page.items) };
  }

  async report(schoolId: number, query: RangeDto): Promise<GateReportDto> {
    const { from, to } = await this.range(schoolId, query);
    const params = [schoolId, from, to, this.core.timeZone];
    const [days, classes, methods, purposes, hours] = await Promise.all([
      this.dataSource.query(
        `SELECT to_char(d, 'YYYY-MM-DD') AS date,
           (SELECT COUNT(*) FROM gate_passes p WHERE p.school_id = $1 AND p.deleted_at IS NULL AND p.pass_date = d::date)::int AS requested,
           (SELECT COUNT(*) FROM gate_passes p WHERE p.school_id = $1 AND p.deleted_at IS NULL AND p.status = 'released' AND (p.released_at AT TIME ZONE $4)::date = d::date)::int AS released,
           (SELECT COUNT(*) FROM gate_passes p WHERE p.school_id = $1 AND p.deleted_at IS NULL AND p.is_emergency AND p.pass_date = d::date)::int AS emergencies,
           (SELECT COUNT(*) FROM gate_passes p WHERE p.school_id = $1 AND p.deleted_at IS NULL AND p.release_method = 'manual' AND (p.released_at AT TIME ZONE $4)::date = d::date)::int AS manual,
           (SELECT COUNT(*) FROM gate_passes p WHERE p.school_id = $1 AND p.deleted_at IS NULL AND p.status = 'rejected' AND p.pass_date = d::date)::int AS rejected,
           (SELECT COUNT(*) FROM gate_passes p WHERE p.school_id = $1 AND p.deleted_at IS NULL AND p.status = 'expired' AND p.pass_date = d::date)::int AS expired,
           (SELECT COUNT(*) FROM gate_visits v WHERE v.school_id = $1 AND v.deleted_at IS NULL AND v.checked_in_at IS NOT NULL AND (v.checked_in_at AT TIME ZONE $4)::date = d::date)::int AS visitors
         FROM generate_series($2::date, $3::date, interval '1 day') d ORDER BY d DESC`,
        params,
      ),
      this.dataSource.query(
        `SELECT COALESCE(c.name || COALESCE(' - ' || sec.name, ''), 'No class') AS key, COUNT(*)::int AS count
         FROM gate_passes p
         LEFT JOIN academic_years ay ON ay.school_id = p.school_id AND ay.deleted_at IS NULL AND ${yearClause('ay')}
         LEFT JOIN student_enrollments e ON e.student_id = p.student_id AND e.academic_year_id = ay.id
         LEFT JOIN classes c ON c.id = e.class_id LEFT JOIN sections sec ON sec.id = e.section_id
         WHERE p.school_id = $1 AND p.deleted_at IS NULL AND p.status = 'released'
           AND (p.released_at AT TIME ZONE $4)::date BETWEEN $2 AND $3
         GROUP BY 1 ORDER BY 2 DESC`,
        params,
      ),
      this.dataSource.query(
        `SELECT release_method AS key, COUNT(*)::int AS count FROM gate_passes
         WHERE school_id = $1 AND deleted_at IS NULL AND status = 'released' AND (released_at AT TIME ZONE $4)::date BETWEEN $2 AND $3
         GROUP BY 1 ORDER BY 2 DESC`,
        params,
      ),
      this.dataSource.query(
        `SELECT purpose AS key, COUNT(*)::int AS count FROM gate_visits
         WHERE school_id = $1 AND deleted_at IS NULL AND visit_date BETWEEN $2 AND $3
         GROUP BY 1 ORDER BY 2 DESC`,
        [schoolId, from, to],
      ),
      this.dataSource.query(
        `SELECT to_char(checked_in_at AT TIME ZONE $4, 'HH24') AS key, COUNT(*)::int AS count FROM gate_visits
         WHERE school_id = $1 AND deleted_at IS NULL AND checked_in_at IS NOT NULL AND (checked_in_at AT TIME ZONE $4)::date BETWEEN $2 AND $3
         GROUP BY 1 ORDER BY 1`,
        params,
      ),
    ]);
    const rows = (list: { key: string; count: number }[], label: (key: string) => string) =>
      list.map((row) => ({ key: row.key, label: label(row.key), count: Number(row.count) }));
    return {
      from,
      to,
      by_day: days,
      by_class: rows(classes, (key) => key),
      by_method: rows(methods, (key) => METHOD_LABELS[key] ?? key),
      by_purpose: rows(purposes, (key) => PURPOSE_LABELS[key] ?? key),
      by_hour: rows(hours, (key) => `${key}:00`),
    };
  }

  async passesFile(schoolId: number, query: PassQueryDto): Promise<StreamableFile> {
    const page = await this.passService.list(schoolId, Object.assign(query, { page: 1, limit: 5000 }));
    return this.workbook(
      'gate-passes',
      'Gate passes',
      [
        'Pass no',
        'Date',
        'Student',
        'Class',
        'From',
        'Until',
        'Reason',
        'Picked up by',
        'Relation',
        'Status',
        'Emergency',
        'Requested by',
        'Approved by',
        'Released at',
        'Checked by',
        'Released by',
      ],
      page.items.map((row) => [
        row.pass_no,
        row.pass_date,
        row.student.name,
        row.student.class_section ?? '',
        row.from_time,
        row.until_time,
        row.reason,
        row.pickup.name,
        row.pickup.relation ?? '',
        row.status,
        row.is_emergency ? 'Yes' : '',
        row.requested_by?.name ?? '',
        row.decided_by?.name ?? '',
        row.released_at ? new Date(row.released_at).toLocaleString('en-IN', { timeZone: this.core.timeZone }) : '',
        row.release_method ? (METHOD_LABELS[row.release_method] ?? row.release_method) : '',
        row.released_by?.name ?? '',
      ]),
    );
  }

  async visitsFile(schoolId: number, query: VisitQueryDto): Promise<StreamableFile> {
    const page = await this.visits.list(schoolId, Object.assign(query, { page: 1, limit: 5000 }));
    const time = (value: Date | null) =>
      value
        ? new Date(value).toLocaleTimeString('en-IN', {
            timeZone: this.core.timeZone,
            hour: '2-digit',
            minute: '2-digit',
          })
        : '';
    return this.workbook(
      'visitors',
      'Visitors',
      [
        'Visit no',
        'Date',
        'Name',
        'Mobile',
        'Purpose',
        'Company',
        'People',
        'To meet',
        'Status',
        'In',
        'Out',
        'Vehicle',
      ],
      page.items.map((row) => [
        row.visit_no,
        row.visit_date,
        row.name,
        row.mobile,
        PURPOSE_LABELS[row.purpose] ?? row.purpose,
        row.company ?? '',
        row.people_count,
        row.host?.name ?? 'Office',
        row.status,
        time(row.checked_in_at),
        time(row.checked_out_at),
        row.vehicle_no ?? '',
      ]),
    );
  }

  private async range(schoolId: number, query: RangeDto): Promise<{ from: string; to: string }> {
    const today = this.core.today();
    const monthAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
    return { from: query.from ?? monthAgo, to: query.to ?? today };
  }

  private async workbook(
    name: string,
    title: string,
    headers: string[],
    rows: (string | number)[][],
  ): Promise<StreamableFile> {
    const book = new ExcelJS.Workbook();
    const ws = book.addWorksheet(title);
    ws.addRow([title]).font = { bold: true, size: 14 };
    ws.addRow([`Downloaded on ${this.core.today()}`]).font = { color: { argb: 'FF5A6A62' } };
    ws.addRow([]);
    const head = ws.addRow(headers);
    head.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF159053' } };
    });
    ws.views = [{ state: 'frozen', ySplit: 4 }];
    for (const row of rows) ws.addRow(row);
    headers.forEach((header, index) => (ws.getColumn(index + 1).width = Math.max(10, Math.min(30, header.length + 8))));
    const buffer = Buffer.from(await book.xlsx.writeBuffer());
    return new StreamableFile(buffer, {
      type: XLSX,
      length: buffer.length,
      disposition: `attachment; filename="${name}-${this.core.today()}.xlsx"`,
    });
  }
}
