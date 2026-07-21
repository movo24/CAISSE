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
    p.ean.includes(query) ||
    (!!p.categoryId && p.categoryId.toLowerCase().includes(query))
  );
}
