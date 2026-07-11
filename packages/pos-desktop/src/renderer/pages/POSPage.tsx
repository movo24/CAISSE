import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, User, ShoppingBag, CreditCard, Banknote, Layers,
  Minus, Plus, X, ChevronDown, LogOut, CheckCircle2,
  ScanBarcode, UserCircle, Weight, Tag, ArrowRight,
  FileText, Smartphone, XCircle, Clock, Trash2, Coins, Split,
  History, RotateCcw, Printer, Receipt, AlertTriangle,
  Camera, Monitor, Tablet, Mail, Loader2, Ticket, Gift,
} from 'lucide-react';
import { usePOSStore } from '../stores/posStore';
import { productsApi, productIntegrationApi, salesApi, customersApi, occupancyApi, receiptsApi } from '../services/api';
import {
  finalizeSalePeripherals,
  buildTicketData,
  salePeripheralGuard,
  type PrintStatus,
  type DrawerStatus,
} from '../services/salePeripherals';
import { newIdempotencyKey } from '../services/idempotency';
import { toWirePayments, toSaleDiscountFields } from '../services/salePayload';
import { validateManualDiscount } from '../services/discount-policy';
import { useOfflineStore } from '../stores/offlineStore';
import { getCardPaymentMode, CARD_DISABLED_MESSAGE } from '../services/cardPaymentMode';
import { loadSettings as loadCustomerDisplaySettings, terminalLabel } from '../services/customerDisplay/settings';
import { computePaymentState, type PaymentMethod } from '../services/paymentMachine';
import { FluxWidget } from '../components/FluxWidget';
import { ManualDiscountControl } from '../components/ManualDiscountControl';
import { PromoCodeControl } from '../components/PromoCodeControl';
import { useOfflineMode } from '../hooks/useOfflineMode';
import { useWakeLock } from '../hooks/useWakeLock';
import { EmployeePinGate } from '../components/EmployeePinGate';
import { useRights } from '../hooks/useRights';
import { usePointageStore } from '../stores/pointageStore';
import { ShiftIndicator } from '../components/ShiftIndicator';
import { usePerformanceStore } from '../stores/performanceStore';
import { ShiftWarning } from '../components/ShiftWarning';
import { posEventBus } from '../services/posEventBus';
import { useStaffingStore } from '../services/staffingEngine';
import { StaffingWidget } from '../components/StaffingWidget';
import { ComparisonWidget } from '../components/ComparisonWidget';
import { useComparisonStore } from '../stores/comparisonStore';
import { useDeviceProfile, platformClasses } from '../hooks/useDeviceProfile';
import { useTicketHistory } from '../hooks/useTicketHistory';
import { TicketHistoryModal } from '../components/pos/TicketHistoryModal';
import { ReturnModal } from '../components/pos/ReturnModal';
import { AvoirTenderModal } from '../components/pos/AvoirTenderModal';
import { peripheralBridge } from '../services/peripheralBridge';
import { useCloudSyncStore } from '../services/cloudSyncIdentity';
import { Wifi, WifiOff, CloudOff, Cloud, RefreshCw as SyncIcon, ShieldAlert, Upload, Lock as LockIcon } from 'lucide-react';
import { IPadPOSLayout } from '../components/ipad/IPadPOSLayout';
import { StockAlertToast } from '../components/StockAlertToast';
import { SaleGuardsGate } from '../components/SaleGuardsGate';
import { SalesCockpit } from '../components/SalesCockpit';
import { CustomerDisplayPublisher } from '../components/CustomerDisplayPublisher';
import { ActiveCashierBanner } from '../components/ActiveCashierBanner';
import { ScoreDetailModal } from '../components/ScoreDetailModal';

/* ── Helpers ── */

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

const avatarColors = [
  'from-rose-100 to-rose-200 text-rose-600',
  'from-blue-100 to-blue-200 text-blue-600',
  'from-amber-100 to-amber-200 text-amber-600',
  'from-emerald-100 to-emerald-200 text-emerald-600',
  'from-violet-100 to-violet-200 text-violet-600',
  'from-cyan-100 to-cyan-200 text-cyan-600',
  'from-pink-100 to-pink-200 text-pink-600',
  'from-lime-100 to-lime-200 text-lime-600',
];
function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

/* ── Product type (from backend API) ── */

interface CatalogueProduct {
  id: string;
  ean: string;
  name: string;
  description?: string | null;
  categoryId?: string | null;
  unitType: string;
  priceMinorUnits: number;
  currencyCode: string;
  costMinorUnits?: number;
  taxRate: string | number;
  imageUrl?: string | null;
  stockQuantity: number;
  stockAlertThreshold?: number;
  stockCriticalThreshold?: number;
  isActive: boolean;
  storeId: string;
}

/* ── Payment types ── */

// PaymentMethod is the canonical union from paymentMachine (cash/card/mixed/voucher/gift_card/store_credit)

interface PartialPayment {
  id: string;
  method: PaymentMethod;
  amountMinorUnits: number;
  creditNoteCode?: string;
  /** Card leg NOT really captured (demo) → sale lands payment_pending. */
  pendingCapture?: boolean;
}

/* ── Confirmation overlay types ── */

interface ConfirmationData {
  ticketNumber: string;
  total: number;
  method: PaymentMethod;
  payments: PartialPayment[];
  changeAmount: number;
  itemCount: number;
  cashierName: string;
  timestamp: Date;
}

const TICKET_TIMEOUT_MS = 7000; // 7 seconds auto-dismiss

/* ── Component ── */

export function POSPage() {
  const navigate = useNavigate();
  const store = usePOSStore();
  const offlineMode = useOfflineMode();
  useWakeLock(); // Keep screen awake on iPad
  const rights = useRights();
  const device = useDeviceProfile();
  const cloudSync = useCloudSyncStore();
  const scanRef = useRef<HTMLInputElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  // One idempotency key per checkout (reused on double-click / retry, reset on success).
  const saleIdemKeyRef = useRef<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scanValue, setScanValue] = useState('');
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [scoreDetailOpen, setScoreDetailOpen] = useState(false);

  // Search dropdown
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Weight modal
  const [weightModal, setWeightModal] = useState<CatalogueProduct | null>(null);
  const [weightValue, setWeightValue] = useState('');
  const weightRef = useRef<HTMLInputElement>(null);

  // Produit inconnu — la caisse ne crée JAMAIS de produit, elle ne peut
  // qu'envoyer une demande d'intégration vers le Dashboard / Inventaire.
  const [unknownProduct, setUnknownProduct] = useState<{
    barcode: string;
    comment: string;
    status: 'idle' | 'sending' | 'sent' | 'already' | 'error';
  } | null>(null);

  // Fullscreen confirmation overlay
  const [confirmation, setConfirmation] = useState<ConfirmationData | null>(null);
  const confirmationRef = useRef<ConfirmationData | null>(null); // mirror to avoid stale closures
  // Impression + tiroir du flux de vente desktop : trois statuts DISTINCTS
  // affichés à la caisse — jamais fusionnés (règle owner) :
  //  - la vente (overlay de confirmation) ;
  //  - l'impression du ticket (lastPrintStatus) ;
  //  - l'ouverture du tiroir (lastDrawerStatus).
  // La garde d'idempotence est un SINGLETON de module (clé stable = ticketNumber),
  // hors du cycle de vie React : elle survit à un re-render / remontage / retour
  // d'écran, donc jamais 2 tickets ni 2 ouvertures tiroir pour une même vente.
  const [lastPrintStatus, setLastPrintStatus] = useState<PrintStatus | null>(null);
  const [lastDrawerStatus, setLastDrawerStatus] = useState<DrawerStatus | null>(null);
  // Garde SYNCHRONE de ré-entrée sur finalizePayment : bloque un 2ᵉ appel
  // (double-clic, retour d'écran, re-render) AVANT même le setProcessing async.
  const finalizingRef = useRef(false);

  // Email-receipt modal (shown from the confirmation overlay when a server saleId exists)
  const [emailModal, setEmailModal] = useState(false);
  const [emailValue, setEmailValue] = useState('');
  const [emailStatus, setEmailStatus] = useState<'idle' | 'sending' | 'sent' | 'error' | 'disabled'>('idle');

  // Return / credit-note modal (online only)
  const [returnOpen, setReturnOpen] = useState(false);
  // Pay-by-avoir tender modal
  const [avoirOpen, setAvoirOpen] = useState(false);
  const [ticketCountdown, setTicketCountdown] = useState(TICKET_TIMEOUT_MS / 1000);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Transaction speed tracking
  const [transactionStart, setTransactionStart] = useState<number | null>(null);
  const [lastTransactionTime, setLastTransactionTime] = useState<number | null>(null);

  // Split payment state
  const [partialPayments, setPartialPayments] = useState<PartialPayment[]>([]);
  const [splitAmountInput, setSplitAmountInput] = useState('');
  const splitInputRef = useRef<HTMLInputElement>(null);

  // TPE waiting state — on this legacy desktop path only the labelled DEMO flow
  // can open the overlay (real card = iPad/aligned pipeline; prod unconfigured = disabled).
  const [tpeWaiting, setTpeWaiting] = useState<{
    amountMinorUnits: number;
    method: 'card';
    context: 'quick' | 'split';
    startedAt: number;
    mode: 'demo';
  } | null>(null);
  const tpeWaitingRef = useRef<typeof tpeWaiting>(null); // mirror to avoid stale closures
  const [tpeCountdown, setTpeCountdown] = useState(25);
  const [tpeResult, setTpeResult] = useState<'success' | 'refused' | 'timeout' | null>(null);
  const tpeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tpeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Capture facts attached to a card leg before commit — a card leg can ONLY be
  // committed when facts are set (demo → pendingCapture:true). Nothing can
  // fabricate a captured card payment on this path.
  const cardLegFactsRef = useRef<{ pendingCapture?: boolean } | null>(null);

  // Ticket history (extracted hook)
  const ticketHistory = useTicketHistory();

  const totalPaid = partialPayments.reduce((s, p) => s + p.amountMinorUnits, 0);
  const remaining = store.paymentModalOpen ? store.total() - totalPaid : 0;

  // Focus split input when payment modal opens or after adding a partial payment
  useEffect(() => {
    if (store.paymentModalOpen) {
      setTimeout(() => splitInputRef.current?.focus(), 150);
    } else {
      setPartialPayments([]);
      setSplitAmountInput('');
    }
  }, [store.paymentModalOpen, partialPayments.length]);

  // History focus is handled by useTicketHistory hook

  // Start/stop staffing engine + emit SESSION_OPENED
  useEffect(() => {
    const staffing = useStaffingStore.getState();
    const storeId = store.storeInfo?.siret || store.employee?.storeId || 'unknown';
    staffing.loadPersistedData();
    staffing.start(storeId);

    // Register current cashier + emit event
    if (store.employee) {
      const name = `${store.employee.firstName} ${store.employee.lastName}`;
      staffing.registerCashier(store.employee.id, name);
      posEventBus.emit('SESSION_OPENED', {
        storeId,
        cashierId: store.employee.id,
        cashierName: name,
        timestamp: new Date().toISOString(),
      });
    }

    // Start network comparison polling
    useComparisonStore.getState().startPolling();

    return () => {
      staffing.stop();
      useComparisonStore.getState().stopPolling();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Init peripheral bridge + cloud sync identity
  useEffect(() => {
    peripheralBridge.init(device.platform);
    cloudSync.initDevice(device.platform);
    const storeId = store.storeInfo?.siret || store.employee?.storeId || 'unknown';
    const storeName = store.storeInfo?.storeName || 'Unknown Store';
    cloudSync.registerDevice(storeId, storeName);
    if (store.employee) {
      cloudSync.startSession(
        store.employee.id,
        `${store.employee.firstName} ${store.employee.lastName}`,
        storeId,
        storeName,
      );
    }
    console.log(`[PLATFORM] ${device.platform} | ${device.inputMode} | ${device.screenClass} | ${device.viewportWidth}x${device.viewportHeight}`);
    return () => {
      peripheralBridge.destroy();
      cloudSync.endSession();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch product catalogue from backend
  const [catalogue, setCatalogue] = useState<CatalogueProduct[]>([]);
  useEffect(() => {
    productsApi.list()
      .then((res) => {
        if (Array.isArray(res.data)) setCatalogue(res.data);
      })
      .catch(() => {
        console.warn('[CATALOGUE] Backend non disponible — catalogue vide');
      });
  }, []);

  // filteredHistory, handleReprint — provided by useTicketHistory hook

  /* ── Confirmation overlay logic (robust — no stale closures) ── */

  /** completeTransaction: the single entry point to dismiss the overlay and reset POS state.
   *  This is THE robust function that handles ALL cases:
   *  - Auto-dismiss timer fires
   *  - User clicks a ticket choice button
   *  - User clicks the "Nouvelle Vente" fallback button
   *  - Keyboard Escape
   *  It is idempotent — calling it twice is safe.
   */
  const completeTransaction = useCallback((ticketChoice?: 'paper' | 'digital' | 'none') => {
    // 1. Log the choice (production: print receipt / send email / skip)
    const currentConfirmation = confirmationRef.current;
    if (currentConfirmation) {
      const choice = ticketChoice || (currentConfirmation.method === 'cash' ? 'paper' : 'none');
      console.log(`[POS] Transaction terminée → ticket: ${choice}`, currentConfirmation.ticketNumber);
    }

    // 2. Kill all timers unconditionally
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }

    // 3. Reset ALL overlay state
    setConfirmation(null);
    confirmationRef.current = null;
    setTicketCountdown(TICKET_TIMEOUT_MS / 1000);

    // 4. Ensure cart / payment state is clean (idempotent safety net)
    setPartialPayments([]);
    setSplitAmountInput('');

    // 5. Re-focus scan input for next sale
    setTimeout(() => scanRef.current?.focus(), 50);
  }, []);

  /** handleTicketChoice: user clicks a ticket button → delegates to completeTransaction */
  const handleTicketChoice = useCallback((choice: 'paper' | 'digital' | 'none') => {
    completeTransaction(choice);
  }, [completeTransaction]);

  /** Email the just-completed receipt. Requires a server saleId (online sale). */
  const sendReceiptEmail = useCallback(async () => {
    const saleId = (store as any).lastSaleId as string | undefined;
    if (!saleId) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue.trim())) {
      setEmailStatus('error');
      return;
    }
    setEmailStatus('sending');
    try {
      const res = await receiptsApi.email(saleId, emailValue.trim());
      if (res.data?.skipped) setEmailStatus('disabled');
      else if (res.data?.sent) setEmailStatus('sent');
      else setEmailStatus('error');
    } catch {
      setEmailStatus('error');
    }
  }, [store, emailValue]);

  /** dismissConfirmation: alias for "skip" — used by Escape key and the "Passer" link */
  const dismissConfirmation = useCallback(() => {
    completeTransaction();
  }, [completeTransaction]);

  // Auto-dismiss countdown — STABLE deps (no stale closure issue).
  // Paused while the email-receipt modal is open so the overlay does not vanish
  // under the cashier; closing the modal restarts a fresh countdown.
  useEffect(() => {
    if (!confirmation || emailModal) return;

    // Keep the ref in sync
    confirmationRef.current = confirmation;

    // Reset countdown
    setTicketCountdown(TICKET_TIMEOUT_MS / 1000);

    // Visual countdown (every 1s)
    const countdownId = setInterval(() => {
      setTicketCountdown((prev) => {
        if (prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);
    countdownRef.current = countdownId;

    // Auto-dismiss timeout — uses ref to avoid stale closure
    const timeoutId = setTimeout(() => {
      completeTransaction(); // reads from confirmationRef internally
    }, TICKET_TIMEOUT_MS);
    timeoutRef.current = timeoutId;

    return () => {
      clearInterval(countdownId);
      clearTimeout(timeoutId);
      countdownRef.current = null;
      timeoutRef.current = null;
    };
  }, [confirmation, emailModal]); // restart/pause with the email modal too

  // Redirect if not logged in
  useEffect(() => {
    if (!store.employee) navigate('/');
  }, [store.employee, navigate]);

  // Poll occupancy + weather
  useEffect(() => {
    if (!store.employee) return;
    const storeId = store.employee.storeId;
    const fetchFlux = async () => {
      try {
        const [occRes, wxRes] = await Promise.all([
          occupancyApi.get(storeId),
          occupancyApi.getWeather(storeId),
        ]);
        store.setOccupancy(occRes.data);
        store.setWeather(wxRes.data);
      } catch { /* non-blocking */ }
    };
    fetchFlux();
    const interval = setInterval(fetchFlux, 30_000);
    return () => clearInterval(interval);
  }, [store.employee?.storeId]);

  // Auto-focus scan input
  useEffect(() => {
    if (!weightModal && !confirmation) scanRef.current?.focus();
  }, [store.cartItems.length, weightModal, confirmation]);

  // Focus weight input when modal opens
  useEffect(() => {
    if (weightModal) setTimeout(() => weightRef.current?.focus(), 100);
  }, [weightModal]);

  // Track transaction start when first item added
  useEffect(() => {
    if (store.cartItems.length === 1 && !transactionStart) {
      setTransactionStart(Date.now());
    }
    if (store.cartItems.length === 0) {
      setTransactionStart(null);
    }
  }, [store.cartItems.length, transactionStart]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (weightModal || confirmation) return;
      if (e.key === 'F2') {
        e.preventDefault();
        store.setScanMode(store.scanMode === 'product' ? 'customer' : 'product');
      }
      if (e.key === 'F5') {
        e.preventDefault();
        if (store.cartItems.length > 0) store.setPaymentModalOpen(true);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        store.setPaymentModalOpen(false);
        setProfileOpen(false);
        setSearchOpen(false);
        ticketHistory.dismissSubModals();
      }
      if (e.key === 'F8') {
        e.preventDefault();
        if (rights.canVoid) store.clearCart();
      }
      if (e.key === 'F9') {
        e.preventDefault();
        ticketHistory.openHistory();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [store, weightModal, confirmation]);

  // Close search dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* ── Smart search ── */

  const searchResults = useMemo(() => {
    if (!scanValue.trim() || store.scanMode === 'customer') return [];
    const q = scanValue.toLowerCase().trim();
    return catalogue
      .filter((p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        p.ean.includes(q),
      )
      .slice(0, 8);
  }, [scanValue, store.scanMode, catalogue]);

  const addProductToCart = (product: CatalogueProduct, weightKg?: number) => {
    const isByWeight = product.unitType === 'kg';
    if (isByWeight && weightKg) {
      const kg = weightKg;
      if (kg <= 0) return;
      // For weight products, priceMinorUnits is price per kg
      const priceMinor = Math.round(product.priceMinorUnits * kg);
      store.addToCart({
        productId: product.id + '-' + Date.now(),
        ean: product.ean,
        name: `${product.name} (${kg.toFixed(3)} kg)`,
        unitPriceMinorUnits: priceMinor,
      });
    } else {
      store.addToCart({
        productId: product.id,
        ean: product.ean,
        name: product.name,
        unitPriceMinorUnits: product.priceMinorUnits,
      });
    }
    setScanValue('');
    setSearchOpen(false);
    setSelectedIdx(-1);
    scanRef.current?.focus();
  };

  const handleSelectProduct = (product: CatalogueProduct) => {
    if (product.unitType === 'kg') {
      setWeightModal(product);
      setWeightValue('');
    } else {
      addProductToCart(product);
    }
  };

  const handleWeightConfirm = () => {
    if (!weightModal) return;
    const kg = parseFloat(weightValue.replace(',', '.'));
    if (isNaN(kg) || kg <= 0) return;
    addProductToCart(weightModal, kg);
    setWeightModal(null);
    setWeightValue('');
  };

  /* ── Scan handler ── */

  const handleScan = async (value: string) => {
    if (!value.trim()) return;
    setError('');
    const localMatch = catalogue.find((p) => p.ean === value.trim());
    if (localMatch) { handleSelectProduct(localMatch); return; }
    if (searchResults.length > 0) {
      const idx = selectedIdx >= 0 ? selectedIdx : 0;
      handleSelectProduct(searchResults[idx]);
      return;
    }
    try {
      if (store.scanMode === 'customer') {
        const res = await customersApi.findByQr(value);
        if (res.data) { store.setCustomer(res.data, value); store.setScanMode('product'); }
      } else {
        const res = await productsApi.scan(value);
        if (res.data) {
          store.addToCart({ productId: res.data.id, ean: res.data.ean, name: res.data.name, unitPriceMinorUnits: res.data.priceMinorUnits });
        } else { openUnknownProduct(value.trim()); }
      }
    } catch (e: any) {
      const fuzzy = catalogue.find((p) => p.name.toLowerCase().includes(value.toLowerCase()));
      if (fuzzy) { handleSelectProduct(fuzzy); }
      else if (store.scanMode !== 'customer' && e?.response?.status === 404) {
        // Le backend confirme : ce code-barres n'existe pas → produit inconnu.
        openUnknownProduct(value.trim());
      } else { setError(`Produit non trouve : ${value}`); }
    }
    setScanValue('');
    setSearchOpen(false);
    scanRef.current?.focus();
  };

  /* ── Produit inconnu (aucune création depuis la caisse) ── */

  const openUnknownProduct = (barcode: string) => {
    setUnknownProduct({ barcode, comment: '', status: 'idle' });
  };

  const sendIntegrationRequest = async () => {
    if (!unknownProduct || unknownProduct.status === 'sending') return;
    setUnknownProduct({ ...unknownProduct, status: 'sending' });
    try {
      const res = await productIntegrationApi.createRequest({
        barcode: unknownProduct.barcode,
        source: 'pos',
        terminalId: terminalLabel(loadCustomerDisplaySettings().terminalId),
        comment: unknownProduct.comment.trim() || undefined,
      });
      setUnknownProduct({
        ...unknownProduct,
        status: res.data?.alreadyPending ? 'already' : 'sent',
      });
    } catch {
      setUnknownProduct({ ...unknownProduct, status: 'error' });
    }
  };

  const closeUnknownProduct = () => {
    setUnknownProduct(null);
    scanRef.current?.focus();
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (searchResults.length === 0) { if (e.key === 'Enter') handleScan(scanValue); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, searchResults.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); handleSelectProduct(searchResults[selectedIdx >= 0 ? selectedIdx : 0]); }
    else if (e.key === 'Escape') { setSearchOpen(false); }
  };

  /* ── Split payment logic ── */

  /* ── TPE Waiting Logic (robust — uses refs to avoid stale closures) ── */

  const clearTpeTimers = () => {
    if (tpeTimerRef.current) { clearInterval(tpeTimerRef.current); tpeTimerRef.current = null; }
    if (tpeTimeoutRef.current) { clearTimeout(tpeTimeoutRef.current); tpeTimeoutRef.current = null; }
  };

  const startTpeWaiting = (amountMinor: number, context: 'quick' | 'split') => {
    // Clear any previous TPE session
    clearTpeTimers();
    setTpeResult(null);
    cardLegFactsRef.current = null;

    void (async () => {
      // Card gate (decision produit ratifiée) : this legacy desktop path never runs
      // a real reader flow — real card lives on the aligned iPad pipeline. Prod
      // without Stripe = disabled. Dev without Stripe = labelled DEMO only.
      const mode = await getCardPaymentMode();
      if (mode === 'disabled') {
        setError(CARD_DISABLED_MESSAGE);
        return;
      }
      if (mode === 'real') {
        setError('Paiement carte réel : utilisez la caisse iPad (lecteur WisePad 3). Ce poste desktop n\'est pas encore raccordé au lecteur.');
        return;
      }

      const tpeState = { amountMinorUnits: amountMinor, method: 'card' as const, context, startedAt: Date.now(), mode };
      setTpeCountdown(25);
      setTpeWaiting(tpeState);
      tpeWaitingRef.current = tpeState; // keep ref in sync

      // Countdown timer — demo auto-times out; acceptance is ONLY the explicit demo button
      tpeTimerRef.current = setInterval(() => {
        setTpeCountdown((prev) => {
          if (prev <= 1) {
            handleTpeResponse('timeout');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    })();
  };

  const handleTpeResponse = (result: 'success' | 'refused' | 'timeout') => {
    // Stop all TPE timers immediately
    clearTpeTimers();

    // Read from ref to avoid stale closure on tpeWaiting state
    const currentTpe = tpeWaitingRef.current;

    if (result === 'success') {
      // INVARIANT: a card leg only commits with capture facts attached
      // (demo → pendingCapture:true). No facts → refuse, never fabricate.
      const facts = cardLegFactsRef.current;
      if (!currentTpe || !facts) {
        cardLegFactsRef.current = null;
        setTpeResult('refused');
        return;
      }
      cardLegFactsRef.current = null;
      setTpeResult('success');
      const { amountMinorUnits, context } = currentTpe;

      // TPE approved → show green success 2s, then clear overlay and finalize
      setTimeout(() => {
        // Clear the TPE overlay
        setTpeWaiting(null);
        setTpeResult(null);
        tpeWaitingRef.current = null;

        // Small delay to let React flush the overlay removal, then show confirmation
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
    cardLegFactsRef.current = null;
    setTpeResult(result);
    // Refused / Timeout → overlay stays visible with retry/cash buttons (no auto-dismiss)
    // The user must explicitly choose: retry, switch to cash, or cancel
  };

  /**
   * DEV/DEMO ONLY — simulate a card acceptance. The committed leg is flagged
   * pendingCapture=true → the sale lands payment_pending (à régulariser),
   * NEVER a "paid" card sale.
   */
  const simulateDemoTpeSuccess = () => {
    if (tpeWaitingRef.current?.mode !== 'demo') return;
    cardLegFactsRef.current = { pendingCapture: true };
    handleTpeResponse('success');
  };

  const cancelTpeWaiting = () => {
    clearTpeTimers();
    setTpeWaiting(null);
    setTpeResult(null);
    tpeWaitingRef.current = null;
    cardLegFactsRef.current = null;
  };

  // Cleanup timers on unmount
  useEffect(() => {
    return () => clearTpeTimers();
  }, []);

  /* ── Commit partial payment (after TPE approval for card) ── */

  const commitPartialPayment = (method: PaymentMethod, amountMinor: number, creditNoteCode?: string, cardFacts?: { pendingCapture?: boolean }) => {
    const payment: PartialPayment = {
      id: `pay-${Date.now()}`,
      method,
      amountMinorUnits: amountMinor,
      creditNoteCode,
      ...(cardFacts || {}),
    };

    const newPayments = [...partialPayments, payment];
    const ticketTotal = store.total();
    // Tender state machine: cash change only; voucher/gift-card overpay forfeited.
    const state = computePaymentState(ticketTotal, newPayments);

    if (state.isCovered) {
      finalizePayment(newPayments, state.changeDue);
    } else {
      setPartialPayments(newPayments);
      setSplitAmountInput('');
    }
  };

  const addPartialPayment = (method: PaymentMethod) => {
    const inputVal = splitAmountInput.trim().replace(',', '.');
    const parsed = parseFloat(inputVal);
    // If no amount entered or 0, use the full remaining amount
    const amountEuros = (!inputVal || isNaN(parsed) || parsed <= 0) ? remaining / 100 : parsed;
    const amountMinor = Math.round(amountEuros * 100);

    if (amountMinor <= 0) return;

    if (method === 'card') {
      // CB → wait for TPE confirmation
      startTpeWaiting(amountMinor, 'split');
      return;
    }

    // Cash → immediate
    commitPartialPayment(method, amountMinor);
  };

  const removePartialPayment = (id: string) => {
    setPartialPayments((prev) => prev.filter((p) => p.id !== id));
  };

  const finalizePayment = async (payments: PartialPayment[], changeMinor: number) => {
    // Garde SYNCHRONE de ré-entrée : un 2ᵉ appel concurrent (double-clic, retry,
    // retour d'écran, re-render) est refusé net, avant tout effet réseau ou état.
    // Complète — sans les remplacer — la clé d'idempotence backend (saleIdemKeyRef)
    // et la garde par ticketNumber : une seule vente, un seul ticket, un seul tiroir.
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    // Decision 5 mirror: refuse an impossible manual discount before the network.
    const discCheck = validateManualDiscount({
      subtotalMinor: store.subtotal(),
      manualDiscountMinor: store.manualDiscountMinorUnits,
      approverId: store.discountApproverId,
    });
    if (!discCheck.ok) {
      setError(discCheck.reason || 'Remise refusée');
      finalizingRef.current = false;
      return;
    }
    setProcessing(true);
    setError('');
    const totalAmount = store.total();
    const itemCount = store.cartItems.reduce((s, i) => s + i.quantity, 0);
    const cashierName = store.employee ? `${store.employee.firstName} ${store.employee.lastName}` : 'Caissier';

    const txTime = transactionStart ? Math.round((Date.now() - transactionStart) / 1000) : 0;
    setLastTransactionTime(txTime);

    // Determine primary method
    const primaryMethod: PaymentMethod = payments.length === 1
      ? payments[0].method
      : 'mixed';

    let ticketNumber = '';

    // Stable idempotency key for this checkout — a double-click / retry reuses it,
    // so the backend dedupes instead of creating a second sale + cash-in.
    if (!saleIdemKeyRef.current) saleIdemKeyRef.current = newIdempotencyKey();
    const idempotencyKey = saleIdemKeyRef.current;
    try {
      const res = await salesApi.create({
        items: store.cartItems.map((i) => ({ ean: i.ean, quantity: i.quantity })),
        customerQrCode: store.customerQrCode || undefined,
        // Manual discount (decision 5) + promo (decision 6) — server re-validates.
        // This path silently DROPPED them before (P0 #3 of the field audit).
        ...toSaleDiscountFields(store),
        payments: toWirePayments(payments),
      }, idempotencyKey);
      ticketNumber = res.data.ticketNumber || `T-${Date.now().toString().slice(-6)}`;
      saleIdemKeyRef.current = null; // confirmed online → next sale gets a fresh key
      if (res.data.jackpotResult) store.setJackpotResult(res.data.jackpotResult);
    } catch (err: any) {
      // NO fake ticket, EVER (P0 #2 of the field audit): a failed create must not
      // produce a "successful" sale. Network down → honest offline queue (same
      // pipeline as the iPad path). Any other error → keep the cart, show it.
      const isNetworkError =
        !err?.response ||
        err?.code === 'ERR_NETWORK' ||
        err?.code === 'ECONNABORTED' ||
        err?.message?.includes('Network Error');

      if (isNetworkError) {
        console.warn('[POS] Backend unreachable — queuing sale offline');
        const offlineStore = useOfflineStore.getState();
        ticketNumber = `OFF-${Date.now().toString(36).toUpperCase()}`;
        offlineStore.enqueue({
          type: 'ticket',
          payload: {
            ticketNumber,
            items: store.cartItems.map((i) => ({ ean: i.ean, quantity: i.quantity, name: i.name, unitPriceMinorUnits: i.unitPriceMinorUnits })),
            payments: toWirePayments(payments),
            totalMinorUnits: totalAmount,
            customerQrCode: store.customerQrCode || undefined,
            ...toSaleDiscountFields(store),
            // Same key as the failed online attempt → a lost-response create is
            // deduped on sync replay, not duplicated.
            idempotencyKey,
          },
          cashierId: store.employee?.id || 'unknown',
          cashierName,
          storeId: store.employee?.storeId || 'unknown',
        });
        saleIdemKeyRef.current = null; // queued → this checkout is done
        store.cartItems.forEach((item) => {
          offlineStore.decrementLocalStock(item.ean, item.quantity);
        });
        posEventBus.emit('SALE_OFFLINE', { ticketNumber, pendingCount: offlineStore.pendingCount + 1 });
        // Continue to confirmation — the sale was honestly accepted locally
      } else {
        setProcessing(false);
        finalizingRef.current = false; // vente échouée → un retry est légitime
        const message =
          err?.response?.data?.message ||
          err?.response?.data?.details?.[0] ||
          err?.message ||
          'Erreur lors de la vente';
        setError(message);
        posEventBus.emit('SALE_ERROR', { message });
        console.error('[POS] Sale failed:', message);
        // Keep the cart — the cashier fixes the issue and retries with the SAME key
        return;
      }
    }

    const timestamp = new Date();

    // Save ticket to history
    store.addTicketToHistory({
      ticketNumber,
      timestamp,
      items: store.cartItems.map((i) => ({
        name: i.name,
        ean: i.ean,
        quantity: i.quantity,
        unitPriceMinorUnits: i.unitPriceMinorUnits,
        discountMinorUnits: i.discountMinorUnits,
      })),
      payments: payments.map((p) => ({ method: p.method, amountMinorUnits: p.amountMinorUnits })),
      totalMinorUnits: totalAmount,
      subtotalMinorUnits: store.subtotal(),
      discountMinorUnits: store.totalDiscount(),
      changeMinorUnits: changeMinor,
      cashierName,
      customerName: store.customer ? `${store.customer.firstName} ${store.customer.lastName}` : undefined,
      reprintCount: 0,
      reprintLog: [],
    });

    // Record performance metrics (silent tracking)
    usePerformanceStore.getState().recordTransaction({
      ticketNumber,
      timestamp: timestamp.toISOString(),
      totalMinorUnits: totalAmount,
      itemCount,
      durationSeconds: txTime,
      paymentMethod: primaryMethod,
      discountMinorUnits: store.totalDiscount(),
    });

    // Emit SALE_COMPLETED event for staffing engine + other listeners
    posEventBus.emit('SALE_COMPLETED', {
      storeId: store.storeInfo?.siret || store.employee?.storeId || 'unknown',
      cashierId: store.employee?.id || 'unknown',
      cashierName,
      timestamp: timestamp.toISOString(),
      ticketNumber,
      totalMinorUnits: totalAmount,
      itemCount,
      durationSeconds: txTime,
      paymentMethod: primaryMethod,
      discountMinorUnits: store.totalDiscount(),
    });

    const confirmData: ConfirmationData = {
      ticketNumber,
      total: totalAmount,
      method: primaryMethod,
      payments,
      changeAmount: changeMinor,
      itemCount,
      cashierName,
      timestamp,
    };
    confirmationRef.current = confirmData; // sync ref BEFORE state
    setConfirmation(confirmData);

    // ── Impression ticket + tiroir-caisse (flux de vente RÉEL, desktop) ──
    // La vente est validée (acceptée en ligne, ou honnêtement mise en file
    // offline). On construit le ticket AVANT de vider le panier, puis on
    // imprime / ouvre le tiroir SANS bloquer l'overlay ni conditionner la
    // vente. Idempotent par `saleId` (idempotency key) ET par action, persisté :
    // ni double ticket ni double tiroir sur double-clic / retry / remontage /
    // redémarrage. (`ticketNumber` reste la référence FISCALE affichée.)
    const ticketData = buildTicketData({
      storeName: store.storeInfo?.storeName,
      storeAddress: store.storeInfo?.address,
      siret: store.storeInfo?.siret,
      tvaIntracom: store.storeInfo?.tvaIntracom,
      nifCaisse: store.storeInfo?.nifCaisse,
      ticketNumber,
      date: timestamp,
      cashierName,
      items: store.cartItems.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unitPriceMinorUnits: i.unitPriceMinorUnits,
        discountMinorUnits: i.discountMinorUnits,
      })),
      subtotalMinorUnits: store.subtotal(),
      discountMinorUnits: store.totalDiscount(),
      totalMinorUnits: totalAmount,
      payments: payments.map((p) => ({ method: p.method, amountMinorUnits: p.amountMinorUnits })),
      changeMinorUnits: changeMinor,
    });
    setLastPrintStatus(null);
    setLastDrawerStatus(null);
    void finalizeSalePeripherals({
      // Identité STABLE de la vente = idempotency key (sale-<uuid>), jamais le
      // ticketNumber (séquentiel par magasin côté serveur, instable côté client).
      saleId: idempotencyKey,
      ticketData,
      payments: payments.map((p) => ({ method: p.method, amountMinorUnits: p.amountMinorUnits })),
      saleValidated: true,
      guard: salePeripheralGuard,
    }).then((r) => {
      // Trois statuts distincts, jamais fusionnés (règle owner).
      setLastPrintStatus(r.printStatus);
      setLastDrawerStatus(r.drawerStatus);
    });

    store.clearCart();
    setPartialPayments([]);
    setSplitAmountInput('');
    setProcessing(false);
    store.setPaymentModalOpen(false);
    // Vente terminée : la garde de ré-entrée est relâchée pour la vente SUIVANTE.
    // L'idempotence de CETTE vente reste protégée par la garde-ticket (singleton)
    // et par la clé d'idempotence backend — pas par ce booléen.
    finalizingRef.current = false;
  };

  // Quick full payment (no split needed)
  const handleQuickPayment = (method: PaymentMethod) => {
    const totalAmount = store.total();
    if (method === 'card') {
      // CB → must wait for TPE confirmation first
      startTpeWaiting(totalAmount, 'quick');
      return;
    }
    // Cash → immediate
    finalizePayment([{ id: `pay-${Date.now()}`, method, amountMinorUnits: totalAmount }], 0);
  };

  const formatPrice = (minorUnits: number) =>
    (minorUnits / 100).toFixed(2).replace('.', ',') + ' \u20ac';

  const methodLabel = (m: string) => {
    if (m === 'card') return 'Carte Bancaire';
    if (m === 'cash') return 'Especes';
    if (m === 'voucher') return 'Titre-resto';
    if (m === 'gift_card') return 'Carte cadeau';
    if (m === 'store_credit') return 'Avoir';
    return 'Paiement Mixte';
  };

  const methodIcon = (m: string) => {
    if (m === 'card') return <CreditCard size={18} />;
    if (m === 'cash') return <Banknote size={18} />;
    if (m === 'voucher') return <Ticket size={18} />;
    if (m === 'gift_card') return <Gift size={18} />;
    if (m === 'store_credit') return <Ticket size={18} />;
    return <Layers size={18} />;
  };

  const methodIconSmall = (m: string) => {
    if (m === 'card') return <CreditCard size={14} className="text-pos-accent" />;
    if (m === 'cash') return <Banknote size={14} className="text-pos-success" />;
    if (m === 'voucher') return <Ticket size={14} className="text-amber-500" />;
    if (m === 'gift_card') return <Gift size={14} className="text-violet-500" />;
    if (m === 'store_credit') return <Ticket size={14} className="text-emerald-500" />;
    return <Layers size={14} className="text-pos-muted" />;
  };

  // ══════ IPAD LAYOUT ROUTING ══════
  // On iPad, render the dedicated 3-column touch-first layout
  if (device.isIPad) {
    return (
      <>
        <EmployeePinGate onVerified={(name) => console.log(`[POS] Employee verified: ${name}`)} />
        <IPadPOSLayout />
        <StockAlertToast />
        <SaleGuardsGate />
      </>
    );
  }

  return (
    <div className={`h-screen flex flex-col bg-pos-bg safe-area-top safe-area-bottom overflow-x-hidden ${platformClasses(device)}`}>
      {/* Inert bridge: mirrors cart/payment to the customer display (screen 2). */}
      <CustomerDisplayPublisher />
      {/* ═══════ OFFLINE BANNER ═══════ */}
      {offlineMode.isOffline && (
        <div className="bg-gradient-to-r from-red-600 via-red-500 to-rose-500 px-4 py-2 flex items-center justify-between relative z-50 shadow-lg animate-slide-down">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-white/15 rounded-lg px-2.5 py-1">
              <WifiOff size={14} className="text-white animate-pulse" />
              <span className="text-white text-xs font-black uppercase tracking-wider">Mode Offline</span>
            </div>
            <span className="text-white/80 text-xs font-medium">
              Ventes enregistrees localement — Resync automatique au retour du reseau
            </span>
          </div>
          <div className="flex items-center gap-3">
            {offlineMode.offlineSince && (
              <span className="text-white/60 text-[10px] font-mono">
                Depuis {offlineMode.offlineDuration()}
              </span>
            )}
            <span className="flex items-center gap-1.5 bg-white/15 rounded-lg px-2.5 py-1 text-white text-xs font-bold">
              <Upload size={11} />
              {offlineMode.pendingCount} ticket{offlineMode.pendingCount > 1 ? 's' : ''} en attente
            </span>
            {/* Payment availability indicators */}
            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-1 text-[9px] font-bold text-white/90 bg-emerald-500/40 rounded px-1.5 py-0.5">
                <Banknote size={9} /> Especes
              </span>
              {offlineMode.canPayByCard ? (
                <span className="flex items-center gap-1 text-[9px] font-bold text-white/90 bg-emerald-500/40 rounded px-1.5 py-0.5">
                  <CreditCard size={9} /> CB (TPE 4G)
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[9px] font-bold text-white/50 bg-white/10 rounded px-1.5 py-0.5 line-through">
                  <CreditCard size={9} /> CB
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════ SYNCING BANNER ═══════ */}
      {offlineMode.isSyncing && (
        <div className="bg-gradient-to-r from-blue-500 to-indigo-500 px-4 py-1.5 flex items-center justify-between relative z-50">
          <div className="flex items-center gap-2">
            <SyncIcon size={12} className="text-white animate-spin" />
            <span className="text-white text-xs font-semibold">
              Synchronisation en cours... {offlineMode.syncProgress}%
            </span>
          </div>
          <div className="w-40 h-1.5 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-all duration-300"
              style={{ width: `${offlineMode.syncProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* ═══════ SYNC COMPLETE BANNER (show briefly after sync) ═══════ */}
      {!offlineMode.isOffline && !offlineMode.isSyncing && offlineMode.syncedCount > 0 && (
        <div className="bg-gradient-to-r from-emerald-500 to-green-500 px-4 py-1.5 flex items-center justify-center gap-2 relative z-50">
          <Cloud size={12} className="text-white" />
          <span className="text-white text-xs font-semibold">
            Connecte — {offlineMode.syncedCount} ticket{offlineMode.syncedCount > 1 ? 's' : ''} synchronise{offlineMode.syncedCount > 1 ? 's' : ''}
          </span>
          {offlineMode.conflictCount > 0 && (
            <span className="flex items-center gap-1 bg-amber-400/30 text-white text-[10px] font-bold px-2 py-0.5 rounded-full ml-2">
              <ShieldAlert size={10} />
              {offlineMode.conflictCount} conflit{offlineMode.conflictCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {/* ═══════ SHIFT WARNING BANNER ═══════ */}
      <ShiftWarning />

      {/* ── Header ── */}
      <header className={`bg-white/80 backdrop-blur-xl border-b border-pos-border/30 flex items-center justify-between relative z-30 ${device.isCompact ? 'px-3 py-2' : 'px-5 py-2.5'}`}>
        <div className="flex items-center gap-2 tablet:gap-4 min-w-0">
          <div className={`flex items-center justify-center rounded-xl bg-pos-text flex-shrink-0 ${device.isCompact ? 'w-8 h-8' : 'w-9 h-9'}`}>
            <span className={`text-white font-black ${device.isCompact ? 'text-xs' : 'text-sm'}`}>C</span>
          </div>
          {/* Caissier actif — bloc VISIBLE EN PERMANENCE */}
          <ActiveCashierBanner onScoreClick={() => setScoreDetailOpen(true)} />
          <FluxWidget occupancy={store.occupancy} weather={store.weather} />
          {/* Network status indicator */}
          <button
            onClick={() => offlineMode.isOffline ? undefined : offlineMode.triggerManualSync()}
            className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full transition-all ${
              offlineMode.isOffline
                ? 'bg-red-50 text-red-600 ring-1 ring-red-200 animate-pulse'
                : offlineMode.isSyncing
                ? 'bg-blue-50 text-blue-600 ring-1 ring-blue-200'
                : offlineMode.pendingCount > 0
                ? 'bg-amber-50 text-amber-600 ring-1 ring-amber-200 hover:bg-amber-100 cursor-pointer'
                : 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200'
            }`}
            title={offlineMode.isOffline ? 'Hors ligne' : offlineMode.pendingCount > 0 ? 'Cliquer pour synchroniser' : 'Connecte'}
          >
            {offlineMode.isOffline ? <WifiOff size={10} /> : offlineMode.isSyncing ? <SyncIcon size={10} className="animate-spin" /> : <Wifi size={10} />}
            {offlineMode.isOffline ? 'OFFLINE' : offlineMode.isSyncing ? `SYNC ${offlineMode.syncProgress}%` : offlineMode.pendingCount > 0 ? `${offlineMode.pendingCount} en attente` : 'ONLINE'}
          </button>
          {/* Shift duration indicator */}
          <ShiftIndicator />
          {/* IA Staffing indicator */}
          <StaffingWidget />
          {/* Network comparison indicator */}
          <ComparisonWidget />
          {/* Transaction speed indicator */}
          {lastTransactionTime !== null && (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-pos-muted bg-pos-subtle px-2 py-1 rounded-full">
              <Clock size={10} />
              {lastTransactionTime}s
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 tablet:gap-2">
          {/* Camera scan button — iPad/tablet only */}
          {device.isTouch && device.hasCamera && (
            <button
              onClick={() => setCameraOpen(true)}
              className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-2 tablet:py-1.5 rounded-full bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors border border-amber-200"
            >
              <Camera size={14} />
              <span className="hidden tablet:inline">Scanner</span>
            </button>
          )}
          <span className="badge-ghost hide-compact"><ScanBarcode size={12} /><kbd>F2</kbd> <span className="shortcut-label">Scanner</span></span>
          <span className="badge-ghost hide-compact"><CreditCard size={12} /><kbd>F5</kbd> <span className="shortcut-label">Payer</span></span>
          <span className="badge-ghost hide-compact"><X size={12} /><kbd>F8</kbd> <span className="shortcut-label">Annuler</span></span>
          <button
            onClick={() => ticketHistory.openHistory()}
            className={`flex items-center gap-1.5 font-semibold rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors border border-indigo-100 ${device.isCompact ? 'text-xs px-2.5 py-2' : 'text-[11px] px-3 py-1.5'}`}
          >
            <History size={device.isCompact ? 14 : 12} />
            <span className="hidden compact:inline">Historique</span>
            <kbd className="text-[9px] bg-indigo-100 px-1 py-0.5 rounded font-mono">F9</kbd>
          </button>
          {rights.canRefund && (
            <button
              onClick={() => setReturnOpen(true)}
              title="Retour / Avoir"
              className={`flex items-center gap-1.5 font-semibold rounded-full bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors border border-amber-100 ${device.isCompact ? 'text-xs px-2.5 py-2' : 'text-[11px] px-3 py-1.5'}`}
            >
              <RotateCcw size={device.isCompact ? 14 : 12} />
              <span className="hidden compact:inline">Retour</span>
            </button>
          )}
        </div>

        <div className="relative">
          <button className="profile-trigger" onClick={() => setProfileOpen(!profileOpen)}>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pos-accent/20 to-pos-accent-alt/20 flex items-center justify-center">
              <UserCircle size={18} className="text-pos-text" />
            </div>
            <span className="text-sm font-medium text-pos-text hidden lg:block">{store.employee?.firstName}</span>
            <ChevronDown size={14} className="text-pos-muted" />
          </button>
          {profileOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} />
              <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-2xl shadow-elevated border border-pos-border/30 p-2 z-50 animate-scale-in">
                <div className="px-3 py-2 border-b border-pos-border/30 mb-1">
                  <p className="text-sm font-semibold">{store.employee?.firstName} {store.employee?.lastName}</p>
                  <p className="text-xs text-pos-muted capitalize">{store.employee?.role}</p>
                </div>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-pos-text rounded-xl hover:bg-pos-subtle transition-colors mb-1"
                  onClick={() => {
                    setProfileOpen(false);
                    navigate('/display-settings');
                  }}
                >
                  <Monitor size={14} /> Écran client
                </button>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-pos-text rounded-xl hover:bg-pos-subtle transition-colors mb-1"
                  onClick={() => {
                    setProfileOpen(false);
                    navigate('/peripherals');
                  }}
                >
                  <Printer size={14} /> Imprimante &amp; tiroir
                </button>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-pos-danger rounded-xl hover:bg-pos-danger/5 transition-colors"
                  onClick={() => {
                    // Flush performance metrics before logout
                    usePerformanceStore.getState().flushToSyncQueue();
                    // Emit session closed for staffing engine
                    if (store.employee) {
                      posEventBus.emit('SESSION_CLOSED', {
                        storeId: store.storeInfo?.siret || store.employee.storeId || 'unknown',
                        cashierId: store.employee.id,
                        cashierName: `${store.employee.firstName} ${store.employee.lastName}`,
                        timestamp: new Date().toISOString(),
                        reason: 'manual_logout',
                      });
                    }
                    // Auto clock-out before logout
                    if (store.employee) {
                      usePointageStore.getState().clockOut();
                    }
                    store.logout();
                    setProfileOpen(false);
                  }}
                >
                  <LogOut size={14} /> Deconnexion
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* ── Main content ── */}
      <div className="pos-main-layout">
        <div className={`flex-1 flex flex-col gap-3 tablet:gap-4 ${device.isCompact ? 'p-3' : 'p-5'}`}>

          {/* ── Smart search bar ── */}
          <div className="relative max-w-2xl mx-auto w-full" ref={searchContainerRef}>
            <Search size={20} className="absolute left-5 top-1/2 -translate-y-1/2 text-pos-muted/40 z-10" />
            <input
              ref={scanRef}
              type="text"
              className="scan-input pl-14 pr-28"
              placeholder={store.scanMode === 'customer' ? 'Scanner QR client...' : 'Rechercher produit, categorie ou scanner code-barre...'}
              value={scanValue}
              onChange={(e) => { setScanValue(e.target.value); setSearchOpen(e.target.value.trim().length > 0); setSelectedIdx(-1); }}
              onKeyDown={handleSearchKeyDown}
              onFocus={() => { if (scanValue.trim()) setSearchOpen(true); }}
            />
            <span className={`absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${store.scanMode === 'customer' ? 'bg-violet-100 text-violet-700' : 'bg-pos-subtle text-pos-muted'}`}>
              {store.scanMode === 'customer' ? <User size={12} /> : <ShoppingBag size={12} />}
              {store.scanMode === 'customer' ? 'CLIENT' : 'PRODUIT'}
            </span>

            {/* Search dropdown */}
            {searchOpen && searchResults.length > 0 && store.scanMode === 'product' && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-elevated border border-pos-border/30 overflow-hidden z-50 animate-scale-in">
                <div className="px-4 py-2 border-b border-pos-border/20 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-pos-muted uppercase tracking-wider">{searchResults.length} resultat{searchResults.length > 1 ? 's' : ''}</span>
                  <span className="text-[10px] text-pos-muted">&#8593;&#8595; naviguer &middot; Entree selectionner</span>
                </div>
                {searchResults.map((product, idx) => (
                  <button
                    key={product.id}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${idx === selectedIdx ? 'bg-pos-accent/5 border-l-2 border-pos-accent' : 'hover:bg-pos-subtle border-l-2 border-transparent'} ${idx < searchResults.length - 1 ? 'border-b border-pos-border/10' : ''}`}
                    onClick={() => handleSelectProduct(product)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  >
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${avatarColor(product.name)} flex items-center justify-center font-bold text-xs flex-shrink-0`}>{initials(product.name)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm truncate text-pos-text">{product.name}</p>
                        {product.unitType === 'kg' && (
                          <span className="flex items-center gap-0.5 text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full ring-1 ring-amber-200">
                            <Weight size={9} /> POIDS
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="flex items-center gap-1 text-[11px] text-pos-muted"><Tag size={10} />{product.unitType}</span>
                        <span className="text-[11px] text-pos-muted font-mono">{product.ean}</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {product.unitType === 'kg' ? (
                        <p className="font-bold text-sm text-amber-600">{(product.priceMinorUnits / 100).toFixed(2).replace('.', ',')} &euro;/kg</p>
                      ) : (
                        <p className="font-bold text-sm text-pos-text">{formatPrice(product.priceMinorUnits)}</p>
                      )}
                      <p className="text-[10px] text-pos-muted">stock: {product.stockQuantity}</p>
                    </div>
                    <ArrowRight size={14} className={`flex-shrink-0 transition-colors ${idx === selectedIdx ? 'text-pos-accent' : 'text-pos-border'}`} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="max-w-2xl mx-auto w-full bg-pos-danger/5 text-pos-danger rounded-2xl px-4 py-2.5 text-sm font-medium animate-slide-up">{error}</div>
          )}

          {/* ── Sales Cockpit (shift performance) ── */}
          <div className="max-w-2xl mx-auto w-full mb-3">
            <SalesCockpit />
          </div>

          {/* ── Cart items ── */}
          <div className="flex-1 overflow-auto space-y-2 max-w-2xl mx-auto w-full">
            {store.cartItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-pos-muted gap-3">
                <ShoppingBag size={48} strokeWidth={1} className="opacity-20" />
                <p className="text-base font-medium opacity-60">Tapez le nom d'un produit ou scannez un code-barre</p>
                <p className="text-xs opacity-40">Produits au poids disponibles (bonbons, the, cafe...)</p>
              </div>
            ) : (
              store.cartItems.map((item, idx) => (
                <div key={item.productId} className={`bg-white rounded-2xl shadow-soft border border-pos-border/20 flex items-center animate-slide-up ${device.isTouch ? 'gap-3 p-3 tablet:gap-4 tablet:p-4' : 'gap-4 p-4'}`} style={{ animationDelay: `${idx * 30}ms` }}>
                  <div className={`product-avatar bg-gradient-to-br ${avatarColor(item.name)}`}>{initials(item.name)}</div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold truncate ${device.isTouch ? 'text-base' : 'text-sm'}`}>{item.name}</p>
                    <p className="text-xs text-pos-muted font-mono mt-0.5 hidden tablet:block">{item.ean}</p>
                  </div>
                  <div className={`flex items-center gap-1 bg-pos-subtle rounded-full ${device.isTouch ? 'p-1' : 'p-0.5'}`}>
                    <button className={`rounded-full hover:bg-white hover:shadow-soft flex items-center justify-center transition-all ${device.isTouch ? 'w-10 h-10' : 'w-7 h-7'}`} onClick={() => store.updateQuantity(item.productId, item.quantity - 1)}><Minus size={device.isTouch ? 18 : 14} /></button>
                    <span className={`text-center font-semibold ${device.isTouch ? 'w-10 text-lg' : 'w-8 text-sm'}`}>{item.quantity}</span>
                    <button className={`rounded-full hover:bg-white hover:shadow-soft flex items-center justify-center transition-all ${device.isTouch ? 'w-10 h-10' : 'w-7 h-7'}`} onClick={() => store.updateQuantity(item.productId, item.quantity + 1)}><Plus size={device.isTouch ? 18 : 14} /></button>
                  </div>
                  <div className={`text-right ${device.isTouch ? 'w-20' : 'w-24'}`}>
                    <p className={`font-bold ${device.isTouch ? 'text-base' : 'text-sm'}`}>{formatPrice(item.unitPriceMinorUnits * item.quantity)}</p>
                    {item.discountMinorUnits > 0 && <p className="text-xs text-pos-success font-medium">-{formatPrice(item.discountMinorUnits)}</p>}
                  </div>
                  <button className={`rounded-full hover:bg-pos-danger/10 flex items-center justify-center text-pos-muted hover:text-pos-danger transition-colors ${device.isTouch ? 'w-10 h-10' : 'w-7 h-7'}`} onClick={() => store.removeFromCart(item.productId)}><X size={device.isTouch ? 18 : 14} /></button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Right: Summary panel (sidebar on desktop, bottom sheet on compact) ── */}
        <div className="pos-summary-panel">
          {store.customer && (
            <div className="p-4 border-b border-pos-border/30 bg-gradient-to-r from-violet-50 to-purple-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-violet-100 flex items-center justify-center"><User size={16} className="text-violet-600" /></div>
                  <div>
                    <p className="font-semibold text-sm">{store.customer.firstName} {store.customer.lastName}</p>
                    <p className="text-xs text-pos-muted">{store.customer.loyaltyPoints} pts</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {store.customer.isFirstPurchase && <span className="text-[10px] bg-pos-success text-white px-2 py-0.5 rounded-full font-bold">-5%</span>}
                  <button className="text-xs text-pos-danger font-medium hover:underline" onClick={() => store.clearCustomer()}>Retirer</button>
                </div>
              </div>
            </div>
          )}
          <div className="flex-1" />
          <div className="p-5 space-y-3">
            <div className="flex justify-between text-sm text-pos-muted">
              <span>Sous-total</span><span className="font-medium">{formatPrice(store.subtotal())}</span>
            </div>
            {store.totalDiscount() > 0 && (
              <div className="flex justify-between text-sm text-pos-success">
                <span>Remise</span><span className="font-medium">-{formatPrice(store.totalDiscount())}</span>
              </div>
            )}
            <ManualDiscountControl />
            <PromoCodeControl />
            <div className="h-px bg-pos-border/40" />
            <div className="flex justify-between items-end">
              <span className="text-pos-muted text-sm font-medium">Total</span>
              <span className="text-3xl font-bold tracking-tight">{formatPrice(store.total())}</span>
            </div>
            <div className="text-xs text-pos-muted/60 text-right">{store.cartItems.reduce((s, i) => s + i.quantity, 0)} article(s)</div>
          </div>
          <div className="p-5 space-y-2.5 border-t border-pos-border/30">
            <button className="btn-primary w-full text-base flex items-center justify-center gap-2 py-3.5" disabled={store.cartItems.length === 0 || processing} onClick={() => store.setPaymentModalOpen(true)}>
              <CreditCard size={18} /> Payer
            </button>
            <button
              className={`btn-ghost w-full text-sm py-2.5 ${!rights.canVoid ? 'opacity-40 cursor-not-allowed' : ''}`}
              onClick={() => rights.canVoid && store.clearCart()}
              disabled={!rights.canVoid}
              title={!rights.canVoid ? 'Droit insuffisant — annulation non autorisee' : undefined}
            >
              {!rights.canVoid && <LockIcon size={12} className="inline mr-1.5" />}
              Annuler tout
            </button>
          </div>
        </div>
      </div>

      {/* Détail du score (au clic sur le score du bandeau caissier) */}
      {scoreDetailOpen && <ScoreDetailModal onClose={() => setScoreDetailOpen(false)} />}

      {/* ── Produit inconnu — la caisse ne crée jamais de produit ── */}
      {unknownProduct && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-white rounded-3xl shadow-elevated w-[460px] p-7 space-y-5 animate-scale-in">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-100 to-orange-200 text-orange-600 flex items-center justify-center">
                <ScanBarcode size={26} />
              </div>
              <div>
                <h3 className="font-bold text-lg text-pos-text">Produit inconnu</h3>
                <p className="text-sm text-pos-muted font-mono">{unknownProduct.barcode}</p>
              </div>
            </div>

            {unknownProduct.status === 'sent' || unknownProduct.status === 'already' ? (
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-start gap-2">
                <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
                <span>
                  {unknownProduct.status === 'already'
                    ? 'Une demande d’intégration est déjà en attente pour ce code-barres.'
                    : 'Demande envoyée au Dashboard / Inventaire. Un responsable pourra créer la fiche produit.'}
                </span>
              </div>
            ) : (
              <>
                <p className="text-sm text-pos-muted">
                  Ce produit n&rsquo;existe pas encore dans la base.{' '}
                  <span className="font-semibold text-pos-text">
                    La cr&eacute;ation produit doit &ecirc;tre faite depuis le Dashboard ou le module Inventaire.
                  </span>
                </p>
                <textarea
                  className="w-full rounded-2xl border-2 border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 resize-none"
                  rows={2}
                  placeholder="Commentaire (optionnel) : marque, rayon, prix affiché…"
                  value={unknownProduct.comment}
                  onChange={(e) => setUnknownProduct({ ...unknownProduct, comment: e.target.value })}
                />
                {unknownProduct.status === 'error' && (
                  <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
                    Envoi impossible. R&eacute;essayez ou signalez le code-barres &agrave; un responsable.
                  </div>
                )}
              </>
            )}

            <div className="flex gap-2">
              <button
                onClick={closeUnknownProduct}
                className="flex-1 py-3 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                {unknownProduct.status === 'sent' || unknownProduct.status === 'already' ? 'Fermer' : 'Annuler'}
              </button>
              {unknownProduct.status !== 'sent' && unknownProduct.status !== 'already' && (
                <button
                  onClick={sendIntegrationRequest}
                  disabled={unknownProduct.status === 'sending'}
                  className="flex-[2] py-3 rounded-xl text-sm font-medium bg-orange-500 text-white hover:bg-orange-600 transition-colors shadow-lg shadow-orange-500/25 disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {unknownProduct.status === 'sending'
                    ? <Loader2 size={16} className="animate-spin" />
                    : <ArrowRight size={16} />}
                  Envoyer au Dashboard / Inventaire
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Weight Modal ── */}
      {weightModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-white rounded-3xl shadow-elevated w-[420px] p-7 space-y-5 animate-scale-in">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${avatarColor(weightModal.name)} flex items-center justify-center font-bold text-lg`}>{initials(weightModal.name)}</div>
              <div>
                <h3 className="font-bold text-lg text-pos-text">{weightModal.name}</h3>
                <p className="text-sm text-amber-600 font-semibold flex items-center gap-1.5"><Weight size={14} />{(weightModal.priceMinorUnits / 100).toFixed(2).replace('.', ',')} &euro; / kg</p>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-pos-muted mb-2 uppercase tracking-wider">Poids (kg)</label>
              <div className="relative">
                <Weight size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-amber-500" />
                <input ref={weightRef} type="text" inputMode="decimal" className="w-full pl-12 pr-16 py-4 text-2xl font-bold text-center rounded-2xl border-2 border-amber-200 bg-amber-50/30 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 transition-all" placeholder="0,000" value={weightValue} onChange={(e) => setWeightValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleWeightConfirm(); if (e.key === 'Escape') { setWeightModal(null); setWeightValue(''); } }} />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-amber-600">kg</span>
              </div>
              <div className="flex gap-2 mt-3">
                {['0,100', '0,250', '0,500', '1,000'].map((w) => (
                  <button key={w} onClick={() => setWeightValue(w)} className="flex-1 py-2 rounded-xl border border-amber-200 text-sm font-semibold text-amber-700 hover:bg-amber-50 transition-colors">{w} kg</button>
                ))}
              </div>
              {weightValue && (
                <div className="mt-4 p-3 rounded-xl bg-pos-subtle text-center">
                  <span className="text-xs text-pos-muted">Prix estime : </span>
                  <span className="text-lg font-bold text-pos-text">
                    {(() => { const kg = parseFloat(weightValue.replace(',', '.')); return (isNaN(kg) || kg <= 0) ? '\u2014' : formatPrice(Math.round(weightModal.priceMinorUnits * kg)); })()}
                  </span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setWeightModal(null); setWeightValue(''); }} className="flex-1 py-3 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors">Annuler</button>
              <button onClick={handleWeightConfirm} disabled={!weightValue || parseFloat(weightValue.replace(',', '.')) <= 0} className="flex-1 py-3 rounded-xl text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors shadow-lg shadow-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                <Plus size={16} /> Ajouter au panier
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ── PAYMENT MODAL (Split payment) ── */}
      {/* ══════════════════════════════════════════════════════════ */}
      {store.paymentModalOpen && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-white rounded-3xl shadow-elevated w-[460px] p-7 space-y-5 animate-scale-in">
            {/* Header: Total + Remaining */}
            <div className="text-center">
              <p className="text-sm text-pos-muted font-medium">Total du ticket</p>
              <p className="text-3xl font-bold tracking-tight">{formatPrice(store.total())}</p>
              <p className="text-xs text-pos-muted mt-1">
                {store.cartItems.reduce((s, i) => s + i.quantity, 0)} article(s) &middot; {store.employee?.firstName}
              </p>
            </div>

            {/* Partial payments list */}
            {partialPayments.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-pos-muted uppercase tracking-wider">Paiements enregistres</p>
                {partialPayments.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-pos-subtle border border-pos-border/20">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      p.method === 'card' ? 'bg-indigo-50' : 'bg-emerald-50'
                    }`}>
                      {methodIconSmall(p.method)}
                    </div>
                    <div className="flex-1">
                      <span className="text-sm font-medium">{methodLabel(p.method)}</span>
                    </div>
                    <span className="font-bold text-sm">{formatPrice(p.amountMinorUnits)}</span>
                    <button
                      onClick={() => removePartialPayment(p.id)}
                      className="w-7 h-7 rounded-full flex items-center justify-center text-pos-muted hover:text-pos-danger hover:bg-pos-danger/10 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}

                {/* Summary line */}
                <div className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-pos-muted flex items-center gap-1.5">
                    <CheckCircle2 size={13} className="text-pos-success" />
                    Deja paye
                  </span>
                  <span className="font-semibold text-pos-success">{formatPrice(totalPaid)}</span>
                </div>
              </div>
            )}

            {/* Remaining amount */}
            <div className={`rounded-2xl p-4 text-center ${
              remaining > 0
                ? 'bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200'
                : 'bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200'
            }`}>
              <p className={`text-xs font-semibold uppercase tracking-wider ${remaining > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {remaining > 0 ? 'Reste a percevoir' : 'Ticket solde'}
              </p>
              <p className={`text-3xl font-black mt-1 ${remaining > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                {formatPrice(Math.max(remaining, 0))}
              </p>
            </div>

            {remaining > 0 && (
              <>
                {/* Amount input */}
                <div>
                  <label className="block text-xs font-semibold text-pos-muted mb-1.5 uppercase tracking-wider">
                    Montant a encaisser (laisser vide = tout le reste)
                  </label>
                  <div className="relative">
                    <Coins size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-pos-muted/50" />
                    <input
                      ref={splitInputRef}
                      type="text"
                      inputMode="decimal"
                      className="w-full pl-10 pr-12 py-3 text-lg font-bold rounded-xl border border-pos-border/40 focus:outline-none focus:ring-2 focus:ring-pos-accent/30 focus:border-pos-accent transition-all text-center"
                      placeholder={formatPrice(remaining)}
                      value={splitAmountInput}
                      onChange={(e) => setSplitAmountInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          // Enter without specifying method → use card as default
                          addPartialPayment('card');
                        }
                        if (e.key === 'Escape') {
                          if (partialPayments.length === 0) store.setPaymentModalOpen(false);
                          else { setSplitAmountInput(''); }
                        }
                      }}
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-pos-muted font-semibold">&euro;</span>
                  </div>

                  {/* Quick amount buttons */}
                  {remaining > 500 && (
                    <div className="flex gap-2 mt-2">
                      {[5, 10, 20, 50].filter((v) => v * 100 <= remaining).map((v) => (
                        <button
                          key={v}
                          onClick={() => setSplitAmountInput(String(v))}
                          className="flex-1 py-1.5 rounded-lg border border-pos-border/30 text-xs font-semibold text-pos-muted hover:bg-pos-subtle transition-colors"
                        >
                          {v} &euro;
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Payment method buttons */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-pos-muted uppercase tracking-wider flex items-center gap-1.5">
                    <Split size={12} />
                    Mode de paiement
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className={`flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl border-2 transition-all font-semibold text-sm ${
                        offlineMode.canPayByCard
                          ? 'border-pos-border/40 hover:border-pos-accent hover:bg-pos-accent/5'
                          : 'border-red-200 bg-red-50/50 opacity-50 cursor-not-allowed'
                      }`}
                      onClick={() => offlineMode.canPayByCard && addPartialPayment('card')}
                      disabled={processing || !offlineMode.canPayByCard}
                      title={!offlineMode.canPayByCard ? 'Carte bancaire indisponible (mode offline)' : ''}
                    >
                      <CreditCard size={18} className={offlineMode.canPayByCard ? 'text-pos-accent' : 'text-red-300'} />
                      {offlineMode.canPayByCard ? 'Carte' : 'CB indispo.'}
                    </button>
                    <button
                      className="flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl border-2 border-pos-border/40 hover:border-pos-success hover:bg-pos-success/5 transition-all font-semibold text-sm"
                      onClick={() => addPartialPayment('cash')}
                      disabled={processing}
                    >
                      <Banknote size={18} className="text-pos-success" /> Especes
                    </button>
                  </div>
                  {/* Additional tenders — no PSP, available offline. No cash change on these. */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className="flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl border-2 border-pos-border/40 hover:border-amber-400 hover:bg-amber-50 transition-all font-semibold text-sm"
                      onClick={() => addPartialPayment('voucher')}
                      disabled={processing}
                      title="Titre-resto (aucune monnaie rendue)"
                    >
                      <Ticket size={18} className="text-amber-500" /> Titre-resto
                    </button>
                    <button
                      className="flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl border-2 border-pos-border/40 hover:border-violet-400 hover:bg-violet-50 transition-all font-semibold text-sm"
                      onClick={() => addPartialPayment('gift_card')}
                      disabled={processing}
                      title="Carte cadeau (aucune monnaie rendue)"
                    >
                      <Gift size={18} className="text-violet-500" /> Carte cadeau
                    </button>
                  </div>
                  <button
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border-2 border-pos-border/40 hover:border-emerald-400 hover:bg-emerald-50 transition-all font-semibold text-sm"
                    onClick={() => setAvoirOpen(true)}
                    disabled={processing}
                    title="Payer avec un avoir"
                  >
                    <Ticket size={18} className="text-emerald-500" /> Payer par avoir
                  </button>
                  {/* Offline payment warning */}
                  {offlineMode.isOffline && (
                    <div className="mt-2 flex items-start gap-2 bg-amber-50 rounded-xl px-3 py-2 border border-amber-200">
                      <CloudOff size={12} className="text-amber-600 mt-0.5 flex-shrink-0" />
                      <p className="text-[10px] text-amber-700 leading-relaxed">
                        <span className="font-bold">Mode Offline</span> — {offlineMode.canPayByCard ? 'CB disponible via TPE autonome (4G).' : 'CB indisponible.'} Especes toujours acceptees. QR/Wallet indisponibles.
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Quick pay buttons (when no split started) */}
            {partialPayments.length === 0 && (
              <div className="border-t border-pos-border/20 pt-4 space-y-2">
                <p className="text-[10px] font-semibold text-pos-muted uppercase tracking-wider">Paiement rapide (total)</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm transition-all ${
                      offlineMode.canPayByCard
                        ? 'bg-pos-accent/5 border border-pos-accent/20 text-pos-accent hover:bg-pos-accent/10'
                        : 'bg-red-50/50 border border-red-200 text-red-300 cursor-not-allowed'
                    }`}
                    onClick={() => offlineMode.canPayByCard && handleQuickPayment('card')}
                    disabled={processing || !offlineMode.canPayByCard}
                    title={!offlineMode.canPayByCard ? 'CB indisponible en mode offline' : ''}
                  >
                    <CreditCard size={16} /> {offlineMode.canPayByCard ? 'Tout en CB' : 'CB indispo.'}
                  </button>
                  <button
                    className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-pos-success/5 border border-pos-success/20 text-pos-success font-semibold text-sm hover:bg-pos-success/10 transition-all"
                    onClick={() => handleQuickPayment('cash')}
                    disabled={processing}
                  >
                    <Banknote size={16} /> Tout en especes
                  </button>
                </div>
                {/* Offline quick pay notice */}
                {offlineMode.isOffline && !offlineMode.canPayByCard && (
                  <p className="text-[9px] text-red-500 font-medium mt-1 text-center">
                    Paiement CB indisponible — Utilisez especes ou attendez le retour du reseau
                  </p>
                )}
              </div>
            )}

            <button
              className="btn-ghost w-full text-sm"
              onClick={() => {
                setPartialPayments([]);
                setSplitAmountInput('');
                store.setPaymentModalOpen(false);
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ── TPE WAITING OVERLAY ── */}
      {/* ══════════════════════════════════════════════════════════ */}
      {tpeWaiting && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-[100] animate-fade-in">
          <div className="bg-white rounded-3xl shadow-elevated p-8 w-[420px] text-center">
            {/* Waiting state */}
            {!tpeResult && (
              <>
                <div className="mb-4 px-3 py-2 rounded-xl bg-amber-100 text-amber-800 text-xs font-black tracking-wide">
                  MODE DÉMO — aucun paiement réel. La vente restera « à régulariser ».
                </div>
                {/* Animated card icon */}
                <div className="relative mx-auto w-24 h-24 mb-6">
                  <div className="absolute inset-0 rounded-full bg-pos-accent/10 animate-ping" />
                  <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-pos-accent to-indigo-400 flex items-center justify-center">
                    <CreditCard size={40} className="text-white animate-pulse" />
                  </div>
                </div>

                <h3 className="text-xl font-black text-pos-text mb-2">En attente du TPE (démo)...</h3>
                <p className="text-sm text-pos-muted mb-1">Presentez la carte sur le terminal</p>
                <p className="text-2xl font-black text-pos-accent mb-4">
                  {(tpeWaiting.amountMinorUnits / 100).toFixed(2).replace('.', ',')} €
                </p>

                {/* Countdown */}
                <div className="flex items-center justify-center gap-3 mb-6">
                  <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-pos-accent rounded-full transition-all duration-1000"
                      style={{ width: `${(tpeCountdown / 25) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-mono text-pos-muted font-semibold">{tpeCountdown}s</span>
                </div>

                {/* Dots animation */}
                <div className="flex items-center justify-center gap-1.5 mb-6">
                  <div className="w-2.5 h-2.5 rounded-full bg-pos-accent animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2.5 h-2.5 rounded-full bg-pos-accent animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2.5 h-2.5 rounded-full bg-pos-accent animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>

                <button
                  className="w-full py-3 mb-2 rounded-xl text-sm font-black bg-amber-500 text-white"
                  onClick={simulateDemoTpeSuccess}
                >
                  Simuler l'acceptation (DÉMO)
                </button>
                <button
                  className="btn-ghost w-full text-sm"
                  onClick={cancelTpeWaiting}
                >
                  Annuler
                </button>
              </>
            )}

            {/* Success state */}
            {tpeResult === 'success' && (
              <>
                <div className="mx-auto w-24 h-24 rounded-full bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center mb-6 animate-scale-in">
                  <CheckCircle2 size={48} className="text-white" />
                </div>
                <h3 className="text-xl font-black text-emerald-600 mb-2">Paiement simule (DÉMO) — a regulariser</h3>
                <p className="text-sm text-pos-muted">Aucun paiement reel n'a ete capture</p>
                <p className="text-2xl font-black text-emerald-600 mt-3">
                  {(tpeWaiting.amountMinorUnits / 100).toFixed(2).replace('.', ',')} €
                </p>
              </>
            )}

            {/* Refused state */}
            {tpeResult === 'refused' && (
              <>
                <div className="mx-auto w-24 h-24 rounded-full bg-gradient-to-br from-red-400 to-rose-500 flex items-center justify-center mb-6 animate-scale-in">
                  <XCircle size={48} className="text-white" />
                </div>
                <h3 className="text-xl font-black text-red-600 mb-2">Paiement refuse</h3>
                <p className="text-sm text-pos-muted mb-4">Le terminal a refuse la transaction</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-pos-accent/10 text-pos-accent font-semibold text-sm hover:bg-pos-accent/20 transition-all"
                    onClick={() => {
                      const saved = tpeWaitingRef.current || tpeWaiting;
                      if (!saved) return;
                      setTpeResult(null);
                      startTpeWaiting(saved.amountMinorUnits, saved.context);
                    }}
                  >
                    <CreditCard size={14} /> Reessayer
                  </button>
                  <button
                    className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-pos-success/10 text-pos-success font-semibold text-sm hover:bg-pos-success/20 transition-all"
                    onClick={() => {
                      const saved = tpeWaitingRef.current || tpeWaiting;
                      if (!saved) return;
                      const { amountMinorUnits, context } = saved;
                      cancelTpeWaiting();
                      if (context === 'quick') {
                        handleQuickPayment('cash');
                      } else {
                        commitPartialPayment('cash', amountMinorUnits);
                      }
                    }}
                  >
                    <Banknote size={14} /> Payer en especes
                  </button>
                </div>
                <button
                  className="btn-ghost w-full text-sm mt-2"
                  onClick={cancelTpeWaiting}
                >
                  Annuler
                </button>
              </>
            )}

            {/* Timeout state */}
            {tpeResult === 'timeout' && (
              <>
                <div className="mx-auto w-24 h-24 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mb-6 animate-scale-in">
                  <Clock size={48} className="text-white" />
                </div>
                <h3 className="text-xl font-black text-amber-600 mb-2">Delai depasse</h3>
                <p className="text-sm text-pos-muted mb-4">Le terminal n'a pas repondu dans les temps</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-pos-accent/10 text-pos-accent font-semibold text-sm hover:bg-pos-accent/20 transition-all"
                    onClick={() => {
                      const saved = tpeWaitingRef.current || tpeWaiting;
                      if (!saved) return;
                      setTpeResult(null);
                      startTpeWaiting(saved.amountMinorUnits, saved.context);
                    }}
                  >
                    <CreditCard size={14} /> Reessayer
                  </button>
                  <button
                    className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-pos-success/10 text-pos-success font-semibold text-sm hover:bg-pos-success/20 transition-all"
                    onClick={() => {
                      const saved = tpeWaitingRef.current || tpeWaiting;
                      if (!saved) return;
                      const { amountMinorUnits, context } = saved;
                      cancelTpeWaiting();
                      if (context === 'quick') {
                        handleQuickPayment('cash');
                      } else {
                        commitPartialPayment('cash', amountMinorUnits);
                      }
                    }}
                  >
                    <Banknote size={14} /> Payer en especes
                  </button>
                </div>
                <button
                  className="btn-ghost w-full text-sm mt-2"
                  onClick={cancelTpeWaiting}
                >
                  Annuler
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ── TICKET HISTORY MODAL (shared component) ── */}
      {/* ══════════════════════════════════════════════════════════ */}
      <TicketHistoryModal
        open={ticketHistory.historyOpen}
        onClose={ticketHistory.closeHistory}
        historySearch={ticketHistory.historySearch}
        onSearchChange={ticketHistory.setHistorySearch}
        historyFilterTime={ticketHistory.historyFilterTime}
        onFilterTimeChange={ticketHistory.setHistoryFilterTime}
        filteredHistory={ticketHistory.filteredHistory}
        searchRef={ticketHistory.historySearchRef}
        confirmPrintTicket={ticketHistory.confirmPrintTicket}
        onConfirmPrintTicket={ticketHistory.setConfirmPrintTicket}
        duplicatePreview={ticketHistory.duplicatePreview}
        onDuplicatePreview={ticketHistory.setDuplicatePreview}
        onReprint={ticketHistory.handleReprint}
      />


      {/* ══════════════════════════════════════════════════════════ */}
      {/* ── FULLSCREEN CONFIRMATION OVERLAY ── */}
      {/* ══════════════════════════════════════════════════════════ */}
      {confirmation && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-emerald-900/95 via-emerald-800/95 to-teal-900/95 backdrop-blur-xl animate-fade-in">
          {/* Success animation pulse */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-emerald-500/10 animate-ping" style={{ animationDuration: '2s' }} />
          </div>

          <div className="relative text-center space-y-8 max-w-lg w-full px-6 animate-scale-in">
            {/* Checkmark */}
            <div className="mx-auto w-24 h-24 rounded-full bg-white/10 border-4 border-emerald-400 flex items-center justify-center animate-scale-in" style={{ animationDelay: '150ms' }}>
              <CheckCircle2 size={48} className="text-emerald-400" strokeWidth={2.5} />
            </div>

            {/* Title */}
            <div className="space-y-2">
              <h1 className="text-3xl font-black text-white tracking-tight">PAIEMENT ACCEPTE</h1>
              <div className="flex items-center justify-center gap-2 text-emerald-300">
                {methodIcon(confirmation.method)}
                <span className="font-semibold">{methodLabel(confirmation.method)}</span>
              </div>
            </div>

            {/* Amount */}
            <div className="bg-white/10 rounded-3xl p-6 backdrop-blur-sm border border-white/10">
              <p className="text-6xl font-black text-white tracking-tight">{formatPrice(confirmation.total)}</p>
              <div className="flex items-center justify-center gap-4 mt-3 text-sm text-emerald-300/80">
                <span>{confirmation.itemCount} article{confirmation.itemCount > 1 ? 's' : ''}</span>
                <span>&middot;</span>
                <span>{confirmation.ticketNumber}</span>
                <span>&middot;</span>
                <span>{confirmation.cashierName}</span>
              </div>

              {/* Payment breakdown for split payments */}
              {confirmation.payments.length > 1 && (
                <div className="mt-4 pt-3 border-t border-white/10 space-y-1.5">
                  {confirmation.payments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between text-sm text-emerald-300/70">
                      <span className="flex items-center gap-2">
                        {p.method === 'card' ? <CreditCard size={13} /> : <Banknote size={13} />}
                        {methodLabel(p.method)}
                      </span>
                      <span className="font-semibold">{formatPrice(p.amountMinorUnits)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Change amount */}
              {confirmation.changeAmount > 0 && (
                <div className="mt-3 pt-3 border-t border-white/10">
                  <div className="flex items-center justify-center gap-2 text-lg">
                    <Coins size={18} className="text-amber-400" />
                    <span className="font-black text-amber-400">Monnaie a rendre : {formatPrice(confirmation.changeAmount)}</span>
                  </div>
                </div>
              )}

              {lastTransactionTime !== null && lastTransactionTime > 0 && (
                <p className="text-[11px] text-emerald-400/60 mt-2 flex items-center justify-center gap-1">
                  <Clock size={11} /> Transaction en {lastTransactionTime}s
                </p>
              )}

              {/* Statut d'impression HONNÊTE (résultat réel du spooler, pas la
                  simple connectivité). La vente reste valide quoi qu'il arrive. */}
              {lastPrintStatus === 'printed' && (
                <p className="mt-2 text-xs font-bold text-emerald-300">Ticket imprimé.</p>
              )}
              {lastPrintStatus === 'print_failed' && (
                <p className="mt-2 text-xs font-black text-red-300">
                  Ticket NON imprimé — échec imprimante. Vente validée. Réimpression possible depuis l'historique.
                </p>
              )}
              {(lastPrintStatus === 'no_printer' || lastPrintStatus === null) &&
                (!peripheralBridge.status.printer.connected ||
                  peripheralBridge.status.printer.type === 'none' ||
                  peripheralBridge.status.printer.type === 'browser_print') && (
                  <p className="mt-2 text-xs font-black text-amber-300">
                    Aucune imprimante connectée — ticket NON imprimé (QR / email disponibles).
                  </p>
                )}

              {/* Statut TIROIR — DISTINCT de la vente et de l'impression (jamais
                  fusionnés). Le tiroir ne s'affiche que pour une vente espèces
                  (`not_requested` = CB pure → silencieux). */}
              {lastDrawerStatus === 'opened' && (
                <p className="mt-1 text-xs font-bold text-emerald-300">Tiroir-caisse ouvert.</p>
              )}
              {lastDrawerStatus === 'open_failed' && (
                <p className="mt-1 text-xs font-black text-amber-300">
                  Tiroir NON ouvert — vérifier le branchement. Vente validée, ouverture manuelle possible.
                </p>
              )}
            </div>

            {/* ── Ticket choice buttons ── */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-white/60">Choix du ticket</p>
              <div className="grid grid-cols-3 gap-3">
                {/* Paper ticket — default for cash */}
                <button
                  onClick={() => handleTicketChoice('paper')}
                  className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all hover:scale-[1.03] active:scale-[0.97] ${
                    confirmation.method === 'cash'
                      ? 'border-emerald-400 bg-emerald-400/10 ring-2 ring-emerald-400/30'
                      : 'border-white/20 bg-white/5 hover:border-white/40'
                  }`}
                >
                  <FileText size={24} className="text-white" />
                  <span className="text-sm font-semibold text-white">Ticket papier</span>
                  {confirmation.method === 'cash' && (
                    <span className="text-[9px] font-bold text-emerald-400 bg-emerald-400/20 px-2 py-0.5 rounded-full">DEFAUT</span>
                  )}
                </button>

                {/* Digital ticket — default for card */}
                <button
                  onClick={() => handleTicketChoice('digital')}
                  className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all hover:scale-[1.03] active:scale-[0.97] ${
                    confirmation.method === 'card'
                      ? 'border-emerald-400 bg-emerald-400/10 ring-2 ring-emerald-400/30'
                      : 'border-white/20 bg-white/5 hover:border-white/40'
                  }`}
                >
                  <Smartphone size={24} className="text-white" />
                  <span className="text-sm font-semibold text-white">Ticket digital</span>
                  {confirmation.method === 'card' && (
                    <span className="text-[9px] font-bold text-emerald-400 bg-emerald-400/20 px-2 py-0.5 rounded-full">DEFAUT</span>
                  )}
                </button>

                {/* No ticket — default for mixed */}
                <button
                  onClick={() => handleTicketChoice('none')}
                  className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all hover:scale-[1.03] active:scale-[0.97] ${
                    confirmation.method === 'mixed'
                      ? 'border-emerald-400 bg-emerald-400/10 ring-2 ring-emerald-400/30'
                      : 'border-white/20 bg-white/5 hover:border-white/40'
                  }`}
                >
                  <XCircle size={24} className="text-white" />
                  <span className="text-sm font-semibold text-white">Pas de ticket</span>
                  {confirmation.method === 'mixed' && (
                    <span className="text-[9px] font-bold text-emerald-400 bg-emerald-400/20 px-2 py-0.5 rounded-full">DEFAUT</span>
                  )}
                </button>
              </div>

              {/* Email receipt — only when the sale reached the server (has a saleId) */}
              {(store as any).lastSaleId && (
                <button
                  onClick={() => { setEmailValue(''); setEmailStatus('idle'); setEmailModal(true); }}
                  className="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-white/20 bg-white/5 hover:border-white/40 transition-all text-sm font-semibold text-white"
                >
                  <Mail size={18} /> Envoyer le reçu par email
                </button>
              )}
            </div>

            {/* Countdown + auto-dismiss */}
            <div className="space-y-2">
              <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-400 rounded-full transition-all duration-1000 ease-linear"
                  style={{ width: `${(ticketCountdown / (TICKET_TIMEOUT_MS / 1000)) * 100}%` }}
                />
              </div>
              <p className="text-xs text-white/40">
                Nouvelle vente automatique dans {ticketCountdown}s
                {confirmation.method === 'cash' && ' (ticket papier par defaut)'}
                {confirmation.method === 'card' && ' (pas de ticket par defaut)'}
                {confirmation.method === 'mixed' && ' (pas de ticket par defaut)'}
              </p>
            </div>

            {/* ── BOUTON DE SECOURS "NOUVELLE VENTE" ── */}
            <button
              onClick={() => completeTransaction()}
              className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl bg-white/15 hover:bg-white/25 border-2 border-white/30 hover:border-white/50 text-white font-black text-lg tracking-wide transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg"
            >
              <ArrowRight size={22} className="text-emerald-300" />
              Nouvelle Vente
            </button>
          </div>
        </div>
      )}

      {/* ═══════ EMAIL RECEIPT MODAL ═══════ */}
      {emailModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setEmailModal(false)}>
          <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <Mail size={20} className="text-emerald-600" />
              <h3 className="text-lg font-bold text-gray-900">Reçu par email</h3>
            </div>
            {emailStatus === 'sent' ? (
              <div className="text-center py-6">
                <CheckCircle2 size={40} className="mx-auto text-emerald-500 mb-2" />
                <p className="text-sm font-semibold text-gray-800">Reçu envoyé à {emailValue}</p>
                <button onClick={() => setEmailModal(false)} className="mt-5 w-full py-3 rounded-2xl bg-emerald-600 text-white font-semibold">Fermer</button>
              </div>
            ) : (
              <>
                <input
                  type="email"
                  value={emailValue}
                  onChange={(e) => { setEmailValue(e.target.value); if (emailStatus !== 'idle') setEmailStatus('idle'); }}
                  placeholder="client@email.com"
                  autoFocus
                  className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                  onKeyDown={(e) => { if (e.key === 'Enter') sendReceiptEmail(); }}
                />
                {emailStatus === 'error' && <p className="text-xs text-red-500 mt-2">Adresse invalide ou échec de l'envoi.</p>}
                {emailStatus === 'disabled' && <p className="text-xs text-amber-600 mt-2">Service email non configuré sur le serveur.</p>}
                <div className="flex gap-3 mt-5">
                  <button onClick={() => setEmailModal(false)} className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-500">Annuler</button>
                  <button
                    onClick={sendReceiptEmail}
                    disabled={emailStatus === 'sending'}
                    className="flex-1 py-3 rounded-2xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {emailStatus === 'sending' && <Loader2 size={15} className="animate-spin" />}
                    Envoyer
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══════ RETURN / CREDIT-NOTE MODAL ═══════ */}
      {returnOpen && <ReturnModal onClose={() => setReturnOpen(false)} />}

      {/* ═══════ PAY-BY-AVOIR TENDER MODAL ═══════ */}
      {avoirOpen && (
        <AvoirTenderModal
          amountDueMinor={remaining}
          onApply={(code, amt) => { commitPartialPayment('store_credit', amt, code); setAvoirOpen(false); }}
          onClose={() => setAvoirOpen(false)}
        />
      )}

      {/* ═══════ CAMERA BARCODE SCANNER OVERLAY (iPad/Tablet) ═══════ */}
      {cameraOpen && (
        <div className="camera-scanner-overlay" onClick={() => setCameraOpen(false)}>
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <video
              ref={cameraVideoRef}
              autoPlay
              playsInline
              muted
              className="rounded-2xl"
              style={{ width: '80vw', maxWidth: '600px', height: 'auto' }}
              onLoadedMetadata={() => {
                if (cameraVideoRef.current) {
                  peripheralBridge.startCameraScanner(cameraVideoRef.current);
                }
              }}
            />
            <div className="scan-guide" style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
          </div>
          <p className="text-white/80 text-sm mt-4 font-medium">Placez le code-barre dans le cadre</p>
          <button
            onClick={() => {
              peripheralBridge.stopCameraScanner();
              setCameraOpen(false);
            }}
            className="mt-4 btn-danger px-6 py-3"
          >
            <X size={16} className="inline mr-2" /> Fermer
          </button>
        </div>
      )}

      {/* ═══════ DEVICE INFO (dev only) ═══════ */}
      {location.hostname === 'localhost' && (
        <div className="fixed bottom-1 left-1 z-[9999] text-[9px] font-mono text-pos-muted/40 pointer-events-none">
          {device.platform} | {device.inputMode} | {device.screenClass} | {device.viewportWidth}x{device.viewportHeight}
        </div>
      )}

      {/* ═══════ STOCK ALERT TOAST ═══════ */}
      <StockAlertToast />

      {/* ═══════ SALE GUARDS (anti-error, before payment) ═══════ */}
      <SaleGuardsGate />
    </div>
  );
}
