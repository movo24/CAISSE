import { create } from 'zustand';
import { authApi, posSessionApi, employeeScoreApi } from '../services/api';

/** Session POS active (une caisse appartient à un caissier pendant une session). */
export interface PosSession {
  id: string;
  openedAt: string; // ISO
  terminalId: string | null;
}
import type { PaymentMethod } from '../services/paymentMachine';
import { computePromoDiscount } from '../services/discount-policy';

export interface CartItem {
  productId: string;
  ean: string;
  name: string;
  unitPriceMinorUnits: number;
  quantity: number;
  discountMinorUnits: number;
  promoName?: string;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  storeId: string;
}

interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  qrCode: string;
  loyaltyPoints: number;
  isFirstPurchase: boolean;
}

/* ── Ticket History ── */

export interface TicketPayment {
  method: PaymentMethod;
  amountMinorUnits: number;
}

export interface TicketItem {
  name: string;
  ean: string;
  quantity: number;
  unitPriceMinorUnits: number;
  discountMinorUnits: number;
}

export interface TicketHistoryEntry {
  ticketNumber: string;
  timestamp: Date;
  items: TicketItem[];
  payments: TicketPayment[];
  totalMinorUnits: number;
  subtotalMinorUnits: number;
  discountMinorUnits: number;
  changeMinorUnits: number;
  cashierName: string;
  customerName?: string;
  reprintCount: number;
  reprintLog: { at: Date; by: string }[];
}

export interface JackpotResult {
  type: 'mega_jackpot' | 'small_win' | 'no_win';
  rouletteVideoUrl: string | null;
  winVideoUrl: string | null;
  thanksVideoUrl: string | null;
  winAudioUrl: string | null;
  thanksAudioUrl: string | null;
}

export interface WeatherData {
  temp: number;
  feelsLike: number;
  description: string;
  icon: string;
  city: string;
  isRaining: boolean;
  rainIntensity: number;
  businessCategory: string;   // hot|cold|rain|heavy_rain|wind|clear|cloudy
  trafficImpact?: {
    level: string;
    message: string;
    estimatedImpactPercent: number;
  };
  recommendations?: Array<{
    message: string;
    priority: string;
  }>;
}

export interface OccupancyData {
  storeId: string;
  liveCount: number;
  updatedAt: string;
}

/* ── Suspended Ticket ── */

export interface SuspendedTicket {
  id: string;
  items: CartItem[];
  customer: { id: string; firstName: string; lastName: string; qrCode: string; loyaltyPoints: number; isFirstPurchase: boolean } | null;
  customerQrCode: string | null;
  note: string;
  suspendedAt: Date;
  cashierName: string;
}

/* ── Store / Business Info (displayed on tickets) ── */

export interface StoreInfo {
  // Identite commerciale
  storeName: string;             // Raison sociale / enseigne
  address: string;               // Adresse complete
  postalCode: string;            // Code postal
  city: string;                  // Ville
  phone: string;                 // Telephone

  // Mentions legales obligatoires
  siret: string;                 // SIRET (14 chiffres)
  siren: string;                 // SIREN (9 chiffres)
  naf: string;                   // Code NAF / APE
  tvaIntracom: string;           // N° TVA intracommunautaire
  rcs: string;                   // RCS + ville d'immatriculation
  capitalSocial: string;         // Capital social
  formeJuridique: string;        // SAS, SARL, EURL, etc.

  // Infos caisse
  softwareName: string;          // Nom du logiciel de caisse
  softwareVersion: string;       // Version du logiciel
  nifCaisse: string;             // N° d'identification fiscale caisse (NF525)

  // Personnalisation ticket
  headerMessage?: string;        // Message en haut du ticket
  footerMessage?: string;        // Message en bas du ticket (ex: "Merci de votre visite !")
}

interface POSState {
  // Auth
  employee: Employee | null;
  accessToken: string | null;
  posSession: PosSession | null;
  /** Demande de verrouillage explicite (bouton « Changer de caissier »). */
  lockRequested: boolean;
  /** Modale de comptage caisse ouverte (fermeture explicite de la session). */
  cashCountOpen: boolean;
  /** La session vient d'ouvrir sans fond de caisse déclaré → saisie demandée. */
  openingCashRequired: boolean;

  // Cart
  cartItems: CartItem[];
  customerQrCode: string | null;
  customer: Customer | null;
  // Manual cart discount (decision 5) — capped 30%, requires a manager approver.
  manualDiscountMinorUnits: number;
  discountApproverId: string | null;
  // Promo code applied at the sale (decision 6) — owner-defined; the server
  // re-validates + redeems atomically. Discount computed live (getter) so it tracks
  // cart changes and mirrors the server's base exactly.
  promoCode: string | null;
  promoDiscountInfo: { discountType: 'percentage' | 'fixed'; discountValue: number } | null;

  // UI
  scanMode: 'product' | 'customer' | 'employee';
  paymentModalOpen: boolean;
  lastTicket: any | null;

  // Jackpot & Flux
  jackpotResult: JackpotResult | null;
  occupancy: OccupancyData | null;
  weather: WeatherData | null;

  // Ticket History
  ticketHistory: TicketHistoryEntry[];

  // Store / Business info
  storeInfo: StoreInfo | null;

  // Suspended tickets
  suspendedTickets: SuspendedTicket[];

  // Actions
  setEmployee: (employee: Employee, token: string) => void;
  setPosSession: (session: PosSession | null) => void;
  /** Vrai quand l'ouverture de session serveur a échoué (open + récupération
   *  active) : la caisse tourne alors SANS session — état affiché, jamais tu. */
  posSessionOpenFailed: boolean;
  /** Prompt « Serveur de retour — rouvrir une session ? » (jamais silencieux). */
  sessionReopenOffered: boolean;
  dismissSessionReopen: () => void;
  /** Rouvre une session avec le contenu ACTUEL du tiroir comme fond.
   *  Single-flight ; 409 → adopte la session active existante (aucun doublon).
   *  Retourne true si une session est active à l'issue de l'appel. */
  reopenSessionWithFloat: (openingCashMinorUnits: number) => Promise<boolean>;
  openPosSession: () => Promise<void>;
  /** Changement de caissier explicite : ferme la session précédente, ouvre une
   *  nouvelle et journalise EMPLOYEE_SWITCHED (jamais de switch silencieux). */
  switchEmployee: (employee: Employee, token: string) => Promise<void>;
  /** Journalise un fait de score signé (session courante). Best-effort. */
  logScoreEvent: (eventType: string, reason?: string) => void;
  /** Demande/annule un verrouillage explicite de la caisse. */
  requestLock: (v: boolean) => void;
  /** Ouvre/ferme la modale de comptage caisse (fermeture explicite). */
  openCashCount: () => void;
  closeCashCount: () => void;
  /** Déclare le fond de caisse à l'ouverture (caissier, une fois). */
  declareOpeningCash: (openingCashMinorUnits: number) => Promise<void>;
  /** Passe la saisie du fond (fond inconnu — état auditable côté serveur). */
  dismissOpeningCash: () => void;
  /**
   * Ferme la session et déconnecte. `countedCashMinorUnits` (optionnel) = le
   * SEUL montant saisi par le caissier ; l'attendu et l'écart sont calculés
   * côté serveur, jamais envoyés par le client. `skipReason` (optionnel) =
   * motif obligatoire d'une fermeture explicite SANS comptage.
   */
  logout: (countedCashMinorUnits?: number, skipReason?: string) => void;
  addToCart: (item: Omit<CartItem, 'quantity' | 'discountMinorUnits'>) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  setManualDiscount: (minorUnits: number, approverId: string | null) => void;
  setPromoCode: (code: string, info: { discountType: 'percentage' | 'fixed'; discountValue: number }) => void;
  clearPromoCode: () => void;
  promoDiscount: () => number;
  setCustomer: (customer: Customer, qrCode: string) => void;
  clearCustomer: () => void;
  clearCart: () => void;
  setScanMode: (mode: 'product' | 'customer' | 'employee') => void;
  setPaymentModalOpen: (open: boolean) => void;
  setLastTicket: (ticket: any) => void;
  setJackpotResult: (result: JackpotResult | null) => void;
  clearJackpotResult: () => void;
  setOccupancy: (data: OccupancyData | null) => void;
  setWeather: (data: WeatherData | null) => void;
  addTicketToHistory: (ticket: TicketHistoryEntry) => void;
  logReprint: (ticketNumber: string, by: string) => void;
  setStoreInfo: (info: StoreInfo) => void;

  // Suspended tickets
  suspendTicket: (note?: string) => void;
  resumeTicket: (ticketId: string) => void;
  deleteSuspendedTicket: (ticketId: string) => void;

  // Computed
  subtotal: () => number;
  totalDiscount: () => number;
  total: () => number;
}

// Verrou single-flight de la réouverture de session (jamais deux open en vol).
let reopenInFlight = false;

export const usePOSStore = create<POSState>((set, get) => ({
  employee: null,
  accessToken: null,
  posSession: null,
  lockRequested: false,
  cashCountOpen: false,
  openingCashRequired: false,
  posSessionOpenFailed: false,
  sessionReopenOffered: false,
  cartItems: [],
  customerQrCode: null,
  customer: null,
  manualDiscountMinorUnits: 0,
  discountApproverId: null,
  promoCode: null,
  promoDiscountInfo: null,
  scanMode: 'product',
  paymentModalOpen: false,
  lastTicket: null,
  jackpotResult: null,
  occupancy: null,
  weather: null,
  ticketHistory: [],
  storeInfo: null,
  suspendedTickets: (() => {
    try {
      const raw = localStorage.getItem('caisse_suspended_tickets');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  })(),

  setEmployee: (employee, token) => {
    localStorage.setItem('accessToken', token);
    localStorage.setItem('pos_employee', JSON.stringify(employee));
    set({ employee, accessToken: token });
    // Ouvre une session POS liée au terminal (signature technique). Best-effort :
    // une panne de session ne bloque pas la connexion.
    void get().openPosSession();
  },

  setPosSession: (session) => set({ posSession: session }),

  requestLock: (v) => set({ lockRequested: v }),

  openCashCount: () => set({ cashCountOpen: true }),
  closeCashCount: () => set({ cashCountOpen: false }),

  declareOpeningCash: async (openingCashMinorUnits) => {
    const { posSession } = get();
    if (!posSession?.id) { set({ openingCashRequired: false }); return; }
    try {
      await posSessionApi.setOpeningCash(posSession.id, openingCashMinorUnits);
    } catch {
      // Best-effort : ne bloque jamais la caisse (le fond reste null = inconnu).
      console.warn('[POS] setOpeningCash failed');
    } finally {
      set({ openingCashRequired: false });
    }
  },
  dismissOpeningCash: () => set({ openingCashRequired: false }),

  logScoreEvent: (eventType, reason) => {
    const { posSession } = get();
    employeeScoreApi
      .logEvent({ eventType, sessionId: posSession?.id, reason })
      .catch(() => { /* best-effort : ne bloque jamais la caisse */ });
  },

  switchEmployee: async (employee, token) => {
    const { posSession, employee: previous } = get();
    // 1. Journalise le changement AVANT de basculer (attribué à l'ancienne session).
    if (previous && previous.id !== employee.id) {
      employeeScoreApi
        .logEvent({
          eventType: 'EMPLOYEE_SWITCHED',
          sessionId: posSession?.id,
          reason: `${previous.firstName} ${previous.lastName} → ${employee.firstName} ${employee.lastName}`,
        })
        .catch(() => undefined);
    }
    // 2. Ferme la session précédente (fermeture explicite, pas d'abandon).
    if (posSession?.id) {
      await posSessionApi.close(posSession.id).catch(() => undefined);
    }
    // 3. Bascule l'identité + nouvelle session.
    localStorage.setItem('accessToken', token);
    localStorage.setItem('pos_employee', JSON.stringify(employee));
    set({ employee, accessToken: token, posSession: null });
    await get().openPosSession();
  },

  dismissSessionReopen: () => set({ sessionReopenOffered: false }),

  reopenSessionWithFloat: async (openingCashMinorUnits: number) => {
    // Single-flight : un seul appel en vol, les clics répétés sont ignorés.
    if (reopenInFlight) return false;
    if (get().posSession?.id) { set({ sessionReopenOffered: false }); return true; }
    reopenInFlight = true;
    try {
      const res = await posSessionApi.open(openingCashMinorUnits);
      const s = res.data;
      if (s?.id) {
        set({
          posSession: { id: s.id, openedAt: s.openedAt || new Date().toISOString(), terminalId: s.terminalId ?? null },
          openingCashRequired: s.openingCashMinorUnits == null,
          posSessionOpenFailed: false,
          sessionReopenOffered: false,
        });
        return true;
      }
      return false;
    } catch {
      // 409 : une session est déjà active sur ce terminal → on l'ADOPTE, jamais
      // de doublon (le fond saisi est ignoré : la session existante fait foi).
      try {
        const act = await posSessionApi.active();
        const s = act.data;
        if (s?.id) {
          set({
            posSession: { id: s.id, openedAt: s.openedAt || new Date().toISOString(), terminalId: s.terminalId ?? null },
            openingCashRequired: s.openingCashMinorUnits == null,
            posSessionOpenFailed: false,
            sessionReopenOffered: false,
          });
          return true;
        }
      } catch { /* le prompt reste affiché, le caissier peut réessayer */ }
      return false;
    } finally {
      reopenInFlight = false;
    }
  },

  openPosSession: async () => {
    set({ posSessionOpenFailed: false });
    try {
      const res = await posSessionApi.open();
      const s = res.data;
      if (s?.id) {
        set({
          posSession: { id: s.id, openedAt: s.openedAt || new Date().toISOString(), terminalId: s.terminalId ?? null },
          // Fond non déclaré → on demande la saisie à l'ouverture.
          openingCashRequired: s.openingCashMinorUnits == null,
          posSessionOpenFailed: false,
        });
      } else {
        // Réponse sans id : la session n'existe pas côté serveur — état visible.
        set({ posSession: null, posSessionOpenFailed: true });
      }
    } catch (e: any) {
      // 409 = une session est déjà active sur ce terminal → on la récupère.
      try {
        const act = await posSessionApi.active();
        const s = act.data;
        if (s?.id) {
          set({
            posSession: { id: s.id, openedAt: s.openedAt || new Date().toISOString(), terminalId: s.terminalId ?? null },
            // Session récupérée : ne redemande que si le fond n'a jamais été déclaré.
            openingCashRequired: s.openingCashMinorUnits == null,
            posSessionOpenFailed: false,
          });
        } else {
          set({ posSession: null, posSessionOpenFailed: true });
        }
      } catch {
        // Échec TOTAL (réseau/serveur) : la caisse continue mais SANS session —
        // les ventes partiront avec session_id NULL (hors comptage de caisse).
        // Cet état ne doit JAMAIS être silencieux : le bandeau l'affiche.
        set({ posSession: null, posSessionOpenFailed: true });
      }
    }
  },

  logout: (countedCashMinorUnits?: number, skipReason?: string) => {
    const { posSession } = get();
    if (posSession?.id) {
      // Le compté est la seule valeur transmise ; l'attendu/écart sont dérivés
      // côté serveur. skipReason encadre une fermeture explicite sans comptage.
      // Best-effort : une panne réseau ne bloque pas la fermeture.
      posSessionApi
        .close(posSession.id, countedCashMinorUnits, skipReason)
        .catch(() => console.warn('[POS] Session close failed'));
    }
    authApi.logout().catch(() => console.warn('[POS] Server-side logout failed'));
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('pos_employee');
    set({
      employee: null,
      accessToken: null,
      posSession: null,
      cashCountOpen: false,
      cartItems: [],
      customer: null,
      customerQrCode: null,
    });
  },

  addToCart: (item) => {
    const { cartItems } = get();
    const existing = cartItems.find((i) => i.productId === item.productId);
    if (existing) {
      set({
        cartItems: cartItems.map((i) =>
          i.productId === item.productId
            ? { ...i, quantity: i.quantity + 1 }
            : i,
        ),
      });
    } else {
      set({
        cartItems: [
          ...cartItems,
          { ...item, quantity: 1, discountMinorUnits: 0 },
        ],
      });
    }
  },

  removeFromCart: (productId) => {
    set({
      cartItems: get().cartItems.filter((i) => i.productId !== productId),
    });
  },

  updateQuantity: (productId, quantity) => {
    if (quantity <= 0) {
      get().removeFromCart(productId);
      return;
    }
    set({
      cartItems: get().cartItems.map((i) =>
        i.productId === productId ? { ...i, quantity } : i,
      ),
    });
  },

  setCustomer: (customer, qrCode) => {
    set({ customer, customerQrCode: qrCode });
  },

  setManualDiscount: (minorUnits, approverId) => {
    set({ manualDiscountMinorUnits: Math.max(0, Math.round(minorUnits || 0)), discountApproverId: approverId });
  },

  setPromoCode: (code, info) => {
    set({ promoCode: (code || '').trim().toUpperCase() || null, promoDiscountInfo: info });
  },

  clearPromoCode: () => {
    set({ promoCode: null, promoDiscountInfo: null });
  },

  clearCustomer: () => {
    set({ customer: null, customerQrCode: null });
  },

  clearCart: () => {
    set({
      cartItems: [],
      customer: null,
      customerQrCode: null,
      manualDiscountMinorUnits: 0,
      discountApproverId: null,
      promoCode: null,
      promoDiscountInfo: null,
      paymentModalOpen: false,
    });
  },

  setScanMode: (mode) => set({ scanMode: mode }),
  setPaymentModalOpen: (open) => set({ paymentModalOpen: open }),
  setLastTicket: (ticket) => set({ lastTicket: ticket }),
  setJackpotResult: (result) => set({ jackpotResult: result }),
  clearJackpotResult: () => set({ jackpotResult: null }),
  setOccupancy: (data) => set({ occupancy: data }),
  setWeather: (data) => set({ weather: data }),

  addTicketToHistory: (ticket) => {
    set({ ticketHistory: [ticket, ...get().ticketHistory].slice(0, 200) });
  },

  setStoreInfo: (info) => set({ storeInfo: info }),

  logReprint: (ticketNumber, by) => {
    const { ticketHistory } = get();
    set({
      ticketHistory: ticketHistory.map((t) =>
        t.ticketNumber === ticketNumber
          ? {
              ...t,
              reprintCount: t.reprintCount + 1,
              reprintLog: [...t.reprintLog, { at: new Date(), by }],
            }
          : t,
      ),
    });
  },

  suspendTicket: (note?: string) => {
    const { cartItems, customer, customerQrCode, employee, suspendedTickets } = get();
    if (cartItems.length === 0) return;
    const ticket: SuspendedTicket = {
      id: `sus-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      items: [...cartItems],
      customer: customer ? { ...customer } : null,
      customerQrCode,
      note: note || '',
      suspendedAt: new Date(),
      cashierName: employee ? `${employee.firstName} ${employee.lastName}` : 'Caissier',
    };
    const updated = [ticket, ...suspendedTickets];
    set({ suspendedTickets: updated, cartItems: [], customer: null, customerQrCode: null, paymentModalOpen: false });
    try { localStorage.setItem('caisse_suspended_tickets', JSON.stringify(updated)); } catch {}
  },

  resumeTicket: (ticketId: string) => {
    const { suspendedTickets } = get();
    const ticket = suspendedTickets.find((t) => t.id === ticketId);
    if (!ticket) return;
    const updated = suspendedTickets.filter((t) => t.id !== ticketId);
    set({
      cartItems: ticket.items,
      customer: ticket.customer,
      customerQrCode: ticket.customerQrCode,
      suspendedTickets: updated,
    });
    try { localStorage.setItem('caisse_suspended_tickets', JSON.stringify(updated)); } catch {}
  },

  deleteSuspendedTicket: (ticketId: string) => {
    const updated = get().suspendedTickets.filter((t) => t.id !== ticketId);
    set({ suspendedTickets: updated });
    try { localStorage.setItem('caisse_suspended_tickets', JSON.stringify(updated)); } catch {}
  },

  subtotal: () =>
    get().cartItems.reduce(
      (sum, i) => sum + i.unitPriceMinorUnits * i.quantity,
      0,
    ),
  // Promo code discount (decision 6), computed LIVE on the same base the server uses
  // (subtotal − line discounts − manual discount) so the displayed total matches the
  // server total exactly. Owner-defined → not subject to the 30% manual cap.
  promoDiscount: () => {
    const lineDiscounts = get().cartItems.reduce((sum, i) => sum + i.discountMinorUnits, 0);
    const base = get().subtotal() - lineDiscounts - get().manualDiscountMinorUnits;
    return computePromoDiscount(base, get().promoDiscountInfo);
  },
  // Total discount = per-line discounts + manual cart discount (decision 5) + promo (decision 6).
  totalDiscount: () =>
    get().cartItems.reduce((sum, i) => sum + i.discountMinorUnits, 0) + get().manualDiscountMinorUnits + get().promoDiscount(),
  // Business invariant: a cart total is never negative. If discounts exceed the
  // subtotal, clamp at 0 (line state + discount semantics unchanged — only the
  // final total clamps).
  total: () => Math.max(0, get().subtotal() - get().totalDiscount()),
}));
