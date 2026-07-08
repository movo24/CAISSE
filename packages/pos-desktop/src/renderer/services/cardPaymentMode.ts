/**
 * Card payment capability gate (décision produit ratifiée, PR #25).
 *
 * - 'real'     — backend Stripe Terminal configured → the ONLY path that can mark
 *                a card leg captured (via a real WisePad 3 / Stripe reader flow).
 * - 'demo'     — dev/test builds without Stripe config: the TPE overlay is allowed
 *                but is explicitly labelled DEMO and the resulting card leg is sent
 *                with pendingCapture=true → the sale lands payment_pending, NEVER
 *                a fictitious "paid" card sale.
 * - 'disabled' — production build without Stripe config: the card button must not
 *                start any flow; the cashier gets a clear error instead.
 */
import { stripeTerminalApi } from './api';

export type CardPaymentMode = 'real' | 'demo' | 'disabled';

/** Pure decision — testable without network or build flags. */
export function resolveCardPaymentMode(opts: {
  stripeConfigured: boolean;
  isProdBuild: boolean;
}): CardPaymentMode {
  if (opts.stripeConfigured) return 'real';
  return opts.isProdBuild ? 'disabled' : 'demo';
}

const STATUS_CACHE_MS = 60_000;
let cached: { configured: boolean; at: number } | null = null;

/** Test hook / logout hook — drop the cached backend capability. */
export function resetCardPaymentModeCache(): void {
  cached = null;
}

/**
 * Resolve the mode against the live backend (cached 60 s).
 * A failed status call is treated as "not configured": in production that
 * DISABLES card (fail-closed — no fictitious payment), in dev it falls back
 * to the labelled demo mode.
 */
export async function getCardPaymentMode(
  isProdBuild: boolean = import.meta.env.PROD,
): Promise<CardPaymentMode> {
  if (!cached || Date.now() - cached.at > STATUS_CACHE_MS) {
    let configured = false;
    try {
      const res = await stripeTerminalApi.status();
      configured = !!res.data?.configured;
    } catch {
      configured = false; // fail-closed
    }
    cached = { configured, at: Date.now() };
  }
  return resolveCardPaymentMode({ stripeConfigured: cached.configured, isProdBuild });
}

export const CARD_DISABLED_MESSAGE =
  'Paiement carte indisponible : terminal de paiement non configuré. Encaissez en espèces ou contactez votre responsable.';
