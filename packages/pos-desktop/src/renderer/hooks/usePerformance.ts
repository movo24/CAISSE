import { useCallback } from 'react';
import { usePerformanceStore } from '../stores/performanceStore';

/* ═══════════════════════════════════════════════════════════════
   usePerformance — Hook de tracking silencieux
   Pas d'UI intrusive côté POS, juste des fonctions d'enregistrement
   et des computed prêts à l'emploi pour le backoffice
   ═══════════════════════════════════════════════════════════════ */

export function usePerformance() {
  const session = usePerformanceStore((s) => s.session);
  const store = usePerformanceStore.getState;

  // ── Actions ──

  const initSession = useCallback((employeeId: string, employeeName: string, storeId: string) => {
    store().initSession(employeeId, employeeName, storeId);
  }, []);

  const recordTransaction = useCallback((data: {
    ticketNumber: string;
    totalMinorUnits: number;
    itemCount: number;
    durationSeconds: number;
    paymentMethod: 'cash' | 'card' | 'mixed';
    discountMinorUnits: number;
  }) => {
    store().recordTransaction({
      ticketNumber: data.ticketNumber,
      timestamp: new Date().toISOString(),
      totalMinorUnits: data.totalMinorUnits,
      itemCount: data.itemCount,
      durationSeconds: data.durationSeconds,
      paymentMethod: data.paymentMethod,
      discountMinorUnits: data.discountMinorUnits,
    });
  }, []);

  const recordVoid = useCallback((ticketNumber: string, amountMinorUnits: number) => {
    store().recordVoid(ticketNumber, amountMinorUnits);
  }, []);

  const flushSession = useCallback(() => {
    store().flushToSyncQueue();
  }, []);

  const clearSession = useCallback(() => {
    store().clearSession();
  }, []);

  // ── Computed (live) ──

  const isActive = session !== null;
  const ticketCount = session?.ticketCount ?? 0;
  const totalRevenue = session?.totalRevenue ?? 0;
  const voidCount = session?.voidCount ?? 0;

  const avgBasket = store().getAverageBasket();
  const avgSpeed = store().getAverageSpeed();
  const itemsPerMinute = store().getItemsPerMinute();
  const ticketsPerHour = store().getTicketsPerHour();
  const revenuePerHour = store().getRevenuePerHour();
  const voidRate = store().getVoidRate();

  // ── Formatted strings ──

  const formattedRevenue = `${(totalRevenue / 100).toFixed(2).replace('.', ',')} €`;
  const formattedAvgBasket = `${(avgBasket / 100).toFixed(2).replace('.', ',')} €`;
  const formattedAvgSpeed = avgSpeed > 0
    ? avgSpeed >= 60
      ? `${Math.floor(avgSpeed / 60)}min ${avgSpeed % 60}s`
      : `${avgSpeed}s`
    : '--';
  const formattedRevenuePerHour = `${(revenuePerHour / 100).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €/h`;

  return {
    // State
    isActive,
    session,
    ticketCount,
    totalRevenue,
    voidCount,

    // Computed
    avgBasket,
    avgSpeed,
    itemsPerMinute,
    ticketsPerHour,
    revenuePerHour,
    voidRate,

    // Formatted
    formattedRevenue,
    formattedAvgBasket,
    formattedAvgSpeed,
    formattedRevenuePerHour,

    // Actions
    initSession,
    recordTransaction,
    recordVoid,
    flushSession,
    clearSession,
  };
}
