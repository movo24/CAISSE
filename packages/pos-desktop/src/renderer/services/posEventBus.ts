/* ═══════════════════════════════════════════════════════════════
   POS EVENT BUS — Pub/sub interne type-safe
   Decouple les modules : encaissement, staffing IA, pointage
   ═══════════════════════════════════════════════════════════════ */

// ── Event definitions ──

import type { PaymentMethod } from './paymentMachine';

export interface SaleCompletedPayload {
  storeId: string;
  cashierId: string;
  cashierName: string;
  timestamp: string;        // ISO 8601
  ticketNumber: string;
  totalMinorUnits: number;
  itemCount: number;
  durationSeconds: number;
  paymentMethod: PaymentMethod;
  discountMinorUnits: number;
}

export interface SessionOpenedPayload {
  storeId: string;
  cashierId: string;
  cashierName: string;
  timestamp: string;
}

export interface SessionClosedPayload {
  storeId: string;
  cashierId: string;
  cashierName: string;
  timestamp: string;
  reason: 'manual_logout' | 'inactivity_timeout' | 'shift_end';
}

export interface VoidCompletedPayload {
  storeId: string;
  cashierId: string;
  ticketNumber: string;
  amountMinorUnits: number;
  timestamp: string;
}

export interface StockAlertPayload {
  alerts: {
    productId: string;
    productName: string;
    ean: string;
    remainingStock: number;
    /**
     * `negative_stock` (chantier 4) : vente autorisée malgré indisponibilité —
     * avertissement NON bloquant, l'anomalie est transmise au BackOffice.
     */
    level: 'alert' | 'critical' | 'out_of_stock' | 'negative_stock';
    message: string;
  }[];
}

export interface SaleErrorPayload {
  message: string;
}

export interface SaleOfflinePayload {
  ticketNumber: string;
  pendingCount: number;
}

export interface PosEventMap {
  SALE_COMPLETED: SaleCompletedPayload;
  SALE_ERROR: SaleErrorPayload;
  SALE_OFFLINE: SaleOfflinePayload;
  SESSION_OPENED: SessionOpenedPayload;
  SESSION_CLOSED: SessionClosedPayload;
  VOID_COMPLETED: VoidCompletedPayload;
  STOCK_ALERT: StockAlertPayload;
}

// ── Event Bus ──

type Listener<T> = (payload: T) => void;

class PosEventBus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private listeners: Record<string, Set<Listener<any>>> = {};

  on<K extends keyof PosEventMap>(event: K, listener: Listener<PosEventMap[K]>): () => void {
    const key = event as string;
    if (!this.listeners[key]) {
      this.listeners[key] = new Set();
    }
    this.listeners[key].add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners[key]?.delete(listener);
    };
  }

  emit<K extends keyof PosEventMap>(event: K, payload: PosEventMap[K]): void {
    const key = event as string;
    const handlers = this.listeners[key];
    if (!handlers || handlers.size === 0) return;

    handlers.forEach((fn) => {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[EVENT_BUS] Error in ${event} handler:`, err);
      }
    });
  }

  off<K extends keyof PosEventMap>(event: K): void {
    delete this.listeners[event as string];
  }

  clear(): void {
    this.listeners = {};
  }

  listenerCount<K extends keyof PosEventMap>(event: K): number {
    return this.listeners[event as string]?.size || 0;
  }
}

// Singleton export
export const posEventBus = new PosEventBus();
