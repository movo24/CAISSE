/**
 * POS-INT-104 — pure reference implementation of the consumer feed keyset
 * pagination contract (POS-INT-103).
 *
 * The live feed (OutboxQueryService.listForConsumer) runs this exact logic in
 * SQL: order by (occurredAt ASC, id ASC), resume strictly after the composite
 * cursor `(occurredAt, id)`. This module mirrors that semantics in memory so the
 * contract can be exercised deterministically without a database — proving that
 * paginating end-to-end never skips or duplicates an event, even when many
 * events share the same occurredAt across a page boundary.
 *
 * Pure: no DB, no Nest. Used by tests and reusable by any in-memory consumer.
 */

import { encodeEventsCursor, parseEventsCursor } from './events-query';

export interface KeysetEvent {
  id: string;
  occurredAt: Date;
}

/** Total order matching SQL `ORDER BY occurred_at ASC, id ASC`. */
export function compareKeyset(a: KeysetEvent, b: KeysetEvent): number {
  const ta = a.occurredAt.getTime();
  const tb = b.occurredAt.getTime();
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * True when `e` comes strictly after the cursor under (occurredAt, id) order.
 * A bare-timestamp cursor (id null) behaves like the legacy strict-after-time.
 */
export function isAfterCursor(
  e: KeysetEvent,
  cursor: { occurredAt: Date | null; id: string | null },
): boolean {
  if (!cursor.occurredAt) return true; // no cursor → from the start
  const t = e.occurredAt.getTime();
  const c = cursor.occurredAt.getTime();
  if (t > c) return true;
  if (t < c) return false;
  // same timestamp: only advance if a tie-breaker id is set and e.id is greater
  return cursor.id != null && e.id > cursor.id;
}

export interface KeysetPage<T extends KeysetEvent> {
  events: T[];
  nextCursor: string | null;
}

/**
 * Select one page after `since` (encoded cursor string or undefined), mirroring
 * the SQL query. Input need not be pre-sorted; it is ordered here.
 */
export function selectPage<T extends KeysetEvent>(
  all: readonly T[],
  since: string | undefined,
  limit: number,
): KeysetPage<T> {
  const cursor = parseEventsCursor(since);
  const ordered = [...all].sort(compareKeyset);
  const after = ordered.filter((e) => isAfterCursor(e, cursor));
  const events = after.slice(0, Math.max(1, limit));
  const last = events.length ? events[events.length - 1] : null;
  const nextCursor = last ? encodeEventsCursor(last.occurredAt.toISOString(), last.id) : null;
  return { events, nextCursor };
}

/** Drain every page from the start; returns the ids in delivery order. */
export function drainAll<T extends KeysetEvent>(all: readonly T[], limit: number): string[] {
  const out: string[] = [];
  let cursor: string | undefined;
  // hard bound to avoid infinite loops on a broken cursor
  for (let guard = 0; guard <= all.length + 1; guard++) {
    const page = selectPage(all, cursor, limit);
    if (page.events.length === 0) break;
    out.push(...page.events.map((e) => e.id));
    cursor = page.nextCursor ?? undefined;
  }
  return out;
}
