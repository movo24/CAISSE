/**
 * POS-054 — Discount policy (remises) — caisse vs back-office.
 *
 * Business rules (validated with product owner 2026-06-28):
 *
 *  POS CAISSE (terminal magasin):
 *   - Hard ceiling: a manual discount can NEVER exceed 30%, even with a responsable code.
 *   - Any manual discount (> 0%) requires a valid responsable code.
 *   - From 21% up to 30%: a written justification is MANDATORY (non-empty, non-generic).
 *   - Any attempt > 30% is REFUSED and must be audited by the caller as a blocked attempt.
 *
 *  BACK-OFFICE / POS CENTRAL:
 *   - May authorize up to 100%, reserved to central/admin roles only.
 *   - Never reachable from a store terminal (channel = 'pos').
 *   - Any back-office discount > 30% requires a motif (justification) + a validator + audit.
 *
 * This module is intentionally PURE (no DB, no Nest) so the full rule matrix is unit-testable
 * in isolation. The caller (SalesService / a future back-office endpoint) is responsible for:
 *   - verifying the responsable code against the real mechanism (sets `responsableCodeProvided`);
 *   - persisting the audit trail (cashier, responsable, %, motif, ticket, product, store, terminal, datetime).
 */

export type DiscountChannel = 'pos' | 'backoffice';

export const POS_HARD_DISCOUNT_CAP_PCT = 30;
export const JUSTIFICATION_REQUIRED_FROM_PCT = 21;
export const BACKOFFICE_MAX_DISCOUNT_PCT = 100;

/** Roles allowed to apply discounts through the back-office channel. */
export const BACKOFFICE_ALLOWED_ROLES = ['admin'] as const;

/** Generic, non-acceptable justifications (case-insensitive, trimmed). */
const GENERIC_JUSTIFICATIONS = new Set([
  'ok', 'test', 'remise', 'client', 'rien', 'na', 'n/a', '-', '.', 'ras',
]);

const MIN_JUSTIFICATION_LENGTH = 5;

export type DiscountPolicyCode =
  | 'POS_OVER_CAP' // > 30% on a terminal — blocked attempt (audit it)
  | 'RESPONSABLE_REQUIRED' // manual discount without responsable code
  | 'JUSTIFICATION_REQUIRED' // 21-30% without justification
  | 'JUSTIFICATION_INVALID' // justification empty/too short/generic
  | 'BACKOFFICE_FORBIDDEN_ROLE' // non-admin tried back-office discount
  | 'BACKOFFICE_OVER_MAX' // > 100%
  | 'BACKOFFICE_MOTIF_REQUIRED' // back-office > 30% without motif/validator
  | 'MANUAL_EXCEEDS_CART' // manual discount > remaining cart net
  | 'NEGATIVE_DISCOUNT';

export class DiscountPolicyViolation extends Error {
  constructor(public readonly code: DiscountPolicyCode, message: string) {
    super(message);
    this.name = 'DiscountPolicyViolation';
  }
}

export interface ManualDiscountInput {
  channel: DiscountChannel;
  subtotalMinorUnits: number;
  manualDiscountMinorUnits: number;
  /** True only when the caller has VERIFIED a responsable code (do not pass raw input). */
  responsableCodeProvided: boolean;
  justification?: string | null;
  /** 'admin' | 'manager' | 'cashier' — used for back-office role gating. */
  actorRole?: string;
}

export interface DiscountPolicyResult {
  /** Percentage (0-100), rounded to 2 decimals, for reporting/audit. */
  discountPct: number;
  /** Whether a justification was required by the rule. */
  justificationRequired: boolean;
  /** Whether a justification was actually supplied & accepted. */
  justificationAccepted: boolean;
}

function pctOf(discount: number, subtotal: number): number {
  if (subtotal <= 0) return 0;
  return Math.round((discount / subtotal) * 100 * 100) / 100;
}

function isValidJustification(j?: string | null): boolean {
  if (!j) return false;
  const t = j.trim().toLowerCase();
  if (t.length < MIN_JUSTIFICATION_LENGTH) return false;
  if (GENERIC_JUSTIFICATIONS.has(t)) return false;
  return true;
}

/**
 * Evaluate a manual discount against the channel policy.
 * Throws DiscountPolicyViolation on any breach; returns the computed result otherwise.
 */
export function evaluateManualDiscount(input: ManualDiscountInput): DiscountPolicyResult {
  const { channel, subtotalMinorUnits, manualDiscountMinorUnits } = input;

  if (manualDiscountMinorUnits < 0) {
    throw new DiscountPolicyViolation('NEGATIVE_DISCOUNT', 'Remise négative interdite.');
  }

  const pct = pctOf(manualDiscountMinorUnits, subtotalMinorUnits);

  if (channel === 'pos') {
    // Hard ceiling — never above 30%, even with a responsable code.
    if (pct > POS_HARD_DISCOUNT_CAP_PCT) {
      throw new DiscountPolicyViolation(
        'POS_OVER_CAP',
        `Remise ${pct}% refusée : plafond caisse strict ${POS_HARD_DISCOUNT_CAP_PCT}% (même avec code responsable).`,
      );
    }
    if (pct > 0 && !input.responsableCodeProvided) {
      throw new DiscountPolicyViolation(
        'RESPONSABLE_REQUIRED',
        'Une remise manuelle en caisse nécessite un code responsable valide.',
      );
    }
    const justificationRequired = pct >= JUSTIFICATION_REQUIRED_FROM_PCT;
    if (justificationRequired && !isValidJustification(input.justification)) {
      const empty = !input.justification || input.justification.trim().length === 0;
      throw new DiscountPolicyViolation(
        empty ? 'JUSTIFICATION_REQUIRED' : 'JUSTIFICATION_INVALID',
        `Une justification écrite est obligatoire pour une remise de ${JUSTIFICATION_REQUIRED_FROM_PCT}% à ${POS_HARD_DISCOUNT_CAP_PCT}%.`,
      );
    }
    return { discountPct: pct, justificationRequired, justificationAccepted: justificationRequired };
  }

  // channel === 'backoffice'
  const role = (input.actorRole ?? '').toLowerCase();
  if (!BACKOFFICE_ALLOWED_ROLES.includes(role as (typeof BACKOFFICE_ALLOWED_ROLES)[number])) {
    throw new DiscountPolicyViolation(
      'BACKOFFICE_FORBIDDEN_ROLE',
      'Les remises back-office sont réservées aux rôles centraux/admin et inaccessibles depuis une caisse.',
    );
  }
  if (pct > BACKOFFICE_MAX_DISCOUNT_PCT) {
    throw new DiscountPolicyViolation(
      'BACKOFFICE_OVER_MAX',
      `Remise ${pct}% refusée : plafond back-office ${BACKOFFICE_MAX_DISCOUNT_PCT}%.`,
    );
  }
  // Above 30% requires a motif + a validator (responsable code) + audit.
  const motifRequired = pct > POS_HARD_DISCOUNT_CAP_PCT;
  if (motifRequired && (!isValidJustification(input.justification) || !input.responsableCodeProvided)) {
    throw new DiscountPolicyViolation(
      'BACKOFFICE_MOTIF_REQUIRED',
      `Une remise back-office > ${POS_HARD_DISCOUNT_CAP_PCT}% exige un motif et un validateur.`,
    );
  }
  return {
    discountPct: pct,
    justificationRequired: motifRequired,
    justificationAccepted: motifRequired,
  };
}

/**
 * Distribute a cart-level manual discount across line net amounts, proportionally,
 * in integer minor units, so the per-line tax base stays consistent (NF525).
 *
 * - Returns an array of per-line discount amounts whose sum === `manualDiscount` exactly.
 * - No line is discounted below 0 (cap at its net amount).
 * - Largest-remainder method assigns leftover cents deterministically (largest net first).
 *
 * Throws DiscountPolicyViolation('MANUAL_EXCEEDS_CART') if the discount exceeds the
 * total net (you cannot discount more than what is left after promotions).
 */
export function distributeManualDiscount(
  lineNetMinorUnits: number[],
  manualDiscount: number,
): number[] {
  if (manualDiscount < 0) {
    throw new DiscountPolicyViolation('NEGATIVE_DISCOUNT', 'Remise négative interdite.');
  }
  const total = lineNetMinorUnits.reduce((a, b) => a + b, 0);
  if (manualDiscount === 0 || total === 0) {
    return lineNetMinorUnits.map(() => 0);
  }
  if (manualDiscount > total) {
    throw new DiscountPolicyViolation(
      'MANUAL_EXCEEDS_CART',
      `Remise manuelle (${manualDiscount}) supérieure au total panier restant (${total}).`,
    );
  }
  // Floor proportional allocation.
  const exact = lineNetMinorUnits.map((net) => (net / total) * manualDiscount);
  const floored = exact.map((x) => Math.floor(x));
  let allocated = floored.reduce((a, b) => a + b, 0);
  let leftover = manualDiscount - allocated;
  // Assign leftover cents by largest fractional remainder, tie-broken by larger net.
  const order = lineNetMinorUnits
    .map((net, i) => ({ i, frac: exact[i] - floored[i], net }))
    .sort((a, b) => b.frac - a.frac || b.net - a.net);
  const result = [...floored];
  for (let k = 0; k < order.length && leftover > 0; k++) {
    const idx = order[k].i;
    if (result[idx] < lineNetMinorUnits[idx]) {
      result[idx] += 1;
      leftover -= 1;
    }
  }
  return result;
}
