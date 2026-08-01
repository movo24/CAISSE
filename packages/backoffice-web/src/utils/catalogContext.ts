/**
 * Contexte de navigation du Catalogue Produits — jeton de session À USAGE UNIQUE.
 *
 * Règle UX (owner, 2026-07-24, durcie) : après l'enregistrement d'une fiche
 * produit, l'utilisateur revient AUTOMATIQUEMENT à Catalogue → Produits, dans
 * EXACTEMENT l'état où il l'avait quitté : recherche, filtres actifs, catégorie,
 * statut, tri, pagination et position de défilement. (Le magasin est un état
 * GLOBAL — `useCurrentStoreId` — déjà persistant, il n'est pas dupliqué ici.)
 *
 * CONSOMMATION UNIQUE (exigence owner) : le contexte n'est écrit QU'AU MOMENT de
 * quitter la liste vers une fiche (`saveCatalogContext` dans `goToProduct`), et
 * il est LU-PUIS-SUPPRIMÉ en un seul geste au montage du catalogue
 * (`consumeCatalogContext`). Il n'existe donc que le temps d'UN aller-retour
 * fiche → catalogue. Conséquences voulues :
 *  - un accès DIRECT ultérieur au catalogue (menu, lien, refresh) dans le même
 *    onglet ne retrouve AUCUN contexte → défauts, dont « Statut : Actif » ;
 *  - il n'y a pas de persistance continue : rien ne peut « réapparaître » plus
 *    tard.
 * - Données corrompues → null (jamais d'exception vers l'UI).
 */

export interface CatalogContext {
  search: string;
  fStatus: string;
  fBrand: string;
  fSupplier: string;
  fCategory: string;
  fTax: string;
  fOutOfStock: boolean;
  fBelowThreshold: boolean;
  fNoImage: boolean;
  fNoSupplier: boolean;
  fNoCategory: boolean;
  sortBy: 'name' | 'price' | 'stock' | 'updatedAt';
  sortDir: 'ASC' | 'DESC';
  page: number;
  /** Position de défilement (window.scrollY) au moment de quitter la liste. */
  scrollY: number;
  savedAt: number;
}

const KEY = 'catalog.context';

function storage(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

export function saveCatalogContext(ctx: Omit<CatalogContext, 'savedAt'>): void {
  try {
    storage()?.setItem(KEY, JSON.stringify({ ...ctx, savedAt: Date.now() }));
  } catch {
    /* stockage indisponible → le retour se fera sur le défaut */
  }
}

export function loadCatalogContext(): CatalogContext | null {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    const ctx = JSON.parse(raw);
    if (!ctx || typeof ctx !== 'object' || typeof ctx.fStatus !== 'string') return null;
    return {
      search: typeof ctx.search === 'string' ? ctx.search : '',
      fStatus: ctx.fStatus,
      fBrand: typeof ctx.fBrand === 'string' ? ctx.fBrand : '',
      fSupplier: typeof ctx.fSupplier === 'string' ? ctx.fSupplier : '',
      fCategory: typeof ctx.fCategory === 'string' ? ctx.fCategory : '',
      fTax: typeof ctx.fTax === 'string' ? ctx.fTax : '',
      fOutOfStock: ctx.fOutOfStock === true,
      fBelowThreshold: ctx.fBelowThreshold === true,
      fNoImage: ctx.fNoImage === true,
      fNoSupplier: ctx.fNoSupplier === true,
      fNoCategory: ctx.fNoCategory === true,
      sortBy: ['name', 'price', 'stock', 'updatedAt'].includes(ctx.sortBy) ? ctx.sortBy : 'name',
      sortDir: ctx.sortDir === 'DESC' ? 'DESC' : 'ASC',
      page: Number.isInteger(ctx.page) && ctx.page >= 1 ? ctx.page : 1,
      scrollY: Number.isFinite(ctx.scrollY) && ctx.scrollY >= 0 ? ctx.scrollY : 0,
      savedAt: Number.isFinite(ctx.savedAt) ? ctx.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export function clearCatalogContext(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Lit le contexte PUIS le supprime, atomiquement (usage unique). C'est la SEULE
 * voie de restauration au montage du catalogue : après ce geste, un accès
 * direct ultérieur dans le même onglet ne retrouve rien. Retourne null si aucun
 * contexte (ou corrompu) — le catalogue applique alors ses défauts.
 */
export function consumeCatalogContext(): CatalogContext | null {
  const ctx = loadCatalogContext();
  // Suppression inconditionnelle : même un contexte corrompu (→ ctx null) est
  // effacé, pour qu'un résidu illisible ne « colle » pas à l'onglet.
  clearCatalogContext();
  return ctx;
}
