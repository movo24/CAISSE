/**
 * MockProvider — remplace le mode `demo` actuel (§3.7) et sert de harnais de
 * test scriptable (§5 : simulation des états, y compris TIMEOUT/UNKNOWN).
 *
 * Deux modes de pilotage :
 *  - Manuel (parité démo caissier) : `collect()` reste en attente jusqu'à
 *    `resolveApproved()` / `resolveDeclined()` / `resolveOutcome()` (le bouton
 *    « simuler » de l'overlay démo), ou expire (`timeoutMs`, 25 s par défaut —
 *    même valeur que l'overlay démo actuel).
 *  - Scripté (tests) : `script([...])` fait résoudre les prochains collect()
 *    automatiquement, avec délai optionnel.
 *
 * claimsCapture = false : une approbation mock ne prouve JAMAIS une capture —
 * la jambe carte part toujours pendingCapture=true (vente payment_pending).
 */

import type {
  PaymentAttempt,
  PaymentProvider,
  ProviderCapabilities,
  ProviderHealth,
  ProviderOutcome,
  ProviderResult,
  ProviderTxStatus,
  RefundRequest,
  TerminalConfig,
} from '../types';

export interface MockScriptStep {
  outcome: ProviderOutcome;
  delayMs?: number;
  providerRef?: string;
  errorMessage?: string;
}

const DEMO_TIMEOUT_MS = 25_000;

interface PendingCollect {
  attempt: PaymentAttempt;
  resolve: (r: ProviderResult) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export class MockProvider implements PaymentProvider {
  readonly name = 'mock';

  private timeoutMs: number;
  private pending: PendingCollect | null = null;
  private autoScript: MockScriptStep[] = [];
  private statusByRef = new Map<string, ProviderTxStatus>();
  private refundOutcome: ProviderOutcome = 'approved';
  private seq = 0;

  constructor(opts?: { timeoutMs?: number }) {
    this.timeoutMs = opts?.timeoutMs ?? DEMO_TIMEOUT_MS;
  }

  capabilities(): ProviderCapabilities {
    return {
      refund: true,
      cancel: true,
      statusQuery: true,
      separateAuthCapture: false,
      claimsCapture: false,
    };
  }

  async init(_config: TerminalConfig): Promise<void> {}
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async reconnect(): Promise<void> {}
  async healthcheck(): Promise<ProviderHealth> {
    return { ok: true, detail: 'mock' };
  }

  /** Script the NEXT collect() calls (tests). Steps are consumed in order. */
  script(steps: MockScriptStep[]): void {
    this.autoScript.push(...steps);
  }

  /** Pre-load a getStatus() answer for a providerRef (verification tests). */
  scriptStatus(providerRef: string, status: ProviderTxStatus): void {
    this.statusByRef.set(providerRef, status);
  }

  get isCollecting(): boolean {
    return this.pending !== null;
  }

  collect(attempt: PaymentAttempt): Promise<ProviderResult> {
    if (this.pending) {
      return Promise.resolve({
        outcome: 'declined',
        errorMessage: 'Un paiement est déjà en cours sur le terminal (mock).',
      });
    }
    return new Promise<ProviderResult>((resolve) => {
      const step = this.autoScript.shift();
      if (step) {
        const fire = () =>
          this.settle({
            outcome: step.outcome,
            providerRef: step.providerRef,
            errorMessage: step.errorMessage,
          });
        this.pending = {
          attempt,
          resolve,
          timer: step.delayMs ? setTimeout(fire, step.delayMs) : null,
        };
        if (!step.delayMs) fire();
        return;
      }
      // Manual mode (demo overlay): explicit resolution or timeout.
      this.pending = {
        attempt,
        resolve,
        timer: setTimeout(
          () => this.settle({ outcome: 'timeout', errorMessage: 'Délai démo dépassé.' }),
          this.timeoutMs,
        ),
      };
    });
  }

  /** Demo button — approve the pending collect (leg stays pendingCapture). */
  resolveApproved(providerRef?: string): void {
    this.settle({ outcome: 'approved', providerRef: providerRef ?? `mock_${++this.seq}` });
  }

  resolveDeclined(errorMessage = 'Paiement refusé (démo).'): void {
    this.settle({ outcome: 'declined', errorMessage });
  }

  resolveOutcome(outcome: ProviderOutcome, partial?: Partial<ProviderResult>): void {
    this.settle({ outcome, ...partial });
  }

  async cancel(_attemptId: string): Promise<ProviderResult> {
    const result: ProviderResult = { outcome: 'cancelled' };
    this.settle(result);
    return result;
  }

  async getStatus(providerRef: string): Promise<ProviderTxStatus> {
    return this.statusByRef.get(providerRef) ?? { state: 'not_found', providerRef };
  }

  async refund(req: RefundRequest): Promise<ProviderResult> {
    return {
      outcome: this.refundOutcome,
      providerRef: `mock_refund_${req.idempotencyKey}`,
    };
  }

  scriptRefundOutcome(outcome: ProviderOutcome): void {
    this.refundOutcome = outcome;
  }

  private settle(result: ProviderResult): void {
    const p = this.pending;
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    this.pending = null;
    p.resolve(result);
  }
}
