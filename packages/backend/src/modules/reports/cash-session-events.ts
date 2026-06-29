/**
 * POS — Cash session (Z-report) closure → integration event (pure, unit-testable).
 * Feeds the outbox so Comptamax24 books the daily closure and Analytik R sees it.
 * The Z-report is immutable; this event mirrors its frozen figures.
 */
import {
  buildIntegrationEvent,
  IntegrationEvent,
} from '../../common/integration/integration-event';

export interface CashSessionClosedInput {
  zReportId: string;
  storeId: string;
  organizationId?: string | null;
  employeeId: string;
  date: string;
  currencyCode: string;
  totalRevenueMinorUnits: number;
  totalTaxMinorUnits: number;
  cashTotalMinorUnits: number;
  cardTotalMinorUnits: number;
  discountTotalMinorUnits: number;
  transactionCount: number;
  averageBasketMinorUnits: number;
  voidCount: number;
  occurredAt?: Date | string;
}

/** `cash_session.closed` — the daily Z-report closure as a normalized event. */
export function buildCashSessionClosedEvent(input: CashSessionClosedInput): IntegrationEvent {
  return buildIntegrationEvent({
    type: 'cash_session.closed',
    aggregateType: 'cash_session',
    aggregateId: input.zReportId,
    tenant: {
      organizationId: input.organizationId ?? null,
      storeId: input.storeId,
    },
    actor: { employeeId: input.employeeId, role: null },
    occurredAt: input.occurredAt,
    payload: {
      date: input.date,
      currencyCode: input.currencyCode,
      totalRevenueMinorUnits: input.totalRevenueMinorUnits,
      totalTaxMinorUnits: input.totalTaxMinorUnits,
      cashTotalMinorUnits: input.cashTotalMinorUnits,
      cardTotalMinorUnits: input.cardTotalMinorUnits,
      discountTotalMinorUnits: input.discountTotalMinorUnits,
      transactionCount: input.transactionCount,
      averageBasketMinorUnits: input.averageBasketMinorUnits,
      voidCount: input.voidCount,
    },
  });
}
