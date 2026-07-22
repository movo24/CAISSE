/**
 * PaymentEngine — le moteur unique (P1) consommé par les deux pipelines POS.
 *
 * Responsabilités (§3.1) :
 *  - machine à états canonique (transitions VALIDÉES par assertTransition) ;
 *  - idempotence / anti-double-débit : verrou de ré-entrée SYNCHRONE
 *    (généralise finalizingRef — corrige R3) + une seule tentative active par
 *    vente (§3.5.2) + clés générées par le moteur, jamais par le connecteur ;
 *  - règle owner suprême : résultat incertain → VERIFICATION_REQUIRED, JAMAIS
 *    de relance automatique de la collecte ; résolution uniquement par
 *    provider.getStatus() (§3.8) ;
 *  - journal append-only en mémoire (§3.9 — la persistance IndexedDB est P2).
 *
 * Le moteur ne connaît AUCUN fournisseur : il parle à un PaymentProvider.
 */

import {
  assertTransition,
  canStartNewAttempt,
  canTransition,
  isUncertainStatus,
  PaymentAttemptStatus,
} from './states';
import { outcomeToStatus, STATUS_MESSAGES_FR } from './mapping';
import { newAttemptForPayment, newPaymentIdentifiers, PaymentIdentifiers } from './identifiers';
import type {
  PaymentAttempt,
  PaymentJournalEntry,
  PaymentProvider,
  ProviderResult,
} from './types';

/** Ordre nominal de la collecte — utilisé pour avancer légalement vers un état cible. */
const COLLECT_PATH: PaymentAttemptStatus[] = [
  'CREATED',
  'PAYMENT_PENDING',
  'WAITING_FOR_CUSTOMER',
  'WAITING_FOR_CARD',
  'AUTHORIZING',
];

export interface StartPaymentInput {
  /** Regroupe les tentatives d'une même vente/checkout (clé d'idempotence de vente). */
  saleKey: string;
  amountMinorUnits: number;
  currency?: string;
  saleId?: string;
  storeId?: string;
  terminalId?: string;
  cashSessionId?: string;
}

export interface PaymentEngineOutcome {
  status: PaymentAttemptStatus;
  /** Message caissier §3.11 — jamais de nom de fournisseur. */
  message: string;
  result?: ProviderResult;
  attempt: PaymentAttempt;
}

export interface EngineSnapshot {
  status: PaymentAttemptStatus | null;
  attemptId: string | null;
  message: string | null;
}

type Listener = (snapshot: EngineSnapshot) => void;

export class EngineBusyError extends Error {
  constructor() {
    super('Un paiement est déjà en cours. Veuillez patienter.');
    this.name = 'EngineBusyError';
  }
}

export class AttemptBlockedError extends Error {
  constructor() {
    super(
      'Un paiement précédent est en vérification. Résolvez-le avant toute nouvelle tentative.',
    );
    this.name = 'AttemptBlockedError';
  }
}

export class PaymentEngine {
  private provider: PaymentProvider;
  private actor: string;

  /** Verrou de ré-entrée SYNCHRONE — posé avant tout await (R3). */
  private busy = false;

  private current: { ids: PaymentIdentifiers; status: PaymentAttemptStatus } | null = null;

  /** Historique en mémoire par vente (P2 : IndexedDB). */
  private attemptStatusesBySale = new Map<string, PaymentAttemptStatus[]>();
  private paymentIdBySale = new Map<string, string>();

  private journalEntries: PaymentJournalEntry[] = [];
  private listeners = new Set<Listener>();

  constructor(provider: PaymentProvider, opts?: { actor?: string }) {
    this.provider = provider;
    this.actor = opts?.actor ?? 'cashier';
  }

  get providerName(): string {
    return this.provider.name;
  }

  /** true → une approbation vaut revendication de capture (vérifiée serveur). */
  get claimsCapture(): boolean {
    return this.provider.capabilities().claimsCapture;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  snapshot(): EngineSnapshot {
    return {
      status: this.current?.status ?? null,
      attemptId: this.current?.ids.attemptId ?? null,
      message: this.current ? STATUS_MESSAGES_FR[this.current.status] : null,
    };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Journal append-only (lecture seule pour l'UI/les tests). */
  journal(): readonly PaymentJournalEntry[] {
    return this.journalEntries;
  }

  /**
   * Lance UNE présentation de paiement. Résout toujours (jamais de throw après
   * le démarrage du flux) — les refus/erreurs sont des états, pas des exceptions.
   * Throws AVANT tout échange : EngineBusyError (double-clic) ou
   * AttemptBlockedError (tentative active/vérification non résolue).
   */
  async startPayment(input: StartPaymentInput): Promise<PaymentEngineOutcome> {
    // — Verrou synchrone : tout re-appel avant la fin est rejeté (R3).
    if (this.busy) throw new EngineBusyError();
    const history = this.attemptStatusesBySale.get(input.saleKey) ?? [];
    if (!canStartNewAttempt(history)) throw new AttemptBlockedError();
    this.busy = true;

    const priorPaymentId = this.paymentIdBySale.get(input.saleKey);
    const ids = priorPaymentId ? newAttemptForPayment(priorPaymentId) : newPaymentIdentifiers();
    this.paymentIdBySale.set(input.saleKey, ids.globalPaymentId);
    const historyIndex = history.length;

    const attempt: PaymentAttempt = {
      globalPaymentId: ids.globalPaymentId,
      attemptId: ids.attemptId,
      idempotencyKey: ids.idempotencyKey,
      amountMinorUnits: input.amountMinorUnits,
      currency: input.currency ?? 'eur',
      saleId: input.saleId,
      storeId: input.storeId,
      terminalId: input.terminalId,
      cashSessionId: input.cashSessionId,
    };

    this.current = { ids, status: 'CREATED' };
    this.attemptStatusesBySale.set(input.saleKey, [...history, 'CREATED']);
    this.recordTransition(attempt, null, 'CREATED');

    const syncHistory = (s: PaymentAttemptStatus) => {
      const list = this.attemptStatusesBySale.get(input.saleKey)!;
      list[historyIndex] = s;
    };

    try {
      this.moveTo(attempt, 'PAYMENT_PENDING', syncHistory);
      this.moveTo(attempt, 'WAITING_FOR_CUSTOMER', syncHistory);

      let result: ProviderResult;
      try {
        result = await this.provider.collect(attempt);
      } catch (err) {
        // Un connecteur ne doit jamais throw — défense en profondeur.
        result = {
          outcome: 'communication_error',
          errorMessage: (err as Error)?.message || 'Erreur terminal de paiement',
        };
      }
      let target = outcomeToStatus(result.outcome);

      this.advanceTowards(attempt, target, syncHistory);

      if (isUncertainStatus(target)) {
        // Règle owner : sortie unique → vérification, jamais une relance.
        this.moveTo(attempt, 'VERIFICATION_REQUIRED', syncHistory);
        target = await this.resolveVerification(attempt, result, syncHistory);
      }

      return {
        status: target,
        message: STATUS_MESSAGES_FR[target],
        result,
        attempt,
      };
    } finally {
      this.busy = false;
    }
  }

  /**
   * Annulation caisse pendant la présentation carte. Ne mute PAS l'état
   * directement : le provider fait échouer la collecte en cours, et le flux
   * nominal de startPayment() journalise la transition vers CANCELLED (une
   * seule écriture d'état, pas de course).
   */
  async cancelActive(): Promise<void> {
    const cur = this.current;
    if (!cur || !this.busy) return;
    await this.provider.cancel(cur.ids.attemptId);
  }

  /**
   * Résolution d'un résultat incertain (§3.8) — UNIQUEMENT par consultation du
   * statut provider. Sans référence provider, rien n'a pu être débité → refus
   * franc, la vente peut être re-tentée. Provider injoignable → l'attempt
   * RESTE en vérification et bloque toute relance (D-PE5).
   */
  private async resolveVerification(
    attempt: PaymentAttempt,
    result: ProviderResult,
    syncHistory: (s: PaymentAttemptStatus) => void,
  ): Promise<PaymentAttemptStatus> {
    if (!result.providerRef) {
      this.moveTo(attempt, 'DECLINED', syncHistory);
      return 'DECLINED';
    }
    if (!this.provider.capabilities().statusQuery) {
      return 'VERIFICATION_REQUIRED';
    }
    try {
      const st = await this.provider.getStatus(result.providerRef);
      switch (st.state) {
        case 'approved': {
          // Le paiement a RÉELLEMENT abouti — la jambe carte doit le porter.
          result.outcome = 'approved';
          this.moveTo(attempt, 'APPROVED', syncHistory);
          return 'APPROVED';
        }
        case 'declined':
        case 'not_found': {
          this.moveTo(attempt, 'DECLINED', syncHistory);
          return 'DECLINED';
        }
        case 'cancelled': {
          this.moveTo(attempt, 'CANCELLED', syncHistory);
          return 'CANCELLED';
        }
        default:
          return 'VERIFICATION_REQUIRED';
      }
    } catch {
      return 'VERIFICATION_REQUIRED';
    }
  }

  /** Avance le long du chemin nominal jusqu'à pouvoir atteindre `target`. */
  private advanceTowards(
    attempt: PaymentAttempt,
    target: PaymentAttemptStatus,
    syncHistory: (s: PaymentAttemptStatus) => void,
  ): void {
    const cur = this.current!;
    while (!canTransition(cur.status, target)) {
      const idx = COLLECT_PATH.indexOf(cur.status);
      const next = COLLECT_PATH[idx + 1];
      if (idx === -1 || !next) {
        // Défense en profondeur : cible inatteignable → l'assert lèvera.
        break;
      }
      this.moveTo(attempt, next, syncHistory);
    }
    this.moveTo(attempt, target, syncHistory);
  }

  private moveTo(
    attempt: PaymentAttempt,
    to: PaymentAttemptStatus,
    syncHistory: (s: PaymentAttemptStatus) => void,
  ): void {
    const cur = this.current!;
    const from = cur.status;
    cur.status = assertTransition(from, to);
    syncHistory(to);
    this.recordTransition(attempt, from, to);
    this.emit();
  }

  private recordTransition(
    attempt: PaymentAttempt,
    from: PaymentAttemptStatus | null,
    to: PaymentAttemptStatus,
  ): void {
    this.journalEntries.push({
      globalPaymentId: attempt.globalPaymentId,
      attemptId: attempt.attemptId,
      saleId: attempt.saleId,
      storeId: attempt.storeId,
      terminalId: attempt.terminalId,
      cashSessionId: attempt.cashSessionId,
      provider: this.provider.name,
      amountMinorUnits: attempt.amountMinorUnits,
      currency: attempt.currency,
      from,
      to,
      at: new Date().toISOString(),
      actor: this.actor,
    });
  }

  private emit(): void {
    const snap = this.snapshot();
    this.listeners.forEach((l) => l(snap));
  }
}
