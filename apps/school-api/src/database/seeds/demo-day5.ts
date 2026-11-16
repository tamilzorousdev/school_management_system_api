import { EntityManager, In } from 'typeorm';
import { SalaryStructure } from '../../modules/payroll/entities/salary-structure.entity';
import { School } from '../../modules/schools/entities/school.entity';
import { AcademicYear } from '../../modules/setup/entities/academic-year.entity';
import { Staff } from '../../modules/staff/entities/staff.entity';
import { LeaveType } from '../../modules/staff-leave/entities/leave-type.entity';
import { StaffLeave } from '../../modules/staff-leave/entities/staff-leave.entity';
import { RouteStop } from '../../modules/transport/entities/route-stop.entity';
import { StudentTransport } from '../../modules/transport/entities/student-transport.entity';
import { TransportRoute } from '../../modules/transport/entities/transport-route.entity';
import { Vehicle } from '../../modules/transport/entities/vehicle.entity';
import { passengerRef } from '../../modules/transport/routes.service';
import { User } from '../../modules/users/entities/user.entity';
import { todayIn } from '../../shared/dates';
import { addDays, weekday } from '../../shared/school-days';

export const SALARY_BY_DESIGNATION: Record<string, [number, number, boolean]> = {
  Principal: [68000, 6000, false],
  'Administrative Officer': [42000, 3000, false],
  'Transport In-charge': [26000, 2000, false],
  'PG Assistant': [36000, 4000, false],
  'BT Assistant': [30000, 3000, false],
  'Physical Education Teacher': [26000, 2000, false],
  'Computer Instructor': [24000, 2000, false],
  'Secondary Grade Teacher': [25000, 2000, false],
  'Art Teacher': [22000, 1500, false],
  'Special Educator': [26000, 2000, false],
  'Music Teacher': [22000, 1500, false],
  'Bus Driver': [13000, 1000, true],
  'Bus Attendant': [9500, 500, true],
};

const DEMO_TRACKER = { id: 1, imei: '860000000000001' };

const ROUTES: {
  code: string;
  name: string;
  stops: [string, string | null, number, number, string, string, number][];
}[] = [
  {
    code: 'R1',
    name: 'Mogappair - Anna Nagar West - School',
    stops: [
      ['Mogappair East bus stand', 'Near the water tank', 13.0846, 80.1767, '07:00', '16:35', 1500],
      ['Anna Nagar West depot', null, 13.0938, 80.1956, '07:12', '16:25', 1200],
      ['Thirumangalam metro', 'Gate A', 13.085, 80.2017, '07:20', '16:15', 1000],
      ['Anna Nagar Roundtana', 'Opposite the bakery', 13.0849, 80.2105, '07:28', '16:08', 800],
    ],
  },
  {
    code: 'R2',
    name: 'Kilpauk - Shenoy Nagar - School',
    stops: [
      ['Kilpauk Garden Road', null, 13.0827, 80.237, '07:05', '16:40', 1500],
      ['Shenoy Nagar market', 'Near the temple', 13.0794, 80.224, '07:15', '16:30', 1200],
      ['Aminjikarai signal', null, 13.073, 80.2224, '07:20', '16:22', 1200],
      ['Anna Nagar East park', null, 13.087, 80.221, '07:28', '16:12', 800],
    ],
  },
];

export async function seedDemoDay5(manager: EntityManager, school: School): Promise<void> {
  const schoolId = school.id;
  if (await manager.exists(Vehicle, { where: { school_id: schoolId } })) {
    console.log(`Day 5     ${school.code}  buses, routes, salaries already set up: kept`);
    return;
  }
  const today = todayIn(process.env.APP_TIMEZONE ?? 'Asia/Kolkata');
  const year = await manager.findOneByOrFail(AcademicYear, { school_id: schoolId, is_current: true });
  const staff = await manager.find(Staff, { where: { school_id: schoolId }, relations: { user: true } });

  const structures = staff
    .filter((member) => member.status !== 'resigned' && SALARY_BY_DESIGNATION[member.designation])
    .map((member) => {
      const [basic, special, esi] = SALARY_BY_DESIGNATION[member.designation]!;
      return manager.create(SalaryStructure, {
        school_id: schoolId,
        user_id: member.user_id,
        effective_from: year.start_date,
        basic,
        da: Math.round(basic * 0.1),
        hra: Math.round(basic * 0.4),
        conveyance: 1600,
        special_allowance: special,
        other_allowance: 0,
        pf_enabled: true,
        esi_enabled: esi,
        professional_tax: basic >= 21000 ? 208 : basic >= 15000 ? 125 : 0,
        tds: basic >= 60000 ? 2500 : 0,
        other_deduction: 0,
      });
    });
  const withoutSalary = staff.find((member) => member.designation === 'Computer Instructor');
  await manager.save(structures.filter((row) => row.user_id !== withoutSalary?.user_id));

  const users = await manager.findBy(User, { mobile: In(['9000000007', '9000000008']), school_id: schoolId });
  const driver = users.find((user) => user.mobile === '9000000007');
  const attendant = users.find((user) => user.mobile === '9000000008');
  const approval = { duty_approved_at: new Date(), duty_approved_until: addDays(today, 6) };
  if (driver) {
    await manager.update(
      Staff,
      { school_id: schoolId, user_id: driver.id },
      {
        licence_no: 'TN0920150012345',
        licence_type: 'TRANSPORT',
        licence_issued_on: '2015-08-15',
        licence_expiry: '2029-08-14',
        badge_no: 'PSV0912345',
        badge_expiry: '2027-08-14',
        medical_fitness_expiry: addDays(today, 6),
        police_verified_on: '2026-04-10',
        police_verification_expiry: '2028-04-09',
        ...approval,
      },
    );
  }
  if (attendant) {
    await manager.update(
      Staff,
      { school_id: schoolId, user_id: attendant.id },
      {
        medical_fitness_expiry: '2027-05-31',
        police_verified_on: '2026-05-02',
        police_verification_expiry: '2028-05-01',
        ...approval,
        duty_approved_until: '2027-05-31',
      },
    );
  }
  const busOne = await manager.save(
    manager.create(Vehicle, {
      school_id: schoolId,
      registration_no: 'TN 09 AB 1234',
      name: 'Bus 1',
      make_model: 'Tata Starbus 40',
      capacity: 40,
      device_id: DEMO_TRACKER.id,
      device_imei: DEMO_TRACKER.imei,
      driver_user_id: driver?.id ?? null,
      attendant_user_id: attendant?.id ?? null,
      insurance_expiry: '2027-03-31',
      fitness_expiry: '2027-06-30',
      puc_expiry: addDays(today, 12),
      permit_expiry: '2027-09-30',
      status: 'active',
    }),
  );
  const busTwo = await manager.save(
    manager.create(Vehicle, {
      school_id: schoolId,
      registration_no: 'TN 09 CD 5678',
      name: 'Bus 2',
      make_model: 'Ashok Leyland Lynx 32',
      capacity: 32,
      device_id: null,
      device_imei: null,
      driver_user_id: null,
      attendant_user_id: null,
      insurance_expiry: addDays(today, 5),
      fitness_expiry: addDays(today, -3),
      puc_expiry: '2027-01-31',
      permit_expiry: '2027-09-30',
      status: 'active',
    }),
  );

  const stopIds: number[][] = [];
  const routeIds: number[] = [];
  for (const [index, definition] of ROUTES.entries()) {
    const route = await manager.save(
      manager.create(TransportRoute, {
        school_id: schoolId,
        code: definition.code,
        name: definition.name,
        vehicle_id: index === 0 ? busOne.id : busTwo.id,
        is_active: true,
      }),
    );
    const stops = await manager.save(
      definition.stops.map(([name, landmark, lat, lng, pickup, drop, fee], sequence) =>
        manager.create(RouteStop, {
          school_id: schoolId,
          route_id: route.id,
          name,
          landmark,
          lat,
          lng,
          sequence: sequence + 1,
          pickup_time: pickup,
          drop_time: drop,
          geofence_radius_m: 120,
          monthly_fee: fee,
        }),
      ),
    );
    routeIds.push(route.id);
    stopIds.push(stops.map((stop) => stop.id));
  }

  const students: { id: number; class_name: string; section_name: string | null }[] = await manager.query(
    `SELECT s.id, c.name AS class_name, sec.name AS section_name FROM students s
     JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $2
     JOIN classes c ON c.id = e.class_id LEFT JOIN sections sec ON sec.id = e.section_id
     WHERE s.school_id = $1 AND s.deleted_at IS NULL AND s.status = 'active' ORDER BY s.id`,
    [schoolId, year.id],
  );
  const riders = students.filter((_student, index) => index % 3 !== 2);
  await manager.save(
    riders.map((student, index) => {
      const routeIndex = student.class_name === '6' && student.section_name === 'A' ? 0 : index % 2;
      const stops = stopIds[routeIndex]!;
      const stop = stops[index % stops.length]!;
      return manager.create(StudentTransport, {
        school_id: schoolId,
        student_id: student.id,
        route_id: routeIds[routeIndex]!,
        stop_id: stop,
        mode: index % 7 === 0 ? 'pickup' : 'both',
        start_date: year.start_date,
        passenger_ref: passengerRef(),
      });
    }),
  );

  let leaveDay = addDays(today, 1);
  while (weekday(leaveDay) === 0) leaveDay = addDays(leaveDay, 1);
  const absentTeacher = staff.find((member) => member.user?.mobile === '9000000006');
  const casual = await manager.findOneBy(LeaveType, { school_id: schoolId, code: 'CL' });
  const principal = staff.find((member) => member.designation === 'Principal');
  if (absentTeacher && casual) {
    await manager.save(
      manager.create(StaffLeave, {
        school_id: schoolId,
        user_id: absentTeacher.user_id,
        leave_type_id: casual.id,
        academic_year_id: year.id,
        from_date: leaveDay,
        to_date: leaveDay,
        half_day: false,
        days: '1',
        reason: 'Family function',
        status: 'approved',
        principal_user_id: principal?.user_id ?? null,
        principal_decided_at: new Date(),
        created_by: absentTeacher.user_id,
      }),
    );
  }
  console.log(
    `Day 5     ${school.code}  2 buses, ${ROUTES.length} routes, ${riders.length} students on the bus, ${structures.length - (withoutSalary ? 1 : 0)} salaries, substitute needed on ${leaveDay}`,
  );
}
