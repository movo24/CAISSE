import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'caisse_favorites';
const MAX_FAVORITES = 10;
const MAX_RECENTS = 20;

interface FavoriteProduct {
  productId: string;
  name: string;
  ean: string;
  priceMinorUnits: number;
  categoryId?: string | null;
  isPinned: boolean;
  addedAt: number;
}

interface FavoritesData {
  pinned: FavoriteProduct[];
  recents: FavoriteProduct[];
}

function loadFromStorage(): FavoritesData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { pinned: [], recents: [] };
    return JSON.parse(raw);
  } catch {
    return { pinned: [], recents: [] };
  }
}

function saveToStorage(data: FavoritesData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* localStorage full */ }
}

export function useFavorites() {
  const [data, setData] = useState<FavoritesData>(loadFromStorage);

  // Persist on change
  useEffect(() => {
    saveToStorage(data);
  }, [data]);

  const addRecent = useCallback((product: { productId: string; name: string; ean: string; priceMinorUnits: number; categoryId?: string | null }) => {
    setData((prev) => {
      // Don't add if already pinned
      if (prev.pinned.some((p) => p.productId === product.productId)) return prev;
      const recents = [
        { ...product, isPinned: false, addedAt: Date.now() },
        ...prev.recents.filter((p) => p.productId !== product.productId),
      ].slice(0, MAX_RECENTS);
      return { ...prev, recents };
    });
  }, []);

  const toggleFavorite = useCallback((productId: string) => {
    setData((prev) => {
      const inPinned = prev.pinned.find((p) => p.productId === productId);
      if (inPinned) {
        // Unpin
        return {
          pinned: prev.pinned.filter((p) => p.productId !== productId),
          recents: [{ ...inPinned, isPinned: false }, ...prev.recents].slice(0, MAX_RECENTS),
        };
      }
      // Pin from recents
      const fromRecent = prev.recents.find((p) => p.productId === productId);
      if (fromRecent && prev.pinned.length < MAX_FAVORITES) {
        return {
          pinned: [...prev.pinned, { ...fromRecent, isPinned: true }],
          recents: prev.recents.filter((p) => p.productId !== productId),
        };
      }
      return prev;
    });
  }, []);

  // Combined list: pinned first, then recents
  const favorites = [...data.pinned, ...data.recents.slice(0, MAX_FAVORITES - data.pinned.length)];

  return {
    favorites,
    pinnedFavorites: data.pinned,
    recents: data.recents,
    addRecent,
    toggleFavorite,
    isPinned: (productId: string) => data.pinned.some((p) => p.productId === productId),
  };
}
