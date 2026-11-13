import { EntityManager } from 'typeorm';
import { AppException, AuthenticatedRequest } from '@app/common';
import { AppConfig } from '../../config/configuration';
import { monthStartIn, todayIn, yearsBetween } from '../../shared/dates';
import { resolveSchoolId } from '../../shared/school-context';
import { PERMISSIONS, ROLE_CATALOG, roleConflict, rolePermissions } from '../access/access.catalog';
import { SequencesService } from '../schools/sequences.service';
import { holidayDays } from '../setup/holidays.service';
import { Section } from '../setup/entities/section.entity';
import { assertAdmissionAllows } from './admissions.service';
import { Guardian } from './entities/guardian.entity';
import { GuardiansService } from './guardians.service';
import { StudentsService } from './students.service';

const code = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (error) {
    return ((error as AppException).getResponse() as { code: string }).code;
  }
};

describe('dates', () => {
  it('counts full years only', () => {
    expect(yearsBetween('2021-06-03', '2026-06-02')).toBe(4);
    expect(yearsBetween('2021-06-03', '2026-06-03')).toBe(5);
    expect(yearsBetween('2026-11-02', '2026-11-02')).toBe(0);
  });

  it('uses the school time zone for today and the month start', () => {
    const lateNightUtc = new Date('2026-10-31T20:00:00Z');
    expect(todayIn('Asia/Kolkata', lateNightUtc)).toBe('2026-11-01');
    expect(monthStartIn('Asia/Kolkata', lateNightUtc)).toBe('2026-11-01');
  });

  it('counts holiday days including both ends', () => {
    expect(holidayDays('2026-12-24', '2027-01-01')).toBe(9);
    expect(holidayDays('2026-11-08', null)).toBe(1);
  });
});

describe('numbers', () => {
  it('formats admission and application numbers', () => {
    expect(SequencesService.format('TZMS', '2026', 12)).toBe('TZMS-2026-0012');
    expect(SequencesService.format('APP', 2026, 1)).toBe('APP-2026-0001');
  });
});

describe('school context', () => {
  const request = (user: object | undefined, header?: string) =>
    ({
      user,
      header: (name: string) => (name === 'x-school-id' ? header : undefined),
    }) as unknown as AuthenticatedRequest;

  it('uses the school of a school user and ignores the header', () => {
    expect(resolveSchoolId(request({ school_id: 3, roles: ['ADMIN'] }, '9'))).toBe(3);
  });

  it('lets a super admin pick a school with X-School-Id', () => {
    expect(resolveSchoolId(request({ school_id: null, roles: ['SUPER_ADMIN'] }, '2'))).toBe(2);
  });

  it('asks a super admin to choose a school when the header is missing or invalid', () => {
    expect(code(() => resolveSchoolId(request({ school_id: null, roles: ['SUPER_ADMIN'] })))).toBe('SCHOOL_REQUIRED');
    expect(code(() => resolveSchoolId(request({ school_id: null, roles: ['SUPER_ADMIN'] }, 'abc')))).toBe(
      'SCHOOL_REQUIRED',
    );
  });

  it('never lets a non-super-admin without a school pick one', () => {
    expect(code(() => resolveSchoolId(request({ school_id: null, roles: ['ADMIN'] }, '2')))).toBe('SCHOOL_REQUIRED');
  });
});

describe('permissions', () => {
  const role = (codeName: string) => ROLE_CATALOG.find((item) => item.code === codeName)!;

  it('keeps school creation for the super admin only', () => {
    expect(rolePermissions(role('SUPER_ADMIN'))).toContain(PERMISSIONS.PLATFORM_SCHOOLS);
    expect(rolePermissions(role('ADMIN'))).not.toContain(PERMISSIONS.PLATFORM_SCHOOLS);
    expect(rolePermissions(role('ADMIN'))).toContain(PERMISSIONS.STUDENTS_MANAGE);
  });

  it('lets the AO run admissions but not edit school setup', () => {
    expect(rolePermissions(role('AO'))).toEqual(
      expect.arrayContaining([PERMISSIONS.ADMISSIONS_MANAGE, PERMISSIONS.STUDENTS_MANAGE]),
    );
    expect(rolePermissions(role('AO'))).not.toContain(PERMISSIONS.SCHOOLS_MANAGE);
  });

  it('keeps salaries, user roles and setup away from the AO', () => {
    const ao = rolePermissions(role('AO'));
    for (const code of [
      PERMISSIONS.PAYROLL_VIEW,
      PERMISSIONS.USERS_MANAGE,
      PERMISSIONS.STAFF_BANK,
      PERMISSIONS.TIMETABLE_MANAGE,
    ])
      expect(ao).not.toContain(code);
  });

  it('lets only the AO (and the platform owner) assign substitutes', () => {
    const holders = ROLE_CATALOG.filter((item) => rolePermissions(item).includes(PERMISSIONS.SUBSTITUTES_MANAGE)).map(
      (item) => item.code,
    );
    expect(holders.sort()).toEqual(['AO', 'SUPER_ADMIN']);
  });
});

describe('admission workflow', () => {
  it.each([
    ['approve', 'applied', 'ok'],
    ['approve', 'approved', 'INVALID_ADMISSION_STATUS'],
    ['reject', 'approved', 'ok'],
    ['reject', 'enrolled', 'INVALID_ADMISSION_STATUS'],
    ['enrol', 'approved', 'ok'],
    ['enrol', 'applied', 'INVALID_ADMISSION_STATUS'],
    ['edit', 'rejected', 'INVALID_ADMISSION_STATUS'],
  ] as const)('%s from %s → %s', (action, status, expected) => {
    expect(code(() => assertAdmissionAllows(action, status))).toBe(expected);
  });
});

describe('StudentsService placement rules', () => {
  const section = { id: 8, school_id: 1, class_id: 4, academic_year_id: 2, name: 'A', capacity: 2 } as Section;
  const service = new StudentsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { linkFor: () => null } as never,
    {} as never,
    { timeZone: 'Asia/Kolkata' } as AppConfig,
  );
  const manager = (filled: number, rollTaken: boolean) =>
    ({
      findOneBy: jest.fn().mockResolvedValue(section),
      countBy: jest.fn().mockResolvedValue(filled),
      exists: jest.fn().mockResolvedValue(rollTaken),
    }) as unknown as EntityManager;
  const place = (m: EntityManager, classId: number, sectionId: number | null, roll: number | null, year = 2) =>
    (service as unknown as { assertPlacement: (...args: unknown[]) => Promise<void> })
      .assertPlacement(m, 1, year, classId, sectionId, roll, null)
      .then(
        () => 'ok',
        (error: AppException) => (error.getResponse() as { code: string }).code,
      );

  it('accepts a free roll number in a section of the right class and year', async () => {
    expect(await place(manager(1, false), 4, 8, 5)).toBe('ok');
  });

  it('rejects a section from another class or year', async () => {
    expect(await place(manager(0, false), 5, 8, null)).toBe('SECTION_NOT_IN_CLASS');
    expect(await place(manager(0, false), 4, 8, null, 3)).toBe('SECTION_NOT_CURRENT');
  });

  it('rejects a full section and a taken roll number', async () => {
    expect(await place(manager(2, false), 4, 8, null)).toBe('SECTION_FULL');
    expect(await place(manager(1, true), 4, 8, 5)).toBe('ROLL_TAKEN');
  });

  it('needs a section before a roll number', async () => {
    expect(await place(manager(0, false), 4, null, 5)).toBe('ROLL_NEEDS_SECTION');
  });
});

describe('GuardiansService.ensureLogin', () => {
  const service = new GuardiansService(
    {} as never,
    {} as never,
    { linkFor: () => null } as never,
    {} as never,
    { timeZone: 'Asia/Kolkata' } as AppConfig,
  );
  const guardian = () =>
    ({ id: 7, school_id: 1, name: 'Kala Prabhu', mobile: '9000000302', email: null, user_id: null }) as Guardian;

  it('creates a parent login and invites when the mobile is new', async () => {
    const manager = {
      findOneByOrFail: jest.fn().mockResolvedValue({ id: 8 }),
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((_entity, value) => value),
      save: jest.fn(async (value) => ({ ...value, id: 55 })),
      exists: jest.fn().mockResolvedValue(false),
      insert: jest.fn(),
      update: jest.fn(),
    } as unknown as EntityManager;
    expect(await service.ensureLogin(manager, guardian(), 'ta')).toEqual({ user_id: 55, school_id: 1 });
    expect((manager.save as jest.Mock).mock.calls[0][0]).toMatchObject({ mobile: '9000000302', language: 'ta' });
  });

  it('only adds the parent role to an existing user (teacher who is also a parent)', async () => {
    const manager = {
      findOneByOrFail: jest.fn().mockResolvedValue({ id: 8 }),
      findOneBy: jest.fn().mockResolvedValue({ id: 20 }),
      exists: jest.fn().mockResolvedValue(false),
      insert: jest.fn(),
      update: jest.fn(),
      save: jest.fn(),
    } as unknown as EntityManager;
    expect(await service.ensureLogin(manager, guardian())).toEqual({ user_id: 20, school_id: 1 });
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.insert).toHaveBeenCalledWith(expect.anything(), { user_id: 20, role_id: 8 });
  });

  it('does not invite again when the user is already a parent', async () => {
    const manager = {
      findOneByOrFail: jest.fn().mockResolvedValue({ id: 8 }),
      findOneBy: jest.fn().mockResolvedValue({ id: 20 }),
      exists: jest.fn().mockResolvedValue(true),
      update: jest.fn(),
    } as unknown as EntityManager;
    expect(await service.ensureLogin(manager, { ...guardian(), user_id: 20 } as Guardian)).toBeNull();
  });
});

describe('role conflicts', () => {
  it('stops a teacher from also being bus crew', () => {
    expect(roleConflict(['TEACHER', 'DRIVER'])).toBe(
      'A person cannot be both Teacher and Driver. Teaching staff and bus crew must be different people.',
    );
    expect(roleConflict(['HOD', 'ATTENDANT'])).toContain('Head of department and Bus attendant');
  });

  it('allows a parent who teaches or drives', () => {
    expect(roleConflict(['TEACHER', 'PARENT'])).toBeNull();
    expect(roleConflict(['DRIVER', 'PARENT'])).toBeNull();
    expect(roleConflict(['DRIVER', 'ATTENDANT'])).toBeNull();
  });
});
