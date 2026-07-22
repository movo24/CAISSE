import { useState, useCallback, useRef, useEffect } from 'react';
import { usePOSStore } from '../stores/posStore';
import { salesApi } from '../services/api';
import { validateManualDiscount } from '../services/discount-policy';
import { toWirePayments, toSaleDiscountFields } from '../services/salePayload';
import { newIdempotencyKey } from '../services/idempotency';
import { usePerformanceStore } from '../stores/performanceStore';
import { posEventBus } from '../services/posEventBus';
import { peripheralBridge, TicketData } from '../services/peripheralBridge';
import { buildTicketData } from '../services/salePeripherals';
import { buildTicketUrl, makeTicketQrDataUrl } from '../services/ticketQr';
import { getBrandLogoDataUrl } from '../services/brandLogo';
import { useOfflineStore } from '../stores/offlineStore';
import { computePaymentState, PaymentMethod } from '../services/paymentMachine';
import { getCardPaymentMode, CARD_DISABLED_MESSAGE, CardPaymentMode } from '../services/cardPaymentMode';
import { StripeProvider } from '../payment-engine/providers/stripeProvider';
import {
  getRealPaymentEngine,
  getDemoPaymentEngine,
  cancelAnyActiveCollection,
} from '../payment-engine/engineRegistry';

/* ── Types ── */

export type { PaymentMethod } from '../services/paymentMachine';

export interface PartialPayment {
  id: string;
  method: PaymentMethod;
  amountMinorUnits: number;
  stripePaymentIntentId?: string;
  stripeReaderId?: string;
  terminalId?: string;
  /** For method === 'store_credit': the avoir code being redeemed. */
  creditNoteCode?: string;
  /** Card leg NOT really captured (demo mode) → sale lands payment_pending. */
  pendingCapture?: boolean;
}

/** Capture facts attached to a card leg before it is committed. */
interface CardLegFacts {
  stripePaymentIntentId?: string;
  stripeReaderId?: string;
  pendingCapture?: boolean;
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

const TICKET_TIMEOUT_MS = 30000; // 30s — enough time for customer to scan QR code

export function usePayment() {
  const store = usePOSStore();

  // Split payment state
  const [partialPayments, setPartialPayments] = useState<PartialPayment[]>([]);
  const [splitAmountInput, setSplitAmountInput] = useState('');
  const splitInputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  // One idempotency key per checkout — generated on the first finalize attempt,
  // reused across double-click / network retry / offline fallback, reset after a
  // sale is confirmed. Prevents a double sale / double cash-in on retry.
  const saleIdemKeyRef = useRef<string | null>(null);

  // Transaction speed tracking
  const [transactionStart, setTransactionStart] = useState<number | null>(null);
  const [lastTransactionTime, setLastTransactionTime] = useState<number | null>(null);

  // Honest print outcome for the LAST confirmed sale — shown on the confirmation
  // overlay. 'no_printer' when no real printer is connected (the platform must SAY
  // it cannot print — never pretend), 'print_failed' when the thermal print failed.
  const [lastPrintStatus, setLastPrintStatus] = useState<'printed' | 'print_failed' | 'no_printer' | null>(null);

  // Confirmation overlay
  const [confirmation, setConfirmation] = useState<ConfirmationData | null>(null);
  const confirmationRef = useRef<ConfirmationData | null>(null);
  const [ticketCountdown, setTicketCountdown] = useState(TICKET_TIMEOUT_MS / 1000);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // TPE waiting state — mode 'real' drives the Stripe Terminal (WisePad 3) reader;
  // mode 'demo' is the dev-only labelled simulation (leg goes pendingCapture).
  const [tpeWaiting, setTpeWaiting] = useState<{
    amountMinorUnits: number;
    method: 'card';
    context: 'quick' | 'split';
    startedAt: number;
    mode: CardPaymentMode;
    countdownTotal: number;
  } | null>(null);
  const tpeWaitingRef = useRef<typeof tpeWaiting>(null);
  const [tpeCountdown, setTpeCountdown] = useState(25);
  const [tpeResult, setTpeResult] = useState<'success' | 'refused' | 'timeout' | null>(null);
  const [tpeErrorMessage, setTpeErrorMessage] = useState<string | null>(null);
  const tpeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tpeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Facts of the ACTUAL capture (PI id, reader, pendingCapture). A card leg can only
  // be committed when this is set — nothing can fabricate a captured card payment.
  const cardLegRef = useRef<CardLegFacts | null>(null);

  // Payment Engine (P1) : moteurs UNIQUES partagés par toute l'app (registre
  // module) — verrou de ré-entrée, unicité de tentative par vente
  // (anti-double-débit) et journal des transitions communs à tous les écrans.

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
    // Decision 5 mirror: refuse an impossible manual discount before the network.
    const discCheck = validateManualDiscount({
      subtotalMinor: store.subtotal(),
      manualDiscountMinor: store.manualDiscountMinorUnits,
      approverId: store.discountApproverId,
    });
    if (!discCheck.ok) {
      throw new Error(discCheck.reason || 'Remise refusée');
    }
    setProcessing(true);
    setLastPrintStatus(null); // per-sale outcome — never show a stale status
    try {
    const totalAmount = store.total();
    const itemCount = store.cartItems.reduce((s, i) => s + i.quantity, 0);
    const cashierName = store.employee ? `${store.employee.firstName} ${store.employee.lastName}` : 'Caissier';
    const txTime = transactionStart ? Math.round((Date.now() - transactionStart) / 1000) : 0;
    setLastTransactionTime(txTime);
    const primaryMethod: PaymentMethod = payments.length === 1 ? payments[0].method : 'mixed';
    let ticketNumber = '';
    // Stable key for THIS checkout (synchronous ref → a double-click reuses it).
    if (!saleIdemKeyRef.current) saleIdemKeyRef.current = newIdempotencyKey();
    const idempotencyKey = saleIdemKeyRef.current;
    try {
      const res = await salesApi.create({
        items: store.cartItems.map((i) => ({ ean: i.ean, quantity: i.quantity })),
        customerQrCode: store.customerQrCode || undefined,
        // Manual discount (decision 5) + promo (decision 6) — server re-validates.
        ...toSaleDiscountFields(store),
        payments: toWirePayments(payments),
      }, idempotencyKey);
      ticketNumber = res.data.ticketNumber || `T-${Date.now().toString().slice(-6)}`;
      // Confirmed online → next sale gets a fresh key.
      saleIdemKeyRef.current = null;
      // Store sale ID + public token for QR receipt generation
      if (res.data.id) (store as any).lastSaleId = res.data.id;
      (store as any).lastPublicToken = res.data.publicToken || null;
      if (res.data.jackpotResult) store.setJackpotResult(res.data.jackpotResult);
      // Emit stock alerts if any were returned by the backend
      if (res.data.stockAlerts && res.data.stockAlerts.length > 0) {
        posEventBus.emit('STOCK_ALERT', { alerts: res.data.stockAlerts });
      }
    } catch (err: any) {
      // ── Offline fallback: network error → queue locally ──
      const isNetworkError =
        !err?.response || // No response = network down
        err?.code === 'ERR_NETWORK' ||
        err?.code === 'ECONNABORTED' ||
        err?.message?.includes('Network Error');

      if (isNetworkError) {
        console.warn('[POS] Backend unreachable — queuing sale offline');
        const offlineStore = useOfflineStore.getState();

        // Generate local ticket number
        ticketNumber = `OFF-${Date.now().toString(36).toUpperCase()}`;

        // Enqueue ticket for later sync
        offlineStore.enqueue({
          type: 'ticket',
          payload: {
            ticketNumber,
            items: store.cartItems.map((i) => ({ ean: i.ean, quantity: i.quantity, name: i.name, unitPriceMinorUnits: i.unitPriceMinorUnits })),
            // M603: mirror the ONLINE payload so an offline store_credit / card sale syncs
            // faithfully — creditNoteCode + Stripe/terminal refs + discount/promo preserved.
            payments: toWirePayments(payments),
            totalMinorUnits: totalAmount,
            customerQrCode: store.customerQrCode || undefined,
            ...toSaleDiscountFields(store),
            // Carry the SAME key as the failed online attempt: if the create had
            // actually reached the server (response lost), the replay is deduped
            // and no second sale is created.
            idempotencyKey,
          },
          cashierId: store.employee?.id || 'unknown',
          cashierName,
          storeId: store.employee?.storeId || 'unknown',
        });
        // Sale left the online path (queued) → this checkout is done; next is fresh.
        saleIdemKeyRef.current = null;

        // Decrement local stock cache
        store.cartItems.forEach((item) => {
          offlineStore.decrementLocalStock(item.ean, item.quantity);
        });

        posEventBus.emit('SALE_OFFLINE', { ticketNumber, pendingCount: offlineStore.pendingCount + 1 });
        // Continue to confirmation (don't return — sale was accepted locally)
      } else {
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

    // ── Print ticket ONLY if a REAL printer is configured and connected ──
    // Ignore 'browser_print' (opens window.print dialog = bad UX on iPad)
    // Only print on thermal_usb, thermal_bluetooth, or airprint
    const printerStatus = peripheralBridge.status.printer;
    const hasRealPrinter = printerStatus.connected &&
      printerStatus.type !== 'none' &&
      printerStatus.type !== 'browser_print';
    if (!hasRealPrinter) {
      // Platform cannot really print → say so, never pretend (decision produit).
      setLastPrintStatus('no_printer');
    }
    if (hasRealPrinter) {
      try {
        const storeInfo = store.storeInfo as any;
        // QR ticket numérique : base publique (Dashboard) + jeton serveur.
        // Hors ligne / non configuré → note claire, jamais bloquant.
        const qrEnabled = storeInfo?.receiptQrEnabled !== false;
        const lastToken = (store as any).lastPublicToken || null;
        const ticketUrl = qrEnabled ? buildTicketUrl(storeInfo?.receiptPublicBaseUrl, lastToken) : null;
        const qrDataUrl = ticketUrl ? await makeTicketQrDataUrl(ticketUrl) : null;
        const ticketData: TicketData = buildTicketData({
          storeName: storeInfo?.storeName,
          storeAddress: storeInfo?.address,
          addressLine2: [storeInfo?.postalCode, storeInfo?.city].filter(Boolean).join(' ') || undefined,
          operatingCompanyName: storeInfo?.operatingCompanyName || undefined,
          siret: storeInfo?.siret,
          tvaIntracom: storeInfo?.tvaIntracom,
          rcs: storeInfo?.rcs || undefined,
          capitalSocial: storeInfo?.capitalSocial || undefined,
          phone: storeInfo?.phone || undefined,
          website: storeInfo?.websiteUrl || undefined,
          headerMessage: storeInfo?.headerMessage || undefined,
          nifCaisse: storeInfo?.nifCaisse,
          softwareVersion: storeInfo?.softwareVersion || undefined,
          logoDataUrl: storeInfo?.receiptLogoUrl || getBrandLogoDataUrl(),
          ticketNumber,
          date: timestamp,
          cashierName,
          items: store.cartItems.map(i => ({
            name: i.name,
            quantity: i.quantity,
            unitPriceMinorUnits: i.unitPriceMinorUnits,
            discountMinorUnits: i.discountMinorUnits,
            taxRate: i.taxRate,
          })),
          subtotalMinorUnits: store.subtotal(),
          discountMinorUnits: store.totalDiscount(),
          totalMinorUnits: totalAmount,
          payments: payments.map(p => ({ method: p.method, amountMinorUnits: p.amountMinorUnits })),
          changeMinorUnits: changeMinor,
          footer: storeInfo?.footerMessage || undefined,
          finalMessage: storeInfo?.receiptFinalMessage || undefined,
          qrDataUrl,
          qrContent: qrDataUrl ? ticketUrl : null,
          qrText: qrDataUrl
            ? storeInfo?.receiptQrText || 'Scannez pour retrouver votre ticket et découvrir nos nouveautés'
            : undefined,
          offlineNote:
            qrEnabled && !lastToken ? 'Ticket numérique disponible après synchronisation' : undefined,
        });
        // Auto-print: NO browser-dialog fallback — a failed thermal print must
        // surface as "non imprimé", not silently pretend success.
        peripheralBridge.printTicket(ticketData, { allowBrowserFallback: false })
          .then((ok) => {
            setLastPrintStatus(ok ? 'printed' : 'print_failed');
            if (!ok) console.warn('[POS] Ticket NON imprimé — échec imprimante (réimpression possible depuis l\'historique)');
          })
          .catch((err) => {
            setLastPrintStatus('print_failed');
            console.warn('[POS] Ticket print failed:', err?.message || err);
          });

        // Auto-open cash drawer on cash payments
        const hasCash = payments.some(p => p.method === 'cash');
        if (hasCash) {
          setTimeout(() => {
            peripheralBridge.openCashDrawer().catch((err) =>
              console.warn('[POS] Cash drawer failed:', err?.message || err));
          }, 500);
        }
      } catch (e) {
        console.warn('[POS] Auto-print failed:', e);
      }
    }
    // No printer → no print attempt, no popup, no blocking

    store.clearCart();
    setPartialPayments([]);
    setSplitAmountInput('');
    store.setPaymentModalOpen(false);
  } catch (fatalErr) {
    // Safety net: if ANYTHING crashes after setProcessing(true),
    // we MUST release the lock. Without this, the POS freezes permanently.
    console.error('[POS] FATAL in finalizePayment:', fatalErr);
    posEventBus.emit('SALE_ERROR', { message: 'Erreur inattendue. Réessayez.' });
  } finally {
    // ALWAYS release processing lock — no matter what happens
    setProcessing(false);
  }
  }, [store, transactionStart]);

  const commitPartialPayment = useCallback((method: PaymentMethod, amountMinor: number, creditNoteCode?: string, cardFacts?: CardLegFacts) => {
    const payment: PartialPayment = { id: `pay-${Date.now()}`, method, amountMinorUnits: amountMinor, creditNoteCode, ...(cardFacts || {}) };
    const newPayments = [...partialPayments, payment];
    const ticketTotal = store.total();
    // Tender state machine: cash change only; voucher/gift-card overpay is forfeited.
    const state = computePaymentState(ticketTotal, newPayments);
    if (state.isCovered) {
      finalizePayment(newPayments, state.changeDue);
    } else {
      setPartialPayments(newPayments);
      setSplitAmountInput('');
    }
  }, [partialPayments, store, finalizePayment]);

  const handleTpeResponse = useCallback((result: 'success' | 'refused' | 'timeout') => {
    clearTpeTimers();
    const currentTpe = tpeWaitingRef.current;
    if (result === 'success') {
      // INVARIANT: a card leg is only committed with capture facts attached
      // (real: PI id + captured; demo: pendingCapture=true). No facts → refuse.
      const facts = cardLegRef.current;
      if (!currentTpe || !facts) {
        cardLegRef.current = null;
        setTpeErrorMessage('Paiement non confirmé par le terminal.');
        setTpeResult('refused');
        return;
      }
      cardLegRef.current = null;
      setTpeResult('success');
      const { amountMinorUnits, context } = currentTpe;
      setTimeout(() => {
        setTpeWaiting(null);
        setTpeResult(null);
        tpeWaitingRef.current = null;
        setTimeout(() => {
          if (context === 'quick') {
            const totalAmount = store.total();
            finalizePayment([{ id: `pay-${Date.now()}`, method: 'card', amountMinorUnits: totalAmount, ...facts }], 0);
          } else {
            commitPartialPayment('card', amountMinorUnits, undefined, facts);
          }
        }, 100);
      }, 2000);
      return;
    }
    cardLegRef.current = null;
    setTpeResult(result);
  }, [clearTpeTimers, store, finalizePayment, commitPartialPayment]);

  const startTpeWaiting = useCallback((amountMinor: number, context: 'quick' | 'split') => {
    clearTpeTimers();
    setTpeResult(null);
    setTpeErrorMessage(null);
    cardLegRef.current = null;
    void (async () => {
      const mode = await getCardPaymentMode();
      if (mode === 'disabled') {
        // Prod without Stripe Terminal config: no flow starts, clear error instead.
        posEventBus.emit('SALE_ERROR', { message: CARD_DISABLED_MESSAGE });
        return;
      }
      const countdownTotal = mode === 'real' ? 120 : 25;
      const tpeState = {
        amountMinorUnits: amountMinor, method: 'card' as const, context,
        startedAt: Date.now(), mode, countdownTotal,
      };
      setTpeCountdown(countdownTotal);
      setTpeWaiting(tpeState);
      tpeWaitingRef.current = tpeState;
      tpeTimerRef.current = setInterval(() => {
        setTpeCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
      }, 1000);

      // Payment Engine (P1) : même moteur quel que soit le fournisseur — verrou
      // de ré-entrée, une tentative active par vente, incertain → vérification.
      const { engine, provider } = mode === 'real' ? getRealPaymentEngine() : getDemoPaymentEngine();
      try {
        if (mode === 'real') {
          const stripe = provider as StripeProvider;
          await stripe.init({ provider: 'stripe' });
          await stripe.connect(); // « Aucun lecteur carte détecté… » si absent
        }
        if (!saleIdemKeyRef.current) saleIdemKeyRef.current = newIdempotencyKey();
        const out = await engine.startPayment({
          saleKey: saleIdemKeyRef.current,
          amountMinorUnits: amountMinor,
          storeId: store.employee?.storeId,
        });
        if (!tpeWaitingRef.current) return; // cashier cancelled meanwhile

        if (out.status === 'APPROVED') {
          // INVARIANT conservé : seuls les faits de capture committent la jambe.
          // claimsCapture=false (mock/manual) → pendingCapture → payment_pending.
          cardLegRef.current = engine.claimsCapture
            ? {
                stripePaymentIntentId: out.result?.providerRef,
                stripeReaderId: (provider as StripeProvider).reader?.id,
                pendingCapture: false,
              }
            : { pendingCapture: true };
          handleTpeResponse('success');
          return;
        }
        if (out.status === 'CANCELLED') return; // overlay déjà fermé par l'annulation
        const message =
          out.result?.errorMessage ||
          (out.status === 'VERIFICATION_REQUIRED'
            ? 'Vérification nécessaire — ne relancez pas ce paiement avant résolution.'
            : out.message);
        setTpeErrorMessage(message);
        handleTpeResponse(out.result?.outcome === 'timeout' ? 'timeout' : 'refused');
      } catch (err: any) {
        // EngineBusyError / AttemptBlockedError / lecteur absent / init SDK.
        if (!tpeWaitingRef.current) return;
        setTpeErrorMessage(err?.message || 'Erreur terminal de paiement');
        handleTpeResponse('refused');
      }
    })();
  }, [clearTpeTimers, store, handleTpeResponse]);

  /**
   * DEV/DEMO ONLY — simulate a card acceptance. The committed leg is flagged
   * pendingCapture=true, so the backend records the sale as payment_pending
   * (à régulariser) — a demo can NEVER produce a "paid" card sale.
   */
  const simulateDemoTpeSuccess = useCallback(() => {
    if (tpeWaitingRef.current?.mode !== 'demo') return;
    // Résout la collecte mock : le moteur renvoie APPROVED (claimsCapture=false)
    // et le flux nominal committe la jambe pendingCapture=true.
    getDemoPaymentEngine().provider.resolveApproved();
  }, []);

  const cancelTpeWaiting = useCallback(() => {
    clearTpeTimers();
    setTpeWaiting(null);
    setTpeResult(null);
    setTpeErrorMessage(null);
    tpeWaitingRef.current = null;
    cardLegRef.current = null;
    // Aborte la collecte en cours (lecteur réel ou mock) — l'attempt du moteur
    // se résout en CANCELLED via le flux nominal, le WisePad se réinitialise.
    void cancelAnyActiveCollection();
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
    lastPrintStatus,
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
    tpeErrorMessage,
    startTpeWaiting,
    handleTpeResponse,
    cancelTpeWaiting,
    simulateDemoTpeSuccess,

    // Actions
    addPartialPayment,
    removePartialPayment,
    handleQuickPayment,
    finalizePayment,
    commitPartialPayment,
  };
}
