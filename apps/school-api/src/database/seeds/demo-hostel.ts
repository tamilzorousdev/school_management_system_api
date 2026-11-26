import { EntityManager, In, IsNull } from 'typeorm';
import {
  HostelAdmission,
  HostelAllocation,
  HostelApplication,
  HostelAuditLog,
} from '../../modules/hostel/entities/hostel-admission.entity';
import {
  HostelHealthLog,
  HostelLaundryBatch,
  HostelLaundryItem,
  HostelMedication,
  HostelMedicationDose,
  HostelMessMenu,
  MEALS,
} from '../../modules/hostel/entities/hostel-care.entity';
import {
  HostelComplaint,
  HostelDisciplineCase,
  HostelFeeSchedule,
  HostelMaintenanceTicket,
  HostelTicketUpdate,
} from '../../modules/hostel/entities/hostel-conduct.entity';
import {
  HostelDutyRoster,
  HostelDutyShift,
  HostelNightRound,
  HostelSeatAllocation,
  HostelStudyHall,
  HostelStudySchedule,
  HostelStudySeat,
} from '../../modules/hostel/entities/hostel-duty.entity';
import {
  HostelApprovedVisitor,
  HostelBlocklist,
  HostelLeave,
  HostelRollCall,
  HostelRollCallRecord,
  HostelVisit,
} from '../../modules/hostel/entities/hostel-movement.entity';
import {
  CheckResult,
  HostelInspection,
  HostelInspectionItem,
  HostelLocker,
  HostelLockerAllocation,
  HostelRoomAsset,
} from '../../modules/hostel/entities/hostel-rooms.entity';
import {
  Hostel,
  HostelBed,
  HostelBlock,
  HostelFloor,
  HostelRoom,
  HostelRoomType,
  HostelSettings,
} from '../../modules/hostel/entities/hostel.entity';
import { seatLabels } from '../../modules/hostel/hostel-duty.logic';
import {
  DEFAULT_CHECKLIST,
  inspectionResult,
  inspectionScore,
  lockerNumbers,
} from '../../modules/hostel/hostel-rooms.logic';
import {
  bedLabels,
  HOSTEL_OPTIONAL_MODULES,
  RollStatus,
  serialNumber,
  slaDueAt,
} from '../../modules/hostel/hostel.logic';
import { School } from '../../modules/schools/entities/school.entity';
import { SequencesService } from '../../modules/schools/sequences.service';
import { todayIn } from '../../shared/dates';
import { addDays } from '../../shared/school-days';

const ZONE = process.env.APP_TIMEZONE ?? 'Asia/Kolkata';
const WARDEN_MOBILE = '9000000019';
const ASSISTANT_MOBILE = '9000000020';
const ADMIN_MOBILE = '9876543210';
const SHOWCASE_PARENTS = ['9000000005', '9000000006'];
const RESIDENTS_PER_HOSTEL = 15;
const IN_TIME = '19:00';

const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60000);
const capital = (value: string | null) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Parent');

const ROOM_TYPES = [
  {
    name: '4-sharing non-AC',
    code: 'NAC4',
    default_beds: 4,
    is_ac: false,
    attached_bathroom: false,
    annual_fee: 60000,
    amenities: 'Cot, mattress, cupboard, study table, fan; common bathroom',
  },
  {
    name: '2-sharing AC',
    code: 'AC2',
    default_beds: 2,
    is_ac: true,
    attached_bathroom: true,
    annual_fee: 90000,
    amenities: 'AC, attached bathroom, cot, mattress, cupboard, study table',
  },
];

const FLOOR_LAYOUT = ['NAC4', 'NAC4', 'NAC4', 'NAC4', 'AC2', 'AC2'];
const FILL: Record<string, number> = { NAC4: 3, AC2: 2 };
const FLOORS: [string, number][] = [
  ['Ground floor', 0],
  ['First floor', 1],
];

const HOSTELS = [
  {
    name: 'Boys Hostel',
    code: 'BH',
    gender: 'boys' as const,
    phone: WARDEN_MOBILE,
    address: 'Behind the main block, 12, 2nd Avenue, Anna Nagar, Chennai',
    notes: 'Gate closes at 7 pm. Visitors on Saturday and Sunday, 4 pm to 6 pm.',
  },
  {
    name: 'Girls Hostel',
    code: 'GH',
    gender: 'girls' as const,
    phone: ASSISTANT_MOBILE,
    address: '14, 2nd Avenue, Anna Nagar, Chennai',
    notes: 'Gate closes at 6:30 pm. Visitors only from the approved list.',
  },
];

const RULES = [
  'Be back in the hostel by 7 pm.',
  'Lights out at 10 pm; no phones after 9 pm.',
  'Visitors meet students only in the visitors room.',
  'Report illness to the warden at once.',
].join('\n');

const ROOM_ASSETS: [string, boolean][] = [
  ['Cot', true],
  ['Mattress', true],
  ['Cupboard', true],
  ['Table', true],
  ['Chair', true],
  ['Fan', false],
];

const MENU: [string, string | null][][] = [
  [
    ['Poori, potato masala, tea', null],
    ['Vegetable biryani, raita, gulab jamun', 'Chicken biryani'],
    ['Banana bajji, coffee', null],
    ['Chapati, paneer butter masala, curd rice', 'Egg curry'],
  ],
  [
    ['Idli, sambar, coconut chutney, tea', null],
    ['Rice, sambar, beans poriyal, rasam, curd', null],
    ['Sundal, tea', null],
    ['Chapati, vegetable kurma, rice, rasam', null],
  ],
  [
    ['Pongal, vada, sambar, coffee', null],
    ['Rice, vathal kuzhambu, cabbage poriyal, rasam, curd', 'Fish fry'],
    ['Biscuits, milk', null],
    ['Dosa, tomato chutney, sambar', 'Egg dosa'],
  ],
  [
    ['Upma, coconut chutney, tea', null],
    ['Rice, dal, potato fry, rasam, curd', null],
    ['Vegetable puff, tea', null],
    ['Chapati, chana masala, curd rice', 'Chicken curry'],
  ],
  [
    ['Idiyappam, vegetable stew, coffee', null],
    ['Lemon rice, curd rice, appalam, pickle', null],
    ['Groundnut sundal, milk', null],
    ['Parotta, vegetable salna', 'Egg salna'],
  ],
  [
    ['Rava dosa, sambar, chutney, tea', null],
    ['Rice, more kuzhambu, carrot poriyal, rasam, curd', 'Fish curry'],
    ['Masala vada, coffee', null],
    ['Chapati, dal fry, jeera rice', null],
  ],
  [
    ['Semiya upma, chutney, tea', null],
    ['Tomato rice, potato fry, curd rice', null],
    ['Fruit salad', null],
    ['Idli, sambar, chutney, kesari', 'Chicken chukka'],
  ],
];

interface Staffer {
  id: number | null;
  name: string;
}

interface Kid {
  id: number;
  gender: string;
  name: string;
  grade_level: number;
  parent_user_id: number | null;
  guardian_name: string | null;
  guardian_mobile: string | null;
  relation: string | null;
  showcase: boolean;
}

interface Resident extends Kid {
  admission_id: number;
  hostel_id: number;
  room_id: number;
  room_no: string;
  bed_id: number;
  admitted_on: string;
}

interface RoomPlan {
  room: HostelRoom;
  beds: HostelBed[];
  type: HostelRoomType;
}

interface Place {
  hostel: Hostel;
  blocks: HostelBlock[];
  rooms: RoomPlan[];
  keeper: Staffer;
}

interface Ctx {
  manager: EntityManager;
  schoolId: number;
  today: string;
  now: string;
  year: { id: number; start_date: string; end_date: string };
  sequences: SequencesService;
  warden: Staffer;
  assistant: Staffer;
  audit: Partial<HostelAuditLog>[];
}

export async function seedDemoHostel(manager: EntityManager, school: School): Promise<void> {
  if (await manager.existsBy(Hostel, { school_id: school.id })) {
    console.log('Hostel    hostels already set up: kept');
    return;
  }
  const [year] = await manager.query(
    `SELECT id, start_date::text AS start_date, end_date::text AS end_date FROM academic_years
     WHERE school_id = $1 AND is_current = true AND deleted_at IS NULL LIMIT 1`,
    [school.id],
  );
  if (!year) {
    console.log('Hostel    no current academic year: skipped');
    return;
  }
  const kids = await loadKids(manager, school.id);
  const boys = kids.filter((kid) => kid.gender === 'male');
  const girls = kids.filter((kid) => kid.gender === 'female');
  if (boys.length < 10 || girls.length < 6) {
    console.log('Hostel    not enough active students: skipped');
    return;
  }
  const admin = await staffer(manager, ADMIN_MOBILE, { id: null, name: 'School Admin' });
  const ctx: Ctx = {
    manager,
    schoolId: school.id,
    today: todayIn(ZONE),
    now: new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(
      new Date(),
    ),
    year: { id: Number(year.id), start_date: year.start_date, end_date: year.end_date },
    sequences: new SequencesService(),
    warden: await staffer(manager, WARDEN_MOBILE, admin),
    assistant: await staffer(manager, ASSISTANT_MOBILE, admin),
    audit: [],
  };

  await seedSettings(ctx);
  const types = await seedRoomTypes(ctx);
  const [boysPlace, girlsPlace] = [
    await buildHostel(ctx, HOSTELS[0]!, types, ctx.warden),
    await buildHostel(ctx, HOSTELS[1]!, types, ctx.assistant),
  ];
  const boyCount = Math.min(RESIDENTS_PER_HOSTEL, boys.length - 2);
  const girlCount = Math.min(RESIDENTS_PER_HOSTEL, girls.length - 1);
  const boysIn = await admit(ctx, boysPlace, boys.slice(0, boyCount));
  const girlsIn = await admit(ctx, girlsPlace, girls.slice(0, girlCount));
  const applications = await seedApplications(ctx, boysPlace, girlsPlace, types, [
    boys[boyCount]!,
    girls[girlCount]!,
    boys[boyCount + 1]!,
  ]);
  await seedFeeSchedule(ctx);
  const leaves = await seedLeaves(ctx, boysIn, girlsIn);
  const rollCalls = await seedRollCalls(ctx, [boysPlace, girlsPlace], [...boysIn, ...girlsIn], leaves.out);
  const visits = await seedVisits(ctx, boysIn, girlsIn);
  const cases = await seedCases(ctx, boysIn, leaves.returned);
  const tickets = await seedTickets(ctx, boysPlace, girlsPlace, boysIn, girlsIn);
  await seedMessMenu(ctx);
  const health = await seedHealth(ctx, boysIn, girlsIn);
  await seedLaundry(ctx, boysPlace, boysIn);
  const roster = await seedDuty(ctx, boysPlace, girlsPlace);
  const seats = await seedStudy(ctx, boysPlace, boysIn);
  const lockers = await seedLockers(ctx, boysPlace, boysIn);
  const assets = await seedRoomAssets(ctx, [boysPlace, girlsPlace]);
  await seedInspection(ctx, boysPlace, cases.damage);
  await manager.save(ctx.audit.map((row) => manager.create(HostelAuditLog, row)));

  const rooms = boysPlace.rooms.length + girlsPlace.rooms.length;
  const beds = [...boysPlace.rooms, ...girlsPlace.rooms].reduce((sum, plan) => sum + plan.beds.length, 0);
  console.log(
    `Hostel    2 hostels, ${rooms} rooms, ${beds} beds, ${boysIn.length + girlsIn.length} residents, ${applications} applications, ${rollCalls} roll calls, ${leaves.count} leaves, ${visits} visits, 2 discipline cases, ${tickets} complaints and tickets, ${health} health logs, ${roster} duty slots, ${seats} study seats taken, ${lockers} lockers allotted, ${assets} room assets, 1 inspection`,
  );
}

async function loadKids(manager: EntityManager, schoolId: number): Promise<Kid[]> {
  const rows: Record<string, unknown>[] = await manager.query(
    `SELECT DISTINCT ON (s.id) s.id, s.gender, TRIM(CONCAT(s.first_name, ' ', s.last_name)) AS name, c.grade_level,
       g.user_id AS parent_user_id, g.name AS guardian_name, g.mobile AS guardian_mobile, sg.relation,
       EXISTS (SELECT 1 FROM student_guardians sx JOIN guardians gx ON gx.id = sx.guardian_id
               WHERE sx.student_id = s.id AND gx.mobile = ANY($2::text[])) AS showcase
     FROM students s
     JOIN academic_years ay ON ay.school_id = s.school_id AND ay.is_current = true AND ay.deleted_at IS NULL
     JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ay.id
     JOIN classes c ON c.id = e.class_id
     LEFT JOIN student_guardians sg ON sg.student_id = s.id
     LEFT JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
     WHERE s.school_id = $1 AND s.deleted_at IS NULL AND s.status = 'active'
     ORDER BY s.id, (g.mobile = ANY($2::text[])) DESC NULLS LAST, sg.is_primary DESC NULLS LAST, g.id`,
    [schoolId, SHOWCASE_PARENTS],
  );
  return rows
    .map((row) => ({
      id: Number(row.id),
      gender: String(row.gender),
      name: String(row.name),
      grade_level: Number(row.grade_level ?? 0),
      parent_user_id: row.parent_user_id ? Number(row.parent_user_id) : null,
      guardian_name: (row.guardian_name as string | null) ?? null,
      guardian_mobile: (row.guardian_mobile as string | null) ?? null,
      relation: (row.relation as string | null) ?? null,
      showcase: Boolean(row.showcase),
    }))
    .sort((a, b) => Number(b.showcase) - Number(a.showcase) || b.grade_level - a.grade_level || a.id - b.id);
}

async function staffer(manager: EntityManager, mobile: string, fallback: Staffer): Promise<Staffer> {
  const [row] = await manager.query(`SELECT id, name FROM users WHERE mobile = $1 AND deleted_at IS NULL LIMIT 1`, [
    mobile,
  ]);
  return row ? { id: Number(row.id), name: String(row.name) } : fallback;
}

function record(
  ctx: Ctx,
  actor: Staffer,
  entry: { entity: string; entity_id: number; action: string; student_id?: number; when: Date; note?: string },
): void {
  ctx.audit.push({
    school_id: ctx.schoolId,
    entity: entry.entity,
    entity_id: entry.entity_id,
    action: entry.action,
    student_id: entry.student_id ?? null,
    actor_user_id: actor.id,
    actor_name: actor.name,
    changes: null,
    note: entry.note ?? null,
    created_at: entry.when,
  });
}

async function serial(ctx: Ctx, prefix: string, key: string, year: string): Promise<string> {
  return serialNumber(prefix, year, await ctx.sequences.next(ctx.manager, ctx.schoolId, `${key}:${year}`));
}

async function seedSettings(ctx: Ctx): Promise<void> {
  await ctx.manager.upsert(
    HostelSettings,
    {
      school_id: ctx.schoolId,
      enabled_modules: Object.fromEntries(HOSTEL_OPTIONAL_MODULES.map((key) => [key, true])),
      caution_deposit: 5000,
      bill_on_admission: true,
      rules: RULES,
      updated_by: ctx.warden.id,
    },
    ['school_id'],
  );
}

async function seedRoomTypes(ctx: Ctx): Promise<Map<string, HostelRoomType>> {
  const types = new Map<string, HostelRoomType>();
  for (const type of ROOM_TYPES) {
    const existing = await ctx.manager.findOneBy(HostelRoomType, {
      school_id: ctx.schoolId,
      code: type.code,
      deleted_at: IsNull(),
    });
    types.set(
      type.code,
      existing ??
        (await ctx.manager.save(
          ctx.manager.create(HostelRoomType, { ...type, school_id: ctx.schoolId, created_by: ctx.warden.id }),
        )),
    );
  }
  return types;
}

async function buildHostel(
  ctx: Ctx,
  plan: (typeof HOSTELS)[number],
  types: Map<string, HostelRoomType>,
  keeper: Staffer,
): Promise<Place> {
  const { manager, schoolId } = ctx;
  const hostel = await manager.save(
    manager.create(Hostel, {
      ...plan,
      school_id: schoolId,
      status: 'active',
      warden_user_id: keeper.id,
      created_by: ctx.warden.id,
    }),
  );
  const blocks: HostelBlock[] = [];
  const rooms: RoomPlan[] = [];
  for (const [blockIndex, code] of ['A', 'B'].entries()) {
    const block = await manager.save(
      manager.create(HostelBlock, {
        school_id: schoolId,
        hostel_id: hostel.id,
        name: `${code} Block`,
        code,
        sort_order: blockIndex,
        incharge_user_id: keeper.id,
        created_by: ctx.warden.id,
      }),
    );
    blocks.push(block);
    for (const [name, level] of FLOORS) {
      const floor = await manager.save(
        manager.create(HostelFloor, {
          school_id: schoolId,
          hostel_id: hostel.id,
          block_id: block.id,
          name,
          level,
          created_by: ctx.warden.id,
        }),
      );
      for (const [position, typeCode] of FLOOR_LAYOUT.entries()) {
        const type = types.get(typeCode)!;
        const room = await manager.save(
          manager.create(HostelRoom, {
            school_id: schoolId,
            hostel_id: hostel.id,
            block_id: block.id,
            floor_id: floor.id,
            room_type_id: type.id,
            room_no: `${code}-${level}${String(position + 1).padStart(2, '0')}`,
            capacity: type.default_beds,
            status: 'active',
            notes: null,
            created_by: ctx.warden.id,
          }),
        );
        const beds = await manager.save(
          bedLabels(type.default_beds).map((label) =>
            manager.create(HostelBed, {
              school_id: schoolId,
              hostel_id: hostel.id,
              room_id: room.id,
              bed_no: label,
              status: 'vacant',
              created_by: ctx.warden.id,
            }),
          ),
        );
        rooms.push({ room, beds, type });
      }
    }
  }
  return { hostel, blocks, rooms, keeper };
}

async function admit(ctx: Ctx, place: Place, kids: Kid[]): Promise<Resident[]> {
  const { manager, schoolId } = ctx;
  const startYear = ctx.year.start_date.slice(0, 4);
  const slots = place.rooms.flatMap((plan) =>
    plan.beds.slice(0, FILL[plan.type.code] ?? 0).map((bed) => ({ plan, bed })),
  );
  const residents: Resident[] = [];
  for (const [index, kid] of kids.entries()) {
    const slot = slots[index];
    if (!slot) break;
    const admittedOn = [addDays(ctx.year.start_date, 2 + (index % 6)), ctx.today].sort()[0]!;
    const localGuardian = index % 4 === 0;
    const admission = await manager.save(
      manager.create(HostelAdmission, {
        school_id: schoolId,
        admission_no: await serial(ctx, 'HST', 'hostel_admission', startYear),
        student_id: kid.id,
        academic_year_id: ctx.year.id,
        hostel_id: place.hostel.id,
        application_id: null,
        status: 'active',
        admitted_on: admittedOn,
        diet: (['veg', 'non_veg', 'eggetarian'] as const)[index % 3]!,
        local_guardian_name: localGuardian ? ['Raghavan S', 'Malathi K', 'Prakash R', 'Sumathi V'][index % 4]! : null,
        local_guardian_mobile: localGuardian ? `98400${String(20000 + index * 53).slice(0, 5)}` : null,
        local_guardian_relation: localGuardian ? (index % 8 === 0 ? 'Uncle' : 'Aunt') : null,
        local_guardian_address: localGuardian ? `${index + 3}, Kilpauk Garden Road, Chennai` : null,
        medical_notes: index === 5 ? 'Mild asthma: inhaler kept with the warden' : null,
        notes: null,
        created_by: place.keeper.id,
        created_at: at(admittedOn, '10:00'),
      }),
    );
    await manager.insert(HostelAllocation, {
      school_id: schoolId,
      admission_id: admission.id,
      student_id: kid.id,
      hostel_id: place.hostel.id,
      room_id: slot.plan.room.id,
      bed_id: slot.bed.id,
      from_date: admittedOn,
      to_date: null,
      end_reason: null,
      created_by: place.keeper.id,
      created_at: at(admittedOn, '10:05'),
    });
    slot.bed.status = 'occupied';
    record(ctx, place.keeper, {
      entity: 'admission',
      entity_id: admission.id,
      action: 'admit',
      student_id: kid.id,
      when: at(admittedOn, '10:00'),
    });
    record(ctx, place.keeper, {
      entity: 'admission',
      entity_id: admission.id,
      action: 'allocate',
      student_id: kid.id,
      when: at(admittedOn, '10:05'),
      note: `${slot.plan.room.room_no} / ${slot.bed.bed_no}`,
    });
    residents.push({
      ...kid,
      admission_id: admission.id,
      hostel_id: place.hostel.id,
      room_id: slot.plan.room.id,
      room_no: slot.plan.room.room_no,
      bed_id: slot.bed.id,
      admitted_on: admittedOn,
    });
  }
  const occupied = residents.map((resident) => resident.bed_id);
  if (occupied.length) await manager.update(HostelBed, { id: In(occupied) }, { status: 'occupied' });
  return residents;
}

async function seedApplications(
  ctx: Ctx,
  boysPlace: Place,
  girlsPlace: Place,
  types: Map<string, HostelRoomType>,
  spare: Kid[],
): Promise<number> {
  const startYear = ctx.year.start_date.slice(0, 4);
  const plans = [
    {
      status: 'pending' as const,
      source: 'parent' as const,
      type: 'NAC4',
      reason: 'Parents are moving to Coimbatore for work',
      note: null,
    },
    {
      status: 'waitlisted' as const,
      source: 'office' as const,
      type: 'AC2',
      reason: 'Long daily travel from Avadi',
      note: 'On the AC waiting list; first in line when an AC bed frees up',
    },
    {
      status: 'approved' as const,
      source: 'office' as const,
      type: 'NAC4',
      reason: 'Preparing for board exams; wants the evening study hours',
      note: 'Approved; admit from the date wanted',
    },
  ];
  let count = 0;
  for (const [index, plan] of plans.entries()) {
    const kid = spare[index];
    if (!kid) break;
    const place = kid.gender === 'female' ? girlsPlace : boysPlace;
    const decided = plan.status !== 'pending';
    const saved = await ctx.manager.save(
      ctx.manager.create(HostelApplication, {
        school_id: ctx.schoolId,
        application_no: await serial(ctx, 'HAP', 'hostel_application', startYear),
        student_id: kid.id,
        academic_year_id: ctx.year.id,
        hostel_id: place.hostel.id,
        room_type_id: types.get(plan.type)!.id,
        source: plan.source,
        status: plan.status,
        priority: plan.status === 'waitlisted' ? 1 : 0,
        wanted_from: addDays(ctx.today, 7 + index * 3),
        reason: plan.reason,
        decided_by: decided ? place.keeper.id : null,
        decided_at: decided ? at(addDays(ctx.today, -2), '11:30') : null,
        decision_note: plan.note,
        admission_id: null,
        created_by: plan.source === 'parent' ? kid.parent_user_id : ctx.warden.id,
        created_at: at(addDays(ctx.today, -4 + index), '10:15'),
      }),
    );
    record(ctx, decided ? place.keeper : ctx.warden, {
      entity: 'application',
      entity_id: saved.id,
      action: decided ? plan.status : 'create',
      student_id: kid.id,
      when: decided ? at(addDays(ctx.today, -2), '11:30') : at(addDays(ctx.today, -4 + index), '10:15'),
    });
    count += 1;
  }
  return count;
}

async function seedFeeSchedule(ctx: Ctx): Promise<void> {
  const terms: [string, number, number][] = [
    ['Term 1', 14, 40],
    ['Term 2', 122, 30],
    ['Term 3', 218, 30],
  ];
  await ctx.manager.save(
    terms.map(([label, offset, share], index) =>
      ctx.manager.create(HostelFeeSchedule, {
        school_id: ctx.schoolId,
        academic_year_id: ctx.year.id,
        label,
        due_date: [addDays(ctx.year.start_date, offset), addDays(ctx.year.end_date, index - 2)].sort()[0]!,
        share_percent: share,
        sort_order: index,
        created_by: ctx.warden.id,
      }),
    ),
  );
}

async function seedLeaves(
  ctx: Ctx,
  boys: Resident[],
  girls: Resident[],
): Promise<{ count: number; out: HostelLeave; returned: HostelLeave }> {
  const { today } = ctx;
  const leave = async (
    resident: Resident,
    { created, ...plan }: Partial<HostelLeave> & { from_date: string; to_date: string; created: Date },
  ) => {
    const saved = await ctx.manager.save(
      ctx.manager.create(HostelLeave, {
        school_id: ctx.schoolId,
        leave_no: await serial(ctx, 'HLV', 'hostel_leave', plan.from_date.slice(0, 4)),
        admission_id: resident.admission_id,
        student_id: resident.id,
        hostel_id: resident.hostel_id,
        kind: 'home',
        expected_return_at: at(plan.to_date, plan.return_time ?? IN_TIME),
        source: 'parent',
        consent_status: 'given',
        consent_by: resident.parent_user_id,
        consent_at: created,
        escort_name: resident.guardian_name,
        escort_relation: capital(resident.relation),
        escort_mobile: resident.guardian_mobile,
        qr_version: 1,
        created_by: plan.source === 'parent' || !plan.source ? resident.parent_user_id : ctx.warden.id,
        ...plan,
        created_at: created,
      }),
    );
    record(ctx, ctx.warden, {
      entity: 'leave',
      entity_id: saved.id,
      action: 'create',
      student_id: resident.id,
      when: created,
    });
    return saved;
  };

  const returnedBoy = boys[3]!;
  const returned = await leave(returnedBoy, {
    from_date: addDays(today, -10),
    to_date: addDays(today, -8),
    depart_time: '16:30',
    reason: 'Cousin’s wedding at Madurai',
    status: 'returned',
    decided_by: ctx.warden.id,
    decided_at: at(addDays(today, -11), '18:00'),
    departed_at: at(addDays(today, -10), '16:35'),
    departed_by: ctx.warden.id,
    returned_at: at(addDays(today, -8), '19:25'),
    returned_by: ctx.warden.id,
    late_minutes: 25,
    created: at(addDays(today, -12), '20:10'),
  });

  const outBoy = boys[2]!;
  const out = await leave(outBoy, {
    from_date: addDays(today, -1),
    to_date: addDays(today, 1),
    depart_time: '16:30',
    reason: 'Grandfather’s 80th birthday at home',
    source: 'warden',
    status: 'out',
    consent_at: at(addDays(today, -2), '20:00'),
    decided_by: ctx.warden.id,
    decided_at: at(addDays(today, -2), '20:30'),
    departed_at: at(addDays(today, -1), '16:40'),
    departed_by: ctx.warden.id,
    created: at(addDays(today, -2), '18:15'),
  });
  await ctx.manager.update(HostelAdmission, { id: outBoy.admission_id }, { status: 'on_leave' });

  await leave(girls[1]!, {
    kind: 'festival',
    from_date: addDays(today, 2),
    to_date: addDays(today, 4),
    depart_time: '16:00',
    reason: 'Karthigai Deepam at home',
    status: 'approved',
    decided_by: ctx.assistant.id,
    decided_at: minutesAgo(90),
    created: minutesAgo(600),
  });

  await leave(boys[0]!, {
    from_date: addDays(today, 5),
    to_date: addDays(today, 6),
    depart_time: '17:00',
    reason: 'Family function at Trichy',
    status: 'pending',
    created: minutesAgo(45),
  });

  return { count: 4, out, returned };
}

async function seedRollCalls(ctx: Ctx, places: Place[], residents: Resident[], outLeave: HostelLeave): Promise<number> {
  const marks = new Map<string, [RollStatus, string]>();
  const mark = (offset: number, resident: Resident | undefined, status: RollStatus, note: string) => {
    if (resident) marks.set(`${addDays(ctx.today, offset)}:${resident.admission_id}`, [status, note]);
  };
  const boys = residents.filter((resident) => resident.gender === 'male');
  const girls = residents.filter((resident) => resident.gender === 'female');
  mark(
    -1,
    boys.find((resident) => resident.admission_id === outLeave.admission_id),
    'on_leave',
    outLeave.leave_no,
  );
  mark(-3, boys[8], 'absent', 'Not in the room; found in the TV room at 22:10');
  mark(-1, boys[9], 'absent', 'Not in the room at roll call');
  mark(-2, girls[3], 'late', 'Came back from the library at 21:40');
  mark(-3, girls[2], 'sick', 'Fever; resting in the room');

  let count = 0;
  for (const place of places) {
    const people = residents.filter((resident) => resident.hostel_id === place.hostel.id);
    for (const offset of [-3, -2, -1]) {
      const date = addDays(ctx.today, offset);
      const call = await ctx.manager.save(
        ctx.manager.create(HostelRollCall, {
          school_id: ctx.schoolId,
          hostel_id: place.hostel.id,
          roll_date: date,
          slot: 'night',
          started_by: place.keeper.id,
          finished_by: place.keeper.id,
          finished_at: at(date, '21:45'),
          created_at: at(date, '21:30'),
        }),
      );
      await ctx.manager.insert(
        HostelRollCallRecord,
        people.map((resident, index) => {
          const [status, note] = marks.get(`${date}:${resident.admission_id}`) ?? ['present' as RollStatus, null];
          return {
            school_id: ctx.schoolId,
            roll_call_id: call.id,
            admission_id: resident.admission_id,
            student_id: resident.id,
            status,
            method: 'manual' as const,
            note,
            marked_by: place.keeper.id,
            marked_at: new Date(at(date, '21:30').getTime() + index * 30000),
            parent_notified_at: status === 'absent' ? at(date, '21:50') : null,
          };
        }),
      );
      count += 1;
    }
  }
  return count;
}

async function seedVisits(ctx: Ctx, boys: Resident[], girls: Resident[]): Promise<number> {
  const { manager, schoolId, today } = ctx;
  await manager.save(
    manager.create(HostelBlocklist, {
      school_id: schoolId,
      mobile: '9876500199',
      name: 'Rajesh Kumar',
      reason: 'Court order: not allowed to meet the student',
      created_by: ctx.warden.id,
    }),
  );
  await manager.save([
    manager.create(HostelApprovedVisitor, {
      school_id: schoolId,
      student_id: boys[0]!.id,
      name: 'Narayanan K',
      relation: 'Grandfather',
      mobile: '9876500301',
      added_by_role: 'parent',
      created_by: boys[0]!.parent_user_id,
    }),
    manager.create(HostelApprovedVisitor, {
      school_id: schoolId,
      student_id: girls[0]!.id,
      name: 'Saraswathi Ammal',
      relation: 'Grandmother',
      mobile: '9876500311',
      added_by_role: 'staff',
      created_by: ctx.assistant.id,
    }),
  ]);
  const year = today.slice(0, 4);
  const plans: (Partial<HostelVisit> & { resident: Resident; by: Staffer })[] = [
    {
      resident: boys[0]!,
      by: ctx.warden,
      visitor_name: boys[0]!.guardian_name ?? 'Parent',
      relation: capital(boys[0]!.relation),
      mobile: boys[0]!.guardian_mobile ?? '9876500300',
      purpose: 'Weekend visit with snacks',
      is_known: true,
      status: 'left',
      in_at: at(addDays(today, -3), '16:10'),
      out_at: at(addDays(today, -3), '17:05'),
    },
    {
      resident: girls[0]!,
      by: ctx.assistant,
      visitor_name: 'Saraswathi Ammal',
      relation: 'Grandmother',
      mobile: '9876500311',
      people_count: 2,
      purpose: 'Brought winter clothes',
      is_known: true,
      id_proof_type: 'aadhaar',
      id_proof_last4: '4410',
      status: 'left',
      in_at: at(addDays(today, -1), '15:30'),
      out_at: at(addDays(today, -1), '16:20'),
    },
    {
      resident: boys[1]!,
      by: ctx.warden,
      visitor_name: 'Rajesh Kumar',
      relation: 'Uncle',
      mobile: '9876500199',
      purpose: 'Wanted to take the student out',
      status: 'denied',
      note: 'On the hostel block list',
      in_at: null,
      out_at: null,
    },
    {
      resident: boys[4]!,
      by: ctx.warden,
      visitor_name: 'Manikandan R',
      relation: 'Uncle',
      mobile: '9876500312',
      purpose: 'Brought medicines from home',
      id_proof_type: 'driving_licence',
      id_proof_last4: '7731',
      status: 'inside',
      in_at: minutesAgo(35),
      out_at: null,
    },
  ];
  for (const { resident, by, ...plan } of plans) {
    await manager.save(
      manager.create(HostelVisit, {
        school_id: schoolId,
        visit_no: await serial(ctx, 'HVS', 'hostel_visit', year),
        hostel_id: resident.hostel_id,
        admission_id: resident.admission_id,
        student_id: resident.id,
        people_count: 1,
        in_by: plan.in_at ? by.id : null,
        out_by: plan.out_at ? by.id : null,
        created_at: plan.in_at ?? at(addDays(today, -2), '16:30'),
        ...plan,
      }),
    );
  }
  return plans.length;
}

async function seedCases(
  ctx: Ctx,
  boys: Resident[],
  returned: HostelLeave,
): Promise<{ late: HostelDisciplineCase; damage: HostelDisciplineCase }> {
  const { manager, schoolId, today } = ctx;
  const year = today.slice(0, 4);
  const lateBoy = boys.find((resident) => resident.admission_id === returned.admission_id)!;
  const late = await manager.save(
    manager.create(HostelDisciplineCase, {
      school_id: schoolId,
      case_no: await serial(ctx, 'HDC', 'hostel_case', year),
      admission_id: lateBoy.admission_id,
      student_id: lateBoy.id,
      hostel_id: lateBoy.hostel_id,
      leave_id: returned.id,
      category: 'late_return',
      severity: 'minor',
      incident_at: returned.returned_at!,
      location: 'Hostel gate',
      description: `Came back ${returned.late_minutes} minutes after the in-time from home leave ${returned.leave_no}`,
      status: 'action_taken',
      action: 'warning',
      action_note: 'Warned; parent informed on the phone',
      visible_to_parent: true,
      decided_by: ctx.warden.id,
      decided_at: at(addDays(today, -7), '10:00'),
      created_by: ctx.warden.id,
      created_at: at(addDays(today, -8), '19:40'),
    }),
  );
  const damageBoy = boys[5]!;
  const damage = await manager.save(
    manager.create(HostelDisciplineCase, {
      school_id: schoolId,
      case_no: await serial(ctx, 'HDC', 'hostel_case', year),
      admission_id: damageBoy.admission_id,
      student_id: damageBoy.id,
      hostel_id: damageBoy.hostel_id,
      category: 'damage',
      severity: 'major',
      incident_at: at(addDays(today, -2), '18:20'),
      location: `${damageBoy.room_no} corridor`,
      description: `Broke a window pane of ${damageBoy.room_no} while playing cricket in the corridor`,
      witnesses: 'Night watchman Murugan; two roommates',
      status: 'open',
      visible_to_parent: true,
      created_by: ctx.warden.id,
      created_at: at(addDays(today, -2), '18:45'),
    }),
  );
  for (const item of [late, damage]) {
    record(ctx, ctx.warden, {
      entity: 'case',
      entity_id: item.id,
      action: 'create',
      student_id: item.student_id,
      when: item.created_at,
    });
  }
  return { late, damage };
}

async function seedTickets(
  ctx: Ctx,
  boysPlace: Place,
  girlsPlace: Place,
  boys: Resident[],
  girls: Resident[],
): Promise<number> {
  const { manager, schoolId, today } = ctx;
  const year = today.slice(0, 4);
  const updates: Partial<HostelTicketUpdate>[] = [];
  const update = (
    target: 'complaint' | 'maintenance',
    id: number,
    status: string,
    note: string,
    by: Staffer,
    when: Date,
  ) =>
    updates.push({
      school_id: schoolId,
      target,
      target_id: id,
      status,
      note,
      actor_user_id: by.id,
      actor_name: by.name,
      created_at: when,
    });

  const fanBoy = boys[0]!;
  const fanCreated = at(addDays(today, -1), '10:00');
  const fan = await manager.save(
    manager.create(HostelMaintenanceTicket, {
      school_id: schoolId,
      ticket_no: await serial(ctx, 'HMT', 'hostel_ticket', year),
      hostel_id: fanBoy.hostel_id,
      room_id: fanBoy.room_id,
      category: 'electrical',
      priority: 'high',
      title: `Replace ceiling fan regulator in ${fanBoy.room_no}`,
      description: 'Fan does not start at any speed; regulator is burnt',
      status: 'in_progress',
      assigned_to: ctx.assistant.id,
      vendor_name: 'Sri Murugan Electricals',
      scheduled_on: today,
      due_at: slaDueAt(fanCreated, 'high'),
      created_by: ctx.warden.id,
      created_at: fanCreated,
    }),
  );
  update('maintenance', fan.id, 'assigned', 'Electrician called', ctx.warden, fanCreated);
  update(
    'maintenance',
    fan.id,
    'in_progress',
    'Regulator ordered; fitting today',
    ctx.assistant,
    at(addDays(today, -1), '15:00'),
  );

  const brokenRoom = boysPlace.rooms.find((plan) => plan.room.room_no === 'B-001')!;
  const brokenBed = brokenRoom.beds[2]!;
  await manager.update(HostelBed, { id: brokenBed.id }, { status: 'maintenance', notes: 'Broken cot' });
  const cotCreated = at(addDays(today, -3), '11:00');
  const cot = await manager.save(
    manager.create(HostelMaintenanceTicket, {
      school_id: schoolId,
      ticket_no: await serial(ctx, 'HMT', 'hostel_ticket', year),
      hostel_id: boysPlace.hostel.id,
      room_id: brokenRoom.room.id,
      bed_id: brokenBed.id,
      category: 'carpentry',
      priority: 'normal',
      title: `Broken cot in ${brokenRoom.room.room_no}, bed ${brokenBed.bed_no}`,
      description: 'One leg of the cot is cracked; bed kept out of use',
      status: 'assigned',
      assigned_to: ctx.warden.id,
      vendor_name: 'Anna Nagar Wood Works',
      scheduled_on: addDays(today, 2),
      due_at: slaDueAt(cotCreated, 'normal'),
      created_by: ctx.warden.id,
      created_at: cotCreated,
    }),
  );
  update('maintenance', cot.id, 'assigned', 'Carpenter booked', ctx.warden, cotCreated);

  const waterCreated = minutesAgo(120);
  await manager.save(
    manager.create(HostelComplaint, {
      school_id: schoolId,
      complaint_no: await serial(ctx, 'HCP', 'hostel_complaint', year),
      hostel_id: girlsPlace.hostel.id,
      category: 'water',
      priority: 'high',
      title: 'No hot water in the B block bathrooms',
      description: 'The geyser in B block has not worked since this morning',
      raised_by_role: 'staff',
      status: 'open',
      due_at: slaDueAt(waterCreated, 'high'),
      created_by: ctx.assistant.id,
      created_at: waterCreated,
    }),
  );

  const fanComplaintCreated = at(addDays(today, -1), '08:30');
  const fanComplaint = await manager.save(
    manager.create(HostelComplaint, {
      school_id: schoolId,
      complaint_no: await serial(ctx, 'HCP', 'hostel_complaint', year),
      hostel_id: fanBoy.hostel_id,
      admission_id: fanBoy.admission_id,
      student_id: fanBoy.id,
      room_id: fanBoy.room_id,
      category: 'electrical',
      priority: 'high',
      title: 'Fan in my son’s room is not working',
      description: 'He could not sleep last night because of the heat',
      raised_by_role: 'parent',
      status: 'in_progress',
      assigned_to: ctx.assistant.id,
      due_at: slaDueAt(fanComplaintCreated, 'high'),
      maintenance_ticket_id: fan.id,
      created_by: fanBoy.parent_user_id,
      created_at: fanComplaintCreated,
    }),
  );
  await manager.update(HostelMaintenanceTicket, { id: fan.id }, { complaint_id: fanComplaint.id });
  update(
    'complaint',
    fanComplaint.id,
    'in_progress',
    `Maintenance ticket ${fan.ticket_no} raised`,
    ctx.warden,
    fanCreated,
  );

  const foodGirl = girls[0]!;
  const foodCreated = at(addDays(today, -5), '20:30');
  const food = await manager.save(
    manager.create(HostelComplaint, {
      school_id: schoolId,
      complaint_no: await serial(ctx, 'HCP', 'hostel_complaint', year),
      hostel_id: foodGirl.hostel_id,
      admission_id: foodGirl.admission_id,
      student_id: foodGirl.id,
      category: 'food',
      priority: 'normal',
      title: 'Rice undercooked at dinner',
      description: 'Rice was hard two nights in a row',
      raised_by_role: 'parent',
      status: 'resolved',
      assigned_to: ctx.assistant.id,
      due_at: slaDueAt(foodCreated, 'normal'),
      resolution: 'Spoke to the mess cook; the rice cooker was serviced',
      resolved_at: at(addDays(today, -4), '13:00'),
      rating: 4,
      rating_comment: 'Better now, thank you',
      created_by: foodGirl.parent_user_id,
      created_at: foodCreated,
    }),
  );
  update('complaint', food.id, 'in_progress', 'Checking with the mess', ctx.assistant, at(addDays(today, -5), '21:00'));
  update('complaint', food.id, 'resolved', food.resolution!, ctx.assistant, at(addDays(today, -4), '13:00'));

  await manager.insert(HostelTicketUpdate, updates);
  return 5;
}

async function seedMessMenu(ctx: Ctx): Promise<void> {
  await ctx.manager.save(
    MENU.flatMap((day, dayOfWeek) =>
      day.map(([items, nonVeg], index) =>
        ctx.manager.create(HostelMessMenu, {
          school_id: ctx.schoolId,
          hostel_id: null,
          day_of_week: dayOfWeek,
          meal: MEALS[index]!,
          items,
          non_veg_items: nonVeg,
          created_by: ctx.warden.id,
        }),
      ),
    ),
  );
}

async function seedHealth(ctx: Ctx, boys: Resident[], girls: Resident[]): Promise<number> {
  const { manager, schoolId, today } = ctx;
  const fever = girls[2]!;
  const sick = boys[6]!;
  const ankle = boys[7]!;
  const logs = [
    manager.create(HostelHealthLog, {
      school_id: schoolId,
      admission_id: fever.admission_id,
      student_id: fever.id,
      hostel_id: fever.hostel_id,
      kind: 'illness',
      logged_at: at(addDays(today, -3), '07:10'),
      symptoms: 'Fever and body pain',
      temperature: 100.8,
      action_taken: 'Paracetamol given; rested in the room',
      doctor_name: null,
      parent_informed: true,
      status: 'closed',
      closed_at: at(addDays(today, -2), '18:00'),
      created_by: ctx.assistant.id,
    }),
    manager.create(HostelHealthLog, {
      school_id: schoolId,
      admission_id: sick.admission_id,
      student_id: sick.id,
      hostel_id: sick.hostel_id,
      kind: 'sick_bay',
      logged_at: minutesAgo(180),
      symptoms: 'Stomach ache and vomiting',
      temperature: 99.1,
      action_taken: 'Moved to the sick bay; ORS given; school nurse informed',
      doctor_name: 'Dr. Lakshmi Priya',
      parent_informed: true,
      status: 'open',
      sick_bay_from: minutesAgo(170),
      created_by: ctx.warden.id,
    }),
    manager.create(HostelHealthLog, {
      school_id: schoolId,
      admission_id: ankle.admission_id,
      student_id: ankle.id,
      hostel_id: ankle.hostel_id,
      kind: 'injury',
      logged_at: at(addDays(today, -5), '18:05'),
      symptoms: 'Twisted ankle during evening football',
      action_taken: 'Ice pack and crepe bandage; rest for two days',
      parent_informed: true,
      status: 'closed',
      closed_at: at(addDays(today, -3), '09:00'),
      created_by: ctx.warden.id,
    }),
  ];
  await manager.save(logs);

  const medication = await manager.save(
    manager.create(HostelMedication, {
      school_id: schoolId,
      admission_id: fever.admission_id,
      student_id: fever.id,
      medicine: 'Paracetamol 500 mg',
      dose: 'One tablet after food',
      times: ['08:00', '20:00'],
      from_date: addDays(today, -3),
      to_date: today,
      instructions: 'Only if the temperature is above 99 °F',
      prescribed_by: 'Dr. Lakshmi Priya',
      active: true,
      created_by: ctx.assistant.id,
    }),
  );
  const doses: [number, string, 'given' | 'refused', string | null][] = [
    [-3, '20:00', 'given', null],
    [-2, '08:00', 'given', null],
    [-2, '20:00', 'given', null],
    [-1, '08:00', 'refused', 'Said she felt better; nurse informed'],
    [-1, '20:00', 'given', null],
  ];
  await manager.insert(
    HostelMedicationDose,
    doses.map(([offset, time, status, note]) => ({
      school_id: schoolId,
      medication_id: medication.id,
      admission_id: fever.admission_id,
      dose_date: addDays(today, offset),
      dose_time: time,
      status,
      note,
      given_by: ctx.assistant.id,
      given_at: at(addDays(today, offset), time),
    })),
  );
  return logs.length;
}

async function seedLaundry(ctx: Ctx, place: Place, boys: Resident[]): Promise<void> {
  const { manager, schoolId, today } = ctx;
  const collected = addDays(today, -1);
  const batch = await manager.save(
    manager.create(HostelLaundryBatch, {
      school_id: schoolId,
      hostel_id: place.hostel.id,
      batch_no: await serial(ctx, 'HLB', 'hostel_laundry', today.slice(0, 4)),
      collected_on: collected,
      vendor_name: 'Fresh Fold Laundry',
      status: 'sent',
      sent_on: collected,
      notes: 'Weekly wash',
      created_by: ctx.warden.id,
    }),
  );
  await manager.insert(
    HostelLaundryItem,
    boys.slice(0, 8).map((resident, index) => ({
      school_id: schoolId,
      batch_id: batch.id,
      admission_id: resident.admission_id,
      student_id: resident.id,
      items_given: 5 + (index % 4),
      items_returned: null,
      missing_note: null,
    })),
  );
}

async function seedDuty(ctx: Ctx, boysPlace: Place, girlsPlace: Place): Promise<number> {
  const { manager, schoolId, today, now } = ctx;
  const [day, night] = await manager.save([
    manager.create(HostelDutyShift, {
      school_id: schoolId,
      name: 'Day',
      start_time: '06:00',
      end_time: '18:00',
      is_night: false,
      active: true,
      created_by: ctx.warden.id,
    }),
    manager.create(HostelDutyShift, {
      school_id: schoolId,
      name: 'Night',
      start_time: '18:00',
      end_time: '06:00',
      is_night: true,
      active: true,
      created_by: ctx.warden.id,
    }),
  ]);
  const rows: Partial<HostelDutyRoster>[] = [];
  if (!ctx.warden.id || !ctx.assistant.id) return 0;
  for (let offset = -3; offset <= 3; offset += 1) {
    const date = addDays(today, offset);
    const dayDone = offset < 0;
    const dayStarted = offset === 0 && now >= '06:00';
    const lateDay = offset === -2;
    rows.push({
      school_id: schoolId,
      hostel_id: boysPlace.hostel.id,
      duty_date: date,
      shift_id: day!.id,
      user_id: ctx.warden.id!,
      status: dayDone ? 'completed' : dayStarted ? 'checked_in' : 'scheduled',
      check_in_at: dayDone || dayStarted ? at(date, lateDay ? '06:14' : '05:56') : null,
      check_out_at: dayDone ? at(date, '18:05') : null,
      late_minutes: lateDay ? 14 : null,
      note: lateDay ? 'Bus delay' : null,
      created_by: ctx.warden.id,
    });
    const nightDone = offset < -1 || (offset === -1 && now >= '06:05');
    const nightStarted = offset === -1 && !nightDone;
    rows.push({
      school_id: schoolId,
      hostel_id: girlsPlace.hostel.id,
      duty_date: date,
      shift_id: night!.id,
      user_id: ctx.assistant.id!,
      status: nightDone ? 'completed' : nightStarted ? 'checked_in' : 'scheduled',
      check_in_at: nightDone || nightStarted ? at(date, '17:55') : null,
      check_out_at: nightDone ? at(addDays(date, 1), '06:02') : null,
      late_minutes: null,
      note: null,
      created_by: ctx.warden.id,
    });
  }
  await manager.insert(HostelDutyRoster, rows);
  await manager.insert(
    HostelNightRound,
    [-3, -2, -1].map((offset) => ({
      school_id: schoolId,
      hostel_id: girlsPlace.hostel.id,
      block_id: girlsPlace.blocks[offset === -2 ? 1 : 0]!.id,
      user_id: ctx.assistant.id!,
      round_at: at(addDays(today, offset), '23:15'),
      all_ok: offset !== -2,
      issues: offset === -2 ? 'Lights on in B-104 after lights out; asked the girls to sleep' : null,
    })),
  );
  return rows.length;
}

async function seedStudy(ctx: Ctx, place: Place, boys: Resident[]): Promise<number> {
  const { manager, schoolId } = ctx;
  const hall = await manager.save(
    manager.create(HostelStudyHall, {
      school_id: schoolId,
      hostel_id: place.hostel.id,
      name: 'Prep Hall 1',
      location: 'A Block, ground floor',
      capacity: 20,
      supervisor_user_id: ctx.warden.id,
      status: 'open',
      notes: 'Silent study; no phones',
      created_by: ctx.warden.id,
    }),
  );
  const seats = await manager.save(
    seatLabels(20).map((label) =>
      manager.create(HostelStudySeat, { school_id: schoolId, hall_id: hall.id, seat_no: label, active: true }),
    ),
  );
  const seated = boys.slice(0, 12);
  await manager.insert(
    HostelSeatAllocation,
    seated.map((resident, index) => ({
      school_id: schoolId,
      hall_id: hall.id,
      seat_id: seats[index]!.id,
      admission_id: resident.admission_id,
      from_date: resident.admitted_on,
      to_date: null,
      created_by: ctx.warden.id,
    })),
  );
  await manager.save(
    manager.create(HostelStudySchedule, {
      school_id: schoolId,
      hostel_id: place.hostel.id,
      block_id: null,
      hall_id: hall.id,
      name: 'Evening prep',
      days: [1, 2, 3, 4, 5],
      start_time: '18:30',
      end_time: '20:30',
      supervisor_user_id: ctx.warden.id,
      active: true,
      created_by: ctx.warden.id,
    }),
  );
  return seated.length;
}

async function seedLockers(ctx: Ctx, place: Place, boys: Resident[]): Promise<number> {
  const { manager, schoolId } = ctx;
  const blockA = place.blocks[0]!;
  const lockers = await manager.save(
    lockerNumbers('L-', 1, 20, 3).map((number, index) =>
      manager.create(HostelLocker, {
        school_id: schoolId,
        hostel_id: place.hostel.id,
        block_id: blockA.id,
        room_id: null,
        locker_no: number,
        size: index < 12 ? 'medium' : 'large',
        status: index === 19 ? 'damaged' : index < 6 ? 'allotted' : 'available',
        notes: index === 19 ? 'Hinge broken' : null,
        created_by: ctx.warden.id,
      }),
    ),
  );
  const holders = boys.slice(0, 6);
  await manager.insert(
    HostelLockerAllocation,
    holders.map((resident, index) => ({
      school_id: schoolId,
      locker_id: lockers[index]!.id,
      admission_id: resident.admission_id,
      student_id: resident.id,
      from_date: resident.admitted_on,
      to_date: null,
      keys_given: 1,
      lock_type: index % 3 === 2 ? ('own' as const) : ('school' as const),
      deposit: index % 3 === 2 ? null : 200,
      created_by: ctx.warden.id,
    })),
  );
  return holders.length;
}

async function seedRoomAssets(ctx: Ctx, places: Place[]): Promise<number> {
  const rows: Partial<HostelRoomAsset>[] = places.flatMap((place) =>
    place.rooms.flatMap(({ room }, roomIndex) =>
      ROOM_ASSETS.map(([item, perBed], itemIndex) => ({
        school_id: ctx.schoolId,
        hostel_id: place.hostel.id,
        room_id: room.id,
        item_name: item,
        quantity: perBed ? room.capacity : 1,
        condition: roomIndex === 3 && itemIndex === 1 ? ('fair' as const) : ('good' as const),
        inventory_asset_id: null,
        notes: roomIndex === 3 && itemIndex === 1 ? 'One mattress is worn out' : null,
        last_checked_at: null,
        created_by: ctx.warden.id,
      })),
    ),
  );
  await ctx.manager.insert(HostelRoomAsset, rows);
  return rows.length;
}

async function seedInspection(ctx: Ctx, place: Place, damage: HostelDisciplineCase): Promise<void> {
  const { manager, schoolId, today } = ctx;
  const plan = place.rooms.find((item) => item.room.room_no === 'A-002') ?? place.rooms[1]!;
  const inspectedAt = at(addDays(today, -1), '11:00');
  const marks: { item: string; result: CheckResult; note: string | null }[] = DEFAULT_CHECKLIST.map((item) => ({
    item,
    result:
      item === 'Windows & doors' ? 'issue' : item === 'Washroom clean' && !plan.type.attached_bathroom ? 'na' : 'ok',
    note: item === 'Windows & doors' ? 'Window pane broken' : null,
  }));
  const inspection = await manager.save(
    manager.create(HostelInspection, {
      school_id: schoolId,
      hostel_id: place.hostel.id,
      room_id: plan.room.id,
      inspected_at: inspectedAt,
      inspector_user_id: ctx.warden.id,
      score: inspectionScore(marks),
      cleanliness: 4,
      result: inspectionResult(marks),
      notes: 'Window pane broken; the rest is in order',
      discipline_case_id: damage.id,
      created_by: ctx.warden.id,
    }),
  );
  await manager.insert(
    HostelInspectionItem,
    marks.map((mark) => ({ school_id: schoolId, inspection_id: inspection.id, ...mark })),
  );
  await manager.update(HostelRoomAsset, { room_id: plan.room.id }, { last_checked_at: inspectedAt });
}
