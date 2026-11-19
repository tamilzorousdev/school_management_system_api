import { EntityManager, IsNull } from 'typeorm';
import {
  Asset,
  AssetAllocation,
  AssetDisposal,
  AssetEvent,
  AssetEventKind,
  AssetTransfer,
  AssetTransferItem,
  AssetCondition,
  FundingSource,
} from '../../modules/inventory/entities/asset.entity';
import {
  Department,
  InventoryCategory,
  InventoryLocation,
  InventorySettings,
  InventoryStore,
  InventoryVendor,
  LocationKind,
} from '../../modules/inventory/entities/master.entity';
import {
  AssetAuditItem,
  AssetMaintenanceSchedule,
  AssetMaintenanceTicket,
  InventoryAudit,
  Requisition,
  RequisitionLine,
  StockBalance,
  StockItem,
  StockMovement,
  StockReceipt,
  StockReceiptLine,
  StockUnit,
} from '../../modules/inventory/entities/operations.entity';
import {
  assetTag,
  bookValue,
  codeFrom,
  documentNumber,
  nextDueDate,
  receive,
  StockPosition,
  withdraw,
} from '../../modules/inventory/inventory.logic';
import { SequencesService } from '../../modules/schools/sequences.service';
import { School } from '../../modules/schools/entities/school.entity';
import { Staff } from '../../modules/staff/entities/staff.entity';
import { User } from '../../modules/users/entities/user.entity';
import { todayIn } from '../../shared/dates';

const sequences = new SequencesService();

const shift = (date: string, days: number): string => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const at = (date: string, time = '10:30'): Date => new Date(`${date}T${time}:00+05:30`);

const LOCATIONS: { code: string; name: string; kind: LocationKind; building: string; floor: string }[] = [
  { code: 'LAB-CS', name: 'Computer Lab', kind: 'lab', building: 'Block A', floor: 'First floor' },
  { code: 'LAB-PHY', name: 'Physics Lab', kind: 'lab', building: 'Block B', floor: 'Ground floor' },
  { code: 'LAB-CHE', name: 'Chemistry Lab', kind: 'lab', building: 'Block B', floor: 'First floor' },
  { code: 'OFFICE', name: 'Main Office', kind: 'office', building: 'Admin Block', floor: 'Ground floor' },
  { code: 'STAFF-RM', name: 'Staff Room', kind: 'staff_room', building: 'Block A', floor: 'Ground floor' },
  { code: 'STORE-MAIN', name: 'Central Store', kind: 'store', building: 'Admin Block', floor: 'Basement' },
  { code: 'LIBRARY', name: 'Library', kind: 'library', building: 'Block A', floor: 'Second floor' },
  { code: 'AUDI', name: 'Auditorium', kind: 'hall', building: 'Main Hall', floor: 'Ground floor' },
  { code: 'GROUND', name: 'Playground', kind: 'ground', building: 'Campus', floor: 'Outdoor' },
];

const CATEGORIES: {
  code: string;
  name: string;
  kind: 'asset' | 'stock';
  parent?: string;
  rate?: number;
  life?: number;
  interval?: number;
}[] = [
  { code: 'IT', name: 'IT Equipment', kind: 'asset', rate: 33.33, life: 3 },
  { code: 'IT-LAP', name: 'Laptops', kind: 'asset', parent: 'IT', rate: 33.33, life: 3 },
  { code: 'IT-DSK', name: 'Desktops', kind: 'asset', parent: 'IT', rate: 25, life: 4 },
  { code: 'IT-PRJ', name: 'Projectors & Smart Boards', kind: 'asset', parent: 'IT', rate: 20, life: 5, interval: 90 },
  { code: 'IT-PRN', name: 'Printers', kind: 'asset', parent: 'IT', rate: 25, life: 4, interval: 180 },
  { code: 'FUR', name: 'Furniture', kind: 'asset', rate: 10, life: 10 },
  { code: 'LAB', name: 'Lab Equipment', kind: 'asset', rate: 15, life: 7, interval: 180 },
  { code: 'SPT', name: 'Sports Equipment', kind: 'asset', rate: 20, life: 5 },
  { code: 'ELE', name: 'Electrical & Appliances', kind: 'asset', rate: 15, life: 7, interval: 90 },
  { code: 'STN', name: 'Stationery', kind: 'stock' },
  { code: 'CLN', name: 'Cleaning Supplies', kind: 'stock' },
  { code: 'LABC', name: 'Lab Consumables', kind: 'stock' },
  { code: 'SPTC', name: 'Sports Consumables', kind: 'stock' },
];

const VENDORS = [
  {
    key: 'tech',
    name: 'Chennai Tech Solutions',
    contact_person: 'Ravi Shankar',
    phone: '9840012345',
    supplies: 'Laptops, desktops, printers, AMC',
  },
  {
    key: 'furn',
    name: 'Sri Murugan Furniture Works',
    contact_person: 'Murugan S',
    phone: '9840023456',
    supplies: 'Desks, chairs, cupboards',
  },
  {
    key: 'lab',
    name: 'Scientific Lab Suppliers',
    contact_person: 'Anitha R',
    phone: '9840034567',
    supplies: 'Lab instruments and consumables',
  },
  {
    key: 'stat',
    name: 'Anna Nagar Stationers',
    contact_person: 'Gopal K',
    phone: '9840045678',
    supplies: 'Stationery and office supplies',
  },
  {
    key: 'sport',
    name: 'Victory Sports House',
    contact_person: 'Dinesh P',
    phone: '9840056789',
    supplies: 'Sports equipment',
  },
  {
    key: 'elec',
    name: 'Power Point Electricals',
    contact_person: 'Saravanan M',
    phone: '9840067890',
    supplies: 'ACs, fans, UPS, electrical service',
  },
];

interface AssetSpec {
  key: string;
  name: string;
  category: string;
  make: string | null;
  model: string | null;
  quantity: number;
  cost: number;
  bought: number;
  warrantyYears: number | null;
  amcMonths?: number;
  location: string;
  vendor: string;
  funding?: FundingSource;
  condition?: AssetCondition;
}

const ASSETS: AssetSpec[] = [
  {
    key: 'laptop',
    name: 'Dell Latitude 3440 Laptop',
    category: 'IT-LAP',
    make: 'Dell',
    model: 'Latitude 3440',
    quantity: 6,
    cost: 52000,
    bought: 420,
    warrantyYears: 3,
    location: 'STAFF-RM',
    vendor: 'tech',
  },
  {
    key: 'desktop',
    name: 'HP ProDesk 400 Desktop',
    category: 'IT-DSK',
    make: 'HP',
    model: 'ProDesk 400 G9',
    quantity: 8,
    cost: 41000,
    bought: 900,
    warrantyYears: 3,
    location: 'LAB-CS',
    vendor: 'tech',
    funding: 'government',
  },
  {
    key: 'projector',
    name: 'Epson EB-X51 Projector',
    category: 'IT-PRJ',
    make: 'Epson',
    model: 'EB-X51',
    quantity: 3,
    cost: 38500,
    bought: 700,
    warrantyYears: 2,
    amcMonths: 12,
    location: 'AUDI',
    vendor: 'tech',
  },
  {
    key: 'smartboard',
    name: 'Smart Interactive Panel 65"',
    category: 'IT-PRJ',
    make: 'BenQ',
    model: 'RM6504',
    quantity: 2,
    cost: 145000,
    bought: 330,
    warrantyYears: 3,
    location: 'LAB-CS',
    vendor: 'tech',
    funding: 'donation',
  },
  {
    key: 'printer',
    name: 'Canon imageCLASS Laser Printer',
    category: 'IT-PRN',
    make: 'Canon',
    model: 'MF3010',
    quantity: 2,
    cost: 16500,
    bought: 1050,
    warrantyYears: 1,
    location: 'OFFICE',
    vendor: 'tech',
  },
  {
    key: 'desk',
    name: 'Teacher Desk with Drawer',
    category: 'FUR',
    make: null,
    model: null,
    quantity: 4,
    cost: 8500,
    bought: 1500,
    warrantyYears: null,
    location: 'STAFF-RM',
    vendor: 'furn',
    condition: 'good',
  },
  {
    key: 'cupboard',
    name: 'Steel Cupboard 6 ft',
    category: 'FUR',
    make: 'Godrej',
    model: 'Storwel',
    quantity: 3,
    cost: 14500,
    bought: 1200,
    warrantyYears: 1,
    location: 'OFFICE',
    vendor: 'furn',
    condition: 'good',
  },
  {
    key: 'microscope',
    name: 'Compound Microscope',
    category: 'LAB',
    make: 'Labomed',
    model: 'Vision 2000',
    quantity: 4,
    cost: 9800,
    bought: 800,
    warrantyYears: 2,
    location: 'LAB-PHY',
    vendor: 'lab',
    funding: 'pta',
  },
  {
    key: 'balance',
    name: 'Digital Weighing Balance',
    category: 'LAB',
    make: 'Contech',
    model: 'CA-223',
    quantity: 2,
    cost: 12500,
    bought: 600,
    warrantyYears: 1,
    location: 'LAB-CHE',
    vendor: 'lab',
  },
  {
    key: 'football',
    name: 'Football Goal Post (pair)',
    category: 'SPT',
    make: null,
    model: null,
    quantity: 1,
    cost: 28000,
    bought: 1300,
    warrantyYears: null,
    location: 'GROUND',
    vendor: 'sport',
    condition: 'fair',
  },
  {
    key: 'tt',
    name: 'Table Tennis Table',
    category: 'SPT',
    make: 'Stag',
    model: 'Europa',
    quantity: 1,
    cost: 32000,
    bought: 500,
    warrantyYears: 1,
    location: 'AUDI',
    vendor: 'sport',
  },
  {
    key: 'ac',
    name: 'Split AC 1.5 Ton',
    category: 'ELE',
    make: 'Voltas',
    model: '183V CZT',
    quantity: 2,
    cost: 38000,
    bought: 380,
    warrantyYears: 1,
    amcMonths: 24,
    location: 'LAB-CS',
    vendor: 'elec',
  },
  {
    key: 'ups',
    name: 'Online UPS 5 kVA',
    category: 'ELE',
    make: 'APC',
    model: 'SRV5KI',
    quantity: 1,
    cost: 68000,
    bought: 360,
    warrantyYears: 2,
    location: 'LAB-CS',
    vendor: 'elec',
  },
];

const STOCK: { code: string; name: string; category: string; unit: StockUnit; reorder: number }[] = [
  { code: 'A4-REAM', name: 'A4 Paper 75 GSM', category: 'STN', unit: 'ream', reorder: 20 },
  { code: 'MARKER-WB', name: 'Whiteboard Marker', category: 'STN', unit: 'box', reorder: 10 },
  { code: 'CHALK', name: 'Dustless Chalk', category: 'STN', unit: 'box', reorder: 15 },
  { code: 'REGISTER', name: 'Attendance Register', category: 'STN', unit: 'pcs', reorder: 10 },
  { code: 'TONER-CN', name: 'Canon 912 Toner', category: 'STN', unit: 'pcs', reorder: 3 },
  { code: 'PHENYL', name: 'Phenyl 5 L', category: 'CLN', unit: 'bottle', reorder: 6 },
  { code: 'HANDWASH', name: 'Liquid Hand Wash', category: 'CLN', unit: 'litre', reorder: 10 },
  { code: 'BEAKER-250', name: 'Glass Beaker 250 ml', category: 'LABC', unit: 'pcs', reorder: 12 },
  { code: 'LITMUS', name: 'Litmus Paper', category: 'LABC', unit: 'pack', reorder: 5 },
  { code: 'SHUTTLE', name: 'Feather Shuttlecock', category: 'SPTC', unit: 'box', reorder: 4 },
];

const RECEIPTS: { daysAgo: number; vendor: string; invoice: string; lines: [string, number, number][] }[] = [
  {
    daysAgo: 150,
    vendor: 'stat',
    invoice: 'ANS/2026/0412',
    lines: [
      ['A4-REAM', 80, 245],
      ['MARKER-WB', 30, 180],
      ['CHALK', 50, 65],
      ['REGISTER', 40, 120],
      ['TONER-CN', 6, 1450],
    ],
  },
  {
    daysAgo: 120,
    vendor: 'lab',
    invoice: 'SLS-7781',
    lines: [
      ['BEAKER-250', 48, 85],
      ['LITMUS', 20, 45],
      ['PHENYL', 12, 320],
      ['HANDWASH', 30, 140],
    ],
  },
  { daysAgo: 60, vendor: 'sport', invoice: 'VSH-1190', lines: [['SHUTTLE', 12, 650]] },
  {
    daysAgo: 20,
    vendor: 'stat',
    invoice: 'ANS/2026/0977',
    lines: [
      ['A4-REAM', 40, 255],
      ['MARKER-WB', 10, 185],
    ],
  },
];

export async function seedDemoInventory(manager: EntityManager, school: School): Promise<void> {
  const schoolId = school.id;
  if (await manager.exists(Asset, { where: { school_id: schoolId } })) {
    console.log(`Inventory ${school.code}  assets already set up: kept`);
    return;
  }
  const today = todayIn(school.timezone || 'Asia/Kolkata');
  const year = today.slice(0, 4);

  const userByMobile = async (mobile: string): Promise<number> =>
    (await manager.findOneByOrFail(User, { mobile, deleted_at: IsNull() })).id;
  const admin = await userByMobile('9876543210');
  const keeper = await userByMobile('9000000012');
  const principal = await userByMobile('9000000001');
  const staffUsers = {
    divya: await userByMobile('9000000405'),
    arun: await userByMobile('9000000006'),
    priya: await userByMobile('9000000004'),
    senthil: await userByMobile('9000000404'),
    karthik: await userByMobile('9000000002'),
    joseph: await userByMobile('9000000402'),
    prakash: await userByMobile('9000000611'),
  };

  if (!(await manager.exists(Staff, { where: { user_id: keeper } }))) {
    await manager.save(
      manager.create(Staff, {
        school_id: schoolId,
        user_id: keeper,
        employee_no: `${school.code}-EMP-0090`,
        staff_type: 'non_teaching',
        designation: 'Store Keeper',
        department: 'Administration',
        gender: 'male',
        dob: '1986-03-14',
        joining_date: '2019-06-03',
        prior_experience_years: 4,
        max_periods_per_week: 0,
        address: '18, Kamarajar Road, Chennai',
        emergency_contact_name: 'Family contact',
        emergency_contact_mobile: '9840099001',
        status: 'active',
      }),
    );
  }

  await manager.save(
    manager.create(InventorySettings, {
      school_id: schoolId,
      approve_transfers: true,
      approve_requisitions: true,
      approve_disposals: true,
      depreciation_method: 'straight_line',
      warranty_alert_days: 30,
      maintenance_alert_days: 7,
      updated_by: admin,
    }),
  );

  const departmentNames: { name: string }[] = await manager.query(
    `SELECT DISTINCT initcap(trim(department)) AS name FROM staff
     WHERE school_id = $1 AND deleted_at IS NULL AND department IS NOT NULL AND trim(department) <> '' ORDER BY 1`,
    [schoolId],
  );
  const heads: Record<string, number> = {
    Administration: principal,
    'Computer Science': staffUsers.divya,
    Science: staffUsers.arun,
    Mathematics: staffUsers.priya,
    Sports: staffUsers.senthil,
    Office: staffUsers.karthik,
  };
  const departments = new Map<string, Department>();
  const usedCodes = new Set<string>();
  for (const { name } of departmentNames) {
    let code = codeFrom(name, 'DEPT').slice(0, 20);
    for (let index = 1; usedCodes.has(code); index += 1) code = `${codeFrom(name, 'DEPT').slice(0, 17)}-${index}`;
    usedCodes.add(code);
    departments.set(
      name,
      await manager.save(
        manager.create(Department, {
          school_id: schoolId,
          name,
          code,
          head_user_id: heads[name] ?? null,
          created_by: admin,
        }),
      ),
    );
  }
  const department = (name: string) => departments.get(name)?.id ?? null;

  const locations = new Map<string, InventoryLocation>();
  for (const item of LOCATIONS) {
    locations.set(
      item.code,
      await manager.save(manager.create(InventoryLocation, { ...item, school_id: schoolId, created_by: admin })),
    );
  }
  const rooms: { room: string }[] = await manager.query(
    `SELECT DISTINCT room FROM timetable_slots WHERE school_id = $1 AND room IS NOT NULL AND trim(room) <> '' ORDER BY room`,
    [schoolId],
  );
  for (const { room } of rooms) {
    const [building, name] = room.includes('·') ? room.split('·').map((part) => part.trim()) : [null, room.trim()];
    const code = room.toUpperCase().slice(0, 30);
    if (locations.has(code)) continue;
    locations.set(
      code,
      await manager.save(
        manager.create(InventoryLocation, {
          school_id: schoolId,
          code,
          name: `Room ${name || room}`.slice(0, 80),
          building: building?.slice(0, 40) ?? null,
          kind: 'classroom',
          created_by: admin,
        }),
      ),
    );
  }
  const location = (code: string) => locations.get(code)!;

  const categories = new Map<string, InventoryCategory>();
  for (const item of CATEGORIES) {
    categories.set(
      item.code,
      await manager.save(
        manager.create(InventoryCategory, {
          school_id: schoolId,
          name: item.name,
          code: item.code,
          kind: item.kind,
          parent_id: item.parent ? categories.get(item.parent)!.id : null,
          depreciation_rate: item.rate ?? null,
          useful_life_years: item.life ?? null,
          maintenance_interval_days: item.interval ?? null,
          created_by: admin,
        }),
      ),
    );
  }

  const vendors = new Map<string, InventoryVendor>();
  for (const { key, ...item } of VENDORS) {
    vendors.set(
      key,
      await manager.save(
        manager.create(InventoryVendor, {
          ...item,
          school_id: schoolId,
          email: `sales@${key}vendor.in`,
          address: 'Chennai',
          created_by: admin,
        }),
      ),
    );
  }

  const mainStore = await manager.save(
    manager.create(InventoryStore, {
      school_id: schoolId,
      name: 'Central Store',
      code: 'MAIN',
      location_id: location('STORE-MAIN').id,
      keeper_user_id: keeper,
      created_by: admin,
    }),
  );
  const labStore = await manager.save(
    manager.create(InventoryStore, {
      school_id: schoolId,
      name: 'Science Lab Store',
      code: 'LAB',
      location_id: location('LAB-CHE').id,
      keeper_user_id: staffUsers.arun,
      created_by: admin,
    }),
  );

  const event = (
    assetId: number,
    kind: AssetEventKind,
    note: string,
    date: string,
    actor = keeper,
    ref?: [string, number],
  ) =>
    manager.save(
      manager.create(AssetEvent, {
        school_id: schoolId,
        asset_id: assetId,
        kind,
        note,
        ref_type: ref?.[0] ?? null,
        ref_id: ref?.[1] ?? null,
        actor_id: actor,
        created_at: at(date),
      }),
    );

  const assets = new Map<string, Asset[]>();
  let serial = 1000;
  for (const spec of ASSETS) {
    const bought = shift(today, -spec.bought);
    const category = categories.get(spec.category)!;
    const list: Asset[] = [];
    for (let index = 0; index < spec.quantity; index += 1) {
      serial += 7;
      const asset = await manager.save(
        manager.create(Asset, {
          school_id: schoolId,
          asset_tag: assetTag(school.code, await sequences.next(manager, schoolId, 'inventory_asset')),
          name: spec.name,
          category_id: category.id,
          make: spec.make,
          model: spec.model,
          serial_no: spec.make ? `${spec.make.slice(0, 3).toUpperCase()}${year}${serial}` : null,
          vendor_id: vendors.get(spec.vendor)!.id,
          invoice_no: `${spec.vendor.toUpperCase()}-INV-${spec.bought}`,
          purchase_date: bought,
          cost: spec.cost,
          residual_value: Math.round(spec.cost * 0.05),
          warranty_until: spec.warrantyYears ? shift(bought, spec.warrantyYears * 365) : null,
          amc_until: spec.amcMonths ? shift(today, index === 0 ? 21 : spec.amcMonths * 15) : null,
          amc_vendor_id: spec.amcMonths ? vendors.get(spec.vendor)!.id : null,
          funding_source: spec.funding ?? 'school',
          condition: spec.condition ?? (spec.bought > 900 ? 'good' : 'new'),
          status: 'in_store',
          location_id: location(spec.location).id,
          store_id: mainStore.id,
          created_by: keeper,
          created_at: at(bought),
        }),
      );
      await event(asset.id, 'registered', `Registered from invoice ${asset.invoice_no}`, bought);
      list.push(asset);
    }
    assets.set(spec.key, list);
  }
  const pick = (key: string, index: number) => assets.get(key)![index]!;

  const allocate = async (
    asset: Asset,
    target: { user?: number; department?: string; location?: string },
    daysAgo: number,
    options: { expectedIn?: number; acknowledged?: boolean; returnedDaysAgo?: number } = {},
  ) => {
    const allocatedOn = shift(today, -daysAgo);
    const type = target.user ? 'staff' : target.department ? 'department' : 'location';
    const allocation = await manager.save(
      manager.create(AssetAllocation, {
        school_id: schoolId,
        asset_id: asset.id,
        assignee_type: type,
        user_id: target.user ?? null,
        department_id: target.department ? department(target.department) : null,
        location_id: target.location ? location(target.location).id : null,
        allocated_on: allocatedOn,
        expected_return_on: options.expectedIn === undefined ? null : shift(today, options.expectedIn),
        acknowledged_at: type === 'staff' && options.acknowledged !== false ? at(shift(allocatedOn, 1), '09:15') : null,
        returned_on: options.returnedDaysAgo === undefined ? null : shift(today, -options.returnedDaysAgo),
        return_condition: options.returnedDaysAgo === undefined ? null : 'good',
        status: options.returnedDaysAgo === undefined ? 'active' : 'returned',
        allocated_by: keeper,
        returned_by: options.returnedDaysAgo === undefined ? null : keeper,
        remarks: null,
        created_by: keeper,
        created_at: at(allocatedOn),
      }),
    );
    const label = target.user ? 'staff' : (target.department ?? location(target.location!).name);
    await event(asset.id, 'allocated', `Allocated to ${label}`, allocatedOn, keeper, ['allocation', allocation.id]);
    if (allocation.acknowledged_at) {
      await event(asset.id, 'acknowledged', 'Receipt acknowledged', shift(allocatedOn, 1), target.user!, [
        'allocation',
        allocation.id,
      ]);
    }
    if (options.returnedDaysAgo !== undefined) {
      await event(asset.id, 'returned', 'Returned in good condition', shift(today, -options.returnedDaysAgo), keeper, [
        'allocation',
        allocation.id,
      ]);
      return;
    }
    await manager.update(Asset, asset.id, {
      status: 'allocated',
      custodian_user_id: target.user ?? null,
      department_id: target.department ? department(target.department) : null,
      location_id: target.location ? location(target.location).id : asset.location_id,
    });
  };

  await allocate(pick('laptop', 0), { user: staffUsers.divya }, 380);
  await allocate(pick('laptop', 1), { user: staffUsers.priya }, 370);
  await allocate(pick('laptop', 2), { user: staffUsers.arun }, 200, { expectedIn: -12 });
  await allocate(pick('laptop', 3), { user: staffUsers.joseph }, 3, { acknowledged: false });
  await allocate(pick('laptop', 4), { user: staffUsers.prakash }, 300, { returnedDaysAgo: 40 });
  await allocate(pick('laptop', 4), { user: staffUsers.senthil }, 30, { expectedIn: 60 });
  for (let index = 0; index < 8; index += 1) await allocate(pick('desktop', index), { location: 'LAB-CS' }, 880);
  await allocate(pick('projector', 0), { location: 'AUDI' }, 690);
  await allocate(pick('projector', 1), { location: 'LAB-PHY' }, 690);
  await allocate(pick('smartboard', 0), { location: 'LAB-CS' }, 320);
  await allocate(pick('printer', 0), { department: 'Office' }, 1040);
  for (let index = 0; index < 4; index += 1) await allocate(pick('desk', index), { location: 'STAFF-RM' }, 1490);
  await allocate(pick('cupboard', 0), { department: 'Office' }, 1190);
  for (let index = 0; index < 3; index += 1) await allocate(pick('microscope', index), { department: 'Science' }, 780);
  await allocate(pick('balance', 0), { department: 'Science' }, 590);
  await allocate(pick('football', 0), { department: 'Sports' }, 1290);
  await allocate(pick('tt', 0), { user: staffUsers.senthil }, 480);
  await allocate(pick('ac', 0), { location: 'LAB-CS' }, 370);
  await allocate(pick('ac', 1), { location: 'LIBRARY' }, 370);
  await allocate(pick('ups', 0), { location: 'LAB-CS' }, 350);

  const ticketNo = async () =>
    documentNumber(school.code, 'MNT', year, await sequences.next(manager, schoolId, `inventory_ticket:${year}`));
  const schedules = new Map<string, AssetMaintenanceSchedule>();
  for (const [key, asset, title, interval, lastDaysAgo, vendor] of [
    ['projector', pick('projector', 0), 'Clean filter and check lamp hours', 90, 85, 'tech'],
    ['ac0', pick('ac', 0), 'AC service (filter, gas check)', 90, 95, 'elec'],
    ['ac1', pick('ac', 1), 'AC service (filter, gas check)', 90, 40, 'elec'],
    ['ups', pick('ups', 0), 'UPS battery health check', 180, 120, 'elec'],
    ['printer', pick('printer', 0), 'Printer cleaning and drum check', 180, 30, 'tech'],
  ] as [string, Asset, string, number, number, string][]) {
    const lastDone = shift(today, -lastDaysAgo);
    schedules.set(
      key,
      await manager.save(
        manager.create(AssetMaintenanceSchedule, {
          school_id: schoolId,
          asset_id: asset.id,
          title,
          interval_days: interval,
          last_done_on: lastDone,
          next_due_on: nextDueDate(lastDone, interval),
          vendor_id: vendors.get(vendor)!.id,
          is_active: true,
          created_by: keeper,
        }),
      ),
    );
  }

  const openTicket = async (
    asset: Asset,
    spec: {
      title: string;
      description: string;
      kind?: 'breakdown' | 'preventive' | 'inspection';
      priority?: 'low' | 'medium' | 'high';
      daysAgo: number;
      status: 'open' | 'in_progress' | 'resolved';
      vendor?: string;
      warranty?: boolean;
      cost?: number;
      resolution?: string;
      resolvedDaysAgo?: number;
      schedule?: string;
    },
  ) => {
    const opened = shift(today, -spec.daysAgo);
    const ticket = await manager.save(
      manager.create(AssetMaintenanceTicket, {
        school_id: schoolId,
        ticket_no: await ticketNo(),
        asset_id: asset.id,
        kind: spec.kind ?? 'breakdown',
        title: spec.title,
        description: spec.description,
        priority: spec.priority ?? 'medium',
        status: spec.status,
        reported_by: staffUsers.divya,
        assigned_to_user_id: keeper,
        vendor_id: spec.vendor ? vendors.get(spec.vendor)!.id : null,
        under_warranty: spec.warranty ?? false,
        cost: spec.cost ?? null,
        parts: null,
        opened_at: at(opened, '11:00'),
        resolved_at: spec.resolvedDaysAgo === undefined ? null : at(shift(today, -spec.resolvedDaysAgo), '16:00'),
        resolution: spec.resolution ?? null,
        schedule_id: spec.schedule ? schedules.get(spec.schedule)!.id : null,
        created_by: staffUsers.divya,
      }),
    );
    await event(asset.id, 'maintenance_opened', `${ticket.ticket_no}: ${spec.title}`, opened, staffUsers.divya, [
      'ticket',
      ticket.id,
    ]);
    if (spec.status === 'resolved') {
      await event(
        asset.id,
        'maintenance_closed',
        `${ticket.ticket_no} resolved`,
        shift(today, -spec.resolvedDaysAgo!),
        keeper,
        ['ticket', ticket.id],
      );
    }
    return ticket;
  };

  await openTicket(pick('desktop', 5), {
    title: 'System does not boot',
    description: 'Blue screen on start-up; students cannot use system 6.',
    priority: 'high',
    daysAgo: 4,
    status: 'in_progress',
    vendor: 'tech',
    warranty: true,
  });
  await manager.update(Asset, pick('desktop', 5).id, { status: 'in_maintenance' });
  await openTicket(pick('printer', 1), {
    title: 'Paper jam and streaks on prints',
    description: 'Office printer leaves black streaks.',
    daysAgo: 1,
    status: 'open',
  });
  await manager.update(Asset, pick('printer', 1).id, { status: 'in_maintenance' });
  await openTicket(pick('projector', 1), {
    title: 'Projector lamp replaced',
    description: 'Image was dim during class.',
    daysAgo: 50,
    status: 'resolved',
    vendor: 'tech',
    cost: 6500,
    resolution: 'Replaced lamp (ELPLP96) and cleaned the filter.',
    resolvedDaysAgo: 46,
  });
  await openTicket(pick('ac', 1), {
    title: 'Quarterly AC service',
    description: 'Preventive service from the schedule.',
    kind: 'preventive',
    priority: 'low',
    daysAgo: 41,
    status: 'resolved',
    vendor: 'elec',
    cost: 1200,
    resolution: 'Filters cleaned, gas pressure normal.',
    resolvedDaysAgo: 40,
    schedule: 'ac1',
  });
  await openTicket(pick('microscope', 2), {
    title: 'Fine focus knob loose',
    description: 'Knob slips; slides go out of focus.',
    priority: 'low',
    daysAgo: 120,
    status: 'resolved',
    vendor: 'lab',
    cost: 450,
    resolution: 'Knob tightened and lubricated.',
    resolvedDaysAgo: 112,
  });

  const lostAsset = pick('balance', 1);
  await manager.update(Asset, lostAsset.id, {
    status: 'lost',
    notes: 'Not found in the Chemistry Lab during the term audit',
  });
  await event(lostAsset.id, 'marked_lost', 'Not found in the Chemistry Lab during the term audit', shift(today, -15));

  const disposalNo = async () =>
    documentNumber(school.code, 'DSP', year, await sequences.next(manager, schoolId, `inventory_disposal:${year}`));
  const scrapped = pick('cupboard', 2);
  const scrappedBook =
    bookValue(
      {
        cost: Number(scrapped.cost),
        residual_value: Number(scrapped.residual_value),
        purchase_date: scrapped.purchase_date,
        rate: 10,
        useful_life_years: 10,
        method: 'straight_line',
      },
      today,
    ) ?? 0;
  const approved = await manager.save(
    manager.create(AssetDisposal, {
      school_id: schoolId,
      disposal_no: await disposalNo(),
      asset_id: scrapped.id,
      method: 'scrapped',
      reason: 'Rusted beyond repair after the monsoon leak',
      value_realised: 800,
      book_value: scrappedBook,
      status: 'approved',
      requested_by: keeper,
      decided_by: principal,
      decided_at: at(shift(today, -25)),
      decision_note: 'Approved. Sell the scrap to the registered dealer.',
      created_by: keeper,
    }),
  );
  await manager.update(Asset, scrapped.id, {
    status: 'disposed',
    disposed_at: at(shift(today, -25)),
    condition: 'damaged',
  });
  await event(scrapped.id, 'disposal_requested', `${approved.disposal_no}: scrapped`, shift(today, -28), keeper, [
    'disposal',
    approved.id,
  ]);
  await event(scrapped.id, 'disposed', `${approved.disposal_no} approved`, shift(today, -25), principal, [
    'disposal',
    approved.id,
  ]);

  const oldDesk = pick('cupboard', 1);
  const requested = await manager.save(
    manager.create(AssetDisposal, {
      school_id: schoolId,
      disposal_no: await disposalNo(),
      asset_id: oldDesk.id,
      method: 'donated',
      reason: 'Replaced by new storage; donate to the panchayat school',
      value_realised: null,
      book_value:
        bookValue(
          {
            cost: Number(oldDesk.cost),
            residual_value: Number(oldDesk.residual_value),
            purchase_date: oldDesk.purchase_date,
            rate: 10,
            useful_life_years: 10,
            method: 'straight_line',
          },
          today,
        ) ?? 0,
      status: 'requested',
      requested_by: keeper,
      created_by: keeper,
    }),
  );
  await event(oldDesk.id, 'disposal_requested', `${requested.disposal_no}: donated`, shift(today, -2), keeper, [
    'disposal',
    requested.id,
  ]);

  const transferNo = async () =>
    documentNumber(school.code, 'TRF', year, await sequences.next(manager, schoolId, `inventory_transfer:${year}`));
  const moved = pick('projector', 2);
  const done = await manager.save(
    manager.create(AssetTransfer, {
      school_id: schoolId,
      transfer_no: await transferNo(),
      to_type: 'location',
      to_location_id: location('LIBRARY').id,
      reason: 'Library reading sessions need a projector',
      status: 'completed',
      requested_by: keeper,
      decided_by: principal,
      decided_at: at(shift(today, -10)),
      completed_at: at(shift(today, -10), '15:00'),
      completed_by: keeper,
      created_by: keeper,
    }),
  );
  await manager.save(
    manager.create(AssetTransferItem, {
      school_id: schoolId,
      transfer_id: done.id,
      asset_id: moved.id,
      from_label: 'Central Store',
    }),
  );
  await manager.save(
    manager.create(AssetAllocation, {
      school_id: schoolId,
      asset_id: moved.id,
      assignee_type: 'location',
      location_id: location('LIBRARY').id,
      allocated_on: shift(today, -10),
      status: 'active',
      allocated_by: keeper,
      created_by: keeper,
    }),
  );
  await manager.update(Asset, moved.id, { status: 'allocated', location_id: location('LIBRARY').id });
  await event(moved.id, 'transfer_requested', `${done.transfer_no} to Library`, shift(today, -11), keeper, [
    'transfer',
    done.id,
  ]);
  await event(moved.id, 'transferred', `${done.transfer_no} completed`, shift(today, -10), keeper, [
    'transfer',
    done.id,
  ]);

  const pending = await manager.save(
    manager.create(AssetTransfer, {
      school_id: schoolId,
      transfer_no: await transferNo(),
      to_type: 'department',
      to_department_id: department('Mathematics'),
      reason: 'Maths department needs the second smart panel for the new block',
      status: 'requested',
      requested_by: staffUsers.priya,
      created_by: staffUsers.priya,
    }),
  );
  await manager.save(
    manager.create(AssetTransferItem, {
      school_id: schoolId,
      transfer_id: pending.id,
      asset_id: pick('smartboard', 1).id,
      from_label: 'Central Store',
    }),
  );
  await event(
    pick('smartboard', 1).id,
    'transfer_requested',
    `${pending.transfer_no} to Mathematics`,
    shift(today, -1),
    staffUsers.priya,
    ['transfer', pending.id],
  );

  const items = new Map<string, StockItem>();
  for (const item of STOCK) {
    items.set(
      item.code,
      await manager.save(
        manager.create(StockItem, {
          school_id: schoolId,
          name: item.name,
          code: item.code,
          category_id: categories.get(item.category)!.id,
          unit: item.unit,
          reorder_level: item.reorder,
          created_by: keeper,
        }),
      ),
    );
  }
  const positions = new Map<string, StockPosition>();
  const positionKey = (itemId: number, storeId: number) => `${itemId}:${storeId}`;
  const move = async (
    code: string,
    storeId: number,
    kind: 'receipt' | 'issue' | 'adjustment',
    quantity: number,
    date: string,
    extra: {
      rate?: number;
      ref?: ['receipt' | 'requisition', number];
      department?: string;
      user?: number;
      note?: string;
    } = {},
  ) => {
    const item = items.get(code)!;
    const key = positionKey(item.id, storeId);
    const current = positions.get(key) ?? { quantity: 0, value: 0 };
    let next: StockPosition;
    let rate: number;
    let value: number;
    if (quantity > 0) {
      rate = extra.rate!;
      next = receive(current, quantity, rate);
      value = Math.round(quantity * rate * 100) / 100;
    } else {
      const out = withdraw(current, -quantity);
      next = out.position;
      rate = out.rate;
      value = -out.value;
    }
    positions.set(key, next);
    await manager.save(
      manager.create(StockMovement, {
        school_id: schoolId,
        item_id: item.id,
        store_id: storeId,
        kind,
        quantity,
        rate,
        value,
        balance_after: next.quantity,
        ref_type: extra.ref?.[0] ?? null,
        ref_id: extra.ref?.[1] ?? null,
        department_id: extra.department ? department(extra.department) : null,
        user_id: extra.user ?? null,
        note: extra.note ?? null,
        moved_on: date,
        created_by: keeper,
        created_at: at(date, '12:00'),
      }),
    );
  };

  for (const spec of RECEIPTS) {
    const received = shift(today, -spec.daysAgo);
    const total = spec.lines.reduce((sum, [, quantity, rate]) => sum + quantity * rate, 0);
    const storeId = spec.vendor === 'lab' ? labStore.id : mainStore.id;
    const receipt = await manager.save(
      manager.create(StockReceipt, {
        school_id: schoolId,
        receipt_no: documentNumber(
          school.code,
          'GRN',
          year,
          await sequences.next(manager, schoolId, `inventory_grn:${year}`),
        ),
        store_id: storeId,
        vendor_id: vendors.get(spec.vendor)!.id,
        invoice_no: spec.invoice,
        invoice_date: shift(received, -2),
        received_on: received,
        total,
        created_by: keeper,
      }),
    );
    for (const [code, quantity, rate] of spec.lines) {
      const lineStore = ['PHENYL', 'HANDWASH'].includes(code) ? mainStore.id : storeId;
      await manager.save(
        manager.create(StockReceiptLine, {
          school_id: schoolId,
          receipt_id: receipt.id,
          item_id: items.get(code)!.id,
          quantity,
          rate,
          amount: quantity * rate,
        }),
      );
      await move(code, lineStore, 'receipt', quantity, received, { rate, ref: ['receipt', receipt.id] });
    }
  }

  const requisitionNo = async () =>
    documentNumber(school.code, 'REQ', year, await sequences.next(manager, schoolId, `inventory_requisition:${year}`));
  const requisition = async (spec: {
    daysAgo: number;
    department: string;
    user: number;
    purpose: string;
    status: 'pending' | 'approved' | 'rejected' | 'issued' | 'partly_issued';
    store?: number;
    lines: [string, number, number | null, number][];
    note?: string;
  }) => {
    const raised = shift(today, -spec.daysAgo);
    const storeId = spec.store ?? mainStore.id;
    const decided = spec.status !== 'pending';
    const issued = spec.status === 'issued' || spec.status === 'partly_issued';
    const row = await manager.save(
      manager.create(Requisition, {
        school_id: schoolId,
        requisition_no: await requisitionNo(),
        store_id: storeId,
        department_id: department(spec.department),
        requested_for_user_id: spec.user,
        purpose: spec.purpose,
        needed_by: shift(raised, 5),
        status: spec.status,
        decided_by: decided ? principal : null,
        decided_at: decided ? at(shift(raised, 1)) : null,
        decision_note: spec.note ?? null,
        issued_at: issued ? at(shift(raised, 2)) : null,
        issued_by: issued ? keeper : null,
        created_by: spec.user,
        created_at: at(raised),
      }),
    );
    for (const [code, quantity, approvedQuantity, issuedQuantity] of spec.lines) {
      await manager.save(
        manager.create(RequisitionLine, {
          school_id: schoolId,
          requisition_id: row.id,
          item_id: items.get(code)!.id,
          quantity,
          approved_quantity: approvedQuantity,
          issued_quantity: issuedQuantity,
        }),
      );
      if (issuedQuantity > 0) {
        await move(code, storeId, 'issue', -issuedQuantity, shift(raised, 2), {
          ref: ['requisition', row.id],
          department: spec.department,
          user: spec.user,
        });
      }
    }
  };

  await requisition({
    daysAgo: 140,
    department: 'Office',
    user: staffUsers.karthik,
    purpose: 'Office printing for term 1',
    status: 'issued',
    lines: [
      ['A4-REAM', 30, 30, 30],
      ['TONER-CN', 2, 2, 2],
      ['REGISTER', 25, 25, 25],
    ],
  });
  await requisition({
    daysAgo: 110,
    department: 'Science',
    user: staffUsers.arun,
    purpose: 'Class 9 practicals',
    status: 'issued',
    store: labStore.id,
    lines: [
      ['BEAKER-250', 24, 20, 20],
      ['LITMUS', 10, 10, 10],
    ],
  });
  await requisition({
    daysAgo: 90,
    department: 'Primary',
    user: staffUsers.priya,
    purpose: 'Classroom supplies for primary block',
    status: 'issued',
    lines: [
      ['CHALK', 40, 40, 40],
      ['MARKER-WB', 20, 20, 20],
    ],
  });
  await requisition({
    daysAgo: 45,
    department: 'Sports',
    user: staffUsers.senthil,
    purpose: 'Inter-house badminton',
    status: 'partly_issued',
    lines: [['SHUTTLE', 10, 10, 6]],
  });
  await requisition({
    daysAgo: 30,
    department: 'Mathematics',
    user: staffUsers.priya,
    purpose: 'Unit test papers',
    status: 'issued',
    lines: [
      ['A4-REAM', 40, 35, 35],
      ['MARKER-WB', 6, 6, 6],
    ],
  });
  await requisition({
    daysAgo: 6,
    department: 'Computer Science',
    user: staffUsers.divya,
    purpose: 'Lab printouts and markers',
    status: 'approved',
    lines: [
      ['A4-REAM', 10, 10, 0],
      ['MARKER-WB', 4, 4, 0],
    ],
    note: 'Approved',
  });
  await requisition({
    daysAgo: 2,
    department: 'English',
    user: staffUsers.joseph,
    purpose: 'Debate competition material',
    status: 'pending',
    lines: [
      ['A4-REAM', 5, null, 0],
      ['REGISTER', 2, null, 0],
    ],
  });
  await requisition({
    daysAgo: 1,
    department: 'Science',
    user: staffUsers.prakash,
    purpose: 'Extra beakers for the science fair',
    status: 'pending',
    store: labStore.id,
    lines: [['BEAKER-250', 12, null, 0]],
  });
  await requisition({
    daysAgo: 12,
    department: 'Arts',
    user: staffUsers.joseph,
    purpose: 'Chart paper for exhibition',
    status: 'rejected',
    lines: [['A4-REAM', 25, null, 0]],
    note: 'Use the art store stock first',
  });

  await move('PHENYL', mainStore.id, 'issue', -7, shift(today, -35), {
    department: 'Administration',
    note: 'Monthly housekeeping',
  });
  await move('HANDWASH', mainStore.id, 'issue', -22, shift(today, -18), {
    department: 'Primary',
    note: 'Washrooms, primary block',
  });
  await move('BEAKER-250', labStore.id, 'adjustment', -3, shift(today, -8), {
    note: 'Damaged: broken during practicals',
  });

  for (const [key, position] of positions) {
    const [itemId, storeId] = key.split(':').map(Number);
    await manager.save(
      manager.create(StockBalance, {
        school_id: schoolId,
        item_id: itemId,
        store_id: storeId,
        quantity: position.quantity,
        value: position.value,
      }),
    );
  }

  const labAssets: Asset[] = await manager.find(Asset, {
    where: { school_id: schoolId, location_id: location('LAB-CS').id },
  });
  const audit = await manager.save(
    manager.create(InventoryAudit, {
      school_id: schoolId,
      name: `Computer Lab verification ${today.slice(0, 7)}`,
      kind: 'asset',
      status: 'open',
      location_id: location('LAB-CS').id,
      notes: 'Term-end physical verification',
      expected_count: labAssets.length,
      found_count: 0,
      missing_count: 0,
      created_by: keeper,
    }),
  );
  const scans: {
    asset: Asset | null;
    code: string;
    finding: 'found' | 'misplaced' | 'unknown';
    location: number | null;
  }[] = [
    ...labAssets
      .slice(0, -3)
      .map((asset) => ({ asset, code: asset.asset_tag, finding: 'found' as const, location: asset.location_id })),
    {
      asset: pick('laptop', 5),
      code: pick('laptop', 5).asset_tag,
      finding: 'misplaced',
      location: location('STAFF-RM').id,
    },
    { asset: null, code: 'OLD-CPU-0417', finding: 'unknown', location: null },
  ];
  let found = 0;
  for (const [index, scan] of scans.entries()) {
    if (scan.finding !== 'unknown') found += 1;
    await manager.save(
      manager.create(AssetAuditItem, {
        school_id: schoolId,
        audit_id: audit.id,
        asset_id: scan.asset?.id ?? null,
        code: scan.code,
        finding: scan.finding,
        found_location_id: scan.finding === 'misplaced' ? location('LAB-CS').id : scan.location,
        scanned_by: keeper,
        scanned_at: at(today, `10:${String(index).padStart(2, '0')}`),
      }),
    );
  }
  await manager.update(InventoryAudit, audit.id, { found_count: found });

  const assetCount = [...assets.values()].reduce((sum, list) => sum + list.length, 0);
  console.log(
    `Inventory ${school.code}  ${departments.size} departments, ${locations.size} locations, ${assetCount} assets, ${items.size} stock items: created`,
  );
}

export async function seedDemoCrewAssets(manager: EntityManager, school: School): Promise<void> {
  const [driver]: { id: number; name: string }[] = await manager.query(
    `SELECT u.id, u.name FROM users u WHERE u.mobile = '9000000007' AND u.school_id = $1 AND u.deleted_at IS NULL`,
    [school.id],
  );
  if (!driver) return;
  const [held]: { count: string }[] = await manager.query(
    `SELECT COUNT(*) AS count FROM asset_allocations WHERE user_id = $1 AND deleted_at IS NULL`,
    [driver.id],
  );
  if (Number(held?.count ?? 0) > 0) {
    console.log('Inventory driver assets already set up: kept');
    return;
  }
  const spare = await manager.findOne(Asset, {
    where: { school_id: school.id, status: 'in_store', deleted_at: IsNull() },
    order: { id: 'ASC' },
  });
  if (!spare) {
    console.log('Inventory no asset in store for the driver demo: skipped');
    return;
  }
  const [keeperRow]: { id: number }[] = await manager.query(
    `SELECT id FROM users WHERE mobile = '9000000012' AND deleted_at IS NULL`,
  );
  const keeper = keeperRow ? Number(keeperRow.id) : null;
  const today = todayIn(process.env.APP_TIMEZONE || 'Asia/Kolkata');
  const allocatedOn = shift(today, -2);
  const allocation = await manager.save(
    manager.create(AssetAllocation, {
      school_id: school.id,
      asset_id: spare.id,
      assignee_type: 'staff',
      user_id: Number(driver.id),
      department_id: null,
      location_id: null,
      allocated_on: allocatedOn,
      expected_return_on: shift(today, 60),
      acknowledged_at: null,
      returned_on: null,
      return_condition: null,
      status: 'active',
      allocated_by: keeper,
      returned_by: null,
      remarks: 'For the bus. Please keep it safe and return it at the end of the term.',
      created_by: keeper,
      created_at: at(allocatedOn),
    }),
  );
  await manager.update(Asset, spare.id, { status: 'allocated', custodian_user_id: Number(driver.id) });
  await manager.save(
    manager.create(AssetEvent, {
      school_id: school.id,
      asset_id: spare.id,
      kind: 'allocated',
      note: `Allocated to ${driver.name}`,
      ref_type: 'allocation',
      ref_id: allocation.id,
      actor_id: keeper,
      created_at: at(allocatedOn),
    }),
  );
  console.log(`Inventory ${spare.asset_tag} given to driver ${driver.name} (not yet acknowledged)`);
}
