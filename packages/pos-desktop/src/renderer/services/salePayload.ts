/**
 * Shared sale-payload builders (M603) — used by BOTH the online create and the offline
 * enqueue in usePayment, so the two payloads cannot drift. The offline queue previously
 * dropped creditNoteCode + Stripe/terminal refs, so an offline store_credit sale failed
 * to sync (the server requires creditNoteCode for a store_credit leg).
 */
import type { PaymentMethod } from './paymentMachine';

export interface WirePayment {
  method: PaymentMethod;
  /** Montant APPLIQUÉ au ticket (jamais > reste dû). */
  amountMinorUnits: number;
  /** Espèces physiquement reçues (cash) — mouvement distinct ; monnaie = reçu − appliqué. */
  cashReceivedMinorUnits?: number;
  stripePaymentIntentId?: string;
  stripeReaderId?: string;
  terminalId?: string;
  creditNoteCode?: string;
  /** Card leg NOT really captured (demo/degraded) → the sale lands payment_pending. */
  pendingCapture?: boolean;
}

export interface PartialPaymentLike {
  method: PaymentMethod;
  amountMinorUnits: number;
  cashReceivedMinorUnits?: number;
  stripePaymentIntentId?: string;
  stripeReaderId?: string;
  terminalId?: string;
  creditNoteCode?: string;
  pendingCapture?: boolean;
}

/** Map cart payments to the wire shape the backend /sales DTO accepts (online + offline). */
export function toWirePayments(payments: PartialPaymentLike[]): WirePayment[] {
  return payments.map((p) => ({
    method: p.method,
    amountMinorUnits: p.amountMinorUnits,
    // N'émettre le reçu que s'il diffère de l'appliqué (cash avec monnaie) : évite
    // le bruit et garde exact pour les non-espèces.
    ...(p.cashReceivedMinorUnits != null && p.cashReceivedMinorUnits !== p.amountMinorUnits
      ? { cashReceivedMinorUnits: p.cashReceivedMinorUnits }
      : {}),
    stripePaymentIntentId: p.stripePaymentIntentId,
    stripeReaderId: p.stripeReaderId,
    terminalId: p.terminalId,
    creditNoteCode: p.creditNoteCode,
    pendingCapture: p.pendingCapture,
  }));
}

/**
 * Reshape a QUEUED offline ticket payload into the exact CreateSaleDto the backend
 * accepts on sync (M603 fix). The offline queue entry also carries display-only extras
 * (ticketNumber, totalMinorUnits, item name/unitPrice) for the pending-sales UI; the
 * backend uses `forbidNonWhitelisted: true`, so those extras would 400 the sync. This
 * strips them and maps items to {ean, quantity}, keeping payments + discount/promo.
 */
export function toSyncCreateBody(p: any): Record<string, unknown> {
  return {
    items: (p?.items ?? []).map((i: any) => ({ ean: i.ean, quantity: i.quantity })),
    ...(p?.customerQrCode ? { customerQrCode: p.customerQrCode } : {}),
    ...toSaleDiscountFields({
      manualDiscountMinorUnits: p?.manualDiscountMinorUnits ?? 0,
      discountApproverId: p?.discountApproverId ?? null,
      promoCode: p?.promoCode ?? null,
    }),
    payments: p?.payments ?? [],
  };
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
