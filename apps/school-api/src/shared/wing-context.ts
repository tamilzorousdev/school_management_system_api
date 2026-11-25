import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<{ classIds: number[] }>();

export function runInWings<T>(classIds: number[], work: () => T): T {
  return storage.run({ classIds }, work);
}

export function wingClassIds(): number[] | null {
  return storage.getStore()?.classIds ?? null;
}

export function wingClause(column: string): string {
  const ids = wingClassIds();
  if (!ids) return 'TRUE';
  return ids.length ? `${column} IN (${ids.map((id) => Number(id)).join(', ')})` : 'FALSE';
}

export function inWings(classId: number | null | undefined): boolean {
  const ids = wingClassIds();
  if (!ids) return true;
  return classId !== null && classId !== undefined && ids.includes(Number(classId));
}
