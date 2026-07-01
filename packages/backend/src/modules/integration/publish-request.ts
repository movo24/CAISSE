/**
 * POS — Outbox publish request builder (pure, unit-testable).
 * Builds the signed HTTP body + headers for delivering an integration event to a
 * downstream system (Comptamax24 / TimeWin24 / Analytik R webhook). HMAC-SHA256
 * over `${timestamp}.${body}` lets the receiver verify authenticity + integrity.
 * No network here — the HttpOutboxPublisher performs the actual POST.
 */
import { createHmac, timingSafeEqual } from 'crypto';

export interface PublishableEvent {
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  storeId: string;
  organizationId: string | null;
  terminalId: string | null;
  occurredAt: Date | string;
  payload: Record<string, unknown>;
  schemaVersion: number;
  source: string;
}

export interface PublishRequest {
  body: string;
  headers: Record<string, string>;
}

/** Canonical JSON envelope sent to consumers (stable field order). */
export function publishEnvelope(e: PublishableEvent): Record<string, unknown> {
  return {
    id: e.id,
    type: e.type,
    aggregateType: e.aggregateType,
    aggregateId: e.aggregateId,
    storeId: e.storeId,
    organizationId: e.organizationId ?? null,
    terminalId: e.terminalId ?? null,
    occurredAt: e.occurredAt instanceof Date ? e.occurredAt.toISOString() : e.occurredAt,
    payload: e.payload ?? {},
    schemaVersion: e.schemaVersion,
    source: e.source,
  };
}

/** HMAC-SHA256 hex over `${timestampMs}.${body}` with the shared secret. */
export function signPublishBody(body: string, secret: string, timestampMs: number): string {
  return createHmac('sha256', secret).update(`${timestampMs}.${body}`).digest('hex');
}

/** Default replay window for delivery verification (5 minutes). */
export const PUBLISH_FRESHNESS_MS = 5 * 60 * 1000;

export type VerifyResult = 'ok' | 'bad_signature' | 'stale' | 'malformed';

/** Constant-time hex compare (length-safe). */
function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Receiver-side verification of a signed outbox delivery (Comptamax24 / TimeWin24 /
 * Analytik R webhook). Recomputes the HMAC over `${timestamp}.${body}` and compares
 * in constant time, and rejects deliveries outside the freshness window (replay guard).
 * Pure — the receiver passes the raw body + the x-pos-* headers it received.
 */
export function verifyPublishSignature(
  body: string,
  providedSignature: string,
  secret: string,
  timestampMs: number,
  opts: { nowMs?: number; toleranceMs?: number } = {},
): VerifyResult {
  if (!body || !providedSignature || !Number.isFinite(timestampMs)) return 'malformed';
  const now = opts.nowMs ?? Date.now();
  const tolerance = opts.toleranceMs ?? PUBLISH_FRESHNESS_MS;
  if (Math.abs(now - timestampMs) > tolerance) return 'stale';
  const expected = signPublishBody(body, secret, timestampMs);
  return safeEqualHex(providedSignature, expected) ? 'ok' : 'bad_signature';
}

/**
 * Build the signed request (body + headers) for one event.
 * `batchId` (optional) = relay-run correlation id, carried as `x-pos-batch-id`.
 * It is a DEBUG/correlation aid only: idempotence stays keyed on the EVENT id
 * (`x-pos-event-id` / envelope `id`), never on the batch. The signature does
 * not cover it (headers are not signed; the body is).
 */
export function buildOutboxPublishRequest(
  event: PublishableEvent,
  secret: string,
  nowMs: number = Date.now(),
  batchId?: string,
): PublishRequest {
  const body = JSON.stringify(publishEnvelope(event));
  const signature = signPublishBody(body, secret, nowMs);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-pos-event-id': event.id,
    'x-pos-timestamp': String(nowMs),
    'x-pos-signature': signature,
  };
  if (batchId) headers['x-pos-batch-id'] = batchId;
  return { body, headers };
}
