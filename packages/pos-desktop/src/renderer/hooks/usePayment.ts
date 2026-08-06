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
import { resolveReceiptLogo } from '../services/brandLogo';
import { useOfflineStore } from '../stores/offlineStore';
import {
  allocateTender,
  assertPaymentsApplied,
  computePaymentState,
  evaluateChangeApproval,
  DEFAULT_CHANGE_POLICY,
  type ChangeApprovalPolicy,
  type TenderAllocation,
  PaymentMethod,
} from '../services/paymentMachine';
import { useStripeTerminal } from './useStripeTerminal';
import { getCardPaymentMode, CARD_DISABLED_MESSAGE, CardPaymentMode } from '../services/cardPaymentMode';

/* ── Types ── */

export type { PaymentMethod } from '../services/paymentMachine';

export interface PartialPayment {
  id: string;
  method: PaymentMethod;
  /** Montant APPLIQUÉ au ticket — jamais > reste dû (P0 : ≠ espèces reçues). */
  amountMinorUnits: number;
  /** Espèces physiquement reçues (cash ; = appliqué sinon). Mouvement de caisse distinct. */
  cashReceivedMinorUnits?: number;
  /** Monnaie à rendre pour ce tender (cash) — jamais un remboursement client. */
  changeMinorUnits?: number;
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
  /** Verrou SYNCHRONE de finalisation (un état React arriverait trop tard). */
  const finalizingRef = useRef(false);
  /** Refus d'allocation / garde comptable / monnaie — affiché, jamais avalé. */
  const [tenderError, setTenderError] = useState('');

  /** Seuils de monnaie du magasin, repli sur la politique par défaut.
   *  Identique à POSPage : une seule règle pour les deux chemins. */
  const changePolicy = useCallback((): ChangeApprovalPolicy => {
    const si = store.storeInfo as any;
    return {
      managerThresholdMinorUnits: Number.isFinite(si?.changeManagerThresholdMinorUnits)
        ? si.changeManagerThresholdMinorUnits
        : DEFAULT_CHANGE_POLICY.managerThresholdMinorUnits,
      hardBlockMinorUnits: Number.isFinite(si?.changeHardBlockMinorUnits)
        ? si.changeHardBlockMinorUnits
        : DEFAULT_CHANGE_POLICY.hardBlockMinorUnits,
    };
  }, [store]);

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

  const stripeTerminal = useStripeTerminal();

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
    // Garde SYNCHRONE de ré-entrée : `processing` est un état React, appliqué au
    // re-render suivant — deux taps rapprochés passaient au travers et
    // produisaient 2 tickets, 2 CA locaux, 2 impressions, 2 ouvertures tiroir.
    if (finalizingRef.current) return;
    finalizingRef.current = true;

    // GARDE COMPTABLE (P0) : la somme des montants APPLIQUÉS doit solder le
    // ticket au centime. Elle existait sur POSPage et manquait ici — c'est ce
    // trou qui laissait partir un sur-paiement au backend.
    try {
      assertPaymentsApplied(store.total(), payments);
    } catch (e) {
      finalizingRef.current = false;
      setTenderError(e instanceof Error ? e.message : 'Répartition des paiements incohérente.');
      throw e;
    }

    // Monnaie aberrante → validation manager ou blocage (jamais en silence).
    const changeSum = payments.reduce((sum, p) => sum + (p.changeMinorUnits ?? 0), 0);
    if (changeSum > 0) {
      const approval = evaluateChangeApproval(changeSum, changePolicy());
      if (approval.decision !== 'ok') {
        finalizingRef.current = false;
        setTenderError(approval.reason || 'Monnaie à rendre inhabituelle — validation requise.');
        return;
      }
    }
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

        // Chantier 4 — même hors ligne, la vente n'est JAMAIS bloquée par le
        // stock : si le cache local passe en négatif, on informe le vendeur
        // sans bloquer. L'anomalie de stock est créée côté serveur à la
        // resynchronisation (même vente, même clé d'idempotence — pas de
        // doublon possible).
        const localCache = useOfflineStore.getState().localStockCache;
        const negativeLocal = store.cartItems
          .filter((item) => (localCache[item.ean] ?? 0) < 0)
          .map((item) => ({
            productId: item.ean,
            productName: item.name,
            ean: item.ean,
            remainingStock: localCache[item.ean] ?? 0,
            level: 'negative_stock' as const,
            message:
              `${item.name} : produit indisponible dans le stock informatique. ` +
              `Vente autorisée, anomalie transmise au BackOffice à la synchronisation. ` +
              `Nouveau stock : ${localCache[item.ean] ?? 0}.`,
          }));
        if (negativeLocal.length > 0) {
          posEventBus.emit('STOCK_ALERT', { alerts: negativeLocal });
        }

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
          logoDataUrl: resolveReceiptLogo(storeInfo?.receiptLogoUrl),
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
    finalizingRef.current = false;
    setProcessing(false);
  }
  }, [store, transactionStart, changePolicy]);

  /**
   * Ajoute un tender DÉJÀ ALLOUÉ (appliqué / reçu / monnaie séparés).
   * Signature alignée sur POSPage : c'est `allocateTender` qui décide, jamais
   * l'appelant — sinon le montant SAISI repart au backend comme montant IMPUTÉ.
   */
  const commitPartialPayment = useCallback((alloc: TenderAllocation, creditNoteCode?: string, cardFacts?: CardLegFacts) => {
    const payment: PartialPayment = {
      id: `pay-${Date.now()}`,
      method: alloc.method,
      amountMinorUnits: alloc.appliedMinorUnits,
      cashReceivedMinorUnits: alloc.cashReceivedMinorUnits,
      changeMinorUnits: alloc.changeMinorUnits,
      creditNoteCode,
      ...(cardFacts || {}),
    };
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

  /**
   * Ajoute un tender à partir d'un MONTANT SAISI (espèces reçues pour cash,
   * appliqué sinon). Point d'entrée UNIQUE pour l'interface : l'allocation est
   * faite ici, jamais par l'appelant. Un refus est affiché, jamais avalé.
   */
  const commitByAmount = useCallback((method: PaymentMethod, requestedMinor: number, creditNoteCode?: string) => {
    setTenderError('');
    const alloc = allocateTender(remaining, method, requestedMinor);
    if (!alloc.ok) { setTenderError(alloc.reason); return; }
    commitPartialPayment(alloc.allocation, creditNoteCode);
  }, [remaining, commitPartialPayment]);

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
            // Le montant CAPTURÉ par le TPE fait foi — surtout pas une relecture
            // de `store.total()` 2,1 s plus tard : le panier a pu changer entre
            // la capture et ce callback, la vente ne correspondrait plus au débit.
            finalizePayment(
              [{ id: `pay-${Date.now()}`, method: 'card', amountMinorUnits, cashReceivedMinorUnits: amountMinorUnits, changeMinorUnits: 0, ...facts }],
              0,
            );
          } else {
            commitPartialPayment(
              { method: 'card', appliedMinorUnits: amountMinorUnits, cashReceivedMinorUnits: amountMinorUnits, changeMinorUnits: 0 },
              undefined,
              facts,
            );
          }
        }, 100);
      }, 2000);
      return;
    }
    cardLegRef.current = null;
    setTpeResult(result);
  }, [clearTpeTimers, finalizePayment, commitPartialPayment]);

  /** Ensure the SDK is up and a reader connected (auto-connects a single reader). */
  const ensureReaderConnected = useCallback(async () => {
    if (stripeTerminal.isReady) return;
    const readers: any[] = await stripeTerminal.initTerminal();
    if (!readers || readers.length === 0) {
      throw new Error('Aucun lecteur carte détecté. Vérifiez que le WisePad 3 est allumé et connecté au réseau.');
    }
    await stripeTerminal.connectReader(readers[0]);
  }, [stripeTerminal]);

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

      if (mode === 'real') {
        try {
          await ensureReaderConnected();
          // Tie the PaymentIntent to THIS checkout: the sale idempotency key is the
          // reference, so a retried PI create dedupes server-side (deterministic key).
          if (!saleIdemKeyRef.current) saleIdemKeyRef.current = newIdempotencyKey();
          const { paymentIntentId } = await stripeTerminal.collectPayment(amountMinor, saleIdemKeyRef.current);
          if (!tpeWaitingRef.current) return; // cashier cancelled meanwhile
          cardLegRef.current = {
            stripePaymentIntentId: paymentIntentId,
            stripeReaderId: stripeTerminal.connectedReader?.id,
            pendingCapture: false,
          };
          handleTpeResponse('success');
        } catch (err: any) {
          if (!tpeWaitingRef.current) return; // cancelled — reader flow already aborted
          setTpeErrorMessage(err?.message || 'Erreur terminal de paiement');
          handleTpeResponse('refused');
        }
      } else {
        // Demo (dev builds only): explicit simulate button; auto-timeout otherwise.
        tpeTimeoutRef.current = setTimeout(() => handleTpeResponse('timeout'), countdownTotal * 1000);
      }
    })();
  }, [clearTpeTimers, ensureReaderConnected, stripeTerminal, handleTpeResponse]);

  /**
   * DEV/DEMO ONLY — simulate a card acceptance. The committed leg is flagged
   * pendingCapture=true, so the backend records the sale as payment_pending
   * (à régulariser) — a demo can NEVER produce a "paid" card sale.
   */
  const simulateDemoTpeSuccess = useCallback(() => {
    if (tpeWaitingRef.current?.mode !== 'demo') return;
    cardLegRef.current = { pendingCapture: true };
    handleTpeResponse('success');
  }, [handleTpeResponse]);

  const cancelTpeWaiting = useCallback(() => {
    clearTpeTimers();
    setTpeWaiting(null);
    setTpeResult(null);
    setTpeErrorMessage(null);
    tpeWaitingRef.current = null;
    cardLegRef.current = null;
    // Abort an in-progress reader collection so the WisePad screen resets.
    if (stripeTerminal.isCollecting) void stripeTerminal.cancelCollect();
  }, [clearTpeTimers, stripeTerminal]);

  const addPartialPayment = useCallback((method: PaymentMethod) => {
    setTenderError('');
    const inputVal = splitAmountInput.trim().replace(',', '.');
    const parsed = parseFloat(inputVal);
    // Vide/0 → non-espèces : tout le reste ; espèces : reçu exactement le reste.
    const amountEuros = (!inputVal || isNaN(parsed) || parsed <= 0) ? remaining / 100 : parsed;
    const requestedMinor = Math.round(amountEuros * 100);

    // Allocation SÉPARÉE : appliqué plafonné au reste dû, espèces reçues à part,
    // dépassement REFUSÉ hors espèces. Sans cela, saisir 20 € sur un ticket de
    // 17,50 € imputait 20 € au ticket → 400 backend, ou vente perdue hors ligne.
    const alloc = allocateTender(remaining, method, requestedMinor);
    if (!alloc.ok) { setTenderError(alloc.reason); return; }

    if (method === 'card') {
      // CB → attente TPE sur le montant APPLIQUÉ (carte = jamais de dépassement).
      startTpeWaiting(alloc.allocation.appliedMinorUnits, 'split');
      return;
    }
    commitPartialPayment(alloc.allocation);
  }, [splitAmountInput, remaining, startTpeWaiting, commitPartialPayment]);

  const removePartialPayment = useCallback((id: string) => {
    setPartialPayments((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handleQuickPayment = useCallback((method: PaymentMethod) => {
    setTenderError('');
    const totalAmount = store.total();
    if (method === 'card') { startTpeWaiting(totalAmount, 'quick'); return; }
    // Même moteur que le paiement scindé : « tout en espèces » = reçu exactement
    // le total, donc appliqué = total et monnaie = 0. Aucun chemin ne contourne
    // plus l'allocation.
    const alloc = allocateTender(totalAmount, method, totalAmount);
    if (!alloc.ok) { setTenderError(alloc.reason); return; }
    finalizePayment(
      [{
        id: `pay-${Date.now()}`,
        method,
        amountMinorUnits: alloc.allocation.appliedMinorUnits,
        cashReceivedMinorUnits: alloc.allocation.cashReceivedMinorUnits,
        changeMinorUnits: alloc.allocation.changeMinorUnits,
      }],
      alloc.allocation.changeMinorUnits,
    );
  }, [store, startTpeWaiting, finalizePayment]);

  // Cleanup TPE timers on unmount
  useEffect(() => () => clearTpeTimers(), [clearTpeTimers]);

  return {
    // State
    processing,
    /** Refus d'allocation ou garde comptable — à afficher dans l'UI de paiement. */
    tenderError,
    setTenderError,
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
    stripeTerminal,

    // Actions
    addPartialPayment,
    removePartialPayment,
    handleQuickPayment,
    finalizePayment,
    commitByAmount,
  };
}
