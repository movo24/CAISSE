import { SelectQueryBuilder } from 'typeorm';

/**
 * INV-5 — the tenant store filter lives in the QUERY layer, never in the UI or
 * bolted on after the fact. Every cockpit read MUST go through this so the scope
 * is a SQL `WHERE store_id IN (:scope)` clause.
 *
 * Fail-closed: an EMPTY scope yields ZERO rows (`1 = 0`), never "all stores".
 */
export function applyStoreScope<T extends import('typeorm').ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  scope: string[],
): SelectQueryBuilder<T> {
  if (!scope || scope.length === 0) {
    return qb.andWhere('1 = 0');
  }
  return qb.andWhere(`${alias}.store_id IN (:...storeScope)`, { storeScope: scope });
}
