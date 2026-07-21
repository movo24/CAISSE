/**
 * Suggestion automatique du « Nom court (caisse) » à partir du nom complet.
 *
 * Objectif : proposer un libellé lisible par le caissier (marque, type,
 * variante, contenance) sans double saisie, jamais coupé au milieu d'un mot.
 * La proposition reste MODIFIABLE : le formulaire n'écrase jamais une saisie
 * manuelle (garde « touched » côté page).
 *
 * Colonne cible : products.short_name varchar(120). La génération vise
 * SHORT_NAME_TARGET (largeur confortable d'une ligne de ticket 58 mm) et ne
 * dépasse jamais SHORT_NAME_MAX.
 */

export const SHORT_NAME_TARGET = 32;
export const SHORT_NAME_MAX = 120;

/** Mots outils français sans valeur d'identification (retirés si trop long). */
const STOPWORDS = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', "l'", 'un', 'une', 'en', 'et',
  'à', 'a', 'au', 'aux', 'avec', 'pour', 'sans',
]);

/** Descripteurs d'emballage/marketing retirés en premier si trop long. */
const FILLERS = new Set([
  'goût', 'gout', 'saveur', 'arôme', 'arome', 'parfum',
  'bouteille', 'canette', 'flacon', 'paquet', 'sachet', 'boîte', 'boite',
  'pot', 'tube', 'spray', 'format', 'édition', 'edition', 'gamme',
  'soin', 'special', 'spécial', 'spéciale', 'nouveau', 'nouvelle',
]);

/** Normalise les contenances : "500 ml" → "500ml", "1,25 litre" → "1,25L", "33 cl" → "33cl". */
function compactUnits(s: string): string {
  return s
    .replace(/(\d[\d.,]*)\s*(?:litres?|l)\b/gi, (_m, n) => `${n}L`)
    .replace(/(\d[\d.,]*)\s*(ml|cl|dl|kg|g|mg)\b/gi, (_m, n, u) => `${n}${u.toLowerCase()}`)
    .replace(/\bpack\s+de\s+(\d+)\b/gi, (_m, n) => `x${n}`)
    .replace(/\blot\s+de\s+(\d+)\b/gi, (_m, n) => `x${n}`);
}

const isQuantity = (w: string) => /^\d[\d.,]*(?:l|ml|cl|dl|kg|g|mg)?$/i.test(w) || /^x\d+$/i.test(w);

/**
 * Propose un nom court à partir du nom produit (et de la marque si connue).
 * - la marque est promue en tête si elle apparaît dans le nom ;
 * - unités compactées ; mots outils puis descripteurs retirés si nécessaire ;
 * - troncature en fin de mot uniquement, quantité finale préservée.
 */
export function suggestShortName(
  name: string,
  brandName?: string | null,
  maxLen: number = SHORT_NAME_TARGET,
): string {
  const cleaned = compactUnits((name || '').replace(/\s+/g, ' ').trim());
  if (!cleaned) return '';
  const cap = Math.min(Math.max(maxLen, 8), SHORT_NAME_MAX);

  let words = cleaned.split(' ');

  // Promotion de la marque en tête (si présente dans le nom, insensible à la casse).
  const brand = (brandName || '').trim();
  if (brand) {
    const bWords = brand.split(/\s+/);
    const idx = words.findIndex((w) => w.localeCompare(bWords[0], 'fr', { sensitivity: 'base' }) === 0);
    const matches =
      idx >= 0 &&
      bWords.every((bw, i) => (words[idx + i] || '').localeCompare(bw, 'fr', { sensitivity: 'base' }) === 0);
    if (matches && idx > 0) {
      const extracted = words.splice(idx, bWords.length);
      words = [...extracted, ...words];
    }
  }

  const join = (ws: string[]) => ws.join(' ');
  if (join(words).length <= cap) return join(words);

  // 1. Retirer les mots outils.
  const kept = words.filter((w, i) => i === 0 || !STOPWORDS.has(w.toLowerCase()));
  if (join(kept).length <= cap) return join(kept);

  // 2. Retirer les descripteurs (fillers), de droite à gauche, en préservant
  //    le premier mot et toute quantité.
  for (let i = kept.length - 1; i >= 1 && join(kept).length > cap; i--) {
    if (FILLERS.has(kept[i].toLowerCase()) && !isQuantity(kept[i])) {
      kept.splice(i, 1);
    }
  }
  if (join(kept).length <= cap) return join(kept);

  // 3. Retirer les mots du milieu (jamais le premier, jamais la quantité finale),
  //    de droite à gauche.
  const lastIsQty = isQuantity(kept[kept.length - 1]);
  const tail = lastIsQty ? [kept[kept.length - 1]] : [];
  const head = lastIsQty ? kept.slice(0, -1) : kept.slice();
  while (head.length > 1 && join([...head, ...tail]).length > cap) {
    head.pop();
  }
  let out = join([...head, ...tail]);

  // 4. Dernier recours : coupe dure (mot unique plus long que la limite).
  if (out.length > cap) out = out.slice(0, cap).trimEnd();
  return out;
}

/** Une proposition n'écrase jamais une saisie manuelle non vide différente. */
export function shouldAutoFillShortName(current: string, lastSuggestion: string): boolean {
  const c = (current || '').trim();
  return c === '' || c === lastSuggestion.trim();
}
