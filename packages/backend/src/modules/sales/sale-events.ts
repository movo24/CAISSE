/**
 * POS — Sale → integration events mapper (pure, unit-testable).
 *
 * Maps a freshly-committed sale to the normalized outbox envelopes consumed by
 * Comptamax24 (pre-accounting), Analytik R (future analytics) and any other reader.
 * Amounts stay integer centimes; one `sale.completed` + one `payment.captured`
 * per tender. No DB, no side effects.
 */
import {
  buildIntegrationEvent,
  IntegrationEvent,
} from '../../common/integration/integration-event';
import { taxBreakdownByRate } from './tax';

export interface SaleEventItem {
  ean: string;
  quantity: number;
  lineTotalMinorUnits: number;
  taxRate?: number;
}

export interface SaleEventPayment {
  method: string;
  amountMinorUnits: number;
  stripePaymentIntentId?: string | null;
}

export interface SaleEventInput {
  saleId: string;
  ticketNumber: string;
  storeId: string;
  organizationId?: string | null;
  terminalId?: string | null;
  employeeId: string;
  employeeRole?: string | null;
  completedAt: Date | string;
  currencyCode: string;
  subtotalMinorUnits: number;
  discountTotalMinorUnits: number;
  taxTotalMinorUnits: number;
  totalMinorUnits: number;
  customerId?: string | null;
  items: SaleEventItem[];
  payments: SaleEventPayment[];
}

/**
 * Build the outbox events for a completed sale:
 *  - 1 × `sale.completed` (fiscal totals + line summary + payment methods)
 *  - N × `payment.captured` (one per tender, for cash reconciliation / pre-accounting)
 * All events share the sale's `occurredAt` (completedAt) for deterministic ordering.
 */
export function buildSaleOutboxEvents(input: SaleEventInput): IntegrationEvent[] {
  const tenant = {
    organizationId: input.organizationId ?? null,
    storeId: input.storeId,
    terminalId: input.terminalId ?? null,
  };
  const actor = { employeeId: input.employeeId, role: input.employeeRole ?? null };
  const occurredAt = input.completedAt;

  const saleEvent = buildIntegrationEvent({
    type: 'sale.completed',
    aggregateType: 'sale',
    aggregateId: input.saleId,
    tenant,
    actor,
    occurredAt,
    payload: {
      ticketNumber: input.ticketNumber,
      currencyCode: input.currencyCode,
      subtotalMinorUnits: input.subtotalMinorUnits,
      discountTotalMinorUnits: input.discountTotalMinorUnits,
      taxTotalMinorUnits: input.taxTotalMinorUnits,
      totalMinorUnits: input.totalMinorUnits,
      customerId: input.customerId ?? null,
      itemCount: input.items.length,
      items: input.items.map((i) => ({
        ean: i.ean,
        quantity: i.quantity,
        lineTotalMinorUnits: i.lineTotalMinorUnits,
        taxRate: i.taxRate ?? null,
      })),
      // POS-INT-96 — per-rate VAT breakdown for multi-rate pre-accounting.
      taxBreakdown: taxBreakdownByRate(
        input.items
          .filter((i) => i.taxRate != null)
          .map((i) => ({ lineTotalMinorUnits: i.lineTotalMinorUnits, taxRate: i.taxRate as number })),
      ),
      paymentMethods: input.payments.map((p) => p.method),
    },
  });

  const paymentEvents = input.payments.map((p) =>
    buildIntegrationEvent({
      type: 'payment.captured',
      aggregateType: 'payment',
      aggregateId: input.saleId, // payments belong to the sale aggregate
      tenant,
      actor,
      occurredAt,
      payload: {
        ticketNumber: input.ticketNumber,
        method: p.method,
        amountMinorUnits: p.amountMinorUnits,
        currencyCode: input.currencyCode,
        stripePaymentIntentId: p.stripePaymentIntentId ?? null,
      },
    }),
  );

  return [saleEvent, ...paymentEvents];
}
