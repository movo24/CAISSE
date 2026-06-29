/**
 * POS — Returns / credit-notes → integration events (pure, unit-testable).
 * Feeds the outbox so Comptamax24 books refunds/avoirs and Analytik R sees returns.
 * Amounts integer centimes. No DB, no side effects.
 */
import {
  buildIntegrationEvent,
  IntegrationEvent,
} from '../../common/integration/integration-event';

export interface RefundEventInput {
  creditNoteId: string;
  code: string;
  storeId: string;
  organizationId?: string | null;
  employeeId: string;
  type: 'refund' | 'store_credit';
  refundMethod: string | null;
  originalSaleId: string | null;
  originalTicketNumber: string | null;
  totalMinorUnits: number;
  currencyCode: string;
  reason: string | null;
  occurredAt?: Date | string;
}

/**
 * A return produces either:
 *  - `refund.created`     (cash/card immediate refund) — aggregate 'refund', or
 *  - `credit_note.issued` (store_credit avoir)         — aggregate 'credit_note'.
 */
export function buildRefundOutboxEvent(input: RefundEventInput): IntegrationEvent {
  const isStoreCredit = input.type === 'store_credit';
  return buildIntegrationEvent({
    type: isStoreCredit ? 'credit_note.issued' : 'refund.created',
    aggregateType: isStoreCredit ? 'credit_note' : 'refund',
    aggregateId: input.creditNoteId,
    tenant: {
      organizationId: input.organizationId ?? null,
      storeId: input.storeId,
    },
    actor: { employeeId: input.employeeId, role: null },
    occurredAt: input.occurredAt,
    payload: {
      code: input.code,
      origin: 'return',
      type: input.type,
      refundMethod: input.refundMethod,
      originalSaleId: input.originalSaleId,
      originalTicketNumber: input.originalTicketNumber,
      totalMinorUnits: input.totalMinorUnits,
      currencyCode: input.currencyCode,
      reason: input.reason,
    },
  });
}

export interface GiftCardEventInput {
  creditNoteId: string;
  code: string;
  storeId: string;
  organizationId?: string | null;
  employeeId: string;
  amountMinorUnits: number;
  currencyCode: string;
  saleId?: string | null;
  occurredAt?: Date | string;
}

/** A gift-card issuance is a store-credit credit-note (`credit_note.issued`, origin gift_card). */
export function buildGiftCardOutboxEvent(input: GiftCardEventInput): IntegrationEvent {
  return buildIntegrationEvent({
    type: 'credit_note.issued',
    aggregateType: 'credit_note',
    aggregateId: input.creditNoteId,
    tenant: {
      organizationId: input.organizationId ?? null,
      storeId: input.storeId,
    },
    actor: { employeeId: input.employeeId, role: null },
    occurredAt: input.occurredAt,
    payload: {
      code: input.code,
      origin: 'gift_card',
      type: 'store_credit',
      amountMinorUnits: input.amountMinorUnits,
      currencyCode: input.currencyCode,
      saleId: input.saleId ?? null,
    },
  });
}
