/**
 * Pure payment-tender state machine (no React, no I/O — unit-testable).
 *
 * Supported tenders. New no-PSP tenders:
 *   - 'voucher'   → titre-resto (meal voucher)
 *   - 'gift_card' → carte cadeau
 *
 * Business rule (French retail): cash change is given ONLY from cash. Overpayment
 * on any non-cash tender (card / meal voucher / gift card) is NOT returned as
 * cash — meal-voucher excess in particular is forfeited by law.
 */
export type PaymentMethod = 'cash' | 'card' | 'mixed' | 'voucher' | 'gift_card' | 'store_credit';

/** Tenders from which the customer can receive cash change back. */
export const CHANGE_ELIGIBLE_METHODS: PaymentMethod[] = ['cash'];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Espèces',
  card: 'Carte bancaire',
  mixed: 'Mixte',
  voucher: 'Titre-resto',
  gift_card: 'Carte cadeau',
  store_credit: 'Avoir',
};

export interface Tender {
  method: PaymentMethod;
  amountMinorUnits: number;
}

export interface PaymentState {
  /** Sum of all tender amounts. */
  totalPaid: number;
  /** Amount still owed: max(0, total - totalPaid). */
  remaining: number;
  /** Cash change to give back (only ever drawn from cash tenders). */
  changeDue: number;
  /** Non-cash amount paid beyond the total — forfeited (no change on voucher/card/gift). */
  forfeitedOverpay: number;
  /** True once tenders cover the total. */
  isCovered: boolean;
}

const sum = (tenders: Tender[], pred: (t: Tender) => boolean): number =>
  tenders.filter(pred).reduce((s, t) => s + Math.max(0, t.amountMinorUnits || 0), 0);

export function computePaymentState(totalMinorUnits: number, tenders: Tender[]): PaymentState {
  const total = Math.max(0, totalMinorUnits || 0);
  const cashPaid = sum(tenders, (t) => CHANGE_ELIGIBLE_METHODS.includes(t.method));
  const nonCashPaid = sum(tenders, (t) => !CHANGE_ELIGIBLE_METHODS.includes(t.method));
  const totalPaid = cashPaid + nonCashPaid;

  // Cash only fills what non-cash tenders did not cover; any extra cash is change.
  const cashNeeded = Math.max(0, total - nonCashPaid);
  const changeDue = Math.max(0, cashPaid - cashNeeded);
  // Non-cash beyond the total cannot become change → forfeited.
  const forfeitedOverpay = Math.max(0, nonCashPaid - total);

  return {
    totalPaid,
    remaining: Math.max(0, total - totalPaid),
    changeDue,
    forfeitedOverpay,
    isCovered: totalPaid >= total,
  };
}

/** Does the running tender list cover the ticket total? */
export function isFullyCovered(totalMinorUnits: number, tenders: Tender[]): boolean {
  return computePaymentState(totalMinorUnits, tenders).isCovered;
}

/* ═══════════════════════════════════════════════════════════════════════
   ALLOCATION D'UN TENDER — séparation stricte (P0 financier 2026-07-24)
   « montant appliqué au ticket » ≠ « espèces physiquement reçues »
   ═══════════════════════════════════════════════════════════════════════

   Faille corrigée : un 2ᵉ paiement de 300 € sur 3 € dus était enregistré comme
   303 € encaissés + 297 € de monnaie. Règle : le montant APPLIQUÉ au ticket ne
   dépasse JAMAIS le reste dû ; seules les ESPÈCES REÇUES peuvent dépasser et
   génèrent la monnaie ; aucun dépassement n'est autorisé sur les tenders
   non-espèces (carte, titre-resto, carte cadeau, avoir). */

export interface TenderAllocation {
  method: PaymentMethod;
  /** Montant RÉELLEMENT imputé au ticket — borné à [1, reste dû]. */
  appliedMinorUnits: number;
  /** Espèces physiquement reçues du client (= applied pour les non-espèces). */
  cashReceivedMinorUnits: number;
  /** Monnaie à rendre (espèces uniquement) : reçu − appliqué. Jamais un remboursement. */
  changeMinorUnits: number;
}

export type AllocationResult =
  | { ok: true; allocation: TenderAllocation }
  | { ok: false; reason: string };

/**
 * Alloue un tender au ticket, en séparant appliqué / reçu / monnaie.
 *  - `remainingMinorUnits` : reste dû AVANT ce tender (centimes).
 *  - `requestedMinorUnits`  : non-espèces → montant à appliquer ; espèces → montant
 *    physiquement REÇU du client.
 * Non-espèces : tout dépassement du reste dû est REFUSÉ (jamais de monnaie rendue
 * sur carte/titre-resto/carte cadeau/avoir). Espèces : appliqué = min(reçu, reste),
 * monnaie = reçu − appliqué.
 */
export function allocateTender(
  remainingMinorUnits: number,
  method: PaymentMethod,
  requestedMinorUnits: number,
): AllocationResult {
  const remaining = Math.round(remainingMinorUnits);
  const req = Math.round(requestedMinorUnits);
  if (!Number.isFinite(req) || req <= 0) return { ok: false, reason: 'Montant invalide.' };
  if (!Number.isFinite(remaining) || remaining <= 0) return { ok: false, reason: 'Ticket déjà soldé — aucun paiement supplémentaire.' };

  if (CHANGE_ELIGIBLE_METHODS.includes(method)) {
    // Espèces : le montant saisi est le REÇU ; l'appliqué est plafonné au reste dû.
    const applied = Math.min(req, remaining);
    const change = req - applied; // > 0 uniquement si reçu > reste dû
    return {
      ok: true,
      allocation: { method, appliedMinorUnits: applied, cashReceivedMinorUnits: req, changeMinorUnits: change },
    };
  }

  // Non-espèces : aucun dépassement — le montant EST l'appliqué.
  if (req > remaining) {
    return { ok: false, reason: `Le montant (${(req / 100).toFixed(2)} €) dépasse le reste dû (${(remaining / 100).toFixed(2)} €). Aucun dépassement n'est autorisé sur ce mode de paiement.` };
  }
  return {
    ok: true,
    allocation: { method, appliedMinorUnits: req, cashReceivedMinorUnits: req, changeMinorUnits: 0 },
  };
}

/* ── Politique de validation de la monnaie rendue (P0) ────────────────────
   Une monnaie « aberrante » (ex. 297 € rendus pour 3 € dus) ne doit jamais être
   acceptée en silence : validation manager, ou blocage si les liquidités
   théoriques manquent. Seuils CONFIGURABLES centralement. */

export interface ChangeApprovalPolicy {
  /** Monnaie ≥ ce seuil (centimes) → validation MANAGER requise. */
  managerThresholdMinorUnits: number;
  /** Monnaie ≥ ce seuil (centimes) → BLOCAGE (jamais accepté). Optionnel. */
  hardBlockMinorUnits?: number;
  /** Liquidités théoriques en caisse (fond + encaissé), centimes. Optionnel. */
  drawerCashMinorUnits?: number;
}

export type ChangeDecision = 'ok' | 'manager' | 'block';

export interface ChangeApproval {
  decision: ChangeDecision;
  reason?: string;
}

/**
 * Décide si la monnaie à rendre est acceptable, requiert un manager, ou doit être
 * bloquée. Priorité : liquidité insuffisante → block ; seuil dur → block ; seuil
 * manager → manager ; sinon ok. Aucune monnaie (≤ 0) → toujours ok.
 */
export function evaluateChangeApproval(
  changeMinorUnits: number,
  policy: ChangeApprovalPolicy,
): ChangeApproval {
  const change = Math.round(changeMinorUnits);
  if (!Number.isFinite(change) || change <= 0) return { decision: 'ok' };

  if (policy.drawerCashMinorUnits != null && change > policy.drawerCashMinorUnits) {
    return { decision: 'block', reason: 'Liquidités insuffisantes en caisse pour rendre cette monnaie.' };
  }
  if (policy.hardBlockMinorUnits != null && change >= policy.hardBlockMinorUnits) {
    return { decision: 'block', reason: `Monnaie à rendre (${(change / 100).toFixed(2)} €) au-delà du plafond autorisé.` };
  }
  if (change >= policy.managerThresholdMinorUnits) {
    return { decision: 'manager', reason: `Monnaie à rendre élevée (${(change / 100).toFixed(2)} €) — validation manager requise.` };
  }
  return { decision: 'ok' };
}

/** Politique par défaut (surchargeable par la config magasin). */
export const DEFAULT_CHANGE_POLICY: ChangeApprovalPolicy = {
  managerThresholdMinorUnits: 5000, // 50 € de monnaie → manager
  hardBlockMinorUnits: 50000, // 500 € de monnaie → blocage
};

/**
 * GARDE COMPTABLE (couche « store local », partagée online + offline).
 * Vérifie qu'une liste de tenders APPLIQUÉS solde EXACTEMENT le ticket : chaque
 * montant appliqué > 0, et la somme des appliqués == total. Lève une erreur
 * sinon — un surpaiement (ex. 303 € appliqués pour 6 €) ne peut jamais partir au
 * backend. (Les espèces reçues / la monnaie sont des champs SÉPARÉS, non testés
 * ici : seul l'appliqué solde le ticket.)
 */
export function assertPaymentsApplied(
  totalMinorUnits: number,
  appliedTenders: Array<{ method: PaymentMethod; amountMinorUnits: number }>,
): void {
  const total = Math.round(totalMinorUnits);
  let sum = 0;
  for (const p of appliedTenders) {
    const a = Math.round(p.amountMinorUnits);
    if (!Number.isFinite(a) || a <= 0) {
      throw new Error(`Montant de paiement invalide (${p.method}: ${p.amountMinorUnits}).`);
    }
    sum += a;
  }
  if (sum !== total) {
    throw new Error(
      `Incohérence de paiement : somme appliquée ${(sum / 100).toFixed(2)} € ≠ total ${(total / 100).toFixed(2)} €. ` +
        `Le montant appliqué au ticket ne peut jamais dépasser le total (la monnaie est un mouvement distinct).`,
    );
  }
}
