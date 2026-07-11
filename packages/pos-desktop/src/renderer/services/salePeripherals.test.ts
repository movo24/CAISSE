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
  SaleFinalizationGuard,
  buildTicketData,
  finalizeSalePeripherals,
  type SalePaymentLite,
} from './salePeripherals';

const cash: SalePaymentLite[] = [{ method: 'cash', amountMinorUnits: 1000 }];
const card: SalePaymentLite[] = [{ method: 'card', amountMinorUnits: 1000 }];
const mixed: SalePaymentLite[] = [
  { method: 'card', amountMinorUnits: 500 },
  { method: 'cash', amountMinorUnits: 500 },
];

describe('salePeripherals — décisions pures', () => {
  it('hasCashTender', () => {
    expect(hasCashTender(cash)).toBe(true);
    expect(hasCashTender(card)).toBe(false);
    expect(hasCashTender(mixed)).toBe(true);
  });
  it('shouldOpenDrawer : espèces validées oui ; CB non ; non validé non', () => {
    expect(shouldOpenDrawer(true, cash)).toBe(true);
    expect(shouldOpenDrawer(true, mixed)).toBe(true); // mixte avec espèces
    expect(shouldOpenDrawer(true, card)).toBe(false); // CB pure
    expect(shouldOpenDrawer(false, cash)).toBe(false); // vente non validée
  });
  it('hasRealPrinter', () => {
    expect(hasRealPrinter({ connected: true, type: 'thermal_usb' })).toBe(true);
    expect(hasRealPrinter({ connected: false, type: 'thermal_usb' })).toBe(false);
    expect(hasRealPrinter({ connected: true, type: 'none' })).toBe(false);
    expect(hasRealPrinter({ connected: true, type: 'browser_print' })).toBe(false);
  });
  it('SaleFinalizationGuard : claim une seule fois', () => {
    const g = new SaleFinalizationGuard();
    expect(g.claim('T-1')).toBe(true);
    expect(g.claim('T-1')).toBe(false); // déjà réservé
    expect(g.claim('')).toBe(false); // ticket vide refusé
    expect(g.claim('T-2')).toBe(true);
  });
  it('buildTicketData : conversion centimes→euros + libellés', () => {
    const td = buildTicketData({
      ticketNumber: 'T-9', date: new Date('2026-07-11T10:00:00Z'), cashierName: 'Alice',
      items: [{ name: 'Bonbon', quantity: 2, unitPriceMinorUnits: 150 }],
      subtotalMinorUnits: 300, discountMinorUnits: 0, totalMinorUnits: 300,
      payments: [{ method: 'cash', amountMinorUnits: 300 }], changeMinorUnits: 0,
    });
    expect(td.total).toBe(3);
    expect(td.items[0]).toMatchObject({ quantity: 2, unitPrice: 1.5, total: 3 });
    expect(td.payments[0]).toEqual({ method: 'Especes', amount: 3 });
    expect(td.softwareVersion).toBe('1.0');
  });
});

describe('salePeripherals — orchestrateur finalizeSalePeripherals', () => {
  beforeEach(() => {
    mockBridge.printTicket.mockReset();
    mockBridge.openCashDrawer.mockReset();
    mockBridge.status.printer = { connected: true, type: 'thermal_usb', name: 'EPSON' };
  });

  const td = buildTicketData({
    ticketNumber: 'T-100', date: new Date('2026-07-11T10:00:00Z'), cashierName: 'Bob',
    items: [{ name: 'X', quantity: 1, unitPriceMinorUnits: 1000 }],
    subtotalMinorUnits: 1000, discountMinorUnits: 0, totalMinorUnits: 1000,
    payments: cash, changeMinorUnits: 0,
  });

  it('vente espèces réussie → imprime + ouvre le tiroir', async () => {
    mockBridge.printTicket.mockResolvedValue(true);
    mockBridge.openCashDrawer.mockResolvedValue(true);
    const r = await finalizeSalePeripherals({ ticketData: td, payments: cash, saleValidated: true, guard: new SaleFinalizationGuard() });
    expect(r).toEqual({ printStatus: 'printed', drawerOpened: true });
    expect(mockBridge.printTicket).toHaveBeenCalledOnce();
    expect(mockBridge.openCashDrawer).toHaveBeenCalledOnce();
  });

  it('vente CB réussie → imprime mais N’ouvre PAS le tiroir', async () => {
    mockBridge.printTicket.mockResolvedValue(true);
    const r = await finalizeSalePeripherals({ ticketData: { ...td, ticketNumber: 'T-CB' }, payments: card, saleValidated: true, guard: new SaleFinalizationGuard() });
    expect(r.printStatus).toBe('printed');
    expect(r.drawerOpened).toBe(false);
    expect(mockBridge.openCashDrawer).not.toHaveBeenCalled();
  });

  it('vente non validée (échouée/en attente) → rien : ni impression ni tiroir', async () => {
    const r = await finalizeSalePeripherals({ ticketData: td, payments: cash, saleValidated: false, guard: new SaleFinalizationGuard() });
    expect(r).toEqual({ printStatus: 'skipped', drawerOpened: false });
    expect(mockBridge.printTicket).not.toHaveBeenCalled();
    expect(mockBridge.openCashDrawer).not.toHaveBeenCalled();
  });

  it('imprimante indisponible → no_printer, vente non affectée, tiroir espèces quand même', async () => {
    mockBridge.status.printer = { connected: false, type: 'none', name: null } as any;
    mockBridge.openCashDrawer.mockResolvedValue(true);
    const r = await finalizeSalePeripherals({ ticketData: { ...td, ticketNumber: 'T-NOPRINT' }, payments: cash, saleValidated: true, guard: new SaleFinalizationGuard() });
    expect(r.printStatus).toBe('no_printer');
    expect(mockBridge.printTicket).not.toHaveBeenCalled();
    expect(r.drawerOpened).toBe(true); // le tiroir espèces s'ouvre indépendamment
  });

  it('échec d’impression → print_failed, la vente reste valide (pas d’exception)', async () => {
    mockBridge.printTicket.mockResolvedValue(false);
    mockBridge.openCashDrawer.mockResolvedValue(true);
    const r = await finalizeSalePeripherals({ ticketData: { ...td, ticketNumber: 'T-FAIL' }, payments: cash, saleValidated: true, guard: new SaleFinalizationGuard() });
    expect(r.printStatus).toBe('print_failed');
    expect(r.drawerOpened).toBe(true);
  });

  it('impression qui throw → print_failed, jamais d’exception propagée', async () => {
    mockBridge.printTicket.mockRejectedValue(new Error('spooler down'));
    const r = await finalizeSalePeripherals({ ticketData: { ...td, ticketNumber: 'T-THROW' }, payments: card, saleValidated: true, guard: new SaleFinalizationGuard() });
    expect(r.printStatus).toBe('print_failed');
  });

  it('double-clic / retry → 2ᵉ appel idempotent : pas de 2ᵉ ticket ni 2ᵉ tiroir', async () => {
    mockBridge.printTicket.mockResolvedValue(true);
    mockBridge.openCashDrawer.mockResolvedValue(true);
    const guard = new SaleFinalizationGuard();
    const a = await finalizeSalePeripherals({ ticketData: { ...td, ticketNumber: 'T-DUP' }, payments: cash, saleValidated: true, guard });
    const b = await finalizeSalePeripherals({ ticketData: { ...td, ticketNumber: 'T-DUP' }, payments: cash, saleValidated: true, guard });
    expect(a.printStatus).toBe('printed');
    expect(b).toEqual({ printStatus: 'skipped', drawerOpened: false });
    expect(mockBridge.printTicket).toHaveBeenCalledOnce();
    expect(mockBridge.openCashDrawer).toHaveBeenCalledOnce();
  });

  it('tiroir non configuré (openCashDrawer=false) → drawerOpened false, honnête', async () => {
    mockBridge.printTicket.mockResolvedValue(true);
    mockBridge.openCashDrawer.mockResolvedValue(false);
    const r = await finalizeSalePeripherals({ ticketData: { ...td, ticketNumber: 'T-NODRAWER' }, payments: cash, saleValidated: true, guard: new SaleFinalizationGuard() });
    expect(r.drawerOpened).toBe(false);
  });
});
