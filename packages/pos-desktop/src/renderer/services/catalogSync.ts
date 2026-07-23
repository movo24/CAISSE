/**
 * Synchronisation du catalogue produits de la caisse (P0 sync caisse).
 *
 * Corrige deux causes de « produit créé au back-office mais absent en caisse » :
 *  1. la caisse ne chargeait que la PREMIÈRE page du catalogue (limit 100,
 *     tri alphabétique) — tout produit au-delà était introuvable à la
 *     recherche texte (elle n'interroge que le cache local) ;
 *  2. aucun cache persistant : au démarrage hors ligne, catalogue VIDE.
 *
 * Ce module est pur (injection du fetcher) et testé unitairement.
 */

import type { CatalogueProduct } from '../hooks/useCart';

export const CATALOG_PAGE_LIMIT = 200;
/** Garde-fou anti-boucle : 25 pages × 200 = 5 000 produits. */
export const CATALOG_MAX_PAGES = 25;

const CACHE_KEY = 'pos_catalogue_cache_v1';

export interface CatalogPage {
  data: unknown;
}

export type CatalogListFetcher = (params: {
  page: number;
  limit: number;
}) => Promise<CatalogPage>;

export interface CatalogFetchOutcome {
  products: CatalogueProduct[];
  total: number;
  /** false si le garde-fou MAX_PAGES a tronqué (loggé, jamais silencieux). */
  complete: boolean;
}

/**
 * Charge TOUTES les pages du catalogue (réponse paginée { data, total } ou
 * tableau nu legacy). Lève si la première page échoue — l'appelant garde
 * alors son cache précédent.
 */
export async function fetchFullCatalogue(
  list: CatalogListFetcher,
): Promise<CatalogFetchOutcome> {
  const products: CatalogueProduct[] = [];
  let total = 0;
  let truncated = false;
  for (let page = 1; ; page++) {
    if (page > CATALOG_MAX_PAGES) {
      truncated = true;
      break;
    }
    const res = await list({ page, limit: CATALOG_PAGE_LIMIT });
    const raw = res.data as any;
    if (Array.isArray(raw)) {
      // Ancien backend : tableau nu, pas de pagination → une seule page.
      products.push(...raw);
      total = raw.length;
      break;
    }
    const batch: CatalogueProduct[] = raw?.data ?? [];
    products.push(...batch);
    total = typeof raw?.total === 'number' ? raw.total : products.length;
    if (batch.length < CATALOG_PAGE_LIMIT || products.length >= total) break;
  }
  if (truncated) {
    // Jamais de troncature silencieuse : le caissier doit pouvoir le signaler.
    console.warn(
      `[CATALOGUE] Tronqué au garde-fou ${CATALOG_MAX_PAGES * CATALOG_PAGE_LIMIT} produits (total serveur: ${total})`,
    );
  }
  return { products, total, complete: !truncated };
}

export interface CatalogueCache {
  at: string | null;
  products: CatalogueProduct[];
}

/** Cache persistant : la caisse redémarre avec le dernier catalogue connu. */
export function saveCatalogueCache(products: CatalogueProduct[], now: Date = new Date()): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: now.toISOString(), products }));
  } catch {
    // Quota/localStorage indisponible : le cache mémoire reste la source.
  }
}

export function loadCatalogueCache(): CatalogueCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { at: null, products: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.products)) return { at: null, products: [] };
    return { at: typeof parsed.at === 'string' ? parsed.at : null, products: parsed.products };
  } catch {
    return { at: null, products: [] };
  }
}

export function clearCatalogueCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* noop */
  }
}
