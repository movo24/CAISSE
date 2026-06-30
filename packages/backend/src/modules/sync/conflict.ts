/**
 * POS-049/086 — Offline sync conflict resolution (pure, unit-testable).
 * Extracted from SyncService.push (behavior-preserving).
 *
 * Rule: if the server record changed since the client's last sync (`updatedAt > lastSyncAt`),
 * the server wins (a conflict is reported and the incoming value is NOT saved). Otherwise the
 * incoming record is accepted. This is last-write-wins biased to the server for safety.
 */
export type SyncResolution = 'server_wins' | 'rejected_no_id';

export interface SyncConflict {
  entity: string;
  entityId: string;
  field: string;
  localValue: unknown;
  serverValue: unknown;
  resolution: SyncResolution;
}

/**
 * POS-INT-136 — offline-sale idempotency partition.
 *
 * A re-pushed offline batch must NEVER create a second sale (NF525 idempotency).
 * Dedup is by client-generated `id`; a sale WITHOUT an id cannot be deduped, so
 * on replay it would be inserted again → a duplicate (money) row. We therefore
 * reject id-less sales rather than insert them. Pure; the caller persists only
 * `withId` and reports `rejected`.
 */
export function partitionPushSales<T extends { id?: string | null }>(
  sales: readonly T[],
): { withId: T[]; rejected: T[] } {
  const withId: T[] = [];
  const rejected: T[] = [];
  for (const s of sales ?? []) {
    if (s && typeof s.id === 'string' && s.id.length > 0) withId.push(s);
    else rejected.push(s);
  }
  return { withId, rejected };
}

/** True when the server record is newer than the client's last sync point. */
export function isServerNewerThanSync(
  serverUpdatedAt: Date | string,
  lastSyncAt: Date | string,
): boolean {
  return new Date(serverUpdatedAt).getTime() > new Date(lastSyncAt).getTime();
}

export interface IncomingCustomer {
  id: string;
  loyaltyPoints: unknown;
}
export interface ServerCustomer {
  updatedAt: Date | string;
  loyaltyPoints: unknown;
}

/** Decide whether to save an incoming customer or report a server-wins conflict. */
export function resolveCustomerSync(
  incoming: IncomingCustomer,
  existing: ServerCustomer | undefined,
  lastSyncAt: Date | string,
): { save: boolean; conflict?: SyncConflict } {
  if (existing && isServerNewerThanSync(existing.updatedAt, lastSyncAt)) {
    return {
      save: false,
      conflict: {
        entity: 'customer',
        entityId: incoming.id,
        field: 'loyaltyPoints',
        localValue: incoming.loyaltyPoints,
        serverValue: existing.loyaltyPoints,
        resolution: 'server_wins',
      },
    };
  }
  return { save: true };
}
