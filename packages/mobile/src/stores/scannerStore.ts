// ── Scanner Store ────────────────────────────────────────────────
// Session state for inventory & receiving modes
// Items stored in-memory (Map), not persisted (V1)
//
// ALL numbers are sanitized — no NaN can leak to the UI.
// ─────────────────────────────────────────────────────────────────

import { create } from 'zustand';

/** Safely convert any value to an integer, defaulting to 0 */
function safeInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export interface ScannedProduct {
  id: string;
  name: string;
  ean: string;
  categoryId?: string;
  priceMinorUnits: number;
  imageUrl?: string;
  stockQuantity: number;
}

export interface SessionItem {
  product: ScannedProduct;
  counted: number;
  theoretical: number; // stockQuantity at time of first scan
  scannedAt: number;   // timestamp of last scan
}

type SessionType = 'idle' | 'inventory' | 'receiving';

interface ScannerState {
  sessionType: SessionType;
  items: Map<string, SessionItem>;
  startedAt: number | null;

  // Actions
  startSession: (type: 'inventory' | 'receiving') => void;
  addScan: (product: ScannedProduct) => void;
  adjustCount: (productId: string, delta: number) => void;
  setCount: (productId: string, count: number) => void;
  removeItem: (productId: string) => void;
  endSession: () => SessionItem[];
  clearSession: () => void;

  // Computed helpers
  getItems: () => SessionItem[];
  totalItems: () => number;
  totalScans: () => number;
  mismatches: () => SessionItem[];
}

export const useScannerStore = create<ScannerState>((set, get) => ({
  sessionType: 'idle',
  items: new Map(),
  startedAt: null,

  startSession: (type) => {
    set({
      sessionType: type,
      items: new Map(),
      startedAt: Date.now(),
    });
  },

  addScan: (product) => {
    // Sanitize all numeric fields from the API response
    const safeProduct: ScannedProduct = {
      ...product,
      priceMinorUnits: safeInt(product.priceMinorUnits),
      stockQuantity: safeInt(product.stockQuantity),
    };

    set((state) => {
      const items = new Map(state.items);
      const existing = items.get(safeProduct.id);

      if (existing) {
        // Increment count on rescan
        items.set(safeProduct.id, {
          ...existing,
          counted: existing.counted + 1,
          scannedAt: Date.now(),
        });
      } else {
        items.set(safeProduct.id, {
          product: safeProduct,
          counted: 1,
          theoretical: safeProduct.stockQuantity,
          scannedAt: Date.now(),
        });
      }

      return { items };
    });
  },

  adjustCount: (productId, delta) => {
    set((state) => {
      const items = new Map(state.items);
      const item = items.get(productId);
      if (!item) return state;

      const newCount = Math.max(0, safeInt(item.counted) + safeInt(delta));
      items.set(productId, { ...item, counted: newCount });
      return { items };
    });
  },

  setCount: (productId, count) => {
    set((state) => {
      const items = new Map(state.items);
      const item = items.get(productId);
      if (!item) return state;

      items.set(productId, { ...item, counted: Math.max(0, safeInt(count)) });
      return { items };
    });
  },

  removeItem: (productId) => {
    set((state) => {
      const items = new Map(state.items);
      items.delete(productId);
      return { items };
    });
  },

  endSession: () => {
    const items = Array.from(get().items.values());
    set({ sessionType: 'idle', items: new Map(), startedAt: null });
    return items;
  },

  clearSession: () => {
    set({ sessionType: 'idle', items: new Map(), startedAt: null });
  },

  getItems: () => Array.from(get().items.values()),

  totalItems: () => get().items.size,

  totalScans: () => {
    let total = 0;
    for (const item of get().items.values()) {
      total += safeInt(item.counted);
    }
    return total;
  },

  mismatches: () => {
    const result: SessionItem[] = [];
    for (const item of get().items.values()) {
      if (safeInt(item.counted) !== safeInt(item.theoretical)) {
        result.push(item);
      }
    }
    return result;
  },
}));
