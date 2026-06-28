import { createHmac } from 'crypto';

/**
 * TimeWin24 POS-feed HMAC authentication (pure, unit-testable).
 * Extracted from TimewinService.fetchWithPosSecret (behavior-preserving).
 *
 * Signature = HMAC-SHA256(secret, `${timestamp}.${nonce}.${bodyStr}`) hex.
 * Headers: X-POS-Timestamp, X-POS-Nonce, X-POS-Signature, X-POS-Key-Id.
 */
export function signPosPayload(
  secret: string,
  timestamp: string,
  nonce: string,
  bodyStr: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${nonce}.${bodyStr}`)
    .digest('hex');
}

export function buildPosHmacHeaders(
  secret: string,
  keyId: string,
  timestamp: string,
  nonce: string,
  bodyStr: string,
): Record<string, string> {
  return {
    'X-POS-Timestamp': timestamp,
    'X-POS-Nonce': nonce,
    'X-POS-Signature': signPosPayload(secret, timestamp, nonce, bodyStr),
    'X-POS-Key-Id': keyId,
  };
}
