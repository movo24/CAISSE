/**
 * Contexte de navigation du Catalogue Produits — persistance de session.
 *
 * Règle UX (owner, 2026-07-24) : après l'enregistrement d'une fiche produit,
 * l'utilisateur revient AUTOMATIQUEMENT à Catalogue → Produits, dans EXACTEMENT
 * l'état où il l'avait quitté : recherche, filtres actifs, catégorie, statut,
 * tri, pagination et position de défilement. (Le magasin est un état GLOBAL —
 * `useCurrentStoreId` — déjà persistant, il n'est pas dupliqué ici.)
 *
 * - `sessionStorage` : le contexte survit aux allers-retours fiche↔catalogue
 *   et au refresh, mais pas à la fermeture de l'onglet (comportement voulu :
 *   une nouvelle session repart sur le défaut « Statut : Actif »).
 * - Fiche ouverte en accès direct (lien profond, nouvelle session) → aucun
 *   contexte → le catalogue s'ouvre sur son défaut (Statut : Actif).
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
