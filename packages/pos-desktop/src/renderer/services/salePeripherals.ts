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
  printStatus: PrintStatus;
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

  if (!saleValidated) return { printStatus: 'skipped', drawerOpened: false };
  // Idempotence : une seule fois par ticket.
  if (!guard.claim(ticketData.ticketNumber)) {
    return { printStatus: 'skipped', drawerOpened: false };
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
  let drawerOpened = false;
  if (shouldOpenDrawer(saleValidated, payments)) {
    try {
      drawerOpened = await peripheralBridge.openCashDrawer();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[POS] Ouverture tiroir échouée:', e);
      drawerOpened = false;
    }
  }

  return { printStatus, drawerOpened };
}
