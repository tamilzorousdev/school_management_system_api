import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Paginated, paginate } from '@app/common';
import { monthStartIn } from '../../shared/dates';
import { yearClause } from '../../shared/year-context';
import { VehicleExpiryKind } from '../transport/entities/expiry-alert.entity';
import { VEHICLE_EXPIRY_FIELDS } from '../transport/entities/vehicle-document.entity';
import { BusRefDto } from './dto/fleet-ops.dto';
import {
  CostRowDto,
  DueReportDto,
  FleetInsightsDto,
  IdleRowDto,
  MileageRowDto,
  ReimbursementRowDto,
  ReportRangeDto,
  SpendQueryDto,
  SpendRowDto,
  VehicleLogEntryDto,
  VehicleLogQueryDto,
  VehicleSummaryDto,
} from './dto/fleet-maintenance.dto';
import { FleetBooksService } from './fleet-books.service';
import { FuelService } from './fuel.service';
import { costPerKm, daysBetween, fillEconomy, idleLitres, mileageDropped } from './maintenance-plan.logic';
import { CATEGORY_LABELS, MaintenanceSchedulesService } from './maintenance-schedules.service';
import { MaintenanceService } from './maintenance.service';

export interface Range {
  from: string;
  to: string;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

const EXPENSE_LABELS: Record<string, string> = {
  tyres: 'Tyres',
  insurance: 'Insurance',
  fitness: 'Fitness certificate',
  permit: 'Permit',
  puc: 'PUC',
  road_tax: 'Road tax',
  rc: 'RC',
  speed_governor: 'Speed governor',
  fire_extinguisher: 'Fire extinguisher',
  first_aid: 'First aid',
  fine: 'Fine',
  toll: 'Toll',
  parking: 'Parking',
  cleaning: 'Cleaning',
  other: 'Other',
  fuel: 'Fuel',
};

export function months(range: Range): string[] {
  const result: string[] = [];
  let cursor = `${range.from.slice(0, 7)}-01`;
  while (cursor.slice(0, 7) <= range.to.slice(0, 7)) {
    result.push(cursor.slice(0, 7));
    const [year, month] = cursor.split('-').map(Number) as [number, number];
    cursor = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  }
  return result;
}

@Injectable()
export class FleetReportsService {
  constructor(
    private readonly books: FleetBooksService,
    private readonly schedules: MaintenanceSchedulesService,
    private readonly maintenance: MaintenanceService,
    private readonly fuel: FuelService,
    private readonly dataSource: DataSource,
  ) {}

  async range(schoolId: number, query: { from?: string; to?: string }): Promise<Range> {
    if (query.from && query.to) return { from: query.from, to: query.to };
    const [year] = await this.dataSource.query(
      `SELECT to_char(ay.start_date, 'YYYY-MM-DD') AS start, to_char(ay.end_date, 'YYYY-MM-DD') AS finish
       FROM academic_years ay WHERE ay.school_id = $1 AND ay.deleted_at IS NULL AND ${yearClause('ay')}`,
      [schoolId],
    );
    const today = this.books.today();
    const fallbackFrom = `${Number(today.slice(0, 4)) - 1}${today.slice(4, 8)}01`;
    return {
      from: query.from ?? year?.start ?? fallbackFrom,
      to: query.to ?? (year?.finish && year.finish < today ? year.finish : today),
    };
  }

  async summary(schoolId: number, vehicleId: number): Promise<VehicleSummaryDto> {
    const vehicle = await this.books.bus(schoolId, vehicleId);
    const month = this.books.today().slice(0, 7);
    const [km, spent, [fuelMonth], services, openTickets, offRoad, kmpl] = await Promise.all([
      this.books.currentKm([vehicle.id]),
      this.books.spentInMonth(schoolId, [vehicle.id], month),
      this.dataSource.query(
        `SELECT COALESCE(SUM(amount), 0)::float AS amount FROM fuel_logs
         WHERE school_id = $1 AND vehicle_id = $2 AND deleted_at IS NULL AND status = 'approved' AND filled_on >= $3`,
        [schoolId, vehicle.id, `${month}-01`],
      ),
      this.schedules.forBuses(schoolId, [vehicle.id]),
      this.maintenance.openCount(schoolId, vehicle.id),
      this.maintenance.isOffRoad(schoolId, vehicle.id),
      this.monthKmPerLitre(schoolId, vehicle.id, month),
    ]);
    const current = km.get(vehicle.id) ?? { km: null, source: 'none' as const };
    return {
      vehicle: { id: vehicle.id, registration_no: vehicle.registration_no, name: vehicle.name },
      current_km: current.km,
      odometer_source: current.source,
      tank_litres: vehicle.tank_litres,
      monthly_budget: vehicle.monthly_budget,
      spent_this_month: spent.get(vehicle.id) ?? 0,
      fuel_this_month: round2(Number(fuelMonth?.amount ?? 0)),
      km_per_litre_this_month: kmpl,
      next_service: services[0] ?? null,
      open_tickets: openTickets,
      off_road: offRoad,
    };
  }

  async log(schoolId: number, vehicleId: number, query: VehicleLogQueryDto): Promise<Paginated<VehicleLogEntryDto>> {
    await this.books.bus(schoolId, vehicleId);
    const params: unknown[] = [schoolId, vehicleId, this.books.timeZone];
    const where: string[] = [];
    if (query.type) where.push(`type = $${params.push(query.type)}`);
    if (query.from) where.push(`"on" >= $${params.push(query.from)}`);
    if (query.to) where.push(`"on" <= $${params.push(query.to)}`);
    for (const word of (query.search ?? '').split(/\s+/).filter(Boolean)) {
      where.push(
        `(title ILIKE $${params.push(`%${word.replace(/[\\%_]/g, (match) => `\\${match}`)}%`)} OR COALESCE(detail, '') ILIKE $${params.length})`,
      );
    }
    const union = `
      SELECT 'fuel' AS type, f.id, to_char(f.filled_on, 'YYYY-MM-DD') AS "on",
             'Fuel ' || trim(to_char(f.litres, 'FM999990.00')) || ' L' || COALESCE(' at ' || f.station, '') AS title,
             'Odometer ' || trim(to_char(f.odometer_km, 'FM9999990.0')) || ' km · ' || CASE WHEN f.is_full THEN 'full tank' ELSE 'part fill' END
               || ' · ' || replace(f.payment_mode, '_', ' ') AS detail,
             f.amount::float AS amount, f.status::text AS status, f.odometer_km::float AS odometer_km, f.created_at
      FROM fuel_logs f WHERE f.school_id = $1 AND f.vehicle_id = $2 AND f.deleted_at IS NULL
      UNION ALL
      SELECT t.kind, t.id, to_char((COALESCE(t.closed_at, t.opened_at) AT TIME ZONE $3)::date, 'YYYY-MM-DD'),
             t.title,
             NULLIF(concat_ws(' · ', t.vendor, CASE WHEN t.off_road AND t.status <> 'done' THEN 'off the road' END,
               CASE WHEN t.source = 'driver' THEN 'reported by the crew' WHEN t.source = 'obd' THEN 'engine fault code' END), ''),
             t.cost::float, t.status::text, t.odometer_km::float, t.created_at
      FROM maintenance_tickets t WHERE t.school_id = $1 AND t.vehicle_id = $2 AND t.deleted_at IS NULL
      UNION ALL
      SELECT 'expense', e.id, to_char(e.spent_on, 'YYYY-MM-DD'),
             initcap(replace(e.category, '_', ' ')) || COALESCE(' – ' || e.paid_to, ''),
             NULLIF(concat_ws(' · ', CASE WHEN e.renewed_until IS NOT NULL THEN 'valid until ' || to_char(e.renewed_until, 'DD Mon YYYY') END, e.note), ''),
             e.amount::float, CASE WHEN e.payment_mode = 'driver_paid' AND e.reimbursed_at IS NULL THEN 'to pay back' END,
             NULL::float, e.created_at
      FROM vehicle_expenses e WHERE e.school_id = $1 AND e.vehicle_id = $2 AND e.deleted_at IS NULL
      UNION ALL
      SELECT 'check', c.id, to_char(c.check_date, 'YYYY-MM-DD'),
             CASE WHEN c.failed_count = 0 THEN 'Pre-trip check: all OK' ELSE 'Pre-trip check: ' || c.failed_count || ' not OK' END,
             CASE WHEN c.cleared_at IS NOT NULL THEN 'Cleared: ' || c.clear_note END,
             NULL::float,
             CASE WHEN c.critical_failed AND c.cleared_at IS NULL THEN 'blocked' WHEN c.critical_failed THEN 'cleared'
                  WHEN c.failed_count > 0 THEN 'failed' ELSE 'ok' END,
             c.odometer_km::float, c.created_at
      FROM pre_trip_checks c WHERE c.school_id = $1 AND c.vehicle_id = $2 AND c.deleted_at IS NULL`;
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ total }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM (${union}) log ${filter}`,
      params,
    );
    const rows: VehicleLogEntryDto[] = await this.dataSource.query(
      `SELECT type, id, "on", title, detail, amount, status, odometer_km FROM (${union}) log ${filter}
       ORDER BY "on" ${query.order === 'asc' ? 'ASC' : 'DESC'}, created_at ${query.order === 'asc' ? 'ASC' : 'DESC'}
       LIMIT $${params.push(query.limit)} OFFSET $${params.push((query.page - 1) * query.limit)}`,
      params,
    );
    return paginate(
      [
        rows.map((row) => ({
          ...row,
          id: Number(row.id),
          amount: row.amount === null ? null : round2(Number(row.amount)),
        })),
        total,
      ],
      query.page,
      query.limit,
    );
  }

  async costs(schoolId: number, query: ReportRangeDto): Promise<CostRowDto[]> {
    const range = await this.range(schoolId, query);
    const params: unknown[] = [schoolId, range.from, range.to, this.books.timeZone];
    const bus = query.vehicle_id ? `AND vehicle_id = $${params.push(query.vehicle_id)}` : '';
    const spend: { vehicle_id: number; month: string; kind: string; amount: number }[] = await this.dataSource.query(
      `SELECT vehicle_id, month, kind, SUM(amount)::float AS amount FROM (
         SELECT vehicle_id, to_char(filled_on, 'YYYY-MM') AS month, 'fuel' AS kind, amount FROM fuel_logs
         WHERE school_id = $1 AND deleted_at IS NULL AND status = 'approved' AND filled_on BETWEEN $2 AND $3 ${bus}
         UNION ALL
         SELECT vehicle_id, to_char((closed_at AT TIME ZONE $4)::date, 'YYYY-MM'), kind, cost FROM maintenance_tickets
         WHERE school_id = $1 AND deleted_at IS NULL AND status = 'done' AND cost IS NOT NULL
           AND (closed_at AT TIME ZONE $4)::date BETWEEN $2 AND $3 ${bus}
         UNION ALL
         SELECT vehicle_id, to_char(spent_on, 'YYYY-MM'), 'other', amount FROM vehicle_expenses
         WHERE school_id = $1 AND deleted_at IS NULL AND spent_on BETWEEN $2 AND $3 ${bus}
       ) spend GROUP BY vehicle_id, month, kind`,
      params,
    );
    const kms = await this.kmByMonth(schoolId, range, query.vehicle_id);
    const vehicles: { id: number; capacity: number; monthly_budget: string | null }[] = await this.dataSource.query(
      `SELECT id, capacity, monthly_budget FROM vehicles WHERE school_id = $1 AND deleted_at IS NULL ${query.vehicle_id ? 'AND id = $2' : ''}`,
      query.vehicle_id ? [schoolId, query.vehicle_id] : [schoolId],
    );
    const buses = await this.books.busRefs(vehicles.map((row) => Number(row.id)));
    const rows: CostRowDto[] = [];
    for (const vehicle of vehicles) {
      const id = Number(vehicle.id);
      for (const month of months(range)) {
        const own = spend.filter((row) => Number(row.vehicle_id) === id && row.month === month);
        const sum = (kind: string) =>
          round2(own.filter((row) => row.kind === kind).reduce((total, row) => total + Number(row.amount), 0));
        const fuel = sum('fuel');
        const service = sum('service');
        const repair = sum('repair');
        const other = sum('other');
        const total = round2(fuel + service + repair + other);
        const km = kms.get(`${id}:${month}`) ?? null;
        if (!total && km === null) continue;
        const budget = vehicle.monthly_budget === null ? null : Number(vehicle.monthly_budget);
        rows.push({
          vehicle: buses.get(id)!,
          month,
          fuel,
          service,
          repair,
          other,
          total,
          km,
          cost_per_km: costPerKm(total, km),
          cost_per_seat: vehicle.capacity ? round2(total / vehicle.capacity) : null,
          budget,
          over_budget: budget !== null && total > budget,
        });
      }
    }
    return rows.sort((a, b) => b.month.localeCompare(a.month) || a.vehicle.name.localeCompare(b.vehicle.name));
  }

  async mileage(schoolId: number, query: ReportRangeDto): Promise<MileageRowDto[]> {
    const range = await this.range(schoolId, query);
    const settings = await this.books.settings(schoolId);
    const fills: {
      id: number;
      vehicle_id: number;
      filled_on: string;
      odometer_km: number;
      litres: number;
      is_full: boolean;
    }[] = await this.dataSource.query(
      `SELECT id, vehicle_id, to_char(filled_on, 'YYYY-MM-DD') AS filled_on, odometer_km::float AS odometer_km,
              litres::float AS litres, is_full
       FROM fuel_logs WHERE school_id = $1 AND deleted_at IS NULL AND status = 'approved' AND filled_on <= $2
       ${query.vehicle_id ? 'AND vehicle_id = $3' : ''}`,
      query.vehicle_id ? [schoolId, range.to, query.vehicle_id] : [schoolId, range.to],
    );
    const kms = await this.kmByMonth(schoolId, range, query.vehicle_id);
    const vehicleIds = [...new Set(fills.map((row) => Number(row.vehicle_id)))];
    const buses = await this.books.busRefs(vehicleIds);
    const rows: MileageRowDto[] = [];
    for (const vehicleId of vehicleIds) {
      const own = fills
        .filter((row) => Number(row.vehicle_id) === vehicleId)
        .map((row) => ({ ...row, id: Number(row.id) }));
      const economy = fillEconomy(own);
      const inRange = own.filter((row) => row.filled_on >= range.from);
      const values = inRange
        .map((row) => economy.get(row.id)?.km_per_litre)
        .filter((value): value is number => !!value);
      const normal = values.length ? round2(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
      for (const month of months(range)) {
        const monthRows = inRange.filter((row) => row.filled_on.startsWith(month));
        if (!monthRows.length) continue;
        const monthValues = monthRows
          .map((row) => economy.get(row.id)?.km_per_litre)
          .filter((value): value is number => !!value);
        const kmpl = monthValues.length
          ? round2(monthValues.reduce((sum, value) => sum + value, 0) / monthValues.length)
          : null;
        rows.push({
          vehicle: buses.get(vehicleId)!,
          month,
          litres: round2(monthRows.reduce((sum, row) => sum + row.litres, 0)),
          km: kms.get(`${vehicleId}:${month}`) ?? null,
          km_per_litre: kmpl,
          normal,
          low: mileageDropped(kmpl, normal, settings.low_mileage_drop_pct),
        });
      }
    }
    return rows.sort((a, b) => b.month.localeCompare(a.month) || a.vehicle.name.localeCompare(b.vehicle.name));
  }

  async due(schoolId: number): Promise<DueReportDto> {
    const today = this.books.today();
    const limit = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10);
    const fields = Object.entries(VEHICLE_EXPIRY_FIELDS) as [VehicleExpiryKind, string][];
    const vehicles: Record<string, string | number | null>[] = await this.dataSource.query(
      `SELECT id, ${fields.map(([, field]) => `to_char(${field}, 'YYYY-MM-DD') AS ${field}`).join(', ')}
       FROM vehicles WHERE school_id = $1 AND deleted_at IS NULL AND status = 'active'`,
      [schoolId],
    );
    const buses = await this.books.busRefs(vehicles.map((row) => Number(row.id)));
    const documents = vehicles
      .flatMap((row) =>
        fields
          .filter(([, field]) => row[field] && String(row[field]) <= limit)
          .map(([kind, field]) => ({
            vehicle: buses.get(Number(row.id))!,
            kind,
            expiry: String(row[field]),
            days_left: daysBetween(today, String(row[field])),
          })),
      )
      .sort((a, b) => a.days_left - b.days_left);
    return { services: await this.schedules.due(schoolId), documents };
  }

  async spend(schoolId: number, query: SpendQueryDto): Promise<SpendRowDto[]> {
    const range = await this.range(schoolId, query);
    const params: unknown[] = [schoolId, range.from, range.to, this.books.timeZone];
    const bus = query.vehicle_id ? `AND vehicle_id = $${params.push(query.vehicle_id)}` : '';
    const byVendor = query.group === 'vendor';
    const rows: { key: string; label: string; amount: number; entries: number }[] = await this.dataSource.query(
      `SELECT key, MAX(label) AS label, SUM(amount)::float AS amount, COUNT(*)::int AS entries FROM (
         SELECT ${byVendor ? `COALESCE('vendor:' || station_id, 'name:' || lower(COALESCE(station, 'not given'))), COALESCE(station, 'Not given')` : `'fuel', 'Fuel'`} , amount
         FROM fuel_logs WHERE school_id = $1 AND deleted_at IS NULL AND status = 'approved' AND filled_on BETWEEN $2 AND $3 ${bus}
         UNION ALL
         SELECT ${byVendor ? `COALESCE('vendor:' || vendor_id, 'name:' || lower(COALESCE(vendor, 'not given'))), COALESCE(vendor, 'Not given')` : `COALESCE(category, kind), COALESCE(category, kind)`}, cost
         FROM maintenance_tickets WHERE school_id = $1 AND deleted_at IS NULL AND status = 'done' AND cost IS NOT NULL
           AND (closed_at AT TIME ZONE $4)::date BETWEEN $2 AND $3 ${bus}
         UNION ALL
         SELECT ${byVendor ? `COALESCE('vendor:' || vendor_id, 'name:' || lower(COALESCE(paid_to, 'not given'))), COALESCE(paid_to, 'Not given')` : `category, category`}, amount
         FROM vehicle_expenses WHERE school_id = $1 AND deleted_at IS NULL AND spent_on BETWEEN $2 AND $3 ${bus}
       ) spend (key, label, amount) GROUP BY key ORDER BY amount DESC`,
      params,
    );
    return rows.map((row) => ({
      key: row.key,
      label: byVendor ? row.label : (CATEGORY_LABELS[row.label] ?? EXPENSE_LABELS[row.label] ?? labelOf(row.label)),
      amount: round2(Number(row.amount)),
      entries: Number(row.entries),
    }));
  }

  async idle(schoolId: number, query: ReportRangeDto): Promise<IdleRowDto[]> {
    const range = await this.range(schoolId, query);
    const settings = await this.books.settings(schoolId);
    const params: unknown[] = [schoolId, range.from, range.to, this.books.timeZone];
    const bus = query.vehicle_id ? `AND a.vehicle_id = $${params.push(query.vehicle_id)}` : '';
    const rows: { vehicle_id: number; alerts: number; minutes: number; price: number | null }[] =
      await this.dataSource.query(
        `SELECT a.vehicle_id, COUNT(*)::int AS alerts,
              COALESCE(SUM(NULLIF(a.data->>'value', '')::numeric), 0)::float AS minutes,
              (SELECT SUM(f.amount) / NULLIF(SUM(f.litres), 0) FROM fuel_logs f
               WHERE f.vehicle_id = a.vehicle_id AND f.deleted_at IS NULL AND f.status = 'approved')::float AS price
       FROM fleet_alerts a
       JOIN vehicles v ON v.id = a.vehicle_id AND v.deleted_at IS NULL
       WHERE a.school_id = $1 AND a.kind = 'idle'
         AND (a.raised_at AT TIME ZONE $4)::date BETWEEN $2 AND $3 ${bus}
       GROUP BY a.vehicle_id`,
        params,
      );
    const buses = await this.books.busRefs(rows.map((row) => Number(row.vehicle_id)));
    return rows
      .map((row) => {
        const litres = idleLitres(Number(row.minutes), Number(settings.idle_litres_per_hour));
        return {
          vehicle: buses.get(Number(row.vehicle_id)) as BusRefDto,
          alerts: Number(row.alerts),
          minutes: Math.round(Number(row.minutes)),
          litres,
          amount: row.price ? round2(litres * Number(row.price)) : 0,
        };
      })
      .sort((a, b) => b.litres - a.litres);
  }

  async reimbursements(schoolId: number): Promise<ReimbursementRowDto[]> {
    const rows: {
      type: 'fuel' | 'expense';
      id: number;
      vehicle_id: number;
      on: string;
      amount: number;
      paid_by: number | null;
      title: string;
    }[] = await this.dataSource.query(
      `SELECT 'fuel' AS type, id, vehicle_id, to_char(filled_on, 'YYYY-MM-DD') AS "on", amount::float AS amount,
                COALESCE(filled_by, created_by) AS paid_by, 'Fuel ' || trim(to_char(litres, 'FM999990.00')) || ' L' AS title
         FROM fuel_logs WHERE school_id = $1 AND deleted_at IS NULL AND status = 'approved'
           AND payment_mode = 'driver_paid' AND reimbursed_at IS NULL
         UNION ALL
         SELECT 'expense', id, vehicle_id, to_char(spent_on, 'YYYY-MM-DD'), amount::float, created_by,
                initcap(replace(category, '_', ' '))
         FROM vehicle_expenses WHERE school_id = $1 AND deleted_at IS NULL AND payment_mode = 'driver_paid' AND reimbursed_at IS NULL
         ORDER BY 4`,
      [schoolId],
    );
    const [buses, people] = await Promise.all([
      this.books.busRefs(rows.map((row) => Number(row.vehicle_id))),
      this.books.people(rows.map((row) => (row.paid_by === null ? null : Number(row.paid_by)))),
    ]);
    return rows.map((row) => ({
      type: row.type,
      id: Number(row.id),
      vehicle: buses.get(Number(row.vehicle_id))!,
      on: row.on,
      amount: round2(Number(row.amount)),
      paid_by: row.paid_by === null ? null : (people.get(Number(row.paid_by)) ?? null),
      title: row.title,
    }));
  }

  async insights(schoolId: number): Promise<FleetInsightsDto> {
    const from = monthStartIn(this.books.timeZone);
    const [[month], due, fuel, offRoad, blocked, reimbursements, spent, budgets] = await Promise.all([
      this.dataSource.query(
        `SELECT
           (SELECT COALESCE(SUM(amount), 0) FROM fuel_logs WHERE school_id = $1 AND deleted_at IS NULL AND status = 'approved' AND filled_on >= $2)::float AS fuel,
           (SELECT COALESCE(SUM(cost), 0) FROM maintenance_tickets WHERE school_id = $1 AND deleted_at IS NULL AND status = 'done'
              AND (closed_at AT TIME ZONE $3)::date >= $2)::float AS maintenance,
           (SELECT COALESCE(SUM(amount), 0) FROM vehicle_expenses WHERE school_id = $1 AND deleted_at IS NULL AND spent_on >= $2)::float AS other`,
        [schoolId, from, this.books.timeZone],
      ),
      this.schedules.due(schoolId),
      this.fuel.insights(schoolId),
      this.dataSource.query(
        `SELECT COUNT(DISTINCT vehicle_id)::int AS count FROM maintenance_tickets
         WHERE school_id = $1 AND deleted_at IS NULL AND off_road = true AND status <> 'done'`,
        [schoolId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS count FROM pre_trip_checks
         WHERE school_id = $1 AND deleted_at IS NULL AND check_date = $2 AND critical_failed = true AND cleared_at IS NULL`,
        [schoolId, this.books.today()],
      ),
      this.reimbursements(schoolId),
      this.books.spentInMonth(schoolId, null, from.slice(0, 7)),
      this.dataSource.query(
        `SELECT id, monthly_budget::float AS budget FROM vehicles
         WHERE school_id = $1 AND deleted_at IS NULL AND monthly_budget IS NOT NULL`,
        [schoolId],
      ) as Promise<{ id: number; budget: number }[]>,
    ]);
    const fuelAmount = round2(Number(month.fuel));
    const maintenance = round2(Number(month.maintenance));
    const other = round2(Number(month.other));
    return {
      fuel_this_month: fuelAmount,
      maintenance_this_month: maintenance,
      other_this_month: other,
      total_this_month: round2(fuelAmount + maintenance + other),
      overdue_services: due.filter((row) => row.status === 'overdue').length,
      due_soon_services: due.filter((row) => row.status === 'due_soon').length,
      avg_km_per_litre: fuel.avg_km_per_litre,
      off_road_buses: offRoad[0]?.count ?? 0,
      pending_fuel_approvals: fuel.pending_approvals,
      blocked_checks: blocked[0]?.count ?? 0,
      pending_reimbursements: round2(reimbursements.reduce((sum, row) => sum + row.amount, 0)),
      over_budget_buses: budgets.filter((row) => (spent.get(Number(row.id)) ?? 0) > Number(row.budget)).length,
    };
  }

  private async monthKmPerLitre(schoolId: number, vehicleId: number, month: string): Promise<number | null> {
    const rows: { id: number; filled_on: string; odometer_km: number; litres: number; is_full: boolean }[] =
      await this.dataSource.query(
        `SELECT id, to_char(filled_on, 'YYYY-MM-DD') AS filled_on, odometer_km::float AS odometer_km, litres::float AS litres, is_full
         FROM fuel_logs WHERE school_id = $1 AND vehicle_id = $2 AND deleted_at IS NULL AND status = 'approved'`,
        [schoolId, vehicleId],
      );
    const economy = fillEconomy(rows.map((row) => ({ ...row, id: Number(row.id) })));
    const values = rows
      .filter((row) => row.filled_on.startsWith(month))
      .map((row) => economy.get(Number(row.id))?.km_per_litre)
      .filter((value): value is number => !!value);
    return values.length ? round2(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  }

  private async kmByMonth(schoolId: number, range: Range, vehicleId?: number): Promise<Map<string, number>> {
    const readings: { vehicle_id: number; on: string; km: number }[] = await this.dataSource.query(
      `SELECT vehicle_id, "on", km FROM (
         SELECT vehicle_id, to_char(filled_on, 'YYYY-MM-DD') AS "on", odometer_km::float AS km FROM fuel_logs
         WHERE school_id = $1 AND deleted_at IS NULL AND status <> 'rejected' AND filled_on <= $2
         UNION ALL
         SELECT vehicle_id, to_char(check_date, 'YYYY-MM-DD'), odometer_km::float FROM pre_trip_checks
         WHERE school_id = $1 AND deleted_at IS NULL AND odometer_km IS NOT NULL AND check_date <= $2
         UNION ALL
         SELECT vehicle_id, to_char((COALESCE(closed_at, opened_at) AT TIME ZONE $3)::date, 'YYYY-MM-DD'), odometer_km::float
         FROM maintenance_tickets WHERE school_id = $1 AND deleted_at IS NULL AND odometer_km IS NOT NULL
       ) readings ${vehicleId ? 'WHERE vehicle_id = $4' : ''}`,
      vehicleId ? [schoolId, range.to, this.books.timeZone, vehicleId] : [schoolId, range.to, this.books.timeZone],
    );
    const result = new Map<string, number>();
    for (const id of new Set(readings.map((row) => Number(row.vehicle_id)))) {
      const own = readings.filter((row) => Number(row.vehicle_id) === id && row.on <= range.to);
      for (const month of months(range)) {
        const inMonth = own.filter((row) => row.on.startsWith(month)).map((row) => Number(row.km));
        if (!inMonth.length) continue;
        const before = own.filter((row) => row.on < `${month}-01`).map((row) => Number(row.km));
        const start = before.length ? Math.max(...before) : Math.min(...inMonth);
        const km = Math.round((Math.max(...inMonth) - start) * 10) / 10;
        if (km > 0) result.set(`${id}:${month}`, km);
      }
    }
    return result;
  }
}

function labelOf(value: string): string {
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
