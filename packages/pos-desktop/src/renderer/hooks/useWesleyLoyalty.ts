import { useCallback, useState } from 'react';
import { loyaltyApi } from '../services/api';
import type { LoyaltyScanResult } from '../components/pos/LoyaltyCustomerBadge';

/**
 * Detects if a scanned value is a Wesley Club QR token (HMAC format).
 *
 * Format: base64url(JSON).base64url(HMAC) — exactly one dot separator,
 * payload contains JSON with customerId/cardId/expiresAt.
 *
 * Legacy QRs (`legacy-XXX`, `cust-XXX`, etc.) are NOT detected here.
 */
export function isWesleyQrToken(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const parts = value.split('.');
  if (parts.length !== 2) return false;
  if (parts[0].length < 20 || parts[1].length < 20) return false;
  try {
    const decoded = atob(
      parts[0].replace(/-/g, '+').replace(/_/g, '/'),
    );
    const payload = JSON.parse(decoded);
    return !!(payload.customerId && payload.cardId && payload.expiresAt);
  } catch {
    return false;
  }
}

/** Generate a UUIDv4 for idempotency keys (no external dep). */
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function useWesleyLoyalty(opts: { storeId: string; terminalId: string }) {
  const [scan, setScan] = useState<LoyaltyScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Scan QR token. Returns the result (also stored in state). */
  const scanQr = useCallback(
    async (qrToken: string, ticketDraftId?: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = (await loyaltyApi.scan({
          qrToken,
          storeId: opts.storeId,
          terminalId: opts.terminalId,
          ticketDraftId,
        })) as LoyaltyScanResult;
        setScan(result);
        return result;
      } catch (err: any) {
        const msg =
          err?.response?.data?.message ?? err?.message ?? 'Erreur scan';
        setError(msg);
        setScan(null);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [opts.storeId, opts.terminalId],
  );

  /** Redeem the active coupon for an attached customer. Idempotent. */
  const redeem = useCallback(
    async (params: { ticketId: string; ticketAmountCents: number }) => {
      if (!scan?.availableCoupon) {
        throw new Error('Aucun coupon disponible');
      }
      const idempotencyKey = uuid();
      setBusy(true);
      try {
        const result = await loyaltyApi.redeem(
          {
            customerId: scan.customerId,
            couponId: scan.availableCoupon.id,
            storeId: opts.storeId,
            terminalId: opts.terminalId,
            ticketId: params.ticketId,
            ticketAmountCents: params.ticketAmountCents,
          },
          idempotencyKey,
        );
        return result as { success: true; discountPercent: number };
      } finally {
        setBusy(false);
      }
    },
    [scan, opts.storeId, opts.terminalId],
  );

  const clear = useCallback(() => {
    setScan(null);
    setError(null);
  }, []);

  return { scan, error, busy, scanQr, redeem, clear };
}
