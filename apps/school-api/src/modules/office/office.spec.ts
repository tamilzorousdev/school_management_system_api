import { lastValueFrom, of } from 'rxjs';
import { inWings, runInWings, wingClassIds, wingClause } from '../../shared/wing-context';
import {
  classesOfWing,
  classInWing,
  gradeName,
  hasNote,
  hoursSince,
  inactiveFor,
  isOverdue,
  isWingLimitedRole,
  overlapError,
  percent,
  rangeLabel,
  spanActive,
  wingOfClass,
} from './office.logic';
import { WingScopeInterceptor } from './wing-scope.interceptor';

const classes = [
  { id: 1, name: 'LKG', grade_level: -1 },
  { id: 2, name: 'UKG', grade_level: 0 },
  { id: 3, name: '1', grade_level: 1 },
  { id: 7, name: '5', grade_level: 5 },
  { id: 8, name: '6', grade_level: 6 },
  { id: 14, name: '12', grade_level: 12 },
];
const prePrimary = { id: 1, name: 'Pre-primary', from_grade: -1, to_grade: 0, class_ids: null };
const primary = { id: 2, name: 'Primary', from_grade: 1, to_grade: 5, class_ids: null };
const secondary = { id: 3, name: 'Secondary', from_grade: 6, to_grade: 10, class_ids: null };

describe('office wings', () => {
  it('limits only an AO without an admin, principal or super admin role', () => {
    expect(isWingLimitedRole(['AO'])).toBe(true);
    expect(isWingLimitedRole(['AO', 'PARENT'])).toBe(true);
    expect(isWingLimitedRole(['AO', 'PRINCIPAL'])).toBe(false);
    expect(isWingLimitedRole(['ADMIN'])).toBe(false);
    expect(isWingLimitedRole(['TEACHER'])).toBe(false);
  });

  it('puts a class in a wing by grade range, or by exact classes when given', () => {
    expect(classInWing(classes[0]!, prePrimary)).toBe(true);
    expect(classInWing(classes[2]!, prePrimary)).toBe(false);
    expect(classesOfWing(primary, classes).map((row) => row.name)).toEqual(['1', '5']);
    const picked = { ...primary, class_ids: [8] };
    expect(classesOfWing(picked, classes).map((row) => row.id)).toEqual([8]);
    expect(wingOfClass(classes[5]!, [prePrimary, primary, secondary])).toBeNull();
    expect(wingOfClass(classes[4]!, [prePrimary, primary, secondary])?.name).toBe('Secondary');
  });

  it('refuses a class in two wings', () => {
    expect(overlapError([prePrimary, primary, secondary], classes)).toBeNull();
    const wide = { ...secondary, from_grade: 5 };
    expect(overlapError([primary, wide], classes)).toBe(
      'Class 5 is already in Primary; a class can be in one wing only',
    );
    const cbse = { id: 4, name: 'CBSE Primary', from_grade: 1, to_grade: 5, class_ids: [3] };
    const state = { id: 5, name: 'State Primary', from_grade: 1, to_grade: 5, class_ids: [7] };
    expect(overlapError([cbse, state], classes)).toBeNull();
  });

  it('counts a cover only between its dates', () => {
    expect(spanActive({ valid_from: null, valid_to: null }, '2026-11-23')).toBe(true);
    expect(spanActive({ valid_from: '2026-11-24', valid_to: null }, '2026-11-23')).toBe(false);
    expect(spanActive({ valid_from: '2026-11-20', valid_to: '2026-11-23' }, '2026-11-23')).toBe(true);
    expect(spanActive({ valid_from: null, valid_to: '2026-11-22' }, '2026-11-23')).toBe(false);
  });

  it('names grades and ranges', () => {
    expect(gradeName(-1)).toBe('LKG');
    expect(gradeName(0)).toBe('UKG');
    expect(gradeName(7)).toBe('7');
    expect(rangeLabel(prePrimary)).toBe('LKG – UKG');
    expect(rangeLabel(primary)).toBe('Classes 1 – 5');
    expect(rangeLabel({ from_grade: 11, to_grade: 11, class_ids: null })).toBe('Class 11');
    expect(rangeLabel({ from_grade: 1, to_grade: 5, class_ids: [3, 7] }, ['1', '5'])).toBe('1, 5');
  });

  it('treats None, Nil, NA and dashes as no health note', () => {
    expect(hasNote('None')).toBe(false);
    expect(hasNote(' n/a ')).toBe(false);
    expect(hasNote(null)).toBe(false);
    expect(hasNote('Peanut allergy')).toBe(true);
  });

  it('works out percent, age and overdue', () => {
    expect(percent(0, 0)).toBeNull();
    expect(percent(47, 50)).toBe(94);
    const now = new Date('2026-11-23T12:00:00Z');
    expect(hoursSince('2026-11-23T09:30:00Z', now)).toBe(2);
    expect(isOverdue('2026-11-22T12:00:00Z', now)).toBe(true);
    expect(isOverdue('2026-11-22T12:00:01Z', now)).toBe(false);
    expect(inactiveFor(null, now)).toBe(true);
    expect(inactiveFor('2026-11-22T00:00:00Z', now)).toBe(false);
    expect(inactiveFor('2026-11-20T00:00:00Z', now)).toBe(true);
  });
});

describe('wing context', () => {
  it('leaves everything open outside a wing scope', () => {
    expect(wingClassIds()).toBeNull();
    expect(wingClause('e.class_id')).toBe('TRUE');
    expect(inWings(99)).toBe(true);
  });

  it('limits to the wing classes inside a scope', () => {
    runInWings([3, 7], () => {
      expect(wingClause('e.class_id')).toBe('e.class_id IN (3, 7)');
      expect(inWings(3)).toBe(true);
      expect(inWings(8)).toBe(false);
      expect(inWings(null)).toBe(false);
    });
    runInWings([], () => expect(wingClause('e.class_id')).toBe('FALSE'));
  });
});

describe('WingScopeInterceptor', () => {
  const call = (user: object, path: string, routePath: string, params: Record<string, string> = {}) => ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ user, path, route: { path: routePath }, params }) }),
  });
  const scope = (classIds: number[] | null, studentClass: number | null) => ({
    classIdsFor: jest.fn().mockResolvedValue(classIds),
    studentClassId: jest.fn().mockResolvedValue(studentClass),
  });
  const ao = { id: 5, school_id: 1, roles: ['AO'], permissions: [] };
  const seen = () => ({ handle: () => of(wingClassIds()) });

  it('runs a wing AO inside their classes', async () => {
    const interceptor = new WingScopeInterceptor(scope([3, 7], null) as never);
    const result = await interceptor.intercept(
      call(ao, '/api/v1/admin/office/wings', '/api/v1/admin/office/wings') as never,
      seen(),
    );
    expect(await lastValueFrom(result)).toEqual([3, 7]);
  });

  it('gives 404 for a student outside the wing', async () => {
    const interceptor = new WingScopeInterceptor(scope([3, 7], 8) as never);
    await expect(
      interceptor.intercept(
        call(ao, '/api/v1/admin/students/41', '/api/v1/admin/students/:id', { id: '41' }) as never,
        seen(),
      ),
    ).rejects.toMatchObject({ response: { code: 'STUDENT_NOT_FOUND' } });
  });

  it('lets a student in the wing through', async () => {
    const interceptor = new WingScopeInterceptor(scope([3, 7], 7) as never);
    const result = await interceptor.intercept(
      call(ao, '/api/v1/mobile/office/students/41', '/api/v1/mobile/office/students/:id', { id: '41' }) as never,
      seen(),
    );
    expect(await lastValueFrom(result)).toEqual([3, 7]);
  });

  it('does not touch the head AO, admins or other app routes', async () => {
    const head = new WingScopeInterceptor(scope(null, null) as never);
    expect(
      await lastValueFrom(
        await head.intercept(call(ao, '/api/v1/admin/students', '/api/v1/admin/students') as never, seen()),
      ),
    ).toBeNull();
    const parentRoute = scope([3], 8);
    const asParent = new WingScopeInterceptor(parentRoute as never);
    await asParent.intercept(
      call(ao, '/api/v1/mobile/parent/children', '/api/v1/mobile/parent/children') as never,
      seen(),
    );
    expect(parentRoute.classIdsFor).not.toHaveBeenCalled();
    const admin = scope([3], 8);
    await new WingScopeInterceptor(admin as never).intercept(
      call({ ...ao, roles: ['ADMIN'] }, '/api/v1/admin/students/41', '/api/v1/admin/students/:id', {
        id: '41',
      }) as never,
      seen(),
    );
    expect(admin.classIdsFor).not.toHaveBeenCalled();
  });
});
