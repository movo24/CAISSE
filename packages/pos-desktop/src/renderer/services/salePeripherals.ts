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
 *    double-clic / retry / retour d'écran.
 *
 * La logique de DÉCISION (pure) est testée ; l'orchestrateur applique ces
 * décisions à `peripheralBridge`.
 */
import { peripheralBridge, type TicketData } from './peripheralBridge';

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

/**
 * Garde d'idempotence : garantit qu'un même ticket ne déclenche l'impression
 * et le tiroir qu'UNE fois (double-clic, retry, re-render de l'overlay).
 */
export class SaleFinalizationGuard {
  private readonly done = new Set<string>();
  /** Réserve le ticket ; renvoie true la 1ʳᵉ fois, false ensuite (déjà traité). */
  claim(ticketNumber: string): boolean {
    if (!ticketNumber || this.done.has(ticketNumber)) return false;
    this.done.add(ticketNumber);
    return true;
  }
  has(ticketNumber: string): boolean {
    return this.done.has(ticketNumber);
  }
}

/**
 * Garde PARTAGÉE au niveau module (singleton) : la clé stable = `ticketNumber`
 * de la vente. Étant hors du cycle de vie React, elle survit à un re-render,
 * à une navigation aller-retour sur l'écran POS, et à un remontage du
 * composant → impossible de ré-imprimer/ré-ouvrir le tiroir automatiquement
 * pour une vente DÉJÀ finalisée. (Un redémarrage d'app ne rejoue de toute
 * façon jamais `finalizePayment`, donc aucun re-déclenchement au boot.)
 */
export const saleFinalizationGuard = new SaleFinalizationGuard();

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
  items: Array<{ name: string; quantity: number; unitPriceMinorUnits: number; discountMinorUnits?: number }>;
  subtotalMinorUnits: number;
  discountMinorUnits: number;
  totalMinorUnits: number;
  payments: SalePaymentLite[];
  changeMinorUnits: number;
  footer?: string;
}): TicketData {
  const methodLabel = (m: string) =>
    m === 'card' ? 'CB' : m === 'cash' ? 'Especes' : m === 'mixed' ? 'Mixte' : m;
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
    })),
    subtotal: input.subtotalMinorUnits / 100,
    discount: input.discountMinorUnits / 100,
    total: input.totalMinorUnits / 100,
    payments: input.payments.map((p) => ({ method: methodLabel(p.method), amount: p.amountMinorUnits / 100 })),
    change: input.changeMinorUnits / 100,
    footer: input.footer || 'Merci de votre visite !',
    nifCaisse: input.nifCaisse || '',
    softwareVersion: '1.0',
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

/**
 * Orchestrateur : imprime (si imprimante réelle) et ouvre le tiroir (si
 * espèces), APRÈS une vente validée, une seule fois par ticket. Ne throw
 * jamais ; l'impression n'affecte pas la validité de la vente.
 */
export async function finalizeSalePeripherals(params: {
  ticketData: TicketData;
  payments: SalePaymentLite[];
  saleValidated: boolean;
  guard: SaleFinalizationGuard;
}): Promise<FinalizeResult> {
  const { ticketData, payments, saleValidated, guard } = params;

  // Vente non validée (échec / en attente / annulée) → on ne touche à RIEN.
  if (!saleValidated) return { printStatus: 'skipped', drawerStatus: 'skipped', drawerOpened: false };
  // Idempotence : une seule fois par ticket (double-clic / retry / re-render).
  if (!guard.claim(ticketData.ticketNumber)) {
    return { printStatus: 'skipped', drawerStatus: 'skipped', drawerOpened: false };
  }

  // ── Impression (jamais une condition de réussite de la vente) ──
  let printStatus: PrintStatus = 'no_printer';
  if (hasRealPrinter(peripheralBridge.status.printer)) {
    try {
      const ok = await peripheralBridge.printTicket(ticketData, { allowBrowserFallback: false });
      printStatus = ok ? 'printed' : 'print_failed';
      if (!ok) {
        // eslint-disable-next-line no-console
        console.warn('[POS] Ticket NON imprimé — échec imprimante (réimpression possible depuis l’historique)');
      }
    } catch (e) {
      printStatus = 'print_failed';
      // eslint-disable-next-line no-console
      console.warn('[POS] Impression ticket échouée:', e);
    }
  }

  // ── Tiroir : uniquement pour une vente espèces validée ──
  // Statut distinct de l'impression : le tiroir ne s'ouvre JAMAIS pour une CB
  // pure (`not_requested`), et un échec matériel ne remet pas la vente en cause.
  let drawerStatus: DrawerStatus = 'not_requested';
  let drawerOpened = false;
  if (shouldOpenDrawer(saleValidated, payments)) {
    try {
      drawerOpened = await peripheralBridge.openCashDrawer();
      drawerStatus = drawerOpened ? 'opened' : 'open_failed';
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[POS] Ouverture tiroir échouée:', e);
      drawerOpened = false;
      drawerStatus = 'open_failed';
    }
  }

  return { printStatus, drawerStatus, drawerOpened };
}
