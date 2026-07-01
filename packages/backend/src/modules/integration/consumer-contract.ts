/**
 * POS-INT-249 — Integration consumer contract (Analytik R & co.), pure/testable.
 *
 * This is the CONSUMER side of the outbox feed exposed by
 * `GET /api/integration/events` (see OutboxQueryService.listForConsumer /
 * ConsumerEvent). It contractualizes, in one place and with tests, what a
 * downstream consumer may rely on and how it must behave:
 *
 *   1. the exact set of event `type`s POS emits today (no invention — mirrors
 *      the emitters in sales/stock/reports),
 *   2. envelope validation (reject malformed events instead of trusting them),
 *   3. idempotent, ordered consumption with a resumable cursor.
 *
 * It performs NO I/O and talks to NO external system. It is a reference
 * implementation + schema guard the real Analytik R connector can mirror, and
 * a regression lock so our feed shape cannot drift silently. Nothing here is
 * "live": wiring an actual consumer endpoint remains a gated decision.
 */

/**
 * The complete set of event types the POS outbox emits as of this contract.
 * Sourced from the emitters (sale-events, stock-events, cash-session-events,
 * returns) — kept in sync by consumer-contract.spec.ts, which fails if the code
 * emits a type not listed here.
 */
export const KNOWN_EVENT_TYPES = [
  'sale.created',
  'sale.completed',
  'sale.voided',
  'payment.captured',
  'credit_note.issued',
  'cash_session.opened',
  'cash_session.closed',
  'employee_activity.recorded',
  'stock.movement',
  'stock.low',
  'stock.depleted',
] as const;

export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];

/** The highest schema version this contract understands. */
export const SUPPORTED_SCHEMA_VERSION = 1;

/** Envelope a consumer receives (mirrors OutboxQueryService.ConsumerEvent). */
export interface ConsumerEventEnvelope {
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  storeId: string;
  organizationId: string | null;
  occurredAt: string; // ISO 8601
  payload: Record<string, unknown>;
  schemaVersion: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  /** True when the type is unknown OR schemaVersion is newer than supported. */
  forwardIncompatible: boolean;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Validate a single event envelope against the contract.
 *
 * `forwardIncompatible` distinguishes "the producer is ahead of us" (unknown
 * type or newer schemaVersion) from a genuinely broken event. A robust consumer
 * SKIPS forward-incompatible events (and advances its cursor past them) rather
 * than crashing, while it must NOT silently drop structurally invalid ones.
 */
export function validateConsumerEvent(raw: unknown): ValidationResult {
  const errors: string[] = [];
  let forwardIncompatible = false;

  if (typeof raw !== 'object' || raw === null) {
    return { valid: false, errors: ['event is not an object'], forwardIncompatible: false };
  }
  const e = raw as Record<string, unknown>;

  const requireString = (k: string) => {
    if (typeof e[k] !== 'string' || (e[k] as string).length === 0) {
      errors.push(`${k} must be a non-empty string`);
    }
  };
  requireString('id');
  requireString('type');
  requireString('aggregateType');
  requireString('aggregateId');
  requireString('storeId');

  if (e.organizationId !== null && typeof e.organizationId !== 'string') {
    errors.push('organizationId must be a string or null');
  }
  if (typeof e.occurredAt !== 'string' || !ISO_RE.test(e.occurredAt) || Number.isNaN(Date.parse(e.occurredAt as string))) {
    errors.push('occurredAt must be an ISO 8601 timestamp');
  }
  if (typeof e.payload !== 'object' || e.payload === null || Array.isArray(e.payload)) {
    errors.push('payload must be an object');
  }
  if (typeof e.schemaVersion !== 'number' || !Number.isInteger(e.schemaVersion) || e.schemaVersion < 1) {
    errors.push('schemaVersion must be a positive integer');
  } else if (e.schemaVersion > SUPPORTED_SCHEMA_VERSION) {
    forwardIncompatible = true;
  }

  if (typeof e.type === 'string' && !(KNOWN_EVENT_TYPES as readonly string[]).includes(e.type)) {
    forwardIncompatible = true;
  }

  return { valid: errors.length === 0, errors, forwardIncompatible };
}

export interface IngestOutcome {
  accepted: number; // structurally valid, known, not seen before
  duplicates: number; // id already processed (idempotent replay)
  skipped: number; // forward-incompatible (unknown type / newer schema)
  rejected: number; // structurally invalid
  rejectedIds: string[];
  cursor: string | null; // resumable cursor after this batch
}

/**
 * Reference in-memory consumer. Deterministic, no I/O. Models exactly-once
 * effective processing over an at-least-once feed:
 *
 *   - dedups by event id across batches (idempotent replay safe),
 *   - skips forward-incompatible events without failing the batch,
 *   - rejects malformed events (surfaced, never silently swallowed),
 *   - advances the cursor to the feed's nextCursor so a poll resumes cleanly.
 *
 * The real Analytik R connector can mirror this logic against a durable store.
 */
export class ReferenceConsumer {
  private readonly seen = new Set<string>();
  private cursor: string | null = null;

  get lastCursor(): string | null {
    return this.cursor;
  }

  hasProcessed(id: string): boolean {
    return this.seen.has(id);
  }

  ingestBatch(
    batch: { events: unknown[]; nextCursor: string | null },
  ): IngestOutcome {
    let accepted = 0;
    let duplicates = 0;
    let skipped = 0;
    let rejected = 0;
    const rejectedIds: string[] = [];

    for (const raw of batch.events ?? []) {
      const res = validateConsumerEvent(raw);
      const id = (raw as { id?: unknown })?.id;
      if (!res.valid) {
        rejected++;
        if (typeof id === 'string') rejectedIds.push(id);
        continue;
      }
      const eid = (raw as ConsumerEventEnvelope).id;
      if (this.seen.has(eid)) {
        duplicates++;
        continue;
      }
      if (res.forwardIncompatible) {
        this.seen.add(eid); // mark seen so we don't reconsider it forever
        skipped++;
        continue;
      }
      this.seen.add(eid);
      accepted++;
    }

    // Only advance the cursor when the feed provided one (empty page keeps it).
    if (batch.nextCursor) this.cursor = batch.nextCursor;

    return { accepted, duplicates, skipped, rejected, rejectedIds, cursor: this.cursor };
  }
}
