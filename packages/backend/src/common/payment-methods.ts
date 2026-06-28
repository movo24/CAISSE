/**
 * POS-040/043 — Allowed POS payment methods (single source of truth).
 *
 * NOTE: `store_credit` (avoir) was missing from SalePaymentDto's @IsIn while the sales
 * service processes it — with the global ValidationPipe (forbidNonWhitelisted) that
 * rejected legitimate avoir redemptions. This constant fixes the divergence.
 */
export const PAYMENT_METHODS = [
  'cash',
  'card',
  'mobile',
  'check',
  'voucher',
  'store_credit',
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function isAllowedPaymentMethod(method: string): method is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(method);
}
