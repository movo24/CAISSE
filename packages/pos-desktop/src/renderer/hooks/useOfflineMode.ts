import { useEffect, useCallback } from 'react';
import { useOfflineStore } from '../stores/offlineStore';
import { usePOSStore, TicketHistoryEntry } from '../stores/posStore';
import { startNetworkWatcher, stopNetworkWatcher, triggerManualSync } from '../services/syncEngine';

/* ═══════════════════════════════════════════════════════════════
   useOfflineMode — Hook principal pour le mode offline-first
   Gère : détection réseau, enqueue tickets, fraud guards,
   stock local, formatage UI
   ═══════════════════════════════════════════════════════════════ */

export function useOfflineMode() {
  const offline = useOfflineStore();
  const pos = usePOSStore();

  // ── Lifecycle: start/stop network watcher ──
  useEffect(() => {
    startNetworkWatcher();
    return () => stopNetworkWatcher();
  }, []);

  // ── Is currently offline? ──
  const isOffline = offline.networkStatus === 'offline';
  const isDegraded = offline.networkStatus === 'degraded';

  // ── Offline duration (human readable) ──
  const offlineDuration = useCallback((): string => {
    if (!offline.offlineSince) return '';
    const ms = Date.now() - new Date(offline.offlineSince).getTime();
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}min`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}min`;
  }, [offline.offlineSince]);

  // ── Enqueue a completed ticket (works offline) ──
  const enqueueTicket = useCallback(
    (ticket: TicketHistoryEntry, stockDecrements: { productId: string; qty: number }[]) => {
      const cashier = pos.employee;
      const storeId = pos.storeInfo?.siret || 'unknown';

      // 1. Check ticket amount limit
      const limitCheck = offline.checkTicketLimit(ticket.totalMinorUnits);
      if (!limitCheck.allowed) {
        return { success: false, reason: limitCheck.reason };
      }

      // 2. Enqueue the ticket
      const ticketId = offline.enqueue({
        type: 'ticket',
        payload: {
          ticketNumber: ticket.ticketNumber,
          timestamp: ticket.timestamp,
          items: ticket.items,
          payments: ticket.payments,
          totalMinorUnits: ticket.totalMinorUnits,
          subtotalMinorUnits: ticket.subtotalMinorUnits,
          discountMinorUnits: ticket.discountMinorUnits,
          changeMinorUnits: ticket.changeMinorUnits,
          cashierName: ticket.cashierName,
          customerName: ticket.customerName,
        },
        cashierId: cashier?.id || 'unknown',
        cashierName: cashier ? `${cashier.firstName} ${cashier.lastName}` : 'Inconnu',
        storeId,
      });

      // 3. Enqueue each payment
      ticket.payments.forEach((p) => {
        offline.enqueue({
          type: 'payment',
          payload: {
            ticketNumber: ticket.ticketNumber,
            ticketId,
            method: p.method,
            amountMinorUnits: p.amountMinorUnits,
          },
          cashierId: cashier?.id || 'unknown',
          cashierName: cashier ? `${cashier.firstName} ${cashier.lastName}` : 'Inconnu',
          storeId,
        });
      });

      // 4. Enqueue stock decrements
      stockDecrements.forEach((dec) => {
        offline.enqueue({
          type: 'stock_movement',
          payload: {
            productId: dec.productId,
            delta: -dec.qty,
            ticketNumber: ticket.ticketNumber,
            reason: 'sale',
          },
          cashierId: cashier?.id || 'unknown',
          cashierName: cashier ? `${cashier.firstName} ${cashier.lastName}` : 'Inconnu',
          storeId,
        });
        // Decrement local cache
        offline.decrementLocalStock(dec.productId, dec.qty);
      });

      // 5. Reset consecutive voids (a sale happened) + increment daily ticket count
      if (cashier?.id) {
        offline.resetConsecutiveVoids(cashier.id);
      }

      console.log(`[OFFLINE] Ticket ${ticket.ticketNumber} enqueued (${isOffline ? 'OFFLINE' : 'ONLINE'})`);
      return { success: true, queueId: ticketId };
    },
    [pos.employee, pos.storeInfo, isOffline, offline],
  );

  // ── Enqueue a void/annulation (with fraud guard) ──
  const enqueueVoid = useCallback(
    (ticketNumber: string, reason: string) => {
      const cashier = pos.employee;
      const cashierId = cashier?.id || 'unknown';
      const storeId = pos.storeInfo?.siret || 'unknown';

      // Fraud guard check
      const voidCheck = offline.trackVoid(cashierId);
      if (!voidCheck.allowed) {
        return { success: false, reason: voidCheck.reason };
      }

      offline.enqueue({
        type: 'void',
        payload: { ticketNumber, reason, cancelledAt: new Date().toISOString() },
        cashierId,
        cashierName: cashier ? `${cashier.firstName} ${cashier.lastName}` : 'Inconnu',
        storeId,
      });

      console.log(`[OFFLINE] Void enqueued: ${ticketNumber} (guard: ${voidCheck.allowed})`);
      return { success: true };
    },
    [pos.employee, pos.storeInfo, offline],
  );

  // ── Enqueue a cash refund (with fraud guard) ──
  const enqueueCashRefund = useCallback(
    (ticketNumber: string, amountMinorUnits: number, reason: string) => {
      const cashier = pos.employee;
      const cashierId = cashier?.id || 'unknown';
      const storeId = pos.storeInfo?.siret || 'unknown';

      // Fraud guard check
      const refundCheck = offline.trackCashRefund(cashierId, amountMinorUnits);
      if (!refundCheck.allowed) {
        return { success: false, reason: refundCheck.reason };
      }

      offline.enqueue({
        type: 'return',
        payload: { ticketNumber, amountMinorUnits, reason, method: 'cash', returnedAt: new Date().toISOString() },
        cashierId,
        cashierName: cashier ? `${cashier.firstName} ${cashier.lastName}` : 'Inconnu',
        storeId,
      });

      console.log(`[OFFLINE] Cash refund enqueued: ${ticketNumber} (${(amountMinorUnits / 100).toFixed(2)}€)`);
      return { success: true };
    },
    [pos.employee, pos.storeInfo, offline],
  );

  // ── Payment availability helpers ──
  const canPayByCash = offline.paymentAvailability.cash;
  const canPayByCard = offline.paymentAvailability.card;
  const canPayByQR = offline.paymentAvailability.qr;
  const canPayByWallet = offline.paymentAvailability.wallet;

  // ── Actions blocked in offline mode ──
  const isActionBlocked = useCallback(
    (action: 'create_user' | 'modify_global_price' | 'generate_report' | 'modify_promo'): boolean => {
      if (!isOffline) return false;
      // These actions always require the server
      return ['create_user', 'modify_global_price', 'generate_report', 'modify_promo'].includes(action);
    },
    [isOffline],
  );

  return {
    // State
    isOffline,
    isDegraded,
    networkStatus: offline.networkStatus,
    pendingCount: offline.pendingCount,
    syncedCount: offline.syncedCount,
    conflictCount: offline.conflictCount,
    isSyncing: offline.isSyncing,
    syncProgress: offline.syncProgress,
    lastSyncAt: offline.lastSyncAt,
    offlineSince: offline.offlineSince,
    offlineDuration,
    syncErrors: offline.syncErrors,

    // Payment
    canPayByCash,
    canPayByCard,
    canPayByQR,
    canPayByWallet,
    paymentAvailability: offline.paymentAvailability,
    tpeConfig: offline.tpeConfig,

    // Actions
    enqueueTicket,
    enqueueVoid,
    enqueueCashRefund,
    triggerManualSync,
    isActionBlocked,

    // Fraud
    fraudGuard: offline.fraudGuard,
    cashierTrackers: offline.cashierTrackers,

    // Queue access
    queue: offline.queue,
    getPendingEntries: offline.getPendingEntries,
    conflicts: offline.conflicts,
  };
}
