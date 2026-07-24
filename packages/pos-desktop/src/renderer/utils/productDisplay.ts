/**
 * Libellé produit affiché en caisse (recherche, panier, écran client, ticket).
 *
 * Règle owner (GO 2026-07-19) : utiliser `short_name` quand il existe,
 * sinon retomber sur `name`. Le libellé est figé dans la ligne de panier au
 * moment de l'ajout — l'écran client et l'impression du ticket en héritent.
 */

export interface DisplayableProduct {
  name: string;
  shortName?: string | null;
}

/** `shortName` s'il est renseigné (non vide après trim), sinon `name`. */
export function productDisplayName(p: DisplayableProduct): string {
  const short = (p.shortName ?? '').trim();
  return short !== '' ? short : p.name;
}

/* ── Avatar de repli (quand aucune photo produit) — partagé POSPage + panier ── */

/** Initiales (2 lettres) d'un libellé, pour l'avatar de repli. */
export function initials(name: string): string {
  return (name || '')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

const AVATAR_COLORS = [
  'from-rose-100 to-rose-200 text-rose-600',
  'from-blue-100 to-blue-200 text-blue-600',
  'from-amber-100 to-amber-200 text-amber-600',
  'from-emerald-100 to-emerald-200 text-emerald-600',
  'from-violet-100 to-violet-200 text-violet-600',
  'from-cyan-100 to-cyan-200 text-cyan-600',
  'from-pink-100 to-pink-200 text-pink-600',
  'from-lime-100 to-lime-200 text-lime-600',
];

/** Couleur d'avatar déterministe d'après le libellé (stable pour un même nom). */
export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export interface SearchableProduct extends DisplayableProduct {
  ean: string;
  description?: string | null;
  categoryId?: string | null;
}

/**
 * Prédicat de la recherche produit POS : nom complet, NOM COURT, description,
 * code-barres/SKU et catégorie. `query` est déjà en minuscules/trimmée côté appelant.
 */
export function productMatchesQuery(p: SearchableProduct, query: string): boolean {
  return (
    p.name.toLowerCase().includes(query) ||
    ((p.shortName ?? '').toLowerCase().includes(query) && (p.shortName ?? '').trim() !== '') ||
    (!!p.description && p.description.toLowerCase().includes(query)) ||
    // Insensible à la casse : indispensable pour les identifiants internes
    // Wesley (WES-P-…) — la requête arrive déjà en minuscules de l'appelant.
    p.ean.toLowerCase().includes(query) ||
    (!!p.categoryId && p.categoryId.toLowerCase().includes(query))
  );
}
