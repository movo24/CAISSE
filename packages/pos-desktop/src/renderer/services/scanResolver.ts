/**
 * Résolution PURE d'un code scanné contre le catalogue local (hors-ligne compatible)
 * + anti-double-ajout d'un même scan physique. Aucune dépendance UI/DOM/réseau.
 */

/** Sous-ensemble du produit catalogue nécessaire à la résolution d'un scan. */
export interface ScanProduct {
  id: string;
  ean: string;
  name: string;
  priceMinorUnits: number;
  unitType?: string;
  isActive: boolean;
  imageUrl?: string | null;
}

export type ScanOutcome =
  | { status: 'add'; product: ScanProduct }
  | { status: 'refused'; product: ScanProduct; reason: string }
  | { status: 'unknown'; code: string };

/**
 * Résout un scan sur le catalogue LOCAL (synchronisé) — fonctionne hors-ligne.
 * - trouvé & vendable (`isActive`) → `add` ;
 * - trouvé mais désactivé/interdit → `refused` avec motif clair ;
 * - absent → `unknown` (l'appelant peut alors interroger le backend).
 */
export function resolveLocalScan(code: string, catalogue: ScanProduct[]): ScanOutcome {
  const c = (code || '').trim();
  const product = catalogue.find((p) => p.ean === c);
  if (!product) return { status: 'unknown', code: c };
  if (product.isActive === false) {
    return { status: 'refused', product, reason: 'Produit désactivé — vente interdite' };
  }
  return { status: 'add', product };
}

/** État du dernier scan accepté, pour bloquer un double-envoi d'un SEUL scan. */
export interface ScanDedupState {
  code: string | null;
  ts: number;
}

/**
 * Fenêtre par défaut (ms). VOLONTAIREMENT COURTE : elle ne doit capter qu'un
 * double-envoi *instantané* d'un SEUL scan (certaines douchettes ré-émettent le
 * code en quelques ms), JAMAIS un 2ᵉ scan volontaire du même article. Sur l'E655
 * (scanner de bureau à présentation), re-présenter le même article prend ≥300 ms —
 * bien au-delà de 50 ms — donc une re-lecture délibérée (→ quantité +1) n'est jamais bloquée.
 */
export const SCAN_DEDUP_WINDOW_MS = 50;

/**
 * Un même code re-émis dans la fenêtre = double-ajout accidentel d'un seul scan → à ignorer.
 * Un code différent, ou le même code après la fenêtre (re-scan volontaire → quantité +1),
 * est toujours autorisé.
 */
export function isDuplicateScan(
  prev: ScanDedupState,
  code: string,
  now: number,
  windowMs: number = SCAN_DEDUP_WINDOW_MS,
): boolean {
  return prev.code === (code || '').trim() && now - prev.ts < windowMs;
}
