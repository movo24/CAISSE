/**
 * POS — Integration events consumer query normalization (pure, unit-testable).
 * Used by the Analytik R (and any consumer) polling endpoint: validate/clamp the
 * incremental cursor, page size and type filter. No DB.
 */

export const MAX_EVENTS_PAGE = 500;
export const DEFAULT_EVENTS_PAGE = 100;

export interface NormalizedEventsQuery {
  sinceDate: Date | null; // events strictly after this occurredAt (cursor)
  limit: number; // 1..MAX_EVENTS_PAGE
  types: string[]; // empty = all
}

/** Parse + clamp the consumer query params. Invalid `since` → null (from start). */
export function normalizeEventsQuery(input: {
  since?: string;
  limit?: string | number;
  type?: string; // comma-separated
}): NormalizedEventsQuery {
  let sinceDate: Date | null = null;
  if (input.since) {
    const d = new Date(input.since);
    if (!Number.isNaN(d.getTime())) sinceDate = d;
  }

  const rawLimit = typeof input.limit === 'number' ? input.limit : parseInt(input.limit ?? '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_EVENTS_PAGE)
    : DEFAULT_EVENTS_PAGE;

  const types = (input.type ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  return { sinceDate, limit, types };
}
