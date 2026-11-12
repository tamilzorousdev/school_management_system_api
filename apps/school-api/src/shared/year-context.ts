import { AsyncLocalStorage } from 'node:async_hooks';

export const YEAR_HEADER = 'x-academic-year-id';

const storage = new AsyncLocalStorage<{ yearId: number }>();

export function runInYear<T>(yearId: number, work: () => T): T {
  return storage.run({ yearId }, work);
}

export function viewingYearId(): number | null {
  return storage.getStore()?.yearId ?? null;
}

export function yearClause(alias: string): string {
  const yearId = viewingYearId();
  return yearId ? `${alias}.id = ${Number(yearId)}` : `${alias}.is_current = true`;
}

export function parseYearHeader(value: string | undefined): number | null | 'invalid' {
  if (value === undefined || value === '') return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 'invalid';
}

export function yearWhere(
  schoolId: number,
): { school_id: number; id: number } | { school_id: number; is_current: true } {
  const yearId = viewingYearId();
  return yearId ? { school_id: schoolId, id: yearId } : { school_id: schoolId, is_current: true };
}
