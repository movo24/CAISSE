// ── Couleurs stables par magasin ─────────────────────────────────
// Un magasin garde la même couleur sur toute l'application pendant
// la session (mapping persisté). Palette distincte, lisible sur fond
// clair, adaptée aux courbes superposées.
// ─────────────────────────────────────────────────────────────────

export const STORE_PALETTE = [
  '#7c3aed', // violet (identité)
  '#0ea5e9', // bleu ciel
  '#f59e0b', // ambre
  '#10b981', // émeraude
  '#ef4444', // rouge
  '#8b5cf6', // violet clair
  '#0d9488', // sarcelle
  '#d946ef', // fuchsia
  '#84cc16', // citron vert
  '#f97316', // orange
  '#3b82f6', // bleu
  '#a16207', // brun doré
];

export const NETWORK_AVG_COLOR = '#64748b'; // gris ardoise, pointillés

const KEY = 'pilotage:storeColors';

function loadMap(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** Couleur stable d'un magasin (assignée au premier usage, persistée). */
export function storeColor(storeId: string): string {
  const map = loadMap();
  if (map[storeId] === undefined) {
    const used = new Set(Object.values(map).map((i) => i % STORE_PALETTE.length));
    let idx = 0;
    while (used.has(idx % STORE_PALETTE.length) && idx < STORE_PALETTE.length) idx++;
    map[storeId] = Object.keys(map).length ? idx : 0;
    // Réassignation simple : index d'arrivée si la palette est saturée.
    if (idx >= STORE_PALETTE.length) map[storeId] = Object.keys(map).length;
    try {
      localStorage.setItem(KEY, JSON.stringify(map));
    } catch {
      /* non bloquant */
    }
  }
  return STORE_PALETTE[map[storeId] % STORE_PALETTE.length];
}
