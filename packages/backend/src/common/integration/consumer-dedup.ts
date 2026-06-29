/**
 * POS-INT-102 — consumer-side idempotency contract.
 *
 * The POS outbox guarantees AT-LEAST-ONCE delivery: a relay retry, a replayed
 * push, or a re-read of the feed can hand the same integration event to a
 * downstream consumer (Comptamax24, Analytik R) more than once. Every event
 * carries a stable unique `id` (see buildIntegrationEvent). Consumers achieve
 * EXACTLY-ONCE processing by remembering which ids they have already applied and
 * skipping repeats.
 *
 * This module is pure (no DB, no Nest): the caller owns the "seen" store (a Set
 * in memory, a table, a KV — whatever the consumer has). The POS never depends
 * on it; it is preparation for consumers, never a blocker of the caisse.
 */

/** Minimal shape a consumer needs to dedupe: anything with a stable event id. */
export interface Dedupable {
  id: string;
}

export interface DedupResult<T extends Dedupable> {
  /** Events not seen before, in input order, each id unique within the batch. */
  fresh: T[];
  /** Events skipped because their id was already seen (prior batch or earlier in this batch). */
  duplicates: T[];
  /** The updated set of seen ids (same reference as `seen` when provided). */
  seen: Set<string>;
}

/** True when this id has not yet been processed. */
export function isFreshEventId(id: string, seen: ReadonlySet<string>): boolean {
  return !!id && !seen.has(id);
}

/**
 * Split a batch into fresh vs duplicate events relative to a set of already-seen
 * ids, marking fresh ids as seen. Intra-batch repeats and events with an empty
 * id are treated as duplicates (an event with no id cannot be deduped safely, so
 * a careful consumer drops it rather than risk double-applying it).
 */
export function dedupeBatch<T extends Dedupable>(
  events: readonly T[],
  seen: Set<string> = new Set<string>(),
): DedupResult<T> {
  const fresh: T[] = [];
  const duplicates: T[] = [];
  for (const e of events) {
    if (isFreshEventId(e.id, seen)) {
      seen.add(e.id);
      fresh.push(e);
    } else {
      duplicates.push(e);
    }
  }
  return { fresh, duplicates, seen };
}

/** Convenience: just the fresh events (order preserved), seen set mutated. */
export function freshOnly<T extends Dedupable>(
  events: readonly T[],
  seen?: Set<string>,
): T[] {
  return dedupeBatch(events, seen).fresh;
}

/** Build a seen-set from already-processed ids (e.g. loaded from a consumer store). */
export function seenSetFrom(ids: Iterable<string>): Set<string> {
  return new Set<string>([...ids].filter((id) => !!id));
}
