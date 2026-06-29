/**
 * POS — Outbox publish request builder (pure, unit-testable).
 * Builds the signed HTTP body + headers for delivering an integration event to a
 * downstream system (Comptamax24 / TimeWin24 / Analytik R webhook). HMAC-SHA256
 * over `${timestamp}.${body}` lets the receiver verify authenticity + integrity.
 * No network here — the HttpOutboxPublisher performs the actual POST.
 */
import { createHmac } from 'crypto';

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

/** Build the signed request (body + headers) for one event. */
export function buildOutboxPublishRequest(
  event: PublishableEvent,
  secret: string,
  nowMs: number = Date.now(),
): PublishRequest {
  const body = JSON.stringify(publishEnvelope(event));
  const signature = signPublishBody(body, secret, nowMs);
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'x-pos-event-id': event.id,
      'x-pos-timestamp': String(nowMs),
      'x-pos-signature': signature,
    },
  };
}
