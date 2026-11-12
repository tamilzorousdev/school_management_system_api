import { EntityManager, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { AppException } from '@app/common';
import { yearClause } from './year-context';

export const CURRENT_YEAR_ALIAS = 'cy';

export function currentYearCondition(alias: string, yearAlias = CURRENT_YEAR_ALIAS): string {
  return `${yearAlias}.id = ${alias}.academic_year_id AND ${yearClause(yearAlias)} AND ${yearAlias}.deleted_at IS NULL`;
}

export function onlyCurrentYear<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias = qb.alias,
): SelectQueryBuilder<T> {
  return qb.innerJoin('academic_years', CURRENT_YEAR_ALIAS, currentYearCondition(alias));
}

export function currentYearSql(alias: string, yearAlias = CURRENT_YEAR_ALIAS): string {
  return `JOIN academic_years ${yearAlias} ON ${currentYearCondition(alias, yearAlias)}`;
}

export async function currentYearId(manager: EntityManager, schoolId: number): Promise<number> {
  const [row]: { id: number }[] = await manager.query(
    `SELECT id FROM academic_years y WHERE y.school_id = $1 AND ${yearClause('y')} AND y.deleted_at IS NULL LIMIT 1`,
    [schoolId],
  );
  if (!row) {
    throw AppException.badRequest('Set the current academic year in School setup first', 'NO_CURRENT_YEAR');
  }
  return Number(row.id);
}

export async function isCurrentYear(manager: EntityManager, yearId: number): Promise<boolean> {
  const [row] = await manager.query(
    `SELECT 1 FROM academic_years WHERE id = $1 AND is_current = true AND deleted_at IS NULL`,
    [yearId],
  );
  return Boolean(row);
}
