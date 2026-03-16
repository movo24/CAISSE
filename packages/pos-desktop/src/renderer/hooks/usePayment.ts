import { useState, useCallback, useRef, useEffect } from 'react';
import { usePOSStore } from '../stores/posStore';
import { salesApi } from '../services/api';
import { usePerformanceStore } from '../stores/performanceStore';
import { posEventBus } from '../services/posEventBus';
import { peripheralBridge, TicketData } from '../services/peripheralBridge';

/* ── Types ── */

export type PaymentMethod = 'cash' | 'card' | 'mixed';

export interface PartialPayment {
  id: string;
  method: PaymentMethod;
  amountMinorUnits: number;
}

export interface ConfirmationData {
  ticketNumber: string;
  total: number;
  method: PaymentMethod;
  payments: PartialPayment[];
  changeAmount: number;
  itemCount: number;
  cashierName: string;
  timestamp: Date;
}

const TICKET_TIMEOUT_MS = 7000;

export function usePayment() {
  const store = usePOSStore();

  // Split payment state
  const [partialPayments, setPartialPayments] = useState<PartialPayment[]>([]);
  const [splitAmountInput, setSplitAmountInput] = useState('');
  const splitInputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);

  // Transaction speed tracking
  const [transactionStart, setTransactionStart] = useState<number | null>(null);
  const [lastTransactionTime, setLastTransactionTime] = useState<number | null>(null);

  // Confirmation overlay
  const [confirmation, setConfirmation] = useState<ConfirmationData | null>(null);
  const confirmationRef = useRef<ConfirmationData | null>(null);
  const [ticketCountdown, setTicketCountdown] = useState(TICKET_TIMEOUT_MS / 1000);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // TPE waiting state
  const [tpeWaiting, setTpeWaiting] = useState<{
    amountMinorUnits: number;
    method: 'card';
    context: 'quick' | 'split';
    startedAt: number;
  } | null>(null);
  const tpeWaitingRef = useRef<typeof tpeWaiting>(null);
  const [tpeCountdown, setTpeCountdown] = useState(25);
  const [tpeResult, setTpeResult] = useState<'success' | 'refused' | 'timeout' | null>(null);
  const tpeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tpeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalPaid = partialPayments.reduce((s, p) => s + p.amountMinorUnits, 0);
  const remaining = store.paymentModalOpen ? store.total() - totalPaid : 0;

  // Focus split input when payment modal opens
  useEffect(() => {
    if (store.paymentModalOpen) {
      setTimeout(() => splitInputRef.current?.focus(), 150);
    } else {
      setPartialPayments([]);
      setSplitAmountInput('');
    }
  }, [store.paymentModalOpen, partialPayments.length]);

  // Track transaction start when first item added
  useEffect(() => {
    if (store.cartItems.length === 1 && !transactionStart) {
      setTransactionStart(Date.now());
    }
    if (store.cartItems.length === 0) {
      setTransactionStart(null);
    }
  }, [store.cartItems.length, transactionStart]);

  /* ── Confirmation overlay logic ── */

  const completeTransaction = useCallback((ticketChoice?: 'paper' | 'digital' | 'none') => {
    const currentConfirmation = confirmationRef.current;
    if (currentConfirmation) {
      const choice = ticketChoice || (currentConfirmation.method === 'cash' ? 'paper' : 'none');
      console.log(`[POS] Transaction terminee → ticket: ${choice}`, currentConfirmation.ticketNumber);
    }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    setConfirmation(null);
    confirmationRef.current = null;
    setTicketCountdown(TICKET_TIMEOUT_MS / 1000);
    setPartialPayments([]);
    setSplitAmountInput('');
  }, []);

  const handleTicketChoice = useCallback((choice: 'paper' | 'digital' | 'none') => {
    completeTransaction(choice);
  }, [completeTransaction]);

  const dismissConfirmation = useCallback(() => {
    completeTransaction();
  }, [completeTransaction]);

  // Auto-dismiss countdown
  useEffect(() => {
    if (!confirmation) return;
    confirmationRef.current = confirmation;
    setTicketCountdown(TICKET_TIMEOUT_MS / 1000);
    const countdownId = setInterval(() => {
      setTicketCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    countdownRef.current = countdownId;
    const timeoutId = setTimeout(() => completeTransaction(), TICKET_TIMEOUT_MS);
    timeoutRef.current = timeoutId;
    return () => {
      clearInterval(countdownId);
      clearTimeout(timeoutId);
      countdownRef.current = null;
      timeoutRef.current = null;
    };
  }, [confirmation, completeTransaction]);

  /* ── TPE Logic ── */

  const clearTpeTimers = useCallback(() => {
    if (tpeTimerRef.current) { clearInterval(tpeTimerRef.current); tpeTimerRef.current = null; }
    if (tpeTimeoutRef.current) { clearTimeout(tpeTimeoutRef.current); tpeTimeoutRef.current = null; }
  }, []);

  const finalizePayment = useCallback(async (payments: PartialPayment[], changeMinor: number) => {
    setProcessing(true);
    const totalAmount = store.total();
    const itemCount = store.cartItems.reduce((s, i) => s + i.quantity, 0);
    const cashierName = store.employee ? `${store.employee.firstName} ${store.employee.lastName}` : 'Caissier';
    const txTime = transactionStart ? Math.round((Date.now() - transactionStart) / 1000) : 0;
    setLastTransactionTime(txTime);
    const primaryMethod: PaymentMethod = payments.length === 1 ? payments[0].method : 'mixed';
    let ticketNumber = '';
    try {
      const res = await salesApi.create({
        items: store.cartItems.map((i) => ({ ean: i.ean, quantity: i.quantity })),
        customerQrCode: store.customerQrCode || undefined,
        payments: payments.map((p) => ({ method: p.method, amountMinorUnits: p.amountMinorUnits })),
      });
      ticketNumber = res.data.ticketNumber || `T-${Date.now().toString().slice(-6)}`;
      if (res.data.jackpotResult) store.setJackpotResult(res.data.jackpotResult);
      // Emit stock alerts if any were returned by the backend
      if (res.data.stockAlerts && res.data.stockAlerts.length > 0) {
        posEventBus.emit('STOCK_ALERT', { alerts: res.data.stockAlerts });
      }
    } catch (err: any) {
      setProcessing(false);
      // Extract error message from backend response (e.g. "Insufficient stock")
      const message =
        err?.response?.data?.message ||
        err?.response?.data?.details?.[0] ||
        err?.message ||
        'Erreur lors de la vente';
      posEventBus.emit('SALE_ERROR', { message });
      console.error('[POS] Sale failed:', message);
      // Do NOT clear cart — let the cashier fix the issue and retry
      return;
    }
    const timestamp = new Date();
    store.addTicketToHistory({
      ticketNumber, timestamp,
      items: store.cartItems.map((i) => ({ name: i.name, ean: i.ean, quantity: i.quantity, unitPriceMinorUnits: i.unitPriceMinorUnits, discountMinorUnits: i.discountMinorUnits })),
      payments: payments.map((p) => ({ method: p.method, amountMinorUnits: p.amountMinorUnits })),
      totalMinorUnits: totalAmount, subtotalMinorUnits: store.subtotal(), discountMinorUnits: store.totalDiscount(),
      changeMinorUnits: changeMinor, cashierName,
      customerName: store.customer ? `${store.customer.firstName} ${store.customer.lastName}` : undefined,
      reprintCount: 0, reprintLog: [],
    });
    usePerformanceStore.getState().recordTransaction({
      ticketNumber, timestamp: timestamp.toISOString(), totalMinorUnits: totalAmount,
      itemCount, durationSeconds: txTime, paymentMethod: primaryMethod, discountMinorUnits: store.totalDiscount(),
    });
    posEventBus.emit('SALE_COMPLETED', {
      storeId: store.storeInfo?.siret || store.employee?.storeId || 'unknown',
      cashierId: store.employee?.id || 'unknown', cashierName,
      timestamp: timestamp.toISOString(), ticketNumber, totalMinorUnits: totalAmount,
      itemCount, durationSeconds: txTime, paymentMethod: primaryMethod, discountMinorUnits: store.totalDiscount(),
    });
    const confirmData: ConfirmationData = { ticketNumber, total: totalAmount, method: primaryMethod, payments, changeAmount: changeMinor, itemCount, cashierName, timestamp };
    confirmationRef.current = confirmData;
    setConfirmation(confirmData);

    // ── Auto-print ticket via Bluetooth/thermal printer ──
    try {
      const storeInfo = store.storeInfo;
      const ticketData: TicketData = {
        storeName: storeInfo?.storeName || 'CAISSE',
        storeAddress: storeInfo?.address || '',
        siret: storeInfo?.siret || '',
        tvaIntracom: storeInfo?.tvaIntracom || '',
        ticketNumber,
        date: timestamp.toLocaleString('fr-FR'),
        cashierName,
        items: store.cartItems.map(i => ({
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.unitPriceMinorUnits / 100,
          total: (i.unitPriceMinorUnits * i.quantity - (i.discountMinorUnits || 0)) / 100,
          discount: i.discountMinorUnits ? i.discountMinorUnits / 100 : undefined,
        })),
        subtotal: store.subtotal() / 100,
        discount: store.totalDiscount() / 100,
        total: totalAmount / 100,
        payments: payments.map(p => ({
          method: p.method === 'card' ? 'CB' : p.method === 'cash' ? 'Especes' : 'Mixte',
          amount: p.amountMinorUnits / 100,
        })),
        change: changeMinor / 100,
        footer: 'Merci de votre visite !',
        nifCaisse: storeInfo?.nifCaisse || '',
        softwareVersion: '1.0',
      };
      // Fire-and-forget: don't block the confirmation overlay
      peripheralBridge.printTicket(ticketData).catch(() => {});

      // ── Auto-open cash drawer on cash payments ──
      const hasCash = payments.some(p => p.method === 'cash');
      if (hasCash) {
        // Small delay to let print command go first
        setTimeout(() => {
          peripheralBridge.openCashDrawer().catch(() => {});
        }, 500);
      }
    } catch (e) {
      console.warn('[POS] Auto-print/drawer failed:', e);
    }

    store.clearCart();
    setPartialPayments([]);
    setSplitAmountInput('');
    setProcessing(false);
    store.setPaymentModalOpen(false);
  }, [store, transactionStart]);

  const commitPartialPayment = useCallback((method: PaymentMethod, amountMinor: number) => {
    const payment: PartialPayment = { id: `pay-${Date.now()}`, method, amountMinorUnits: amountMinor };
    const newPayments = [...partialPayments, payment];
    const newTotalPaid = newPayments.reduce((s, p) => s + p.amountMinorUnits, 0);
    const ticketTotal = store.total();
    if (newTotalPaid >= ticketTotal) {
      finalizePayment(newPayments, newTotalPaid - ticketTotal);
    } else {
      setPartialPayments(newPayments);
      setSplitAmountInput('');
    }
  }, [partialPayments, store, finalizePayment]);

  const handleTpeResponse = useCallback((result: 'success' | 'refused' | 'timeout') => {
    clearTpeTimers();
    setTpeResult(result);
    const currentTpe = tpeWaitingRef.current;
    if (result === 'success' && currentTpe) {
      const { amountMinorUnits, context } = currentTpe;
      setTimeout(() => {
        setTpeWaiting(null);
        setTpeResult(null);
        tpeWaitingRef.current = null;
        setTimeout(() => {
          if (context === 'quick') {
            const totalAmount = store.total();
            finalizePayment([{ id: `pay-${Date.now()}`, method: 'card', amountMinorUnits: totalAmount }], 0);
          } else {
            commitPartialPayment('card', amountMinorUnits);
          }
        }, 100);
      }, 2000);
    }
  }, [clearTpeTimers, store, finalizePayment, commitPartialPayment]);

  const startTpeWaiting = useCallback((amountMinor: number, context: 'quick' | 'split') => {
    clearTpeTimers();
    const tpeState = { amountMinorUnits: amountMinor, method: 'card' as const, context, startedAt: Date.now() };
    setTpeResult(null);
    setTpeCountdown(25);
    setTpeWaiting(tpeState);
    tpeWaitingRef.current = tpeState;
    tpeTimerRef.current = setInterval(() => {
      setTpeCountdown((prev) => {
        if (prev <= 1) { handleTpeResponse('timeout'); return 0; }
        return prev - 1;
      });
    }, 1000);
    // Real TPE response comes via peripheralBridge event
  }, [clearTpeTimers, handleTpeResponse]);

  const cancelTpeWaiting = useCallback(() => {
    clearTpeTimers();
    setTpeWaiting(null);
    setTpeResult(null);
    tpeWaitingRef.current = null;
  }, [clearTpeTimers]);

  const addPartialPayment = useCallback((method: PaymentMethod) => {
    const inputVal = splitAmountInput.trim().replace(',', '.');
    const parsed = parseFloat(inputVal);
    const amountEuros = (!inputVal || isNaN(parsed) || parsed <= 0) ? remaining / 100 : parsed;
    const amountMinor = Math.round(amountEuros * 100);
    if (amountMinor <= 0) return;
    if (method === 'card') { startTpeWaiting(amountMinor, 'split'); return; }
    commitPartialPayment(method, amountMinor);
  }, [splitAmountInput, remaining, startTpeWaiting, commitPartialPayment]);

  const removePartialPayment = useCallback((id: string) => {
    setPartialPayments((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handleQuickPayment = useCallback((method: PaymentMethod) => {
    const totalAmount = store.total();
    if (method === 'card') { startTpeWaiting(totalAmount, 'quick'); return; }
    finalizePayment([{ id: `pay-${Date.now()}`, method, amountMinorUnits: totalAmount }], 0);
  }, [store, startTpeWaiting, finalizePayment]);

  // Cleanup TPE timers on unmount
  useEffect(() => () => clearTpeTimers(), [clearTpeTimers]);

  return {
    // State
    processing,
    partialPayments,
    splitAmountInput,
    setSplitAmountInput,
    splitInputRef,
    totalPaid,
    remaining,
    lastTransactionTime,

    // Confirmation
    confirmation,
    ticketCountdown,
    TICKET_TIMEOUT_MS,
    completeTransaction,
    handleTicketChoice,
    dismissConfirmation,

    // TPE
    tpeWaiting,
    tpeWaitingRef,
    tpeCountdown,
    tpeResult,
    startTpeWaiting,
    handleTpeResponse,
    cancelTpeWaiting,

    // Actions
    addPartialPayment,
    removePartialPayment,
    handleQuickPayment,
    finalizePayment,
    commitPartialPayment,
  };
}
