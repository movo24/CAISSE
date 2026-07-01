import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import {
  KNOWN_EVENT_TYPES,
  SUPPORTED_SCHEMA_VERSION,
  validateConsumerEvent,
  ReferenceConsumer,
  ConsumerEventEnvelope,
} from './consumer-contract';

// PAQUET 249 — consumer contract for the Analytik R (and any) outbox consumer.
// Pure, no I/O, no live system.

const validEvent = (over: Partial<ConsumerEventEnvelope> = {}): ConsumerEventEnvelope => ({
  id: 'evt-1',
  type: 'stock.low',
  aggregateType: 'product',
  aggregateId: 'p-1',
  storeId: 's-1',
  organizationId: 'org-1',
  occurredAt: '2026-06-07T10:00:00.000Z',
  payload: { productId: 'p-1', quantity: 3 },
  schemaVersion: 1,
  ...over,
});

describe('consumer-contract — envelope validation', () => {
  it('accepts a well-formed known event', () => {
    const res = validateConsumerEvent(validEvent());
    expect(res).toEqual({ valid: true, errors: [], forwardIncompatible: false });
  });

  it('accepts organizationId = null', () => {
    expect(validateConsumerEvent(validEvent({ organizationId: null })).valid).toBe(true);
  });

  it('rejects a non-object', () => {
    expect(validateConsumerEvent(null).valid).toBe(false);
    expect(validateConsumerEvent('nope').valid).toBe(false);
  });

  it('rejects missing/empty required string fields', () => {
    const res = validateConsumerEvent(validEvent({ id: '', storeId: undefined as any }));
    expect(res.valid).toBe(false);
    expect(res.errors).toEqual(expect.arrayContaining([
      'id must be a non-empty string',
      'storeId must be a non-empty string',
    ]));
  });

  it('rejects a non-ISO occurredAt', () => {
    expect(validateConsumerEvent(validEvent({ occurredAt: '07/06/2026' as any })).valid).toBe(false);
  });

  it('rejects a payload that is not a plain object', () => {
    expect(validateConsumerEvent(validEvent({ payload: [] as any })).valid).toBe(false);
    expect(validateConsumerEvent(validEvent({ payload: 'x' as any })).valid).toBe(false);
  });

  it('rejects a non-positive-integer schemaVersion', () => {
    expect(validateConsumerEvent(validEvent({ schemaVersion: 0 })).valid).toBe(false);
    expect(validateConsumerEvent(validEvent({ schemaVersion: 1.5 })).valid).toBe(false);
  });

  it('flags a newer schemaVersion as forward-incompatible (still structurally valid)', () => {
    const res = validateConsumerEvent(validEvent({ schemaVersion: SUPPORTED_SCHEMA_VERSION + 1 }));
    expect(res.valid).toBe(true);
    expect(res.forwardIncompatible).toBe(true);
  });

  it('flags an unknown event type as forward-incompatible', () => {
    const res = validateConsumerEvent(validEvent({ type: 'sale.teleported' }));
    expect(res.valid).toBe(true);
    expect(res.forwardIncompatible).toBe(true);
  });
});

describe('consumer-contract — ReferenceConsumer (idempotent, ordered)', () => {
  it('accepts new events and advances the cursor', () => {
    const c = new ReferenceConsumer();
    const out = c.ingestBatch({
      events: [validEvent({ id: 'a' }), validEvent({ id: 'b' })],
      nextCursor: '2026-06-07T10:00:00.000Z|b',
    });
    expect(out.accepted).toBe(2);
    expect(out.cursor).toBe('2026-06-07T10:00:00.000Z|b');
    expect(c.hasProcessed('a')).toBe(true);
  });

  it('is idempotent: replaying the same batch produces only duplicates', () => {
    const c = new ReferenceConsumer();
    const batch = { events: [validEvent({ id: 'a' }), validEvent({ id: 'b' })], nextCursor: 'x|b' };
    c.ingestBatch(batch);
    const second = c.ingestBatch(batch);
    expect(second).toMatchObject({ accepted: 0, duplicates: 2 });
  });

  it('skips forward-incompatible events without failing the batch, and marks them seen', () => {
    const c = new ReferenceConsumer();
    const out = c.ingestBatch({
      events: [validEvent({ id: 'a' }), validEvent({ id: 'future', type: 'sale.teleported' })],
      nextCursor: 'x|future',
    });
    expect(out).toMatchObject({ accepted: 1, skipped: 1, rejected: 0 });
    // re-seeing the skipped event counts as duplicate, not re-skipped
    const again = c.ingestBatch({ events: [validEvent({ id: 'future', type: 'sale.teleported' })], nextCursor: null });
    expect(again.duplicates).toBe(1);
  });

  it('rejects malformed events and surfaces their ids (never silently dropped)', () => {
    const c = new ReferenceConsumer();
    const out = c.ingestBatch({
      events: [validEvent({ id: 'ok' }), validEvent({ id: 'bad', occurredAt: 'garbage' as any })],
      nextCursor: 'x|bad',
    });
    expect(out).toMatchObject({ accepted: 1, rejected: 1, rejectedIds: ['bad'] });
  });

  it('keeps the previous cursor when a page is empty', () => {
    const c = new ReferenceConsumer();
    c.ingestBatch({ events: [validEvent({ id: 'a' })], nextCursor: 'cur1' });
    const out = c.ingestBatch({ events: [], nextCursor: null });
    expect(out.cursor).toBe('cur1');
  });
});

// Sync guard: KNOWN_EVENT_TYPES must mirror what the code actually emits.
// Scans the emitters for `type: 'x.y'` literals and asserts each is declared.
describe('consumer-contract — KNOWN_EVENT_TYPES stays in sync with emitters', () => {
  const modulesDir = join(__dirname, '..');

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(p));
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(p);
    }
    return out;
  };

  it('every emitted event type literal is declared in KNOWN_EVENT_TYPES', () => {
    const known = new Set<string>(KNOWN_EVENT_TYPES);
    const emitted = new Set<string>();
    const re = /type:\s*'([a-z_]+\.[a-z_]+)'/g;
    for (const file of walk(modulesDir)) {
      const src = readFileSync(file, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) emitted.add(m[1]);
    }
    // Sanity: we actually found some emitters.
    expect(emitted.size).toBeGreaterThan(0);
    const undeclared = [...emitted].filter((t) => !known.has(t));
    expect(undeclared).toEqual([]);
  });
});
