/**
 * P353 — POS-042 / TD-042-EXECUTOR : exécuteur de capture différée.
 *
 * Consomme les ordres `card_deferred_capture` de la file offline au retour
 * réseau. TOUTES les dépendances sont injectées (client de capture, file,
 * actions vente, notification opérateur) → l'orchestration est prouvable
 * SANS TPE ; seul l'adaptateur physique reste à valider sur matériel réel.
 *
 * Invariants tenus (prouvés par deferred-capture-executor.test.ts) :
 *  - la capture est appelée avec la clé d'idempotence DÉTERMINISTE de l'ordre
 *    (rejeu de file ⇒ même clé ⇒ pas de double charge côté Stripe) ;
 *  - captured  → finalizeSale PUIS entrée `synced` (si la finalisation échoue,
 *    l'entrée reste en file : rejouable, la clé idempotente absorbe le rejeu) ;
 *  - declined  → voidPendingSale + entrée `failed` + message opérateur ;
 *  - error/exception → l'entrée RESTE `local_pending` (retry au prochain run) ;
 *  - un ordre déjà `synced`/non-différé n'est jamais retraité ;
 *  - jamais d'échec silencieux : chaque issue notifie l'opérateur (S5).
 */
import {
  DeferredCaptureOrder,
  CaptureOutcome,
  settleDeferredCapture,
} from './deferred-card-policy';

export interface QueueEntryLike {
  id: string;
  type: string;
  status: string;
  payload?: any;
}

export interface DeferredCaptureDeps {
  /**
   * Adaptateur de capture (Stripe Terminal / backend). DOIT honorer la clé
   * d'idempotence. Peut jeter : toute exception est traitée comme 'error'
   * (transitoire, retry) — jamais comme un refus définitif.
   */
  capture: (order: DeferredCaptureOrder) => Promise<CaptureOutcome>;
  /** Finalise la vente en attente (création idempotente côté backend). */
  finalizeSale: (saleClientId: string) => Promise<void>;
  /** Abandonne la vente en attente (jamais entrée dans la chaîne fiscale). */
  voidPendingSale: (saleClientId: string) => Promise<void>;
  /** Statut de l'entrée de file. */
  updateEntryStatus: (entryId: string, status: 'synced' | 'failed' | 'local_pending') => void;
  /** Message opérateur — TOUJOURS appelé, jamais d'échec silencieux. */
  notify: (message: string) => void;
}

export interface DeferredRunReport {
  processed: number;
  captured: number;
  declined: number;
  retried: number;
}

const isPendingDeferred = (e: QueueEntryLike) =>
  e.type === 'payment' &&
  e.payload?.kind === 'card_deferred_capture' &&
  (e.status === 'local_pending' || e.status === 'failed_retryable');

/**
 * Traite séquentiellement (pas de parallélisme : un TPE, un opérateur, et un
 * ordre déterministe rend les rejeux reproductibles) les ordres de capture
 * différée en attente.
 */
export async function processDeferredCaptures(
  queue: QueueEntryLike[],
  deps: DeferredCaptureDeps,
): Promise<DeferredRunReport> {
  const report: DeferredRunReport = { processed: 0, captured: 0, declined: 0, retried: 0 };

  for (const entry of queue.filter(isPendingDeferred)) {
    const order = entry.payload as DeferredCaptureOrder;
    report.processed++;

    let outcome: CaptureOutcome;
    try {
      outcome = await deps.capture(order);
    } catch {
      outcome = 'error'; // exception = transitoire ⇒ retry, jamais un refus
    }

    const settle = settleDeferredCapture(outcome);

    if (settle.saleAction === 'finalize_sale') {
      try {
        await deps.finalizeSale(order.saleClientId);
      } catch {
        // Capture OK mais finalisation KO (ex. réseau retombé) : on NE MARQUE
        // PAS synced — l'entrée reste rejouable ; au rejeu, la même clé de
        // capture est idempotente côté Stripe et la création de vente est
        // idempotente côté backend. Aucune double charge possible.
        deps.updateEntryStatus(entry.id, 'local_pending');
        deps.notify(
          'Capture réussie mais finalisation de la vente en échec — nouvel essai à la prochaine synchro (aucune double charge possible).',
        );
        report.retried++;
        continue;
      }
      deps.updateEntryStatus(entry.id, 'synced');
      report.captured++;
    } else if (settle.saleAction === 'void_pending_sale') {
      await deps.voidPendingSale(order.saleClientId);
      deps.updateEntryStatus(entry.id, 'failed');
      report.declined++;
    } else {
      deps.updateEntryStatus(entry.id, 'local_pending');
      report.retried++;
    }

    deps.notify(settle.operatorMessage);
  }

  return report;
}
