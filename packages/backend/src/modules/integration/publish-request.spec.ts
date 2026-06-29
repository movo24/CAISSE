import {
  publishEnvelope,
  signPublishBody,
  buildOutboxPublishRequest,
  verifyPublishSignature,
  PUBLISH_FRESHNESS_MS,
  PublishableEvent,
} from './publish-request';
import { createHmac } from 'crypto';

const ev: PublishableEvent = {
  id: 'evt-1',
  type: 'sale.completed',
  aggregateType: 'sale',
  aggregateId: 'sale-1',
  storeId: 'store-1',
  organizationId: 'org-1',
  terminalId: 'T1',
  occurredAt: new Date('2026-06-29T10:00:00.000Z'),
  payload: { totalMinorUnits: 2990 },
  schemaVersion: 1,
  source: 'pos-caisse',
};

describe('POS integration publish-request', () => {
  it('publishEnvelope normalizes date + nullable fields', () => {
    const env = publishEnvelope(ev);
    expect(env.occurredAt).toBe('2026-06-29T10:00:00.000Z');
    expect(env).toMatchObject({ id: 'evt-1', storeId: 'store-1', organizationId: 'org-1', terminalId: 'T1' });
  });

  it('signPublishBody is HMAC-SHA256 over `${ts}.${body}`', () => {
    const body = '{"a":1}';
    const expected = createHmac('sha256', 'secret').update(`1000.${body}`).digest('hex');
    expect(signPublishBody(body, 'secret', 1000)).toBe(expected);
  });

  it('buildOutboxPublishRequest returns body + signed headers (deterministic)', () => {
    const r = buildOutboxPublishRequest(ev, 'secret', 1000);
    expect(r.headers['x-pos-event-id']).toBe('evt-1');
    expect(r.headers['x-pos-timestamp']).toBe('1000');
    expect(r.headers['content-type']).toBe('application/json');
    expect(r.headers['x-pos-signature']).toBe(signPublishBody(r.body, 'secret', 1000));
    // body is the canonical envelope
    expect(JSON.parse(r.body).aggregateId).toBe('sale-1');
  });

  it('signature changes if body or timestamp changes (tamper-evident)', () => {
    const a = buildOutboxPublishRequest(ev, 'secret', 1000).headers['x-pos-signature'];
    const b = buildOutboxPublishRequest({ ...ev, payload: { totalMinorUnits: 1 } }, 'secret', 1000).headers['x-pos-signature'];
    const c = buildOutboxPublishRequest(ev, 'secret', 2000).headers['x-pos-signature'];
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  describe('verifyPublishSignature (receiver side)', () => {
    const now = 1_000_000;
    const req = buildOutboxPublishRequest(ev, 'secret', now);

    it('ok for a valid, fresh delivery', () => {
      expect(verifyPublishSignature(req.body, req.headers['x-pos-signature'], 'secret', now, { nowMs: now })).toBe('ok');
    });
    it('bad_signature on wrong secret or tampered body', () => {
      expect(verifyPublishSignature(req.body, req.headers['x-pos-signature'], 'WRONG', now, { nowMs: now })).toBe('bad_signature');
      expect(verifyPublishSignature(req.body + 'x', req.headers['x-pos-signature'], 'secret', now, { nowMs: now })).toBe('bad_signature');
    });
    it('stale beyond the freshness window (replay guard)', () => {
      expect(PUBLISH_FRESHNESS_MS).toBe(300000);
      expect(verifyPublishSignature(req.body, req.headers['x-pos-signature'], 'secret', now, { nowMs: now + 400000 })).toBe('stale');
    });
    it('malformed on empty inputs', () => {
      expect(verifyPublishSignature('', 'sig', 'secret', now)).toBe('malformed');
      expect(verifyPublishSignature(req.body, '', 'secret', now)).toBe('malformed');
    });
  });
});
