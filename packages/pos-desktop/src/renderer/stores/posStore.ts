import { create } from 'zustand';
import { authApi } from '../services/api';
import type { PaymentMethod } from '../services/paymentMachine';

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

  // Cart
  cartItems: CartItem[];
  customerQrCode: string | null;
  customer: Customer | null;

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
  logout: () => void;
  addToCart: (item: Omit<CartItem, 'quantity' | 'discountMinorUnits'>) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
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

export const usePOSStore = create<POSState>((set, get) => ({
  employee: null,
  accessToken: null,
  cartItems: [],
  customerQrCode: null,
  customer: null,
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
  },

  logout: () => {
    authApi.logout().catch(() => console.warn('[POS] Server-side logout failed'));
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('pos_employee');
    set({
      employee: null,
      accessToken: null,
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

  clearCustomer: () => {
    set({ customer: null, customerQrCode: null });
  },

  clearCart: () => {
    set({
      cartItems: [],
      customer: null,
      customerQrCode: null,
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
  totalDiscount: () =>
    get().cartItems.reduce((sum, i) => sum + i.discountMinorUnits, 0),
  total: () => get().subtotal() - get().totalDiscount(),
}));
