/**
 * POS — Stock movement → integration events (pure, unit-testable).
 * Feeds the outbox so Analytik R sees stock flow and ruptures, and any consumer
 * can track inventory. Non-fiscal signal. No DB, no side effects.
 */
import {
  buildIntegrationEvent,
  IntegrationEvent,
} from '../../common/integration/integration-event';

export interface StockEventInput {
  productId: string;
  storeId: string;
  organizationId?: string | null;
  employeeId?: string | null;
  ean: string | null;
  productName: string;
  newQuantity: number;
  deltaQuantity: number; // signed (negative on sale/decrement)
  reason: string;
  occurredAt?: Date | string;
}

/**
 * Build stock events:
 *  - always `stock.movement` (delta + resulting quantity),
 *  - plus `stock.depleted` when the resulting quantity reaches 0 (rupture).
 */
export function buildStockEvents(input: StockEventInput): IntegrationEvent[] {
  const tenant = {
    organizationId: input.organizationId ?? null,
    storeId: input.storeId,
  };
  const actor = { employeeId: input.employeeId ?? null, role: null };
  const payload = {
    productId: input.productId,
    ean: input.ean,
    productName: input.productName,
    newQuantity: input.newQuantity,
    deltaQuantity: input.deltaQuantity,
    reason: input.reason,
  };

  const events: IntegrationEvent[] = [
    buildIntegrationEvent({
      type: 'stock.movement',
      aggregateType: 'stock',
      aggregateId: input.productId,
      tenant,
      actor,
      occurredAt: input.occurredAt,
      payload,
    }),
  ];

  if (input.newQuantity <= 0) {
    events.push(
      buildIntegrationEvent({
        type: 'stock.depleted',
        aggregateType: 'stock',
        aggregateId: input.productId,
        tenant,
        actor,
        occurredAt: input.occurredAt,
        payload,
      }),
    );
  }
  return events;
}
