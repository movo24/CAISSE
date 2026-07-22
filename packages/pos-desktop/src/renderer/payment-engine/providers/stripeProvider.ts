/**
 * StripeProvider — extraction de l'existant (P1) derrière l'interface unique.
 *
 * Reprend, à comportement identique, la logique de useStripeTerminal.ts :
 *  - SDK @stripe/terminal-js (connection token backend, découverte internet
 *    readers, lecteurs simulés uniquement hors build prod) ;
 *  - création du PaymentIntent côté backend avec retry ×2 (1,5 s, 3 s) ;
 *  - collectPaymentMethod bornée à 120 s puis processPayment ;
 *  - messages d'erreur FR identiques.
 *
 * Différences voulues (écarts corrigés par l'architecture ratifiée) :
 *  - la clé transmise au backend est la clé DÉTERMINISTE de l'attempt
 *    (attempt.idempotencyKey) — un retry technique du même attempt déduplique
 *    le PaymentIntent (corrige §2.3.3) ;
 *  - getStatus() interroge GET /stripe-terminal/payment-intent/:id (jamais
 *    appelé par l'ancien pipeline) → résolution des résultats incertains.
 *
 * PCI §3.10 : aucun PAN/piste/CVV ne transite ici — uniquement des ids `pi_…`.
 */

import { loadStripeTerminal } from '@stripe/terminal-js';
import { stripeTerminalApi } from '../../services/api';
import { fromStripePaymentIntentStatus } from '../mapping';
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

const COLLECT_TIMEOUT_MS = 120_000;
const MAX_BACKEND_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

/* eslint-disable @typescript-eslint/no-explicit-any -- SDK Stripe non typé strictement */
interface StripeSdkTerminal {
  discoverReaders(opts: { simulated: boolean }): Promise<any>;
  connectReader(reader: any): Promise<any>;
  collectPaymentMethod(clientSecret: string): Promise<any>;
  processPayment(paymentIntent: any): Promise<any>;
  cancelCollectPaymentMethod(): Promise<any>;
  disconnectReader(): Promise<any>;
}

export interface StripeReaderInfo {
  id: string;
  label?: string;
  serial_number?: string;
  device_type?: string;
  status?: string;
}

export interface StripeProviderDeps {
  /** Injectable pour les tests — défaut : loadStripeTerminal() réel. */
  loadTerminal?: () => Promise<{ create(opts: any): StripeSdkTerminal } | null>;
  /** Injectable pour les tests — défaut : stripeTerminalApi réel. */
  api?: Pick<typeof stripeTerminalApi, 'connectionToken' | 'createPaymentIntent' | 'getPaymentIntent'>;
  /** Lecteurs simulés (dev). Défaut : !import.meta.env.PROD (parité existante). */
  simulated?: boolean;
  sleep?: (ms: number) => Promise<void>;
}

/** Messages FR — parité stricte avec useStripeTerminal.getFrenchErrorMessage. */
export function stripeErrorToFrench(err: any): string {
  const code = err?.code || err?.decline_code || '';
  const msg = (err?.message || '').toLowerCase();
  if (code === 'reader_not_found' || msg.includes('reader not found')) {
    return "Lecteur introuvable. Verifiez qu'il est allume et a portee.";
  }
  if (code === 'bluetooth_disabled' || msg.includes('bluetooth')) {
    return 'Bluetooth desactive. Activez le Bluetooth pour connecter le lecteur.';
  }
  if (code === 'reader_busy' || msg.includes('reader is busy') || msg.includes('busy')) {
    return "Le lecteur est occupe. Attendez la fin de l'operation en cours.";
  }
  if (code === 'card_declined' || msg.includes('card declined') || msg.includes('declined')) {
    return 'Carte refusee. Demandez au client un autre moyen de paiement.';
  }
  if (code === 'timed_out' || msg.includes('timeout') || msg.includes('timed out')) {
    return "Delai d'attente depasse. Veuillez reessayer.";
  }
  if (code === 'network_error' || msg.includes('network') || msg.includes('fetch')) {
    return 'Erreur reseau. Verifiez la connexion Internet.';
  }
  if (code === 'reader_disconnected' || msg.includes('disconnected')) {
    return 'Lecteur deconnecte. Reconnectez le lecteur.';
  }
  return err?.message || 'Erreur terminal de paiement';
}

/** Classe l'erreur en outcome canonique — jamais un succès implicite. */
export function stripeErrorToOutcome(err: any): ProviderOutcome {
  const code = err?.code || err?.decline_code || '';
  const msg = (err?.message || '').toLowerCase();
  if (code === 'timed_out' || msg.includes('delai') || msg.includes('timeout') || msg.includes('timed out')) {
    return 'timeout';
  }
  if (
    code === 'network_error' ||
    code === 'ERR_NETWORK' ||
    msg.includes('network') ||
    msg.includes('fetch') ||
    msg.includes('reseau')
  ) {
    return 'communication_error';
  }
  if (msg.includes('cancel') || msg.includes('annul')) {
    return 'cancelled';
  }
  // Refus carte, lecteur absent/occupé, erreurs SDK explicites → refus franc.
  return 'declined';
}

export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe';

  private deps: Required<Pick<StripeProviderDeps, 'loadTerminal' | 'api' | 'sleep'>> & {
    simulated: boolean;
  };
  private terminal: StripeSdkTerminal | null = null;
  private connectedReader: StripeReaderInfo | null = null;
  private collecting = false;

  constructor(deps?: StripeProviderDeps) {
    this.deps = {
      loadTerminal: deps?.loadTerminal ?? (() => loadStripeTerminal() as any),
      api: deps?.api ?? stripeTerminalApi,
      simulated: deps?.simulated ?? !import.meta.env.PROD,
      sleep: deps?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    };
  }

  capabilities(): ProviderCapabilities {
    return {
      refund: false, // P4 — remboursement piloté, chantier séparé
      cancel: true,
      statusQuery: true,
      separateAuthCapture: false, // capture_method: 'automatic' (existant)
      claimsCapture: true, // le serveur re-vérifie via verifyCardCaptureClaims
    };
  }

  get reader(): StripeReaderInfo | null {
    return this.connectedReader;
  }

  get isCollecting(): boolean {
    return this.collecting;
  }

  async init(_config: TerminalConfig): Promise<void> {
    if (this.terminal) return;
    const sdk = await this.deps.loadTerminal();
    if (!sdk) throw new Error('Failed to load Stripe Terminal SDK');
    this.terminal = sdk.create({
      onFetchConnectionToken: async () => {
        const res = await this.deps.api.connectionToken();
        return res.data.secret;
      },
      onUnexpectedReaderDisconnect: () => {
        this.connectedReader = null;
      },
    });
  }

  async connect(): Promise<void> {
    if (!this.terminal) throw new Error('Terminal non initialise');
    if (this.connectedReader) return;
    const discoverResult: any = await this.terminal.discoverReaders({
      simulated: this.deps.simulated,
    });
    if (discoverResult?.error) {
      throw new Error(discoverResult.error.message || 'Discovery failed');
    }
    const readers: StripeReaderInfo[] = discoverResult?.discoveredReaders || [];
    if (readers.length === 0) {
      // Message parité usePayment.ensureReaderConnected.
      throw new Error(
        'Aucun lecteur carte détecté. Vérifiez que le WisePad 3 est allumé et connecté au réseau.',
      );
    }
    const result: any = await this.terminal.connectReader(readers[0]);
    if (result?.error) throw new Error(result.error.message || 'Connection failed');
    this.connectedReader = result.reader as StripeReaderInfo;
  }

  async disconnect(): Promise<void> {
    if (this.terminal && this.connectedReader) {
      try {
        await this.terminal.disconnectReader();
      } catch {
        // ignore — parité existante
      }
    }
    this.connectedReader = null;
  }

  async reconnect(): Promise<void> {
    await this.disconnect();
    await this.connect();
  }

  async healthcheck(): Promise<ProviderHealth> {
    if (!this.terminal) return { ok: false, detail: 'SDK non initialisé' };
    if (!this.connectedReader) return { ok: false, detail: 'Aucun lecteur connecté' };
    return { ok: true, detail: this.connectedReader.id };
  }

  async collect(attempt: PaymentAttempt): Promise<ProviderResult> {
    if (!this.terminal) {
      return { outcome: 'communication_error', errorMessage: 'Terminal non initialise' };
    }
    if (!this.connectedReader) {
      return { outcome: 'communication_error', errorMessage: 'Aucun lecteur connecte' };
    }
    if (this.collecting) {
      return {
        outcome: 'declined',
        errorMessage: 'Un paiement est deja en cours. Veuillez patienter.',
      };
    }
    this.collecting = true;
    let paymentIntentId: string | undefined;
    try {
      // 1. PaymentIntent backend — retry ×2, clé DÉTERMINISTE de l'attempt.
      let piRes: any;
      for (let n = 0; n <= MAX_BACKEND_RETRIES; n++) {
        try {
          piRes = await this.deps.api.createPaymentIntent({
            amount: attempt.amountMinorUnits,
            ticketNumber: attempt.idempotencyKey,
            currency: attempt.currency,
          });
          break;
        } catch (backendErr) {
          if (n === MAX_BACKEND_RETRIES) throw backendErr;
          await this.deps.sleep(RETRY_DELAY_MS * (n + 1));
        }
      }
      paymentIntentId = piRes.data.paymentIntentId;
      const clientSecret = piRes.data.clientSecret;

      // 2. Collecte sur le lecteur, bornée à 120 s (parité existante).
      const collectResult: any = await Promise.race([
        this.terminal.collectPaymentMethod(clientSecret),
        this.deps.sleep(COLLECT_TIMEOUT_MS).then(() => {
          throw new Error("Delai d'attente depasse (2 min). Veuillez reessayer.");
        }),
      ]);
      if (collectResult?.error) {
        throw new Error(collectResult.error.message || 'Collection annulee');
      }

      // 3. Autorisation.
      const processResult: any = await this.terminal.processPayment(collectResult.paymentIntent);
      if (processResult?.error) {
        throw new Error(processResult.error.message || 'Paiement refuse');
      }

      return { outcome: 'approved', providerRef: paymentIntentId };
    } catch (err) {
      return {
        outcome: stripeErrorToOutcome(err),
        providerRef: paymentIntentId,
        errorMessage: stripeErrorToFrench(err),
        errorCode: (err as any)?.code,
      };
    } finally {
      this.collecting = false;
    }
  }

  async cancel(_attemptId: string): Promise<ProviderResult> {
    if (this.terminal) {
      try {
        await this.terminal.cancelCollectPaymentMethod();
      } catch {
        // parité existante : l'échec d'annulation n'est pas bloquant
      }
    }
    return { outcome: 'cancelled' };
  }

  async getStatus(providerRef: string): Promise<ProviderTxStatus> {
    try {
      const res = await this.deps.api.getPaymentIntent(providerRef);
      const outcome = fromStripePaymentIntentStatus(res.data.status);
      const state: ProviderTxStatus['state'] =
        outcome === 'approved' ? 'approved' : outcome === 'cancelled' ? 'cancelled' : 'pending';
      return {
        state,
        providerRef,
        amountMinorUnits: res.data.amount,
        currency: res.data.currency,
      };
    } catch (err: any) {
      if (err?.response?.status === 400 || err?.response?.status === 404) {
        return { state: 'not_found', providerRef };
      }
      return { state: 'unknown', providerRef };
    }
  }

  async refund(_req: RefundRequest): Promise<ProviderResult> {
    return {
      outcome: 'declined',
      errorMessage: 'Remboursement carte piloté non disponible (chantier P4).',
    };
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
