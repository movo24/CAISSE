import { createHmac } from 'crypto';
import { signPosPayload, buildPosHmacHeaders } from './pos-hmac';

describe('TimeWin24 pos-hmac', () => {
  const secret = 'test-secret';
  const ts = '1700000000000';
  const nonce = 'nonce-123';

  it('signPosPayload matches a manual HMAC-SHA256 of timestamp.nonce.body', () => {
    const body = '{"a":1}';
    const expected = createHmac('sha256', secret)
      .update(`${ts}.${nonce}.${body}`)
      .digest('hex');
    expect(signPosPayload(secret, ts, nonce, body)).toBe(expected);
  });

  it('is deterministic for identical inputs', () => {
    expect(signPosPayload(secret, ts, nonce, '')).toBe(signPosPayload(secret, ts, nonce, ''));
  });

  it('changes when body changes', () => {
    expect(signPosPayload(secret, ts, nonce, 'a')).not.toBe(signPosPayload(secret, ts, nonce, 'b'));
  });

  it('changes when nonce changes', () => {
    expect(signPosPayload(secret, ts, 'n1', '')).not.toBe(signPosPayload(secret, ts, 'n2', ''));
  });

  it('buildPosHmacHeaders returns the 4 required headers', () => {
    const h = buildPosHmacHeaders(secret, 'key-1', ts, nonce, '');
    expect(h['X-POS-Timestamp']).toBe(ts);
    expect(h['X-POS-Nonce']).toBe(nonce);
    expect(h['X-POS-Key-Id']).toBe('key-1');
    expect(h['X-POS-Signature']).toBe(signPosPayload(secret, ts, nonce, ''));
  });
});
