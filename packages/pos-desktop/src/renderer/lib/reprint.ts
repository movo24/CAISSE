/**
 * P361 — POS-036 : réimpression de ticket (part logicielle, pure).
 *
 * Convertit une entrée d'historique (`TicketHistoryEntry`, centimes) vers le
 * `TicketData` attendu par les builders ESC/POS déjà prouvés (POS-037), avec
 * les règles duplicata :
 *  - le ticket réimprimé est MARQUÉ « DUPLICATA n°X » (jamais confondable
 *    avec l'original — exigence de bon sens NF525 : un seul original) ;
 *  - la DATE affichée est celle de la VENTE originale, pas de la réimpression
 *    (le duplicata reproduit l'original ; la réimpression est tracée à part) ;
 *  - les montants sont copiés depuis l'historique, JAMAIS recalculés.
 *
 * `recordReprint` journalise la réimpression de façon IMMUABLE (compteur + log
 * {quand, par qui}) — l'entrée d'origine n'est pas mutée.
 */
import type { TicketData } from '../services/peripheralBridge';
import type { TicketHistoryEntry } from '../stores/posStore';

export interface StoreMeta {
  storeName: string;
  storeAddress: string;
  siret: string;
  tvaIntracom: string;
  nifCaisse: string;
  softwareVersion: string;
}

const toEuros = (minorUnits: number): number => Math.round(minorUnits) / 100;

const methodLabel = (m: string): string => m; // le builder gère déjà cash/card ; le reste passe tel quel

/** Construit le TicketData du DUPLICATA (n° = reprintCount + 1). */
export function buildDuplicateTicketData(
  entry: TicketHistoryEntry,
  meta: StoreMeta,
): TicketData {
  const duplicateNumber = (entry.reprintCount ?? 0) + 1;
  return {
    storeName: meta.storeName,
    storeAddress: meta.storeAddress,
    siret: meta.siret,
    tvaIntracom: meta.tvaIntracom,
    // Marquage duplicata SUR le numéro de ticket : visible en tête, ambiguïté impossible.
    ticketNumber: `${entry.ticketNumber} — DUPLICATA n°${duplicateNumber}`,
    date: new Date(entry.timestamp).toLocaleString('fr-FR'),
    cashierName: entry.cashierName,
    items: entry.items.map((it) => ({
      name: it.name,
      quantity: it.quantity,
      unitPrice: toEuros(it.unitPriceMinorUnits),
      total: toEuros(it.unitPriceMinorUnits * it.quantity - (it.discountMinorUnits ?? 0)),
      discount: it.discountMinorUnits ? toEuros(it.discountMinorUnits) : undefined,
    })),
    subtotal: toEuros(entry.subtotalMinorUnits),
    discount: toEuros(entry.discountMinorUnits ?? 0),
    total: toEuros(entry.totalMinorUnits),
    payments: entry.payments.map((p) => ({
      method: methodLabel(p.method),
      amount: toEuros(p.amountMinorUnits),
    })),
    change: toEuros(entry.changeMinorUnits ?? 0),
    footer: `*** DUPLICATA n°${duplicateNumber} — NE VAUT PAS ORIGINAL ***`,
    nifCaisse: meta.nifCaisse,
    softwareVersion: meta.softwareVersion,
  };
}

/** Journalise une réimpression — retourne une NOUVELLE entrée, l'originale est intacte. */
export function recordReprint(
  entry: TicketHistoryEntry,
  by: string,
  at: Date = new Date(),
): TicketHistoryEntry {
  return {
    ...entry,
    reprintCount: (entry.reprintCount ?? 0) + 1,
    reprintLog: [...(entry.reprintLog ?? []), { at, by }],
  };
}
