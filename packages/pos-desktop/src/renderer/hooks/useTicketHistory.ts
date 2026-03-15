import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { usePOSStore, TicketHistoryEntry } from '../stores/posStore';
import { useRights } from './useRights';

/**
 * Hook for ticket history management.
 * Extracted from POSPage.tsx to be shared between Desktop and iPad layouts.
 *
 * Provides: filtered history, search, time filters, reprint, void, duplicate preview.
 */
export function useTicketHistory() {
  const store = usePOSStore();
  const rights = useRights();

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyFilterTime, setHistoryFilterTime] = useState<'all' | 'last1h' | 'last3h' | 'today'>('all');
  const [confirmPrintTicket, setConfirmPrintTicket] = useState<TicketHistoryEntry | null>(null);
  const [duplicatePreview, setDuplicatePreview] = useState<TicketHistoryEntry | null>(null);
  const historySearchRef = useRef<HTMLInputElement>(null);

  // Focus search when modal opens, reset state when closing
  useEffect(() => {
    if (historyOpen) setTimeout(() => historySearchRef.current?.focus(), 150);
    if (!historyOpen) {
      setConfirmPrintTicket(null);
      setDuplicatePreview(null);
      setHistorySearch('');
      setHistoryFilterTime('all');
    }
  }, [historyOpen]);

  // Filtered history
  const filteredHistory = useMemo(() => {
    let list = store.ticketHistory;
    const now = new Date();

    // Time filter
    if (historyFilterTime === 'last1h') {
      list = list.filter((t) => now.getTime() - new Date(t.timestamp).getTime() < 3600000);
    } else if (historyFilterTime === 'last3h') {
      list = list.filter((t) => now.getTime() - new Date(t.timestamp).getTime() < 10800000);
    } else if (historyFilterTime === 'today') {
      list = list.filter((t) => {
        const d = new Date(t.timestamp);
        return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      });
    }

    // Text search: ticket number, amount, cashier, customer, item names
    if (historySearch.trim()) {
      const q = historySearch.toLowerCase().trim();
      list = list.filter((t) =>
        t.ticketNumber.toLowerCase().includes(q) ||
        (t.totalMinorUnits / 100).toFixed(2).includes(q) ||
        t.cashierName.toLowerCase().includes(q) ||
        (t.customerName && t.customerName.toLowerCase().includes(q)) ||
        t.items.some((i) => i.name.toLowerCase().includes(q)),
      );
    }

    return list;
  }, [store.ticketHistory, historySearch, historyFilterTime]);

  // Handle reprint: log + show duplicate preview
  const handleReprint = useCallback((ticket: TicketHistoryEntry) => {
    if (!rights.canReprintTicket) return;
    const cashierName = store.employee ? `${store.employee.firstName} ${store.employee.lastName}` : 'Caissier';
    store.logReprint(ticket.ticketNumber, cashierName);
    setConfirmPrintTicket(null);
    setDuplicatePreview(ticket);
    console.log(`[DUPLICATA] Reprint logged: ${ticket.ticketNumber} by ${cashierName} at ${new Date().toISOString()}`);
  }, [store, rights.canReprintTicket]);

  // Open history modal
  const openHistory = useCallback(() => {
    setHistoryOpen(true);
  }, []);

  // Close history modal
  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
  }, []);

  // Dismiss sub-modals (Escape handling helper)
  const dismissSubModals = useCallback(() => {
    if (duplicatePreview) { setDuplicatePreview(null); return true; }
    if (confirmPrintTicket) { setConfirmPrintTicket(null); return true; }
    if (historyOpen) { setHistoryOpen(false); return true; }
    return false;
  }, [duplicatePreview, confirmPrintTicket, historyOpen]);

  return {
    // State
    historyOpen,
    historySearch,
    setHistorySearch,
    historyFilterTime,
    setHistoryFilterTime,
    filteredHistory,
    historySearchRef,

    // Reprint / preview
    confirmPrintTicket,
    setConfirmPrintTicket,
    duplicatePreview,
    setDuplicatePreview,
    handleReprint,

    // Actions
    openHistory,
    closeHistory,
    dismissSubModals,
  };
}
