import { EntityManager, In, IsNull } from 'typeorm';
import { TransportFeeAdjustment } from '../../modules/fees/entities/transport-fee-adjustment.entity';
import { recordPayment } from '../../modules/fees/fee-ledger';
import { round2 } from '../../modules/fees/fees.logic';
import { rupees } from '../../modules/payroll/payroll.calc';
import { School } from '../../modules/schools/entities/school.entity';
import { SequencesService } from '../../modules/schools/sequences.service';
import {
  AlertData,
  AlertKind,
  AlertSeverity,
  AlertStatus,
  FleetAlert,
} from '../../modules/tracking/entities/fleet-alert.entity';
import { cancelNote } from '../../modules/tracking/fleet-alerts.logic';
import { feeStanding, graceEnds, HoldKind, passNumber } from '../../modules/transport/bus-pass.logic';
import { BusFeeReminder, BusPass, BusPassSettings } from '../../modules/transport/entities/bus-pass.entity';
import { RouteStop } from '../../modules/transport/entities/route-stop.entity';
import { StudentTransport } from '../../modules/transport/entities/student-transport.entity';
import { TransportRoute } from '../../modules/transport/entities/transport-route.entity';
import { Vehicle } from '../../modules/transport/entities/vehicle.entity';
import { User } from '../../modules/users/entities/user.entity';
import { todayIn } from '../../shared/dates';

const GRACE_DAYS = 7;

const ROUTE_FEES: Record<string, { monthly_fee: number; fallback_stop?: string }> = {
  R1: { monthly_fee: 1000 },
  R2: { monthly_fee: 1000 },
  R3: { monthly_fee: 900, fallback_stop: 'ICF main gate' },
};

const PAID_PARENT = '9000000005';
const HELD_PARENT = '9000000006';

interface Rider {
  student_id: number;
  route_id: number;
  stop_id: number;
  name: string;
  oldest_unpaid_due: string | null;
  any_paid: boolean;
  first_paid_on: string | null;
}

interface CrewMember {
  user: User;
  vehicle: Vehicle | null;
  route: TransportRoute | null;
  role: 'Driver' | 'Attendant';
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

export async function seedDemoRouteFees(manager: EntityManager, school: School): Promise<void> {
  const routes = await manager.findBy(TransportRoute, {
    school_id: school.id,
    code: In(Object.keys(ROUTE_FEES)),
    deleted_at: IsNull(),
  });
  let changed = 0;
  for (const route of routes) {
    if (Number(route.monthly_fee) > 0) continue;
    const plan = ROUTE_FEES[route.code]!;
    await manager.update(TransportRoute, route.id, { monthly_fee: plan.monthly_fee });
    if (plan.fallback_stop) {
      await manager.update(RouteStop, { route_id: route.id, name: plan.fallback_stop }, { monthly_fee: null });
    }
    changed += 1;
  }
  console.log(`  Route fees: ${changed ? `${changed} routes given a default monthly fee` : 'already set up: kept'}`);
}

export async function seedDemoBusPasses(manager: EntityManager, school: School): Promise<void> {
  const schoolId = school.id;
  // The settings row alone is not proof the passes are there. A database
  // that ended up with passes but no settings row — this one had 54 and 0 —
  // walked straight past this guard into the insert below and broke
  // UQ_bus_passes_student_year, and because the whole demo seed is one
  // transaction that rolled back every step before it too: the users, their
  // roles, the diary, the library. Guard on the rows the constraint protects,
  // and put the missing settings row back while we are here.
  const hasPasses = await manager.existsBy(BusPass, { school_id: schoolId });
  const hasSettings = await manager.existsBy(BusPassSettings, { school_id: schoolId });
  if (hasPasses || hasSettings) {
    if (!hasSettings) {
      await manager.insert(BusPassSettings, { school_id: schoolId, grace_days: GRACE_DAYS, updated_by: null });
    }
    console.log('  Bus passes and safety alerts: already set up: kept');
    return;
  }
  const [year]: { id: number; start_date: string; end_date: string }[] = await manager.query(
    `SELECT id, start_date::text AS start_date, end_date::text AS end_date FROM academic_years
     WHERE school_id = $1 AND is_current = true AND deleted_at IS NULL`,
    [schoolId],
  );
  if (!year) return;
  const today = todayIn(process.env.APP_TIMEZONE || 'Asia/Kolkata');
  const office = await manager.findOneBy(User, { mobile: '9000000003', deleted_at: IsNull() });
  const officeId = office?.id ?? null;

  await manager.insert(BusPassSettings, { school_id: schoolId, grace_days: GRACE_DAYS, updated_by: officeId });
  const showcase = await payShowcaseRider(manager, schoolId, today, officeId);

  const riders = await loadRiders(manager, schoolId, Number(year.id));
  const sequences = new SequencesService();
  const yearStart = Number(year.start_date.slice(0, 4));
  for (const rider of riders) {
    const number = await sequences.next(manager, schoolId, `bus_pass:${yearStart}`);
    await manager.insert(BusPass, {
      school_id: schoolId,
      student_id: rider.student_id,
      academic_year_id: Number(year.id),
      pass_no: passNumber(school.code, yearStart, number),
      valid_from: year.start_date,
      valid_until: year.end_date,
      issued_at: rider.any_paid ? new Date(`${rider.first_paid_on ?? today}T09:30:00+05:30`) : null,
    });
  }

  const holds = await placeHolds(manager, schoolId, Number(year.id), riders, today, showcase, officeId);
  const adjusted = await addFeeAdjustment(manager, schoolId, Number(year.id), today, showcase, officeId);
  const alerts = await seedSafetyAlerts(manager, schoolId, officeId);

  const issued = riders.filter((rider) => rider.any_paid).length;
  console.log(
    `  Bus passes: ${riders.length} passes (${issued} issued), ${holds.fee} fee holds, ${holds.office} office hold, ${adjusted ? 1 : 0} fee adjustment; ${alerts} safety alerts`,
  );
}

async function loadRiders(manager: EntityManager, schoolId: number, yearId: number): Promise<Rider[]> {
  const rows: Rider[] = await manager.query(
    `SELECT t.student_id, t.route_id, t.stop_id, s.first_name || COALESCE(' ' || s.last_name, '') AS name,
            (MIN(i.due_date) FILTER (WHERE i.balance > 0 AND i.status <> 'cancelled'))::text AS oldest_unpaid_due,
            COALESCE(bool_or(i.status = 'paid'), false) AS any_paid,
            (SELECT MIN(p.paid_on)::text FROM fee_payments p WHERE p.invoice_id = ANY(array_agg(i.id))) AS first_paid_on
     FROM student_transport t
     JOIN students s ON s.id = t.student_id AND s.deleted_at IS NULL AND s.status = 'active'
     LEFT JOIN fee_invoices i ON i.student_id = t.student_id AND i.academic_year_id = $2 AND i.deleted_at IS NULL
       AND i.status <> 'cancelled'
       AND EXISTS (SELECT 1 FROM fee_invoice_lines l WHERE l.invoice_id = i.id AND l.kind = 'transport' AND l.deleted_at IS NULL)
     WHERE t.school_id = $1 AND t.deleted_at IS NULL
     GROUP BY t.student_id, t.route_id, t.stop_id, s.first_name, s.last_name, s.id
     ORDER BY s.first_name, s.last_name, s.id`,
    [schoolId, yearId],
  );
  return rows.map((row) => ({
    ...row,
    student_id: Number(row.student_id),
    route_id: Number(row.route_id),
    stop_id: Number(row.stop_id),
  }));
}

async function riderChildOf(manager: EntityManager, schoolId: number, mobile: string): Promise<number | null> {
  const [row]: { student_id: number }[] = await manager.query(
    `SELECT t.student_id FROM guardians g
     JOIN student_guardians sg ON sg.guardian_id = g.id
     JOIN student_transport t ON t.student_id = sg.student_id AND t.deleted_at IS NULL
     WHERE g.school_id = $1 AND g.mobile = $2 AND g.deleted_at IS NULL
     ORDER BY t.student_id LIMIT 1`,
    [schoolId, mobile],
  );
  return row ? Number(row.student_id) : null;
}

async function payShowcaseRider(
  manager: EntityManager,
  schoolId: number,
  today: string,
  officeId: number | null,
): Promise<number | null> {
  const studentId = await riderChildOf(manager, schoolId, PAID_PARENT);
  if (!studentId) return null;
  const open: { id: number; balance: string; due_date: string }[] = await manager.query(
    `SELECT i.id, i.balance, i.due_date::text AS due_date FROM fee_invoices i
     WHERE i.student_id = $1 AND i.deleted_at IS NULL AND i.status <> 'cancelled' AND i.balance > 0
       AND i.due_date <= $2
       AND EXISTS (SELECT 1 FROM fee_invoice_lines l WHERE l.invoice_id = i.id AND l.kind = 'transport')
     ORDER BY i.due_date`,
    [studentId, today],
  );
  for (const invoice of open) {
    await recordPayment(manager, schoolId, Number(invoice.id), {
      amount: round2(Number(invoice.balance)),
      mode: 'upi',
      reference: `UPI${String(700000 + Number(invoice.id))}`,
      paid_on: invoice.due_date,
      notes: 'Paid in the parent app',
      received_by: officeId,
    });
  }
  return studentId;
}

async function placeHolds(
  manager: EntityManager,
  schoolId: number,
  yearId: number,
  riders: Rider[],
  today: string,
  showcase: number | null,
  officeId: number | null,
): Promise<{ fee: number; office: number }> {
  const heldChild = await riderChildOf(manager, schoolId, HELD_PARENT);
  const pastGrace = riders.filter(
    (rider) =>
      rider.student_id !== showcase && feeStanding({ ...rider, any_billed: true }, GRACE_DAYS, today) === 'past_grace',
  );
  const feeHeld = [
    ...pastGrace.filter((rider) => rider.student_id === heldChild),
    ...pastGrace.filter((rider) => rider.student_id !== heldChild),
  ].slice(0, 3);
  const clear = riders.find((rider) => rider.student_id !== showcase && rider.any_paid && !rider.oldest_unpaid_due);

  const hold = async (rider: Rider, kind: HoldKind, note: string | null) => {
    await manager.update(
      StudentTransport,
      { school_id: schoolId, student_id: rider.student_id },
      {
        pass_status: 'on_hold',
        hold_kind: kind,
        pass_note: note,
        pass_changed_at: minutesAgo(60 * 26),
        pass_changed_by: officeId,
      },
    );
    await manager.query(
      `INSERT INTO route_changes (school_id, route_id, student_id, kind, summary, parents_told, changed_by, created_at)
       VALUES ($1, $2, $3, 'pass_changed', $4, 1, $5, $6)`,
      [
        schoolId,
        rider.route_id,
        rider.student_id,
        `Bus pass for ${rider.name} put on hold${kind === 'fee' ? ' (bus fee pending)' : ''}`.slice(0, 255),
        officeId,
        minutesAgo(60 * 26),
      ],
    );
  };

  for (const rider of feeHeld) {
    await hold(rider, 'fee', null);
    const [invoice]: { id: number }[] = await manager.query(
      `SELECT i.id FROM fee_invoices i WHERE i.student_id = $1 AND i.academic_year_id = $2
       AND i.due_date = $3 AND i.status <> 'cancelled' AND i.deleted_at IS NULL LIMIT 1`,
      [rider.student_id, yearId, rider.oldest_unpaid_due],
    );
    if (invoice) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(BusFeeReminder)
        .values({
          school_id: schoolId,
          invoice_id: Number(invoice.id),
          kind: 'grace_ending',
          sent_at: new Date(`${graceEnds(rider.oldest_unpaid_due!, GRACE_DAYS - 1)}T08:00:00+05:30`),
        })
        .orIgnore()
        .execute();
    }
  }
  if (clear) await hold(clear, 'office', 'Parent asked to confirm the new pickup point with the office');
  return { fee: feeHeld.length, office: clear ? 1 : 0 };
}

async function addFeeAdjustment(
  manager: EntityManager,
  schoolId: number,
  yearId: number,
  today: string,
  showcase: number | null,
  officeId: number | null,
): Promise<number | null> {
  const [candidate]: {
    invoice_id: number;
    installment: string;
    student_id: number;
    route_id: number;
    amount: string;
    months: number;
    monthly_rate: string;
    new_stop_id: number;
    new_stop: string;
    new_fee: string;
  }[] = await manager.query(
    `SELECT i.id AS invoice_id, i.installment, i.student_id, l.route_id, l.amount, l.months, l.monthly_rate,
            d.id AS new_stop_id, d.name AS new_stop, d.fee AS new_fee
     FROM fee_invoices i
     JOIN fee_invoice_lines l ON l.invoice_id = i.id AND l.kind = 'transport' AND l.deleted_at IS NULL
     JOIN student_transport t ON t.student_id = i.student_id AND t.deleted_at IS NULL
       AND t.pass_status = 'active' AND t.drop_stop_id IS NULL AND t.route_id = l.route_id
     JOIN LATERAL (
       SELECT s.id, s.name, COALESCE(s.monthly_fee, r.monthly_fee) AS fee FROM route_stops s
       JOIN transport_routes r ON r.id = s.route_id
       WHERE s.route_id = t.route_id AND s.deleted_at IS NULL AND COALESCE(s.monthly_fee, r.monthly_fee) > l.monthly_rate
       ORDER BY COALESCE(s.monthly_fee, r.monthly_fee) DESC, s.sequence LIMIT 1
     ) d ON true
     WHERE i.school_id = $1 AND i.academic_year_id = $2 AND i.due_date >= $3 AND i.paid > 0
       AND i.status <> 'cancelled' AND i.deleted_at IS NULL AND i.student_id <> $4
     ORDER BY i.id LIMIT 1`,
    [schoolId, yearId, today, showcase ?? 0],
  );
  if (!candidate) return null;
  const dearest = { id: candidate.new_stop_id, name: candidate.new_stop, fee: candidate.new_fee };
  const difference = round2(Number(dearest.fee) * Number(candidate.months) - Number(candidate.amount));
  await manager.update(
    StudentTransport,
    { school_id: schoolId, student_id: Number(candidate.student_id) },
    { stop_id: Number(dearest.id) },
  );
  await manager.save(
    manager.create(TransportFeeAdjustment, {
      school_id: schoolId,
      student_id: Number(candidate.student_id),
      invoice_id: Number(candidate.invoice_id),
      amount: difference,
      reason: `Bus fee changed to ${rupees(Number(dearest.fee))} a month (${candidate.installment})`.slice(0, 160),
      applied_invoice_id: null,
      created_by: officeId,
    }),
  );
  await manager.query(
    `INSERT INTO route_changes (school_id, route_id, stop_id, student_id, kind, summary, parents_told, changed_by)
     VALUES ($1, $2, $3, $4, 'student_moved', 'Pickup moved to ' || $5 || ' (fee difference added to the next invoice)', 1, $6)`,
    [schoolId, candidate.route_id, Number(dearest.id), Number(candidate.student_id), dearest.name, officeId],
  );
  return Number(candidate.student_id);
}

async function crewOn(manager: EntityManager, schoolId: number, mobile: string): Promise<CrewMember | null> {
  const user = await manager.findOneBy(User, { school_id: schoolId, mobile, deleted_at: IsNull() });
  if (!user) return null;
  const vehicle = await manager.findOne(Vehicle, {
    where: [
      { school_id: schoolId, driver_user_id: user.id, deleted_at: IsNull() },
      { school_id: schoolId, attendant_user_id: user.id, deleted_at: IsNull() },
    ],
  });
  const route = vehicle
    ? await manager.findOne(TransportRoute, {
        where: { school_id: schoolId, vehicle_id: vehicle.id, deleted_at: IsNull() },
        order: { code: 'ASC' },
      })
    : null;
  return { user, vehicle, route, role: vehicle?.driver_user_id === user.id ? 'Driver' : 'Attendant' };
}

async function stopNear(manager: EntityManager, routeId: number | undefined, sequence: number) {
  if (!routeId) return null;
  const stop = await manager.findOneBy(RouteStop, { route_id: routeId, sequence });
  return stop ? { lat: Number(stop.lat) + 0.0012, lng: Number(stop.lng) - 0.0009, name: stop.name } : null;
}

async function seedSafetyAlerts(manager: EntityManager, schoolId: number, officeId: number | null): Promise<number> {
  const driver = await crewOn(manager, schoolId, '9000000007');
  const attendant = await crewOn(manager, schoolId, '9000000008');
  const secondDriver = await crewOn(manager, schoolId, '9000000701');
  const busTwo = secondDriver ?? attendant;
  const rows: Partial<FleetAlert>[] = [];

  const sos = async (
    member: CrewMember | null,
    minutes: number,
    status: AlertStatus,
    note: string | null,
    stopSequence: number,
    closing?: { note: string; by: 'self' | 'office'; after: number },
  ) => {
    if (!member) return;
    const near = await stopNear(manager, member.route?.id, stopSequence);
    const data: AlertData = { role: member.role, phone: member.user.mobile, ...(note ? { note } : {}) };
    const raisedAt = minutesAgo(minutes);
    const closedAt = closing ? minutesAgo(minutes - closing.after) : null;
    const closer = closing?.by === 'self' ? member.user.id : officeId;
    rows.push({
      kind: 'sos',
      severity: 'critical',
      status,
      source: 'driver_app',
      vehicle_id: member.vehicle?.id ?? null,
      route_id: member.route?.id ?? null,
      device_id: member.vehicle?.device_id ?? null,
      raised_by: member.user.id,
      message: `SOS from ${member.user.name} (${member.role})${note ? `: ${note}` : ''}`.slice(0, 300),
      position: near ? { lat: near.lat, lng: near.lng, speed_kmh: 0 } : null,
      data,
      raised_at: raisedAt,
      notified: 4,
      acknowledged_by: status !== 'open' ? (closing?.by === 'self' ? null : officeId) : null,
      acknowledged_at: status !== 'open' && closing?.by !== 'self' ? minutesAgo(minutes - 2) : null,
      resolved_by: status === 'resolved' ? closer : null,
      resolved_at: status === 'resolved' ? closedAt : null,
      resolution_note: status === 'resolved' ? closing!.note : null,
    });
  };

  await sos(driver, 6, 'open', 'A child fainted on the bus, need medical help', 2);
  await sos(attendant, 60 * 22, 'resolved', null, 3, {
    note: cancelNote(attendant?.user.name ?? 'Attendant'),
    by: 'self',
    after: 1,
  });
  await sos(busTwo, 60 * 24 * 3 + 40, 'resolved', 'Front tyre burst near the market', 2, {
    note: 'Spare bus sent from school; all children reached home safely by 5:10 pm',
    by: 'office',
    after: 55,
  });

  const telematics = async (
    member: CrewMember | null,
    kind: AlertKind,
    severity: AlertSeverity,
    status: AlertStatus,
    minutes: number,
    message: string,
    data: AlertData,
    stopSequence: number,
    speed: number | null,
    resolution?: string,
  ) => {
    if (!member?.vehicle) return;
    const near = await stopNear(manager, member.route?.id, stopSequence);
    const raisedAt = minutesAgo(minutes);
    rows.push({
      kind,
      severity,
      status,
      source: 'telematics',
      source_ref: `${member.vehicle.device_id ?? member.vehicle.id}:${kind}:${raisedAt.toISOString()}`,
      vehicle_id: member.vehicle.id,
      route_id: member.route?.id ?? null,
      device_id: member.vehicle.device_id ?? null,
      raised_by: null,
      message,
      position: near ? { lat: near.lat, lng: near.lng, speed_kmh: speed } : null,
      data,
      raised_at: raisedAt,
      notified: severity === 'high' ? 3 : 2,
      acknowledged_by: status !== 'open' ? officeId : null,
      acknowledged_at: status !== 'open' ? minutesAgo(minutes - 5) : null,
      resolved_by: status === 'resolved' ? officeId : null,
      resolved_at: status === 'resolved' ? minutesAgo(minutes - 30) : null,
      resolution_note: status === 'resolved' ? (resolution ?? null) : null,
    });
  };

  await telematics(
    driver,
    'overspeed',
    'high',
    'acknowledged',
    95,
    'Overspeed: 62 km/h in a 40 km/h limit',
    { value: 62, limit: 40 },
    3,
    62,
  );
  await telematics(busTwo, 'route_deviation', 'medium', 'open', 18, 'Off the route by 850 m', { value: 850 }, 3, 24);
  await telematics(busTwo, 'idle', 'low', 'open', 40, 'Engine idling for 18 min', { value: 18 }, 1, 0);
  await telematics(
    driver,
    'harsh_braking',
    'medium',
    'resolved',
    60 * 26,
    'Harsh braking',
    {},
    2,
    31,
    'Spoke to the driver: a two-wheeler cut in at the signal',
  );
  await telematics(
    busTwo,
    'overspeed',
    'high',
    'resolved',
    60 * 24 * 2 + 15,
    'Overspeed: 58 km/h in a 40 km/h limit',
    { value: 58, limit: 40 },
    4,
    58,
    'Warning given to the driver and noted in the duty register',
  );

  if (!rows.length) return 0;
  await manager.save(
    FleetAlert,
    rows.map((row) => manager.create(FleetAlert, { ...row, school_id: schoolId, created_by: row.raised_by ?? null })),
  );
  await manager.query(
    `UPDATE fleet_alerts SET created_at = raised_at, updated_at = COALESCE(resolved_at, acknowledged_at, raised_at)
     WHERE school_id = $1`,
    [schoolId],
  );
  return rows.length;
}
