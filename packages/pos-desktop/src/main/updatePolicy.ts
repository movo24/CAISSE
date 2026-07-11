/**
 * Auto-update policy — pure, framework-free, unit-testable.
 *
 * Encapsule les DÉCISIONS de mise à jour (sans Electron ni réseau) :
 *  - quand est-il sûr d'INSTALLER une mise à jour déjà téléchargée
 *    (jamais pendant une vente, un paiement, une impression, une sync) ;
 *  - résolution du canal (stable vs pilote) ;
 *  - fréquence de vérification (« au minimum toutes les 24 h »).
 *
 * Le contrôleur `updater.ts` (electron-updater) ne fait qu'appliquer ces
 * décisions — toute la logique testable vit ici.
 */

/** Activité critique en cours sur la caisse (remontée par le renderer). */
export interface UpdateActivity {
  saleInProgress: boolean;
  paymentInProgress: boolean;
  printing: boolean;
  syncing: boolean;
}

export type BusyReason = 'payment' | 'printing' | 'sale' | 'syncing' | null;

export const IDLE_ACTIVITY: UpdateActivity = {
  saleInProgress: false,
  paymentInProgress: false,
  printing: false,
  syncing: false,
};

/**
 * Sûr d'installer MAINTENANT ? Uniquement si rien de critique n'est en cours.
 * (Le paiement et l'impression sont les plus sensibles — NF525/monnaie.)
 */
export function isSafeToInstall(a: UpdateActivity): boolean {
  return !a.saleInProgress && !a.paymentInProgress && !a.printing && !a.syncing;
}

/** Raison de blocage la plus prioritaire (pour un message clair), sinon null. */
export function busyReason(a: UpdateActivity): BusyReason {
  if (a.paymentInProgress) return 'payment';
  if (a.printing) return 'printing';
  if (a.saleInProgress) return 'sale';
  if (a.syncing) return 'syncing';
  return null;
}

// ── Canal de publication ──────────────────────────────────────────────
export type UpdateChannel = 'stable' | 'pilot';

/** Normalise une valeur (fichier de conf / env) en canal connu. */
export function normalizeChannel(v: unknown): UpdateChannel {
  return v === 'pilot' ? 'pilot' : 'stable';
}

/** Nom de canal electron-updater (latest.yml pour stable, beta.yml pour pilote). */
export function electronUpdaterChannel(c: UpdateChannel): 'latest' | 'beta' {
  return c === 'pilot' ? 'beta' : 'latest';
}

/** Le canal pilote accepte les pré-releases GitHub ; le canal stable non. */
export function allowsPrerelease(c: UpdateChannel): boolean {
  return c === 'pilot';
}

// ── Fréquence de vérification ─────────────────────────────────────────
/** Plancher raisonnable pour ne pas marteler le réseau. */
export const MIN_CHECK_INTERVAL_MS = 60_000; // 1 min
/** Plafond imposé par l'exigence « au minimum toutes les 24 h ». */
export const MAX_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 h
/** Défaut : 6 h (largement sous les 24 h, peu de charge). */
export const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Délai avant la 1ʳᵉ vérification au démarrage (laisser booter le POS). */
export const STARTUP_CHECK_DELAY_MS = 30_000;

/**
 * Intervalle de vérification effectif : jamais > 24 h (exigence), jamais < 1 min.
 * `requested` absent/invalide → défaut 6 h.
 */
export function checkIntervalMs(requested?: number): number {
  const base =
    typeof requested === 'number' && Number.isFinite(requested) && requested > 0
      ? requested
      : DEFAULT_CHECK_INTERVAL_MS;
  return Math.min(MAX_CHECK_INTERVAL_MS, Math.max(MIN_CHECK_INTERVAL_MS, base));
}
