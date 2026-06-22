/**
 * Shared sale-payload builders (M603) — used by BOTH the online create and the offline
 * enqueue in usePayment, so the two payloads cannot drift. The offline queue previously
 * dropped creditNoteCode + Stripe/terminal refs, so an offline store_credit sale failed
 * to sync (the server requires creditNoteCode for a store_credit leg).
 */
import type { PaymentMethod } from './paymentMachine';

export interface WirePayment {
  method: PaymentMethod;
  amountMinorUnits: number;
  stripePaymentIntentId?: string;
  stripeReaderId?: string;
  terminalId?: string;
  creditNoteCode?: string;
}

export interface PartialPaymentLike {
  method: PaymentMethod;
  amountMinorUnits: number;
  stripePaymentIntentId?: string;
  stripeReaderId?: string;
  terminalId?: string;
  creditNoteCode?: string;
}

/** Map cart payments to the wire shape the backend /sales DTO accepts (online + offline). */
export function toWirePayments(payments: PartialPaymentLike[]): WirePayment[] {
  return payments.map((p) => ({
    method: p.method,
    amountMinorUnits: p.amountMinorUnits,
    stripePaymentIntentId: p.stripePaymentIntentId,
    stripeReaderId: p.stripeReaderId,
    terminalId: p.terminalId,
    creditNoteCode: p.creditNoteCode,
  }));
}

/** Sale-level discount/promo fields (decisions 5/6), spread into the payload when present. */
export function toSaleDiscountFields(s: {
  manualDiscountMinorUnits: number;
  discountApproverId: string | null;
  promoCode: string | null;
}): Record<string, unknown> {
  return {
    ...(s.manualDiscountMinorUnits > 0
      ? { manualDiscountMinorUnits: s.manualDiscountMinorUnits, discountApproverId: s.discountApproverId || undefined }
      : {}),
    ...(s.promoCode ? { promoCode: s.promoCode } : {}),
  };
}
