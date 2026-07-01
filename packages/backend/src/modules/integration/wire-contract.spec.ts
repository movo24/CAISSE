/**
 * PAQUET 283 (bloc A3) — WIRE CONTRACT FREEZE for the real POS push connector.
 *
 * This spec pins the EXACT wire contract documented in POS_PUSH_CONTRACT.md:
 * envelope keys, header names, signature scheme, retry policy constants.
 * If any of these assertions fails, you are BREAKING the integration contract
 * with Comptamax24 / TimeWin24 / Analytik R receivers: bump `schemaVersion`,
 * update POS_PUSH_CONTRACT.md, and coordinate with consumers — do not just
 * "fix the test".
 */
import {
  buildOutboxPublishRequest,
  publishEnvelope,
  signPublishBody,
  verifyPublishSignature,
  PUBLISH_FRESHNESS_MS,
  PublishableEvent,
} from './publish-request';
import { MAX_RELAY_ATTEMPTS, relayBackoffMs } from '../../common/integration/outbox-relay';

const EVENT: PublishableEvent = {
  id: '9e107d9d-372b-4a6e-b3a5-d5f6f7a8b9c0',
  type: 'sale.completed',
  aggregateType: 'sale',
  aggregateId: 'ticket-uuid-1', // = ticket/sale id for sale.* events
  storeId: 'store-1',
  organizationId: null,
  terminalId: 'term-1',
  occurredAt: new Date('2026-07-02T10:00:00.000Z'),
  payload: { totalMinorUnits: 500 },
  schemaVersion: 1,
  source: 'pos-caisse',
};

describe('POS push wire contract (frozen — see POS_PUSH_CONTRACT.md)', () => {
  it('envelope has EXACTLY the contracted keys, in stable order', () => {
    const env = publishEnvelope(EVENT);
    expect(Object.keys(env)).toEqual([
      'id',
      'type',
      'aggregateType',
      'aggregateId',
      'storeId',
      'organizationId',
      'terminalId',
      'occurredAt',
      'payload',
      'schemaVersion',
      'source',
    ]);
    expect(env.occurredAt).toBe('2026-07-02T10:00:00.000Z'); // ISO 8601 UTC
  });

  it('headers are exactly the contracted set; batch id is optional correlation only', () => {
    const bare = buildOutboxPublishRequest(EVENT, 's3cret', 1_000);
    expect(Object.keys(bare.headers).sort()).toEqual([
      'content-type',
      'x-pos-event-id',
      'x-pos-signature',
      'x-pos-timestamp',
    ]);
    const withBatch = buildOutboxPublishRequest(EVENT, 's3cret', 1_000, 'batch-42');
    expect(withBatch.headers['x-pos-batch-id']).toBe('batch-42');
    expect(withBatch.headers['x-pos-event-id']).toBe(EVENT.id);
    // batch id NEVER affects the signature (idempotence is per-event)
    expect(withBatch.headers['x-pos-signature']).toBe(bare.headers['x-pos-signature']);
  });

  it('signature = HMAC-SHA256 hex over `${timestamp}.${body}` and round-trips receiver-side', () => {
    const ts = 1_720_000_000_000;
    const req = buildOutboxPublishRequest(EVENT, 's3cret', ts);
    expect(req.headers['x-pos-signature']).toBe(signPublishBody(req.body, 's3cret', ts));
    expect(
      verifyPublishSignature(req.body, req.headers['x-pos-signature'], 's3cret', ts, { nowMs: ts }),
    ).toBe('ok');
  });

  it('retry policy constants are the contracted ones: 5 attempts max, exp backoff capped 1h, 5-min replay window', () => {
    expect(MAX_RELAY_ATTEMPTS).toBe(5);
    expect(relayBackoffMs(0)).toBe(1000);
    expect(relayBackoffMs(3)).toBe(8000);
    expect(relayBackoffMs(30)).toBe(60 * 60 * 1000); // capped
    expect(PUBLISH_FRESHNESS_MS).toBe(5 * 60 * 1000);
  });

  it('same event re-delivered (retry) keeps the SAME event id — the receiver dedup key', () => {
    const first = buildOutboxPublishRequest(EVENT, 's3cret', 1_000);
    const retry = buildOutboxPublishRequest(EVENT, 's3cret', 2_000, 'other-batch');
    expect(retry.headers['x-pos-event-id']).toBe(first.headers['x-pos-event-id']);
    expect(JSON.parse(retry.body).id).toBe(JSON.parse(first.body).id);
  });
});
