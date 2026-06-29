/**
 * POS — Integration events consumer query normalization (pure, unit-testable).
 * Used by the Analytik R (and any consumer) polling endpoint: validate/clamp the
 * incremental cursor, page size and type filter. No DB.
 */

export const MAX_EVENTS_PAGE = 500;
export const DEFAULT_EVENTS_PAGE = 100;

export interface NormalizedEventsQuery {
  sinceDate: Date | null; // events strictly after this occurredAt (cursor)
  sinceId: string | null; // POS-INT-103 — tie-breaker id within the same occurredAt
  limit: number; // 1..MAX_EVENTS_PAGE
  types: string[]; // empty = all
}

/**
 * POS-INT-103 — composite cursor `"<iso>|<id>"`.
 *
 * Ordering is (occurredAt ASC, id ASC). A timestamp-only cursor (MoreThan
 * occurredAt) silently SKIPS events that share the boundary timestamp when a
 * page cuts through a same-millisecond group. The composite cursor carries the
 * last id so the next page resumes exactly after it without loss.
 *
 * Back-compat: a bare ISO `since` (no `|`) parses to { occurredAt, id:null } and
 * behaves like the legacy strict-after-timestamp cursor.
 */
export function parseEventsCursor(since?: string): { occurredAt: Date | null; id: string | null } {
  if (!since) return { occurredAt: null, id: null };
  const sep = since.indexOf('|');
  const datePart = sep >= 0 ? since.slice(0, sep) : since;
  const idPart = sep >= 0 ? since.slice(sep + 1).trim() : '';
  const d = new Date(datePart);
  if (Number.isNaN(d.getTime())) return { occurredAt: null, id: null };
  return { occurredAt: d, id: idPart.length ? idPart : null };
}

/** Build the opaque cursor a consumer should send back to resume after this event. */
export function encodeEventsCursor(occurredAtIso: string, id: string): string {
  return `${occurredAtIso}|${id}`;
}

/** Parse + clamp the consumer query params. Invalid `since` → null (from start). */
export function normalizeEventsQuery(input: {
  since?: string;
  limit?: string | number;
  type?: string; // comma-separated
}): NormalizedEventsQuery {
  const { occurredAt: sinceDate, id: sinceId } = parseEventsCursor(input.since);

  const rawLimit = typeof input.limit === 'number' ? input.limit : parseInt(input.limit ?? '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_EVENTS_PAGE)
    : DEFAULT_EVENTS_PAGE;

  const types = (input.type ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  return { sinceDate, sinceId, limit, types };
}
