/**
 * Câblage impression ticket + tiroir-caisse dans le flux de vente DESKTOP.
 *
 * Règles (owner) :
 *  - après une vente FINALISÉE : imprimer le ticket si une imprimante active
 *    est configurée ; ouvrir le tiroir UNIQUEMENT si la vente contient des
 *    espèces réellement validées (jamais pour CB pure / annulée / échouée /
 *    en attente) ;
 *  - l'impression n'est JAMAIS une condition de réussite de la vente ;
 *  - échec d'impression → vente valide, erreur claire, réimpression possible,
 *    journalisé, pas de seconde vente ;
 *  - idempotent : pas de double ticket ni de double ouverture tiroir sur
 *    double-clic / retry / retour d'écran / remontage / redémarrage.
 *
 * ── Identité de vente (clé d'idempotence des périphériques) ──
 * On NE se sert PAS de `ticketNumber` : côté serveur il est SÉQUENTIEL PAR
 * MAGASIN (`T-000001`…, jamais globalement unique — deux magasins produisent le
 * même), et côté client le repli est `T-<6 derniers ms>` / `OFF-…` (collisionnable
 * et instable après synchronisation). La clé stable est le `saleId` =
 * `sale-<uuid>` (idempotency key) généré UNE fois avant la création de vente,
 * identique en ligne / hors-ligne / au retry, globalement unique et immuable.
 *
 * Deux protections DISTINCTES, jamais confondues :
 *  1. verrou d'exécution en cours (`finalizingRef` dans POSPage) — bloque le
 *     double-clic immédiat, réinitialisé en fin de traitement ;
 *  2. registre PERSISTANT des actions périphériques déjà déclenchées
 *     (`SalePeripheralGuard`) — clé par action (`AUTO_PRINT`,
 *     `AUTO_DRAWER_OPEN`), JAMAIS effacé par la réinitialisation du verrou (1).
 *
 * La logique de DÉCISION (pure) est testée ; l'orchestrateur applique ces
 * décisions à `peripheralBridge`.
 */
import { peripheralBridge, type TicketData, type TicketVatRow } from './peripheralBridge';

export type PrintStatus = 'printed' | 'print_failed' | 'no_printer' | 'skipped';

/**
 * Statut du tiroir, DISTINCT du statut de vente et du statut d'impression
 * (règle owner : ne jamais fusionner ces trois états) :
 *  - `opened`         : tiroir ouvert avec succès (vente espèces validée) ;
 *  - `open_failed`    : ouverture demandée mais échouée (matériel absent/erreur) ;
 *  - `not_requested`  : aucune espèce → le tiroir NE DOIT PAS s'ouvrir (CB pure) ;
 *  - `skipped`        : vente non validée ou ticket déjà traité (idempotence).
 */
export type DrawerStatus = 'opened' | 'open_failed' | 'not_requested' | 'skipped';

export interface SalePaymentLite {
  method: string;
  amountMinorUnits: number;
}

/** Une vente contient-elle un règlement espèces ? (tiroir requis) */
export function hasCashTender(payments: SalePaymentLite[]): boolean {
  return payments.some((p) => p.method === 'cash');
}

/**
 * Le tiroir doit-il s'ouvrir ? Uniquement pour une vente VALIDÉE contenant des
 * espèces. Jamais pour CB pure, ni si la vente n'est pas validée.
 */
export function shouldOpenDrawer(saleValidated: boolean, payments: SalePaymentLite[]): boolean {
  return saleValidated && hasCashTender(payments);
}

/** Une imprimante RÉELLE (thermique) est-elle prête ? (le dialogue navigateur ne compte pas) */
export function hasRealPrinter(printer: { connected: boolean; type: string }): boolean {
  return printer.connected && printer.type !== 'none' && printer.type !== 'browser_print';
}

/** Actions périphériques idempotentes, chacune sa propre clé (jamais fusionnées). */
export type PeripheralAction = 'AUTO_PRINT' | 'AUTO_DRAWER_OPEN';

/**
 * Statut d'une action périphérique :
 *  - `dispatching` : commande envoyée au périphérique, résultat PAS ENCORE
 *    confirmé (si l'app plante ici → INCERTAIN, ne jamais rejouer le tiroir) ;
 *  - `completed`   : action terminée avec succès ;
 *  - `failed`      : action tentée et échouée (pas de rejeu auto ; réimpression
 *    manuelle explicite possible pour le ticket) ;
 *  - `unknown`     : état indéterminé.
 */
export type PeripheralActionStatus = 'dispatching' | 'completed' | 'failed' | 'unknown';

export interface PeripheralActionRecord {
  saleId: string;
  action: PeripheralAction;
  status: PeripheralActionStatus;
  timestamp: number;
  error?: string;
}

/** Stockage clé/valeur minimal (localStorage en prod ; injectable pour les tests). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = 'pos_peripheral_actions';
const MAX_RECORDS = 500;

function defaultStore(): KeyValueStore | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* localStorage indisponible */
  }
  return null;
}

/**
 * Registre PERSISTANT des actions périphériques déjà déclenchées, par
 * (`saleId`, action). Persisté dans localStorage → survit à un remontage React,
 * un reload complet du renderer et un redémarrage/crash Electron. C'est la
 * preuve « déjà imprimé / tiroir déjà ouvert », TOTALEMENT distincte du verrou
 * temporaire d'exécution (qui, lui, peut être réinitialisé).
 *
 * `beginAction` ne renvoie `true` (→ on peut déclencher) QUE si aucune trace
 * n'existe pour ce (saleId, action). Une trace `dispatching` laissée par un
 * crash reste `dispatching` → l'action n'est JAMAIS rejouée automatiquement
 * (cas incertain : le tiroir a peut-être déjà été ouvert physiquement).
 */
export class SalePeripheralGuard {
  private readonly mem = new Map<string, PeripheralActionRecord>();
  private readonly store: KeyValueStore | null;

  constructor(store?: KeyValueStore | null) {
    this.store = store === undefined ? defaultStore() : store;
    this.load();
  }

  private keyOf(saleId: string, action: PeripheralAction): string {
    return `${saleId}:${action}`;
  }

  private load(): void {
    if (!this.store) return;
    try {
      const raw = this.store.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, PeripheralActionRecord>;
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v.status === 'string') this.mem.set(k, v);
      }
    } catch {
      /* données corrompues → on repart d'un registre vide en mémoire */
    }
  }

  private persist(): void {
    if (!this.store) return;
    try {
      // Bornage : on garde les MAX_RECORDS entrées les plus récentes.
      if (this.mem.size > MAX_RECORDS) {
        const sorted = [...this.mem.entries()].sort((a, b) => b[1].timestamp - a[1].timestamp);
        this.mem.clear();
        for (const [k, v] of sorted.slice(0, MAX_RECORDS)) this.mem.set(k, v);
      }
      const obj: Record<string, PeripheralActionRecord> = {};
      for (const [k, v] of this.mem) obj[k] = v;
      this.store.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      /* écriture impossible → le registre mémoire reste la source pour la session */
    }
  }

  getRecord(saleId: string, action: PeripheralAction): PeripheralActionRecord | null {
    return this.mem.get(this.keyOf(saleId, action)) ?? null;
  }

  /**
   * Réserve une action pour un `saleId`. Renvoie `true` (→ déclencher) UNIQUEMENT
   * s'il n'existe aucune trace ; écrit alors `dispatching` de façon SYNCHRONE et
   * persistée AVANT tout appel au périphérique. Renvoie `false` si une action a
   * déjà été déclenchée (completed / failed / dispatching) → jamais de rejeu auto.
   * Sans `saleId` (ne devrait pas arriver), on autorise une seule tentative sans
   * persistance plutôt que de priver une vente réelle de son ticket.
   */
  beginAction(saleId: string, action: PeripheralAction): boolean {
    if (!saleId) return true; // dégradé : pas d'identité → au moins imprimer une fois
    const key = this.keyOf(saleId, action);
    if (this.mem.has(key)) return false; // déjà déclenchée (ou incertaine) → ne pas rejouer
    this.mem.set(key, { saleId, action, status: 'dispatching', timestamp: Date.now() });
    this.persist();
    return true;
  }

  /** Enregistre le résultat d'une action déclenchée (completed / failed). */
  settleAction(saleId: string, action: PeripheralAction, ok: boolean, error?: string): void {
    if (!saleId) return;
    const key = this.keyOf(saleId, action);
    const rec = this.mem.get(key);
    if (!rec) return;
    rec.status = ok ? 'completed' : 'failed';
    rec.timestamp = Date.now();
    if (error) rec.error = error;
    this.persist();
  }

  /**
   * Actions restées `dispatching` (incertaines) : l'app a probablement planté
   * après l'envoi de la commande mais avant l'enregistrement du succès. À
   * exposer pour vérification MANUELLE — ne JAMAIS rejouer automatiquement
   * (surtout le tiroir).
   */
  listUncertain(): PeripheralActionRecord[] {
    return [...this.mem.values()].filter((r) => r.status === 'dispatching');
  }
}

/**
 * Registre PARTAGÉ au niveau module (singleton), persisté. La clé stable est le
 * `saleId` (`sale-<uuid>`), hors du cycle de vie React → survit re-render,
 * remontage, reload et redémarrage Electron.
 */
export const salePeripheralGuard = new SalePeripheralGuard();

/**
 * Ventilation TVA par taux depuis les lignes du panier (montants en centimes
 * en entrée, euros en sortie). Même formule d'extraction que le backend
 * (sales.service.ts) : TVA ligne = round(TTC × taux / (100 + taux)), sommée
 * par taux — l'affichage caisse et la vente scellée restent cohérents.
 * Les lignes sans taux connu (catalogue hors ligne ancien) sont ignorées.
 */
export function computeTicketVat(
  items: Array<{ quantity: number; unitPriceMinorUnits: number; discountMinorUnits?: number; taxRate?: number }>,
): TicketVatRow[] {
  const byRate = new Map<number, { ttc: number; tva: number }>();
  for (const i of items) {
    const rate = typeof i.taxRate === 'number' && Number.isFinite(i.taxRate) ? i.taxRate : undefined;
    if (rate === undefined) continue;
    const ttc = i.unitPriceMinorUnits * i.quantity - (i.discountMinorUnits || 0);
    const tva = rate > 0 ? Math.round(ttc * (rate / (100 + rate))) : 0;
    const acc = byRate.get(rate) ?? { ttc: 0, tva: 0 };
    acc.ttc += ttc;
    acc.tva += tva;
    byRate.set(rate, acc);
  }
  return [...byRate.entries()]
    .map(([rate, { ttc, tva }]) => ({
      rate,
      ttc: ttc / 100,
      tva: tva / 100,
      ht: (ttc - tva) / 100,
    }))
    .sort((a, b) => a.rate - b.rate);
}

/** Construit le TicketData depuis des entrées simples (testable, sans store). */
export function buildTicketData(input: {
  storeName?: string;
  storeAddress?: string;
  siret?: string;
  tvaIntracom?: string;
  nifCaisse?: string;
  ticketNumber: string;
  date: Date;
  cashierName: string;
  items: Array<{ name: string; quantity: number; unitPriceMinorUnits: number; discountMinorUnits?: number; taxRate?: number }>;
  subtotalMinorUnits: number;
  discountMinorUnits: number;
  totalMinorUnits: number;
  payments: SalePaymentLite[];
  changeMinorUnits: number;
  footer?: string;
  // ── Refonte ticket The Wesley (config Dashboard — tout optionnel) ──
  addressLine2?: string;
  operatingCompanyName?: string;
  rcs?: string;
  capitalSocial?: string;
  phone?: string;
  website?: string;
  headerMessage?: string;
  logoDataUrl?: string | null;
  registerLabel?: string;
  softwareVersion?: string;
  qrDataUrl?: string | null;
  qrContent?: string | null;
  qrText?: string;
  finalMessage?: string;
  offlineNote?: string;
  testMarker?: string;
}): TicketData {
  const methodLabel = (m: string) =>
    m === 'card' ? 'CB' : m === 'cash' ? 'Especes' : m === 'mixed' ? 'Mixte' : m;
  const cashTendered = input.payments
    .filter((p) => p.method === 'cash')
    .reduce((s, p) => s + p.amountMinorUnits, 0);
  return {
    storeName: input.storeName || 'CAISSE',
    storeAddress: input.storeAddress || '',
    siret: input.siret || '',
    tvaIntracom: input.tvaIntracom || '',
    ticketNumber: input.ticketNumber,
    date: input.date.toLocaleString('fr-FR'),
    cashierName: input.cashierName,
    items: input.items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPriceMinorUnits / 100,
      total: (i.unitPriceMinorUnits * i.quantity - (i.discountMinorUnits || 0)) / 100,
      discount: i.discountMinorUnits ? i.discountMinorUnits / 100 : undefined,
      taxRate: i.taxRate,
    })),
    subtotal: input.subtotalMinorUnits / 100,
    discount: input.discountMinorUnits / 100,
    total: input.totalMinorUnits / 100,
    payments: input.payments.map((p) => ({ method: methodLabel(p.method), amount: p.amountMinorUnits / 100 })),
    change: input.changeMinorUnits / 100,
    // Espèces : « Reçu » = montant espèces encaissé + monnaie rendue.
    cashReceived:
      input.changeMinorUnits > 0 && cashTendered > 0
        ? (cashTendered + input.changeMinorUnits) / 100
        : undefined,
    footer: input.footer || 'Merci de votre visite !',
    nifCaisse: input.nifCaisse || '',
    softwareVersion: input.softwareVersion || '1.0',
    vat: computeTicketVat(input.items),
    addressLine2: input.addressLine2,
    operatingCompanyName: input.operatingCompanyName,
    rcs: input.rcs,
    capitalSocial: input.capitalSocial,
    phone: input.phone,
    website: input.website,
    headerMessage: input.headerMessage,
    logoDataUrl: input.logoDataUrl ?? null,
    registerLabel: input.registerLabel,
    qrDataUrl: input.qrDataUrl ?? null,
    qrContent: input.qrContent ?? null,
    qrText: input.qrText,
    finalMessage: input.finalMessage,
    offlineNote: input.offlineNote,
    testMarker: input.testMarker,
  };
}

export interface FinalizeResult {
  /** Succès/échec de l'IMPRESSION — indépendant de la vente. */
  printStatus: PrintStatus;
  /** Succès/échec de l'OUVERTURE DU TIROIR — indépendant de la vente et de l'impression. */
  drawerStatus: DrawerStatus;
  /** Raccourci booléen (tiroir physiquement ouvert). */
  drawerOpened: boolean;
}

/** Statut d'impression rejoué depuis une trace déjà enregistrée (2ᵉ appel). */
function printStatusFromRecord(rec: PeripheralActionRecord | null): PrintStatus {
  if (rec?.status === 'completed') return 'printed';
  if (rec?.status === 'failed') return 'print_failed';
  return 'skipped'; // dispatching (incertain) / absent → aucune 2ᵉ impression
}

/** Statut tiroir rejoué depuis une trace déjà enregistrée (2ᵉ appel). */
function drawerStatusFromRecord(rec: PeripheralActionRecord | null): DrawerStatus {
  if (rec?.status === 'completed') return 'opened';
  if (rec?.status === 'failed') return 'open_failed';
  return 'skipped'; // dispatching (incertain) / absent → aucune 2ᵉ ouverture
}

/**
 * Orchestrateur : imprime (si imprimante réelle) et ouvre le tiroir (si
 * espèces), APRÈS une vente validée, au plus UNE fois par `saleId` ET par
 * action. Ne throw jamais ; l'impression/le tiroir n'affectent pas la validité
 * de la vente.
 *
 * `saleId` = identité STABLE de la vente (`sale-<uuid>`), pas `ticketNumber`.
 * Impression et tiroir ont chacun leur clé d'idempotence persistée
 * (`AUTO_PRINT`, `AUTO_DRAWER_OPEN`) : ni double ticket, ni double tiroir, même
 * après double-clic / retry / remontage / redémarrage. Une action déjà tentée
 * (y compris restée `dispatching` après un crash) n'est JAMAIS rejouée
 * automatiquement.
 */
export async function finalizeSalePeripherals(params: {
  saleId: string;
  ticketData: TicketData;
  payments: SalePaymentLite[];
  saleValidated: boolean;
  guard: SalePeripheralGuard;
  /**
   * Jalonnage horodaté OPTIONNEL de la chaîne périphérique (diagnostic latence
   * terrain). Purement passif : jamais bloquant, jamais une condition de vente.
   */
  trace?: (step: string, meta?: Record<string, unknown>) => void;
}): Promise<FinalizeResult> {
  const { saleId, ticketData, payments, saleValidated, guard } = params;
  const trace = (step: string, meta?: Record<string, unknown>) => {
    try {
      params.trace?.(step, meta);
    } catch {
      /* la trace ne casse jamais la vente */
    }
  };

  // Vente non validée (échec / en attente / annulée) → on ne touche à RIEN.
  if (!saleValidated) return { printStatus: 'skipped', drawerStatus: 'skipped', drawerOpened: false };

  // ── Impression (jamais une condition de réussite de la vente) ──
  let printStatus: PrintStatus = 'no_printer';
  if (hasRealPrinter(peripheralBridge.status.printer)) {
    if (guard.beginAction(saleId, 'AUTO_PRINT')) {
      try {
        trace('print_submit', { printer: peripheralBridge.status.printer.name });
        const ok = await peripheralBridge.printTicket(ticketData, { allowBrowserFallback: false });
        printStatus = ok ? 'printed' : 'print_failed';
        trace('print_result', { ok, ...(peripheralBridge.lastPrintTimings ?? {}) });
        guard.settleAction(saleId, 'AUTO_PRINT', ok, ok ? undefined : 'printTicket returned false');
        if (!ok) {
          // eslint-disable-next-line no-console
          console.warn('[POS] Ticket NON imprimé — échec imprimante (réimpression possible depuis l’historique)');
        }
      } catch (e) {
        printStatus = 'print_failed';
        trace('print_result', { ok: false, error: String(e) });
        guard.settleAction(saleId, 'AUTO_PRINT', false, String(e));
        // eslint-disable-next-line no-console
        console.warn('[POS] Impression ticket échouée:', e);
      }
    } else {
      // Déjà déclenchée pour cette vente → aucune 2ᵉ impression auto.
      printStatus = printStatusFromRecord(guard.getRecord(saleId, 'AUTO_PRINT'));
    }
  }

  // ── Tiroir : uniquement pour une vente espèces validée ──
  // Statut distinct de l'impression : le tiroir ne s'ouvre JAMAIS pour une CB
  // pure (`not_requested`), et un échec matériel ne remet pas la vente en cause.
  let drawerStatus: DrawerStatus = 'not_requested';
  let drawerOpened = false;
  if (shouldOpenDrawer(saleValidated, payments)) {
    if (guard.beginAction(saleId, 'AUTO_DRAWER_OPEN')) {
      try {
        trace('drawer_submit');
        drawerOpened = await peripheralBridge.openCashDrawer();
        drawerStatus = drawerOpened ? 'opened' : 'open_failed';
        trace('drawer_result', {
          ok: drawerOpened,
          ...(peripheralBridge.lastDrawerTimings ?? {}),
          ...(drawerOpened ? {} : { error: peripheralBridge.lastDrawerError ?? 'openCashDrawer returned false' }),
        });
        guard.settleAction(
          saleId,
          'AUTO_DRAWER_OPEN',
          drawerOpened,
          drawerOpened ? undefined : peripheralBridge.lastDrawerError ?? 'openCashDrawer returned false',
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[POS] Ouverture tiroir échouée:', e);
        drawerOpened = false;
        drawerStatus = 'open_failed';
        trace('drawer_result', { ok: false, error: String(e) });
        guard.settleAction(saleId, 'AUTO_DRAWER_OPEN', false, String(e));
      }
    } else {
      // Déjà déclenchée pour cette vente → aucune 2ᵉ ouverture auto.
      drawerStatus = drawerStatusFromRecord(guard.getRecord(saleId, 'AUTO_DRAWER_OPEN'));
      drawerOpened = drawerStatus === 'opened';
    }
  }

  return { printStatus, drawerStatus, drawerOpened };
}
