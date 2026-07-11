import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock peripheralBridge AVANT l'import du module testé (vi.hoisted → sûr au hoist).
const mockBridge = vi.hoisted(() => ({
  status: { printer: { connected: true, type: 'thermal_usb', name: 'EPSON' } as { connected: boolean; type: string; name: string | null } },
  printTicket: vi.fn(),
  openCashDrawer: vi.fn(),
}));
vi.mock('./peripheralBridge', () => ({
  peripheralBridge: mockBridge,
}));

import {
  hasCashTender,
  shouldOpenDrawer,
  hasRealPrinter,
  SalePeripheralGuard,
  salePeripheralGuard as moduleGuard,
  buildTicketData,
  finalizeSalePeripherals,
  type SalePaymentLite,
  type KeyValueStore,
} from './salePeripherals';

const cash: SalePaymentLite[] = [{ method: 'cash', amountMinorUnits: 1000 }];
const card: SalePaymentLite[] = [{ method: 'card', amountMinorUnits: 1000 }];
const mixed: SalePaymentLite[] = [
  { method: 'card', amountMinorUnits: 500 },
  { method: 'cash', amountMinorUnits: 500 },
];

/** Store clé/valeur en mémoire — simule localStorage (persistance entre gardes). */
function memStore(): KeyValueStore & { dump(): Record<string, unknown> } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => void m.set(k, v),
    dump: () => JSON.parse(m.get('pos_peripheral_actions') || '{}'),
  };
}

const td = (ticketNumber = 'T-100') =>
  buildTicketData({
    ticketNumber, date: new Date('2026-07-11T10:00:00Z'), cashierName: 'Bob',
    items: [{ name: 'X', quantity: 1, unitPriceMinorUnits: 1000 }],
    subtotalMinorUnits: 1000, discountMinorUnits: 0, totalMinorUnits: 1000,
    payments: cash, changeMinorUnits: 0,
  });

describe('salePeripherals — décisions pures', () => {
  it('hasCashTender', () => {
    expect(hasCashTender(cash)).toBe(true);
    expect(hasCashTender(card)).toBe(false);
    expect(hasCashTender(mixed)).toBe(true);
  });
  it('shouldOpenDrawer : espèces validées oui ; CB non ; non validé non', () => {
    expect(shouldOpenDrawer(true, cash)).toBe(true);
    expect(shouldOpenDrawer(true, mixed)).toBe(true);
    expect(shouldOpenDrawer(true, card)).toBe(false);
    expect(shouldOpenDrawer(false, cash)).toBe(false);
  });
  it('hasRealPrinter', () => {
    expect(hasRealPrinter({ connected: true, type: 'thermal_usb' })).toBe(true);
    expect(hasRealPrinter({ connected: false, type: 'thermal_usb' })).toBe(false);
    expect(hasRealPrinter({ connected: true, type: 'none' })).toBe(false);
    expect(hasRealPrinter({ connected: true, type: 'browser_print' })).toBe(false);
  });
  it('buildTicketData : conversion centimes→euros + libellés', () => {
    const t = buildTicketData({
      ticketNumber: 'T-9', date: new Date('2026-07-11T10:00:00Z'), cashierName: 'Alice',
      items: [{ name: 'Bonbon', quantity: 2, unitPriceMinorUnits: 150 }],
      subtotalMinorUnits: 300, discountMinorUnits: 0, totalMinorUnits: 300,
      payments: [{ method: 'cash', amountMinorUnits: 300 }], changeMinorUnits: 0,
    });
    expect(t.total).toBe(3);
    expect(t.payments[0]).toEqual({ method: 'Especes', amount: 3 });
  });
});

describe('SalePeripheralGuard — clé par (saleId, action), persistée', () => {
  it('beginAction réserve une seule fois par (saleId, action) et persiste dispatching', () => {
    const store = memStore();
    const g = new SalePeripheralGuard(store);
    expect(g.beginAction('sale-A', 'AUTO_PRINT')).toBe(true);
    expect(g.beginAction('sale-A', 'AUTO_PRINT')).toBe(false); // déjà réservée
    // action DISTINCTE du même sale : indépendante
    expect(g.beginAction('sale-A', 'AUTO_DRAWER_OPEN')).toBe(true);
    // sale DIFFÉRENT : indépendant
    expect(g.beginAction('sale-B', 'AUTO_PRINT')).toBe(true);
    expect(g.getRecord('sale-A', 'AUTO_PRINT')?.status).toBe('dispatching');
    expect(store.dump()['sale-A:AUTO_PRINT']).toBeTruthy(); // persisté
  });

  it('settleAction passe dispatching → completed / failed', () => {
    const g = new SalePeripheralGuard(memStore());
    g.beginAction('s', 'AUTO_PRINT');
    g.settleAction('s', 'AUTO_PRINT', true);
    expect(g.getRecord('s', 'AUTO_PRINT')?.status).toBe('completed');
    g.beginAction('s', 'AUTO_DRAWER_OPEN');
    g.settleAction('s', 'AUTO_DRAWER_OPEN', false, 'no drawer');
    expect(g.getRecord('s', 'AUTO_DRAWER_OPEN')).toMatchObject({ status: 'failed', error: 'no drawer' });
  });

  it('une NOUVELLE garde relit le store (remontage / redémarrage) et dédoublonne', () => {
    const store = memStore();
    const g1 = new SalePeripheralGuard(store);
    g1.beginAction('s', 'AUTO_PRINT');
    g1.settleAction('s', 'AUTO_PRINT', true);
    const g2 = new SalePeripheralGuard(store); // simulate reload / restart
    expect(g2.beginAction('s', 'AUTO_PRINT')).toBe(false); // pas de rejeu
    expect(g2.getRecord('s', 'AUTO_PRINT')?.status).toBe('completed');
  });

  it('trace `dispatching` après crash → jamais rejouée + listée comme incertaine', () => {
    const store = memStore();
    const g1 = new SalePeripheralGuard(store);
    g1.beginAction('s', 'AUTO_DRAWER_OPEN'); // dispatching persisté, PAS de settle (crash)
    const g2 = new SalePeripheralGuard(store); // redémarrage
    expect(g2.beginAction('s', 'AUTO_DRAWER_OPEN')).toBe(false); // tiroir jamais rouvert auto
    expect(g2.listUncertain().map((r) => `${r.saleId}:${r.action}`)).toContain('s:AUTO_DRAWER_OPEN');
  });

  it('sans saleId → autorise une tentative (dégradé), sans persistance', () => {
    const store = memStore();
    const g = new SalePeripheralGuard(store);
    expect(g.beginAction('', 'AUTO_PRINT')).toBe(true);
    expect(store.dump()['' + ':AUTO_PRINT']).toBeUndefined();
  });
});

describe('finalizeSalePeripherals — orchestrateur (saleId = identité stable)', () => {
  beforeEach(() => {
    mockBridge.printTicket.mockReset();
    mockBridge.openCashDrawer.mockReset();
    mockBridge.status.printer = { connected: true, type: 'thermal_usb', name: 'EPSON' };
  });
  const guard = () => new SalePeripheralGuard(memStore());

  it('vente espèces réussie → imprime + ouvre le tiroir (3 statuts distincts)', async () => {
    mockBridge.printTicket.mockResolvedValue(true);
    mockBridge.openCashDrawer.mockResolvedValue(true);
    const r = await finalizeSalePeripherals({ saleId: 'sale-1', ticketData: td(), payments: cash, saleValidated: true, guard: guard() });
    expect(r).toEqual({ printStatus: 'printed', drawerStatus: 'opened', drawerOpened: true });
  });

  it('vente CB → imprime mais tiroir not_requested', async () => {
    mockBridge.printTicket.mockResolvedValue(true);
    const r = await finalizeSalePeripherals({ saleId: 'sale-cb', ticketData: td('T-CB'), payments: card, saleValidated: true, guard: guard() });
    expect(r.printStatus).toBe('printed');
    expect(r.drawerStatus).toBe('not_requested');
    expect(mockBridge.openCashDrawer).not.toHaveBeenCalled();
  });

  it('vente non validée → rien (skipped/skipped)', async () => {
    const r = await finalizeSalePeripherals({ saleId: 'sale-x', ticketData: td(), payments: cash, saleValidated: false, guard: guard() });
    expect(r).toEqual({ printStatus: 'skipped', drawerStatus: 'skipped', drawerOpened: false });
    expect(mockBridge.printTicket).not.toHaveBeenCalled();
  });

  it('imprimante absente → no_printer, tiroir espèces s’ouvre quand même', async () => {
    mockBridge.status.printer = { connected: false, type: 'none', name: null } as any;
    mockBridge.openCashDrawer.mockResolvedValue(true);
    const r = await finalizeSalePeripherals({ saleId: 'sale-np', ticketData: td('T-NP'), payments: cash, saleValidated: true, guard: guard() });
    expect(r.printStatus).toBe('no_printer');
    expect(r.drawerStatus).toBe('opened');
  });

  it('échec impression → print_failed, vente + tiroir intacts', async () => {
    mockBridge.printTicket.mockResolvedValue(false);
    mockBridge.openCashDrawer.mockResolvedValue(true);
    const r = await finalizeSalePeripherals({ saleId: 'sale-pf', ticketData: td('T-PF'), payments: cash, saleValidated: true, guard: guard() });
    expect(r.printStatus).toBe('print_failed');
    expect(r.drawerStatus).toBe('opened');
  });

  it('impression qui throw → print_failed, jamais d’exception', async () => {
    mockBridge.printTicket.mockRejectedValue(new Error('spooler down'));
    const r = await finalizeSalePeripherals({ saleId: 'sale-th', ticketData: td('T-TH'), payments: card, saleValidated: true, guard: guard() });
    expect(r.printStatus).toBe('print_failed');
    expect(r.drawerStatus).toBe('not_requested');
  });

  it('tiroir absent (false) → open_failed ; tiroir qui throw → open_failed', async () => {
    mockBridge.printTicket.mockResolvedValue(true);
    mockBridge.openCashDrawer.mockResolvedValueOnce(false);
    const r1 = await finalizeSalePeripherals({ saleId: 'sale-d1', ticketData: td('T-D1'), payments: cash, saleValidated: true, guard: guard() });
    expect(r1.drawerStatus).toBe('open_failed');
    mockBridge.openCashDrawer.mockRejectedValueOnce(new Error('offline'));
    const r2 = await finalizeSalePeripherals({ saleId: 'sale-d2', ticketData: td('T-D2'), payments: cash, saleValidated: true, guard: guard() });
    expect(r2.drawerStatus).toBe('open_failed');
  });

  // ── Owner tests 1-12 ──

  it('(1,11,12) deux ventes de saleId différent MAIS même ticketNumber ne se bloquent pas', async () => {
    mockBridge.printTicket.mockResolvedValue(true);
    mockBridge.openCashDrawer.mockResolvedValue(true);
    const g = guard(); // garde partagée
    const same = td('T-000001'); // même numéro fiscal (2 magasins / 2 terminaux)
    const a = await finalizeSalePeripherals({ saleId: 'sale-AAA', ticketData: same, payments: cash, saleValidated: true, guard: g });
    const b = await finalizeSalePeripherals({ saleId: 'sale-BBB', ticketData: same, payments: cash, saleValidated: true, guard: g });
    expect(a.printStatus).toBe('printed');
    expect(b.printStatus).toBe('printed'); // vente différente → imprime aussi
    expect(mockBridge.printTicket).toHaveBeenCalledTimes(2);
    expect(mockBridge.openCashDrawer).toHaveBeenCalledTimes(2);
  });

  it('(2,3) une même vente ne déclenche qu’UNE impression et UNE ouverture', async () => {
    mockBridge.printTicket.mockResolvedValue(true);
    mockBridge.openCashDrawer.mockResolvedValue(true);
    const g = guard();
    await finalizeSalePeripherals({ saleId: 'sale-uno', ticketData: td('T-U'), payments: cash, saleValidated: true, guard: g });
    await finalizeSalePeripherals({ saleId: 'sale-uno', ticketData: td('T-U'), payments: cash, saleValidated: true, guard: g });
    expect(mockBridge.printTicket).toHaveBeenCalledTimes(1);
    expect(mockBridge.openCashDrawer).toHaveBeenCalledTimes(1);
  });

  it('(4) retry après impression réussie → pas de 2ᵉ ticket ; statut rejoué = printed', async () => {
    mockBridge.printTicket.mockResolvedValue(true);
    const g = guard();
    await finalizeSalePeripherals({ saleId: 'sale-r4', ticketData: td('T-R4'), payments: card, saleValidated: true, guard: g });
    const again = await finalizeSalePeripherals({ saleId: 'sale-r4', ticketData: td('T-R4'), payments: card, saleValidated: true, guard: g });
    expect(mockBridge.printTicket).toHaveBeenCalledTimes(1);
    expect(again.printStatus).toBe('printed'); // rejoué depuis la trace, sans réimprimer
  });

  it('(5) retry après tiroir ouvert → pas de 2ᵉ ouverture ; statut rejoué = opened', async () => {
    mockBridge.printTicket.mockResolvedValue(true);
    mockBridge.openCashDrawer.mockResolvedValue(true);
    const g = guard();
    await finalizeSalePeripherals({ saleId: 'sale-r5', ticketData: td('T-R5'), payments: cash, saleValidated: true, guard: g });
    const again = await finalizeSalePeripherals({ saleId: 'sale-r5', ticketData: td('T-R5'), payments: cash, saleValidated: true, guard: g });
    expect(mockBridge.openCashDrawer).toHaveBeenCalledTimes(1);
    expect(again.drawerStatus).toBe('opened');
    expect(again.drawerOpened).toBe(true);
  });

  it('(6) crash après impression physique mais avant retour UI → pas de 2ᵉ impression', async () => {
    const store = memStore();
    // 1ʳᵉ garde : imprime, puis "crash" (dispatching→completed persisté au settle).
    mockBridge.printTicket.mockResolvedValue(true);
    await finalizeSalePeripherals({ saleId: 'sale-r6', ticketData: td('T-R6'), payments: card, saleValidated: true, guard: new SalePeripheralGuard(store) });
    // Nouvelle garde (redémarrage) relit le store → pas de rejeu.
    mockBridge.printTicket.mockClear();
    const again = await finalizeSalePeripherals({ saleId: 'sale-r6', ticketData: td('T-R6'), payments: card, saleValidated: true, guard: new SalePeripheralGuard(store) });
    expect(mockBridge.printTicket).not.toHaveBeenCalled();
    expect(again.printStatus).toBe('printed');
  });

  it('(7,8) remontage / reload : garde neuve depuis le même store → aucun doublon', async () => {
    const store = memStore();
    mockBridge.printTicket.mockResolvedValue(true);
    mockBridge.openCashDrawer.mockResolvedValue(true);
    await finalizeSalePeripherals({ saleId: 'sale-r7', ticketData: td('T-R7'), payments: cash, saleValidated: true, guard: new SalePeripheralGuard(store) });
    mockBridge.printTicket.mockClear();
    mockBridge.openCashDrawer.mockClear();
    await finalizeSalePeripherals({ saleId: 'sale-r7', ticketData: td('T-R7'), payments: cash, saleValidated: true, guard: new SalePeripheralGuard(store) });
    expect(mockBridge.printTicket).not.toHaveBeenCalled();
    expect(mockBridge.openCashDrawer).not.toHaveBeenCalled();
  });

  it('(8bis) tiroir resté `dispatching` (crash) après redémarrage → JAMAIS rouvert auto', async () => {
    const store = memStore();
    // Simuler un crash pendant l'ouverture : openCashDrawer ne résout jamais → on
    // pose la trace dispatching à la main via la 1ʳᵉ garde puis on redémarre.
    const g1 = new SalePeripheralGuard(store);
    g1.beginAction('sale-r8', 'AUTO_DRAWER_OPEN'); // dispatching, pas de settle
    mockBridge.printTicket.mockResolvedValue(true);
    mockBridge.openCashDrawer.mockResolvedValue(true);
    const r = await finalizeSalePeripherals({ saleId: 'sale-r8', ticketData: td('T-R8'), payments: cash, saleValidated: true, guard: new SalePeripheralGuard(store) });
    expect(mockBridge.openCashDrawer).not.toHaveBeenCalled(); // pas de rejeu
    expect(r.drawerStatus).toBe('skipped'); // incertain → ni opened ni open_failed
  });

  it('(10) clé stable après synchronisation offline : même saleId, ticketNumber OFF-→T- → dédup', async () => {
    mockBridge.printTicket.mockResolvedValue(true);
    mockBridge.openCashDrawer.mockResolvedValue(true);
    const g = guard();
    // Vente offline : ticketNumber OFF-xxx
    await finalizeSalePeripherals({ saleId: 'sale-off', ticketData: td('OFF-ABC'), payments: cash, saleValidated: true, guard: g });
    // Après sync, le serveur renvoie T-000042 pour la MÊME vente (même saleId)
    const synced = await finalizeSalePeripherals({ saleId: 'sale-off', ticketData: td('T-000042'), payments: cash, saleValidated: true, guard: g });
    expect(mockBridge.printTicket).toHaveBeenCalledTimes(1); // pas de 2ᵉ ticket
    expect(mockBridge.openCashDrawer).toHaveBeenCalledTimes(1);
    expect(synced.printStatus).toBe('printed');
  });

  it('garde singleton de module exportée est bien une SalePeripheralGuard persistée', () => {
    expect(moduleGuard).toBeInstanceOf(SalePeripheralGuard);
  });
});
