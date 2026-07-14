// ── Sélection multi-magasins (persistante) ───────────────────────
// La sélection est conservée entre les écrans et entre les sessions
// (localStorage) ; elle n'est réinitialisée que sur demande explicite
// (« Réinitialiser la comparaison »). Aucune donnée sensible : des
// identifiants de magasins uniquement.
// ─────────────────────────────────────────────────────────────────

import { create } from 'zustand';

const KEY = 'pilotage:selection';
const FAV_KEY = 'pilotage:favorites';

function load(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
const save = (key: string, ids: string[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* quota — non bloquant */
  }
};

interface SelectionState {
  /** Magasins sélectionnés pour la comparaison (ordre = ordre d'ajout). */
  storeIds: string[];
  /** Superposer la moyenne réseau sur les courbes. */
  showNetworkAvg: boolean;
  /** Favoris locaux (raccourci « Mes magasins favoris »). */
  favorites: string[];
  toggle: (id: string) => void;
  setAll: (ids: string[]) => void;
  clear: () => void;
  swap: () => void;
  setShowNetworkAvg: (v: boolean) => void;
  saveFavorites: () => void;
  applyFavorites: () => void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  storeIds: load(KEY),
  showNetworkAvg: false,
  favorites: load(FAV_KEY),

  toggle: (id) => {
    const cur = get().storeIds;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    save(KEY, next);
    set({ storeIds: next });
  },
  setAll: (ids) => {
    const next = [...new Set(ids)];
    save(KEY, next);
    set({ storeIds: next });
  },
  clear: () => {
    save(KEY, []);
    set({ storeIds: [], showNetworkAvg: false });
  },
  /** Inverse A et B (pertinent quand exactement 2 magasins). */
  swap: () => {
    const cur = get().storeIds;
    if (cur.length === 2) {
      const next = [cur[1], cur[0]];
      save(KEY, next);
      set({ storeIds: next });
    }
  },
  setShowNetworkAvg: (v) => set({ showNetworkAvg: v }),
  saveFavorites: () => {
    const ids = get().storeIds;
    save(FAV_KEY, ids);
    set({ favorites: ids });
  },
  applyFavorites: () => {
    const fav = get().favorites;
    if (fav.length) {
      save(KEY, fav);
      set({ storeIds: fav });
    }
  },
}));
