/**
 * POS — Integration event envelope (pure, unit-testable).
 *
 * The single normalized contract that POS Caisse emits and that Comptamax24,
 * TimeWin24 and (future) Analytik R consume — WITHOUT coupling to POS internals.
 *
 * Architecture rules (INTER_SYSTEM_INTEGRATION.md):
 *  - append-only outbox; business fields never mutated;
 *  - amounts are integer centimes, dates ISO-8601;
 *  - tenant-scoped (storeId always; organizationId when known);
 *  - versioned via `schemaVersion` so consumers evolve safely;
 *  - the caisse never depends on any consumer being online.
 */
import { randomUUID } from 'crypto';

export const INTEGRATION_SOURCE = 'pos-caisse';
export const INTEGRATION_SCHEMA_VERSION = 1;

/** Aggregate roots that emit integration events. */
export type AggregateType =
  | 'sale'
  | 'payment'
  | 'refund'
  | 'credit_note'
  | 'cash_session'
  | 'stock'
  | 'employee_activity';

/** Namespaced event types: `<aggregate>.<action>`. Extend as packets land. */
export type IntegrationEventType =
  | 'sale.completed'
  | 'sale.voided'
  | 'payment.captured'
  | 'refund.created'
  | 'credit_note.issued'
  | 'cash_session.opened'
  | 'cash_session.closed'
  | 'stock.movement'
  | 'stock.low'
  | 'stock.depleted'
  | 'employee_activity.recorded';

export interface EventTenant {
  organizationId: string | null;
  storeId: string;
  terminalId?: string | null;
}

export interface EventActor {
  employeeId?: string | null;
  role?: string | null;
}

export interface IntegrationEvent {
  id: string;
  type: IntegrationEventType;
  aggregateType: AggregateType;
  aggregateId: string;
  occurredAt: string; // ISO-8601
  tenant: EventTenant;
  actor: EventActor;
  payload: Record<string, unknown>;
  schemaVersion: number;
  source: string;
}

export interface BuildEventInput {
  type: IntegrationEventType;
  aggregateType: AggregateType;
  aggregateId: string;
  tenant: EventTenant;
  payload: Record<string, unknown>;
  actor?: EventActor;
  /** Injectable for determinism in tests / for replaying a known timestamp. */
  occurredAt?: Date | string;
  id?: string;
  schemaVersion?: number;
}

/** Build a normalized integration-event envelope (deterministic when id/occurredAt are supplied). */
export function buildIntegrationEvent(input: BuildEventInput): IntegrationEvent {
  if (!input.tenant || !input.tenant.storeId) {
    throw new Error('integration event requires tenant.storeId');
  }
  if (!input.aggregateId) {
    throw new Error('integration event requires aggregateId');
  }
  const occurredAt =
    input.occurredAt instanceof Date
      ? input.occurredAt.toISOString()
      : (input.occurredAt ?? new Date().toISOString());

  return {
    id: input.id ?? randomUUID(),
    type: input.type,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    occurredAt,
    tenant: {
      organizationId: input.tenant.organizationId ?? null,
      storeId: input.tenant.storeId,
      terminalId: input.tenant.terminalId ?? null,
    },
    actor: {
      employeeId: input.actor?.employeeId ?? null,
      role: input.actor?.role ?? null,
    },
    payload: input.payload ?? {},
    schemaVersion: input.schemaVersion ?? INTEGRATION_SCHEMA_VERSION,
    source: INTEGRATION_SOURCE,
  };
}

/** Outbox row statuses (delivery metadata — distinct from immutable business fields). */
export type OutboxStatus = 'pending' | 'published' | 'failed';

/** Shape of an outbox row insert (matches IntegrationEventEntity property names). */
export interface OutboxRow {
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  storeId: string;
  organizationId: string | null;
  terminalId: string | null;
  employeeId: string | null;
  actorRole: string | null;
  occurredAt: Date;
  payload: Record<string, unknown>;
  schemaVersion: number;
  source: string;
}

/** Map a normalized envelope to a persistable outbox row (status/attempts use entity defaults). */
export function toOutboxRow(e: IntegrationEvent): OutboxRow {
  return {
    id: e.id,
    type: e.type,
    aggregateType: e.aggregateType,
    aggregateId: e.aggregateId,
    storeId: e.tenant.storeId,
    organizationId: e.tenant.organizationId ?? null,
    terminalId: e.tenant.terminalId ?? null,
    employeeId: e.actor.employeeId ?? null,
    actorRole: e.actor.role ?? null,
    occurredAt: new Date(e.occurredAt),
    payload: e.payload,
    schemaVersion: e.schemaVersion,
    source: e.source,
  };
}
