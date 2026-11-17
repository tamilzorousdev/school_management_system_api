import { EntityManager, In } from 'typeorm';
import { School } from '../../modules/schools/entities/school.entity';
import { StaffDocument, StaffDocumentType } from '../../modules/staff/entities/staff-document.entity';
import { Staff } from '../../modules/staff/entities/staff.entity';
import { VehicleExpiryKind } from '../../modules/transport/entities/expiry-alert.entity';
import { VEHICLE_EXPIRY_FIELDS, VehicleDocument } from '../../modules/transport/entities/vehicle-document.entity';
import { Vehicle } from '../../modules/transport/entities/vehicle.entity';
import { EXPIRY_LABELS } from '../../modules/transport/transport.logic';
import { User } from '../../modules/users/entities/user.entity';
import { todayIn } from '../../shared/dates';
import { addDays } from '../../shared/school-days';
import { sampleFile } from './demo-staff';

const CREW_DOCUMENTS: Record<string, [StaffDocumentType, string][]> = {
  '9000000007': [
    ['driving_licence', 'Driving licence'],
    ['psv_badge', 'PSV badge'],
    ['medical_fitness', 'Medical fitness certificate'],
    ['police_verification', 'Police verification'],
  ],
  '9000000008': [
    ['medical_fitness', 'Medical fitness certificate'],
    ['police_verification', 'Police verification'],
  ],
};

type BusDocuments = Partial<Record<VehicleExpiryKind, number>>;

const BUSES: {
  registration_no: string;
  master: Partial<Vehicle>;
  documents: BusDocuments;
  verified: boolean;
}[] = [
  {
    registration_no: 'TN 09 AB 1234',
    master: {
      vehicle_type: 'bus',
      fuel_type: 'diesel',
      manufacture_year: 2019,
      chassis_no: 'MAT448123K1A12345',
      engine_no: '497TC81ABC123456',
      ownership: 'school',
    },
    documents: {
      rc: 2800,
      insurance: 135,
      fitness: 225,
      permit: 318,
      puc: 12,
      road_tax: 135,
      speed_governor: 60,
      fire_extinguisher: 21,
      first_aid: 9,
    },
    verified: true,
  },
  {
    registration_no: 'TN 09 CD 5678',
    master: {
      vehicle_type: 'mini_bus',
      fuel_type: 'diesel',
      manufacture_year: 2017,
      chassis_no: 'MB1PBEFC5HPXT2345',
      engine_no: 'H4D12345678',
      ownership: 'contractor',
      contractor_name: 'Sri Murugan Travels',
      contractor_mobile: '9840012345',
    },
    documents: { rc: 2100, insurance: 5, fitness: -3, permit: 318, puc: 76, road_tax: 40, first_aid: -10 },
    verified: false,
  },
];

export async function seedDemoFleet(manager: EntityManager, school: School): Promise<void> {
  const schoolId = school.id;
  if (await manager.exists(VehicleDocument, { where: { school_id: schoolId } })) {
    console.log('  Fleet documents already exist; skipping crew and bus documents');
    return;
  }
  const today = todayIn(process.env.APP_TIMEZONE ?? 'Asia/Kolkata');
  await seedCrew(manager, schoolId, today);
  for (const bus of BUSES) {
    const vehicle = await manager.findOneBy(Vehicle, { school_id: schoolId, registration_no: bus.registration_no });
    if (!vehicle) continue;
    const dates = Object.fromEntries(
      Object.entries(bus.documents).map(([kind, days]) => [
        VEHICLE_EXPIRY_FIELDS[kind as VehicleExpiryKind],
        addDays(today, days),
      ]),
    );
    await manager.update(Vehicle, vehicle.id, { ...bus.master, ...dates });
    for (const [kind, days] of Object.entries(bus.documents) as [VehicleExpiryKind, number][]) {
      await manager.insert(VehicleDocument, {
        school_id: schoolId,
        vehicle_id: vehicle.id,
        type: kind,
        title: EXPIRY_LABELS[kind],
        number: `${kind.toUpperCase().slice(0, 3)}-${vehicle.id}${Math.abs(days)}`,
        expiry_date: addDays(today, days),
        file_id: await sampleFile(manager, schoolId, EXPIRY_LABELS[kind], vehicle.registration_no),
        status: bus.verified ? 'verified' : 'pending',
        verified_at: bus.verified ? new Date() : null,
      });
    }
  }
  console.log('  Fleet: crew documents, bus master details and documents');
}

async function seedCrew(manager: EntityManager, schoolId: number, today: string): Promise<void> {
  const users = await manager.findBy(User, { school_id: schoolId, mobile: In(Object.keys(CREW_DOCUMENTS)) });
  for (const user of users) {
    const staff = await manager.findOneBy(Staff, { school_id: schoolId, user_id: user.id });
    if (!staff) continue;
    const driver = user.mobile === '9000000007';
    const dates = {
      medical_fitness_expiry: addDays(today, 200),
      police_verified_on: '2026-04-10',
      police_verification_expiry: addDays(today, 520),
      ...(driver
        ? {
            licence_no: staff.licence_no ?? 'TN0920150012345',
            licence_type: 'TRANSPORT',
            licence_issued_on: '2015-08-15',
            licence_expiry: staff.licence_expiry ?? '2029-08-14',
            badge_no: 'PSV0912345',
            badge_expiry: addDays(today, 24),
          }
        : {}),
    };
    await manager.update(Staff, staff.id, {
      ...dates,
      duty_approved_at: new Date(),
      duty_approved_until: driver ? dates.badge_expiry : dates.medical_fitness_expiry,
    });
    const existing = await manager.findBy(StaffDocument, { staff_id: staff.id });
    for (const [type, title] of CREW_DOCUMENTS[user.mobile] ?? []) {
      if (existing.some((document) => document.type === type && document.status === 'verified')) continue;
      await manager.insert(StaffDocument, {
        school_id: schoolId,
        staff_id: staff.id,
        type,
        title,
        file_id: await sampleFile(manager, schoolId, title, user.name),
        status: 'verified',
        verified_at: new Date(),
      });
    }
  }
}

const CREW_PROFILES: Record<string, { email: string; contact: string }> = {
  '9000000007': { email: 'ganesan.driver@tamilzorous.in', contact: 'Lakshmi Ganesan (wife)' },
  '9000000008': { email: 'revathi.attendant@tamilzorous.in', contact: 'Kannan R (husband)' },
  '9000000701': { email: 'muthu.driver@tamilzorous.in', contact: 'Selvi Muthu (wife)' },
  '9000000702': { email: 'saroja.attendant@tamilzorous.in', contact: 'Velu S (husband)' },
};

export async function seedDriverProfiles(manager: EntityManager, school: School): Promise<void> {
  const users = await manager.findBy(User, { school_id: school.id, mobile: In(Object.keys(CREW_PROFILES)) });
  let filled = 0;
  for (const user of users) {
    const profile = CREW_PROFILES[user.mobile]!;
    const staff = await manager.findOneBy(Staff, { school_id: school.id, user_id: user.id });
    if (!staff) continue;
    if (!user.email) {
      await manager.update(User, user.id, { email: profile.email });
      filled += 1;
    }
    if (!staff.emergency_contact_name || staff.emergency_contact_name === 'Family contact') {
      await manager.update(Staff, staff.id, { emergency_contact_name: profile.contact });
      filled += 1;
    }
  }
  console.log(`  Driver profiles: ${filled ? `${filled} details filled` : 'already set up: kept'}`);
}
