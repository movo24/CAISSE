/**
 * Client-generated idempotency keys for money-writing POS operations.
 *
 * A sale carries ONE key from the moment checkout starts. It is reused across a
 * double-click, a network retry, and — critically — the offline fallback: if an
 * online create reaches the server but its response is lost, the queued replay
 * uses the SAME key so the backend dedupes instead of creating a second sale.
 * The key is reset only after a sale is confirmed, so the next sale is fresh.
 *
 * Format: `sale-<uuid>` (≤ 64 chars — the backend PK column limit).
 */
export function newIdempotencyKey(prefix = 'sale'): string {
  let uuid: string;
  try {
    uuid = (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ?? '';
  } catch {
    uuid = '';
  }
  if (!uuid) {
    uuid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
  return `${prefix}-${uuid}`.slice(0, 64);
}
