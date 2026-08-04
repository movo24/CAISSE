import type { TicketData, TicketVatRow } from './peripheralBridge';

/**
 * Ticket de DIAGNOSTIC — volontairement COMPLET.
 *
 * L'ancien ticket de test ne contenait qu'une ligne à 0,00 € : il ne prouvait
 * donc rien sur le rendu réel (ni logo, ni QR, ni ventilation TVA, ni totaux).
 * Un ticket de vente réel pèse plusieurs dizaines de ko à cause du logo ; un
 * ticket de test squelettique en pesait quelques centaines d'octets. Impossible
 * de comparer, donc impossible de diagnostiquer une sortie blanche.
 *
 * Ce ticket-ci emprunte EXACTEMENT le même chemin qu'une vente : mêmes champs,
 * même constructeur DOM, même impression. Il porte toujours `testMarker` : il
 * n'est jamais confondable avec un ticket fiscal.
 */

/** Articles fictifs — quantités > 1, remise, et deux taux de TVA distincts. */
const TEST_ITEMS: TicketData['items'] = [
  { name: 'Bonbon Fraise Tagada', quantity: 3, unitPrice: 2.5, total: 7.5, taxRate: 5.5 },
  { name: 'Chocolat noir 70%', quantity: 1, unitPrice: 4.9, total: 4.9, taxRate: 5.5 },
  { name: 'Boisson gazeuse 33cl', quantity: 2, unitPrice: 1.8, total: 3.6, taxRate: 20 },
  { name: 'Sachet cadeau', quantity: 1, unitPrice: 3.0, total: 3.0, discount: 0.5, taxRate: 20 },
];

/** Arrondi comptable au centime (évite les 0,30000000000000004). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Ventilation TVA par taux, calculée depuis les lignes (TTC → HT + TVA).
 * PUR — testé indépendamment de tout rendu.
 */
export function computeTestVat(items: TicketData['items']): TicketVatRow[] {
  const byRate = new Map<number, number>();
  for (const it of items) {
    const rate = it.taxRate ?? 20;
    const ttc = round2(it.total - (it.discount ?? 0));
    byRate.set(rate, round2((byRate.get(rate) ?? 0) + ttc));
  }
  return [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, ttc]) => {
      const ht = round2(ttc / (1 + rate / 100));
      return { rate, ht, tva: round2(ttc - ht), ttc };
    });
}

/** Total TTC des lignes, remises déduites. */
export function computeTestTotals(items: TicketData['items']): {
  subtotal: number;
  discount: number;
  total: number;
} {
  const subtotal = round2(items.reduce((s, it) => s + it.total, 0));
  const discount = round2(items.reduce((s, it) => s + (it.discount ?? 0), 0));
  return { subtotal, discount, total: round2(subtotal - discount) };
}

/**
 * Construit le ticket de diagnostic complet.
 *
 * @param logoDataUrl logo officiel (data-URL) ou null si indisponible
 * @param qrDataUrl   QR pré-généré (data-URL) ou null
 * @param paperWidthMm largeur papier de la caisse (58 / 80)
 */
export function buildTestTicket(
  logoDataUrl: string | null,
  qrDataUrl: string | null,
  paperWidthMm?: 58 | 80,
): TicketData {
  const items = TEST_ITEMS;
  const { subtotal, discount, total } = computeTestTotals(items);
  const cashReceived = Math.ceil(total);

  return {
    storeName: 'THE WESLEY’S',
    storeAddress: '12 rue de la Paix',
    addressLine2: '75002 Paris',
    siret: '000 000 000 00000',
    tvaIntracom: 'FR00000000000',
    phone: '01 00 00 00 00',
    website: 'thewesleys.fr',
    ticketNumber: 'TEST-IMPRESSION',
    registerLabel: 'Caisse diagnostic',
    date: new Date().toLocaleString('fr-FR'),
    cashierName: 'Diagnostic',
    headerMessage: 'TICKET DE TEST — vérification imprimante',
    items,
    subtotal,
    discount,
    total,
    vat: computeTestVat(items),
    payments: [{ method: 'Espèces', amount: cashReceived }],
    cashReceived,
    change: round2(cashReceived - total),
    footer: 'Test imprimante — aucune vente enregistrée',
    finalMessage: 'Merci et à bientôt chez The Wesley',
    nifCaisse: 'TEST',
    softwareVersion:
      (typeof window !== 'undefined' && (window as any).posDesktop?.version) || 'dev',
    logoDataUrl,
    qrDataUrl,
    qrContent: qrDataUrl ? 'https://thewesleys.fr/ticket/TEST' : null,
    qrText: 'Ticket numérique (test)',
    ...(paperWidthMm ? { paperWidthMm } : {}),
    // JAMAIS retiré : ce ticket n'a aucune valeur fiscale.
    testMarker: 'TEST — SANS VALEUR FISCALE',
  };
}
