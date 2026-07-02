/**
 * P352 — POS-042 : paiement carte DIFFÉRÉ en mode offline (moteur pur).
 *
 * DÉCISION DE STRATÉGIE (comble le « à définir » de POS_PAYMENT_STRATEGY.md,
 * cohérente avec les règles NF525 du projet) :
 *
 *   1. Voie NOMINALE offline = TPE AUTONOME (SIM/4G) : la carte est réellement
 *      encaissée par le TPE → ce n'est PAS un différé, la vente se finalise
 *      normalement et part dans la file sync (existant, POS-020).
 *
 *   2. « Différé » ne signifie JAMAIS « vente finalisée sans encaissement »
 *      (règle 3 : somme paiements = total, encaissés). Le différé est une
 *      FILE DE CAPTURE : la vente reste EN ATTENTE (non finalisée, hors
 *      chaîne fiscale), un ordre de capture est mis en file offline avec une
 *      clé d'idempotence DÉTERMINISTE. À la reconnexion :
 *        - capture réussie  → la vente se finalise (création idempotente) ;
 *        - capture échouée  → la vente N'EXISTE PAS fiscalement ; le panier
 *          est re-présenté pour un autre moyen de paiement.
 *      Aucun ticket fiscal n'est émis avant capture (un reçu « en attente »
 *      non fiscal est permis).
 *
 *   3. Garde-fous (mêmes principes que l'anti-fraude offline POS-020) :
 *      plafond PAR TICKET différé + plafond CUMULÉ par session offline.
 *      Défauts prudents : 150 € / ticket, 500 € cumulés — ajustables.
 *
 * Pur : aucune I/O, aucun appel Stripe ici. La capture réelle passe par le
 * module stripe-terminal existant (clé d'idempotence PaymentIntent déjà
 * testée, anti double-charge).
 */
import type { NetworkStatus, TpeMode } from '../stores/offlineStore';

export interface DeferredCardGuard {
  /** Plafond par ticket différé (centimes). */
  maxDeferredTicketMinorUnits: number;
  /** Plafond cumulé des captures différées en attente (centimes). */
  maxDeferredOutstandingMinorUnits: number;
}

export const DEFAULT_DEFERRED_GUARD: DeferredCardGuard = {
  maxDeferredTicketMinorUnits: 15000, // 150,00 €
  maxDeferredOutstandingMinorUnits: 50000, // 500,00 €
};

export interface DeferDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Le différé n'est proposé QUE dans la fenêtre exacte où il a du sens :
 * caisse offline + TPE dépendant d'Internet (sinon la carte passe en direct),
 * montant sous plafond, encours sous plafond.
 */
export function canDeferCard(
  network: NetworkStatus,
  tpeMode: TpeMode,
  amountMinorUnits: number,
  outstandingDeferredMinorUnits: number,
  guard: DeferredCardGuard = DEFAULT_DEFERRED_GUARD,
): DeferDecision {
  if (!Number.isInteger(amountMinorUnits) || amountMinorUnits <= 0) {
    return { allowed: false, reason: 'Montant invalide (entier > 0, centimes)' };
  }
  if (network === 'online') {
    return { allowed: false, reason: 'Caisse en ligne : paiement carte direct (pas de différé)' };
  }
  if (tpeMode === 'autonomous') {
    return { allowed: false, reason: 'TPE autonome (SIM/4G) : encaisser la carte directement' };
  }
  if (amountMinorUnits > guard.maxDeferredTicketMinorUnits) {
    return {
      allowed: false,
      reason: `Différé refusé : ticket au-dessus du plafond offline (${(guard.maxDeferredTicketMinorUnits / 100).toFixed(2)} €)`,
    };
  }
  if (outstandingDeferredMinorUnits + amountMinorUnits > guard.maxDeferredOutstandingMinorUnits) {
    return {
      allowed: false,
      reason: `Différé refusé : encours offline au plafond (${(guard.maxDeferredOutstandingMinorUnits / 100).toFixed(2)} €)`,
    };
  }
  return { allowed: true };
}

/** Ordre de capture mis en file offline (queue type 'payment'). */
export interface DeferredCaptureOrder {
  kind: 'card_deferred_capture';
  /** Id client de la vente EN ATTENTE (uuid généré caisse — deviendra l'id de vente à la finalisation). */
  saleClientId: string;
  amountMinorUnits: number;
  currencyCode: string;
  /**
   * Clé d'idempotence DÉTERMINISTE : même vente + même montant ⇒ même clé,
   * quel que soit le nombre de rejeux de la file. Compatible règle projet
   * (réutiliser/rejeter une clé déjà traitée ; ≤ 64 chars).
   */
  idempotencyKey: string;
  createdAt: string;
}

export function buildDeferredCaptureOrder(input: {
  saleClientId: string;
  amountMinorUnits: number;
  currencyCode?: string;
  now?: Date;
}): DeferredCaptureOrder {
  const { saleClientId, amountMinorUnits } = input;
  if (!saleClientId) throw new Error('saleClientId requis');
  if (!Number.isInteger(amountMinorUnits) || amountMinorUnits <= 0) {
    throw new Error('amountMinorUnits doit être un entier > 0 (centimes)');
  }
  return {
    kind: 'card_deferred_capture',
    saleClientId,
    amountMinorUnits,
    currencyCode: input.currencyCode ?? 'EUR',
    idempotencyKey: `defcap:${saleClientId}:${amountMinorUnits}`.slice(0, 64),
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

/** Encours différé : somme des ordres de capture encore en attente dans la file. */
export function outstandingDeferred(
  queue: Array<{ type: string; status: string; payload?: any }>,
): number {
  return queue
    .filter(
      (e) =>
        e.type === 'payment' &&
        e.payload?.kind === 'card_deferred_capture' &&
        (e.status === 'local_pending' || e.status === 'syncing' || e.status === 'failed'),
    )
    .reduce((s, e) => s + (Number(e.payload?.amountMinorUnits) || 0), 0);
}

export type CaptureOutcome = 'captured' | 'declined' | 'error';

export interface SettleResult {
  /** Ce que la caisse doit faire de la VENTE en attente. */
  saleAction: 'finalize_sale' | 'void_pending_sale' | 'keep_pending_retry';
  /** Statut à poser sur l'entrée de file. */
  queueStatus: 'synced' | 'failed' | 'local_pending';
  /** Message opérateur (toujours affiché — jamais d'échec silencieux, S5). */
  operatorMessage: string;
}

/**
 * Issue d'une tentative de capture au retour réseau.
 *  - captured : la vente peut se finaliser (création idempotente, chaîne fiscale) ;
 *  - declined : refus bancaire DÉFINITIF → la vente en attente est abandonnée
 *    (elle n'a jamais existé fiscalement) et l'opérateur re-encaisse autrement ;
 *  - error    : erreur technique transitoire → l'ordre reste en file (retry),
 *    la vente reste en attente.
 */
export function settleDeferredCapture(outcome: CaptureOutcome): SettleResult {
  switch (outcome) {
    case 'captured':
      return {
        saleAction: 'finalize_sale',
        queueStatus: 'synced',
        operatorMessage: 'Capture différée réussie — vente finalisée.',
      };
    case 'declined':
      return {
        saleAction: 'void_pending_sale',
        queueStatus: 'failed',
        operatorMessage:
          'Capture différée REFUSÉE par la banque — vente annulée (jamais finalisée). Re-encaisser le client.',
      };
    case 'error':
      return {
        saleAction: 'keep_pending_retry',
        queueStatus: 'local_pending',
        operatorMessage: 'Erreur technique de capture — nouvel essai automatique à la prochaine synchro.',
      };
  }
}
