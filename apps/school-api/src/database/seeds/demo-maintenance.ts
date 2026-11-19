import { EntityManager } from 'typeorm';
import {
  FleetEntryChange,
  FleetSettings,
  FleetVendor,
  MaintenanceSchedule,
  PRE_TRIP_ITEMS,
  PreTripCheck,
  VehicleExpense,
} from '../../modules/fleet-ops/entities/fleet-maintenance.entity';
import { FuelLog } from '../../modules/fleet-ops/entities/fuel-log.entity';
import { MaintenanceTicket } from '../../modules/fleet-ops/entities/maintenance-ticket.entity';
import { STANDARD_SCHEDULES } from '../../modules/fleet-ops/maintenance-plan.logic';
import { School } from '../../modules/schools/entities/school.entity';
import { Vehicle } from '../../modules/transport/entities/vehicle.entity';
import { todayIn } from '../../shared/dates';
import { addDays } from '../../shared/school-days';

const KM_PER_DAY = 72;
const DIESEL_PRICE = 94.5;

const at = (date: string, time = '10:00:00') => new Date(`${date}T${time}+05:30`);
const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

export async function seedDemoMaintenance(manager: EntityManager, school: School): Promise<void> {
  if (await manager.existsBy(FleetVendor, { school_id: school.id })) {
    console.log('  Vehicle maintenance: already set up: kept');
    return;
  }
  const buses = await manager.find(Vehicle, {
    where: { school_id: school.id, status: 'active' },
    order: { id: 'ASC' },
  });
  if (!buses.length) {
    console.log('  Vehicle maintenance: no buses: skipped');
    return;
  }
  const [admin]: { id: number }[] = await manager.query(
    `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     WHERE u.school_id = $1 AND r.code = 'ADMIN' AND u.deleted_at IS NULL ORDER BY u.id LIMIT 1`,
    [school.id],
  );
  const by = admin ? Number(admin.id) : null;
  const today = todayIn(process.env.APP_TIMEZONE ?? 'Asia/Kolkata');

  await manager.createQueryBuilder().insert().into(FleetSettings).values({ school_id: school.id }).orIgnore().execute();

  const vendors = await manager.save(
    FleetVendor,
    [
      {
        kind: 'garage' as const,
        name: 'Sri Murugan Motors',
        phone: '9876500011',
        gst_no: '33ABCDE1234F1Z5',
        address: 'Anna Nagar, Chennai',
      },
      {
        kind: 'garage' as const,
        name: 'Lakshmi Auto Works',
        phone: '9876500022',
        gst_no: null,
        address: 'Koyambedu, Chennai',
      },
      {
        kind: 'fuel_station' as const,
        name: 'Indian Oil, Anna Nagar',
        phone: '04426161616',
        gst_no: null,
        address: '2nd Avenue, Anna Nagar',
      },
      {
        kind: 'fuel_station' as const,
        name: 'HP, Koyambedu',
        phone: null,
        gst_no: null,
        address: 'Poonamallee High Road',
      },
      { kind: 'other' as const, name: 'New India Assurance', phone: '18002091415', gst_no: null, address: null },
    ].map((vendor) =>
      manager.create(FleetVendor, { ...vendor, school_id: school.id, is_active: true, created_by: by }),
    ),
  );
  const [murugan, lakshmi, iocl, hp, insurer] = vendors as [
    FleetVendor,
    FleetVendor,
    FleetVendor,
    FleetVendor,
    FleetVendor,
  ];

  let fills = 0;
  let tickets = 0;
  for (const [index, bus] of buses.entries()) {
    const first = index === 0;
    await manager.update(Vehicle, bus.id, { tank_litres: 160, monthly_budget: first ? 45000 : 40000 });
    const [last]: { km: number | null }[] = await manager.query(
      `SELECT GREATEST(
         (SELECT MAX(odometer_km) FROM fuel_logs WHERE vehicle_id = $1 AND deleted_at IS NULL),
         (SELECT MAX(odometer_km) FROM maintenance_tickets WHERE vehicle_id = $1 AND deleted_at IS NULL),
         (SELECT tracker_odometer_km FROM vehicles WHERE id = $1)
       )::float AS km`,
      [bus.id],
    );
    const startKm = Math.ceil(Number(last?.km ?? 0)) + (first ? 42000 : 36500);
    const kmOn = (date: string) => round(startKm + Math.max(0, 80 - daysBack(date, today)) * KM_PER_DAY);
    const driver = bus.driver_user_id;
    const station = index % 2 === 0 ? iocl : hp;
    const garage = index % 2 === 0 ? murugan : lakshmi;

    const fuelRows: Partial<FuelLog>[] = [];
    for (let back = 78; back >= 2; back -= 6) {
      const date = addDays(today, -back);
      const partFill = back === 54 || back === 24;
      const lowMileage = !first && back <= 12;
      const kmpl = lowMileage ? 4.9 : 6.6 + ((back * 7) % 9) / 10;
      const litres = partFill ? 25 : round((6 * KM_PER_DAY) / kmpl, 2);
      const price = back === 30 ? 118.5 : DIESEL_PRICE + ((back % 4) - 1.5) / 2;
      const isDriverEntry = first && back === 6;
      const driverPaid = back === 12;
      fuelRows.push({
        school_id: school.id,
        vehicle_id: bus.id,
        filled_on: date,
        litres,
        amount: round(litres * price, 2),
        odometer_km: kmOn(date),
        station: station.name,
        station_id: station.id,
        is_full: !partFill,
        payment_mode: isDriverEntry || driverPaid ? 'driver_paid' : 'fuel_card',
        status: isDriverEntry ? 'pending' : 'approved',
        filled_by: driver,
        bill_file_id: null,
        created_by: isDriverEntry ? driver : by,
      });
    }
    await manager.save(
      FuelLog,
      fuelRows.map((row) => manager.create(FuelLog, row)),
    );
    fills += fuelRows.length;

    const serviceOn = addDays(today, first ? -170 : -95);
    const taken = await manager.find(MaintenanceSchedule, {
      where: { school_id: school.id, vehicle_id: bus.id, is_active: true },
    });
    const schedules = await manager.save(
      MaintenanceSchedule,
      STANDARD_SCHEDULES.filter((rule) => !taken.some((row) => row.category === rule.category)).map((rule) => {
        const lastOn =
          rule.category === 'engine_oil'
            ? serviceOn
            : rule.category === 'brakes'
              ? addDays(today, first ? -40 : -98)
              : addDays(today, -60);
        return manager.create(MaintenanceSchedule, {
          school_id: school.id,
          vehicle_id: bus.id,
          category: rule.category,
          title: rule.title,
          every_km: rule.every_km,
          every_months: rule.every_months,
          last_done_on: lastOn,
          last_done_km: kmOn(lastOn),
          is_active: true,
          created_by: by,
        });
      }),
    );
    const oil = [...schedules, ...taken].find((row) => row.category === 'engine_oil');

    const batteryOn = addDays(today, -62);
    const ticketRows: Partial<MaintenanceTicket>[] = [
      {
        kind: 'service',
        category: 'engine_oil',
        schedule_id: oil?.id ?? null,
        title: 'Engine oil and filter change',
        description: '15W-40, 18 litres; oil filter and air filter cleaned',
        status: 'done',
        opened_at: at(serviceOn, '09:00:00'),
        closed_at: at(serviceOn, '16:30:00'),
        parts_cost: 6200,
        labour_cost: 800,
        cost: 7000,
        vendor_id: garage.id,
        vendor: garage.name,
        odometer_km: kmOn(serviceOn),
      },
      {
        kind: 'repair',
        category: 'battery',
        title: 'Battery replaced',
        description: 'Bus did not start in the morning; old battery dead',
        status: 'done',
        opened_at: at(batteryOn, '07:10:00'),
        closed_at: at(batteryOn, '12:00:00'),
        parts_cost: 9800,
        labour_cost: 300,
        cost: 10100,
        vendor_id: garage.id,
        vendor: garage.name,
        warranty_months: 18,
        odometer_km: kmOn(batteryOn),
      },
      {
        kind: 'repair',
        category: 'ac',
        title: 'AC not cooling at the back',
        description: 'Gas top-up and blower check',
        status: 'in_progress',
        opened_at: at(addDays(today, -3), '15:00:00'),
        vendor_id: garage.id,
        vendor: garage.name,
        odometer_km: kmOn(addDays(today, -3)),
      },
      {
        kind: 'repair',
        category: 'body',
        source: 'driver',
        title: 'Seat torn in row 4',
        description: 'Reported by the driver after the evening trip',
        status: 'open',
        opened_at: at(addDays(today, -1), '18:20:00'),
        reported_by: driver,
      },
    ];
    if (first) {
      ticketRows.push({
        kind: 'repair',
        category: 'battery',
        title: 'Battery not holding charge',
        description: 'Slow start two mornings in a row',
        status: 'open',
        opened_at: at(today, '07:30:00'),
        odometer_km: kmOn(today),
      });
    }
    await manager.save(
      MaintenanceTicket,
      ticketRows.map((row) =>
        manager.create(MaintenanceTicket, {
          source: 'manual',
          severity: null,
          fault_code: null,
          telematics_fault_id: null,
          off_road: false,
          ...row,
          school_id: school.id,
          vehicle_id: bus.id,
          created_by: row.source === 'driver' ? driver : by,
        }),
      ),
    );
    tickets += ticketRows.length;

    const expenseRows: Partial<VehicleExpense>[] = [
      {
        spent_on: addDays(today, -150),
        category: 'insurance',
        amount: first ? 38500 : 36200,
        vendor_id: insurer.id,
        paid_to: insurer.name,
        payment_mode: 'upi',
        note: 'Yearly comprehensive policy',
        renewed_until: addDays(today, 215),
      },
      {
        spent_on: addDays(today, -45),
        category: 'tyres',
        amount: 28400,
        vendor_id: garage.id,
        paid_to: garage.name,
        payment_mode: 'credit',
        note: 'Two rear tyres',
      },
      {
        spent_on: addDays(today, -20),
        category: 'cleaning',
        amount: 1200,
        paid_to: 'Sparkle Bus Wash',
        payment_mode: 'cash',
        note: 'Deep clean before the term',
      },
      {
        spent_on: addDays(today, -9),
        category: 'toll',
        amount: 340,
        paid_to: 'Sriperumbudur toll plaza',
        payment_mode: 'fuel_card',
        note: 'Sports day trip',
      },
      {
        spent_on: addDays(today, -4),
        category: 'parking',
        amount: 150,
        paid_to: 'Marina parking',
        payment_mode: 'driver_paid',
        note: 'Science fair visit',
      },
    ];
    await manager.save(
      VehicleExpense,
      expenseRows.map((row) =>
        manager.create(VehicleExpense, {
          vendor_id: null,
          reimbursed_at: null,
          bill_file_id: null,
          renewed_until: null,
          ...row,
          school_id: school.id,
          vehicle_id: bus.id,
          created_by: row.payment_mode === 'driver_paid' ? driver : by,
        }),
      ),
    );

    if (driver) {
      const checks: Partial<PreTripCheck>[] = [];
      for (let back = 7; back >= 1; back--) {
        const date = addDays(today, -back);
        if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0) continue;
        const lightsOut = back === 2;
        checks.push({
          school_id: school.id,
          vehicle_id: bus.id,
          check_date: date,
          checked_by: driver,
          items: PRE_TRIP_ITEMS.map((item) => ({
            item,
            ok: !(lightsOut && item === 'lights'),
            note: lightsOut && item === 'lights' ? 'Left indicator not blinking' : null,
          })),
          odometer_km: kmOn(date),
          failed_count: lightsOut ? 1 : 0,
          critical_failed: false,
          created_by: driver,
        });
      }
      await manager.save(
        PreTripCheck,
        checks.map((row) => manager.create(PreTripCheck, row)),
      );
    }
  }

  const [edited]: { id: number; vehicle_id: number; amount: number }[] = await manager.query(
    `SELECT id, vehicle_id, amount::float AS amount FROM fuel_logs
     WHERE school_id = $1 AND deleted_at IS NULL AND status = 'approved' ORDER BY filled_on DESC LIMIT 1`,
    [school.id],
  );
  if (edited && by) {
    await manager.save(
      FleetEntryChange,
      manager.create(FleetEntryChange, {
        school_id: school.id,
        entity: 'fuel',
        entity_id: Number(edited.id),
        vehicle_id: Number(edited.vehicle_id),
        action: 'update',
        before: { amount: round(Number(edited.amount) + 100, 2) },
        after: { amount: Number(edited.amount) },
        note: 'Amount typed wrong, corrected from the bill',
        created_by: by,
      }),
    );
  }
  console.log(
    `  Vehicle maintenance: ${vendors.length} garages and stations, ${fills} fuel fills, ${tickets} jobs for ${buses.length} buses`,
  );
}

function daysBack(date: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000);
}
