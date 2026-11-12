import 'reflect-metadata';
import { lastValueFrom, of } from 'rxjs';
import { currentYearCondition } from './academic-year';
import { parseYearHeader, runInYear, viewingYearId, yearClause, yearWhere } from './year-context';
import { YearContextInterceptor } from './year-context.interceptor';

function http(method: string, path: string, header?: string, schoolId = 1) {
  const request = {
    method,
    path,
    user: { school_id: schoolId, roles: ['ADMIN'] },
    header: (name: string) => (name === 'x-academic-year-id' ? header : undefined),
  };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

function interceptor(year: { id: number; name: string; is_current: boolean } | null) {
  const dataSource = { query: jest.fn().mockResolvedValue(year ? [year] : []) };
  return { interceptor: new YearContextInterceptor(dataSource as never), dataSource };
}

const handler = { handle: () => of(viewingYearId()) };

describe('academic year being viewed', () => {
  it('uses the current year when nothing is chosen', () => {
    expect(viewingYearId()).toBeNull();
    expect(yearClause('y')).toBe('y.is_current = true');
    expect(yearWhere(1)).toEqual({ school_id: 1, is_current: true });
  });

  it('uses the chosen year inside a request', () => {
    runInYear(3, () => {
      expect(yearClause('y')).toBe('y.id = 3');
      expect(yearWhere(1)).toEqual({ school_id: 1, id: 3 });
      expect(currentYearCondition('t')).toContain('cy.id = 3');
    });
    expect(viewingYearId()).toBeNull();
  });

  it('reads the header value', () => {
    expect(parseYearHeader(undefined)).toBeNull();
    expect(parseYearHeader('')).toBeNull();
    expect(parseYearHeader('4')).toBe(4);
    expect(parseYearHeader('abc')).toBe('invalid');
    expect(parseYearHeader('0')).toBe('invalid');
  });
});

describe('year context interceptor', () => {
  it('shows an earlier year for admin reads', async () => {
    const { interceptor: subject } = interceptor({ id: 1, name: '2025-26', is_current: false });
    const result = await subject.intercept(http('GET', '/api/v1/admin/students', '1'), handler);
    expect(await lastValueFrom(result)).toBe(1);
  });

  it('blocks changes while an earlier year is shown', async () => {
    const { interceptor: subject } = interceptor({ id: 1, name: '2025-26', is_current: false });
    await expect(
      subject.intercept(http('PUT', '/api/v1/admin/attendance/sections/2', '1'), handler),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'YEAR_READ_ONLY' }),
    });
  });

  it('works normally for the current year, the apps and requests without the header', async () => {
    const current = interceptor({ id: 2, name: '2026-27', is_current: true }).interceptor;
    expect(await lastValueFrom(await current.intercept(http('PUT', '/api/v1/admin/x', '2'), handler))).toBeNull();
    const { interceptor: subject, dataSource } = interceptor(null);
    expect(
      await lastValueFrom(await subject.intercept(http('GET', '/api/v1/mobile/parent/children', '1'), handler)),
    ).toBeNull();
    expect(await lastValueFrom(await subject.intercept(http('GET', '/api/v1/admin/students'), handler))).toBeNull();
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('refuses a year of another school or a bad value', async () => {
    const { interceptor: subject } = interceptor(null);
    await expect(subject.intercept(http('GET', '/api/v1/admin/students', '99'), handler)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ACADEMIC_YEAR_NOT_FOUND' }),
    });
    await expect(subject.intercept(http('GET', '/api/v1/admin/students', 'x'), handler)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_ACADEMIC_YEAR' }),
    });
  });
});
