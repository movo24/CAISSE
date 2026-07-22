/**
 * Registre des moteurs de paiement (P1) — instances UNIQUES au niveau module,
 * partagées par TOUS les pipelines (iPad et desktop). Fin de la duplication
 * R5 : un seul verrou de ré-entrée, un seul historique de tentatives par
 * vente, un seul journal — quel que soit l'écran qui encaisse.
 *
 * En P3, la résolution provider viendra de la config magasin/terminal
 * (ProviderRegistry backend, D-PE4) ; ici elle suit le CardPaymentMode.
 */

import { PaymentEngine } from './engine';
import { StripeProvider } from './providers/stripeProvider';
import { MockProvider } from './providers/mockProvider';

let real: { engine: PaymentEngine; provider: StripeProvider } | null = null;
let demo: { engine: PaymentEngine; provider: MockProvider } | null = null;

export function getRealPaymentEngine(): { engine: PaymentEngine; provider: StripeProvider } {
  if (!real) {
    const provider = new StripeProvider();
    real = { engine: new PaymentEngine(provider), provider };
  }
  return real;
}

export function getDemoPaymentEngine(): { engine: PaymentEngine; provider: MockProvider } {
  if (!demo) {
    const provider = new MockProvider();
    demo = { engine: new PaymentEngine(provider), provider };
  }
  return demo;
}

/** Annule toute collecte en cours, quel que soit le mode (bouton Annuler). */
export async function cancelAnyActiveCollection(): Promise<void> {
  await Promise.all([real?.engine.cancelActive(), demo?.engine.cancelActive()]);
}

/** Test hook — repart d'instances vierges. */
export function resetPaymentEngines(): void {
  real = null;
  demo = null;
}
