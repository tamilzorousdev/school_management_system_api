import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { awayLookup } from '../../shared/student-away';
import { vehicleOnDay } from '../transport/bus-swaps';
import { StudentsTodayDto, TodayRiderDto } from './dto/driver-ops.dto';
import { studentsTodaySummary } from './driver-ops.logic';

interface RiderRow {
  student_id: number;
  first_name: string;
  last_name: string | null;
  admission_no: string | null;
  class_name: string | null;
  section_name: string | null;
  route_id: number;
  route_name: string;
  route_vehicle_id: number | null;
  stop_name: string | null;
  pass_status: string;
  pass_note: string | null;
  hold_kind: string | null;
}

interface PassRow {
  student_id: number;
  status: 'approved' | 'released';
  pickup_name: string | null;
  pickup_relation: string | null;
  reason: string;
  released_at: Date | null;
}

@Injectable()
export class StudentsTodayService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async today(schoolId: number, date?: string): Promise<StudentsTodayDto> {
    const day = date ?? todayIn(this.app.timeZone);
    const riders = await this.riders(schoolId);
    const ids = riders.map((row) => row.student_id);
    const [away, passes, buses] = await Promise.all([
      awayLookup(this.dataSource, ids, [day]),
      this.earlyLeavePasses(ids, day),
      this.busNames(schoolId, riders, day),
    ]);

    const base = (row: RiderRow): TodayRiderDto => ({
      student: { id: row.student_id, name: [row.first_name, row.last_name].filter(Boolean).join(' ') },
      admission_no: row.admission_no,
      class_section: row.class_name ? [row.class_name, row.section_name].filter(Boolean).join(' - ') : null,
      route: { id: row.route_id, name: row.route_name },
      bus: buses.get(row.route_id) ?? null,
      stop: row.stop_name,
    });

    const awayRows = riders
      .map((row) => ({ row, pickup: away(row.student_id, day, 'pickup'), drop: away(row.student_id, day, 'drop') }))
      .filter((item) => item.pickup || item.drop);
    const byStudent = new Map(riders.map((row) => [row.student_id, row]));
    const earlyLeaves = passes
      .filter((pass) => byStudent.has(pass.student_id))
      .map((pass) => ({
        ...base(byStudent.get(pass.student_id)!),
        status: pass.status,
        pickup_name: pass.pickup_name,
        pickup_relation: pass.pickup_relation,
        reason: pass.reason,
        released_at: pass.released_at,
      }));
    const onHold = riders
      .filter((row) => row.pass_status === 'on_hold')
      .map((row) => ({ ...base(row), hold_kind: row.hold_kind, pass_note: row.pass_note }));

    return {
      date: day,
      summary: studentsTodaySummary({
        riders: riders.length,
        away: awayRows.map((item) => ({ pickup: Boolean(item.pickup), drop: Boolean(item.drop) })),
        earlyLeaves: earlyLeaves.map((item) => item.status),
        onHold: onHold.length,
      }),
      early_leaves: earlyLeaves,
      away: awayRows.map((item) => ({ ...base(item.row), pickup: item.pickup, drop: item.drop })),
      on_hold: onHold,
    };
  }

  private async riders(schoolId: number): Promise<RiderRow[]> {
    const rows: RiderRow[] = await this.dataSource.query(
      `SELECT t.student_id, s.first_name, s.last_name, s.admission_no, c.name AS class_name, sec.name AS section_name,
              t.route_id, r.name AS route_name, r.vehicle_id AS route_vehicle_id, st.name AS stop_name,
              t.pass_status, t.pass_note, t.hold_kind
       FROM student_transport t
       JOIN transport_routes r ON r.id = t.route_id
       JOIN students s ON s.id = t.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       LEFT JOIN route_stops st ON st.id = t.stop_id
       LEFT JOIN student_enrollments e ON e.student_id = s.id
         AND e.academic_year_id = (SELECT id FROM academic_years y WHERE y.school_id = s.school_id AND y.is_current LIMIT 1)
       LEFT JOIN sections sec ON sec.id = e.section_id
       LEFT JOIN classes c ON c.id = e.class_id
       WHERE t.school_id = $1 AND t.deleted_at IS NULL
       ORDER BY r.name, c.name NULLS LAST, s.first_name`,
      [schoolId],
    );
    return rows.map((row) => ({
      ...row,
      student_id: Number(row.student_id),
      route_id: Number(row.route_id),
      route_vehicle_id: row.route_vehicle_id === null ? null : Number(row.route_vehicle_id),
    }));
  }

  private async earlyLeavePasses(studentIds: number[], day: string): Promise<PassRow[]> {
    if (!studentIds.length) return [];
    const rows: PassRow[] = await this.dataSource.query(
      `SELECT DISTINCT ON (student_id) student_id, status, pickup_name, pickup_relation, reason, released_at
       FROM gate_passes
       WHERE student_id = ANY($1) AND pass_date = $2 AND status IN ('approved', 'released') AND deleted_at IS NULL
       ORDER BY student_id, (status = 'released') DESC, released_at DESC NULLS LAST, id DESC`,
      [studentIds, day],
    );
    return rows.map((row) => ({ ...row, student_id: Number(row.student_id) }));
  }

  private async busNames(schoolId: number, riders: RiderRow[], day: string) {
    const routes = new Map<number, number | null>();
    for (const row of riders) routes.set(row.route_id, row.route_vehicle_id);
    const vehicleByRoute = new Map<number, number | null>();
    for (const [id, vehicleId] of routes) {
      vehicleByRoute.set(id, await vehicleOnDay(this.dataSource, { id, vehicle_id: vehicleId }, day));
    }
    const vehicleIds = [...new Set([...vehicleByRoute.values()].filter((id): id is number => id !== null))];
    const vehicles: { id: number; name: string; registration_no: string }[] = vehicleIds.length
      ? await this.dataSource.query(
          `SELECT id, name, registration_no FROM vehicles WHERE school_id = $1 AND id = ANY($2)`,
          [schoolId, vehicleIds],
        )
      : [];
    const names = new Map(vehicles.map((v) => [Number(v.id), `${v.name} · ${v.registration_no}`]));
    const result = new Map<number, { id: number; name: string }>();
    for (const [routeId, vehicleId] of vehicleByRoute) {
      if (vehicleId !== null && names.has(vehicleId))
        result.set(routeId, { id: vehicleId, name: names.get(vehicleId)! });
    }
    return result;
  }
}
