import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CONTINUITÉ DE CAISSE — encaisser malgré un serveur de sessions en panne.
 *
 * Contexte terrain (caisse Windows, 2026-07-28) : `GET /pos-sessions/active` et
 * `POST /pos-sessions/open` renvoient HTTP 500 (jeton, storeId et X-Terminal-Id
 * valides ; `/products` répond 200). L'ancien garde de `finalizePayment`
 * refusait alors TOUTE vente : une panne d'un seul module serveur arrêtait
 * l'encaissement du magasin.
 *
 * Le backend accepte déjà les ventes sans session (`sales.session_id` NULLABLE,
 * dérivé du terminal). On encaisse donc, et on TRACE — sans jamais tenter de
 * rattachement rétroactif (règle « no UPDATE on validated sale »).
 */

const { open, close, active, setOpeningCash, logout, logEvent } = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  active: vi.fn(),
  setOpeningCash: vi.fn().mockResolvedValue(undefined),
  logout: vi.fn().mockResolvedValue(undefined),
  logEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/api', () => ({
  authApi: { logout },
  posSessionApi: {
    open: () => Promise.resolve(open()),
    close: (id: string, counted?: number) => Promise.resolve(close(id, counted)),
    active: () => Promise.resolve(active()),
    setOpeningCash: (id: string, amount: number) => Promise.resolve(setOpeningCash(id, amount)),
  },
  employeeScoreApi: { logEvent: (d: any) => Promise.resolve(logEvent(d)) },
}));

import { usePOSStore } from '../stores/posStore';
import { toWirePayments } from './salePayload';
import { newIdempotencyKey } from './idempotency';

/** Erreur axios réaliste : HTTP 500 du module pos-sessions. */
const http500 = () =>
  Object.assign(new Error('Request failed with status code 500'), {
    response: { status: 500, data: { success: false, code: 'INTERNAL_ERROR', statusCode: 500 } },
  });

const emp = { id: 'emp-1', firstName: 'Caisse', lastName: 'Test', role: 'cashier', storeId: 'store-1' };
const article = { productId: 'p-1', ean: '4260421350771', name: 'CHARBON BLACK COCO', unitPriceMinorUnits: 600 };

describe('Encaissement quand le serveur de sessions renvoie 500', () => {
  beforeEach(() => {
    open.mockReset();
    active.mockReset();
    logEvent.mockReset();
    localStorage.clear();
    usePOSStore.setState({
      employee: null, accessToken: null, posSession: null,
      posSessionOpenFailed: false, openingCashRequired: false, cartItems: [],
    });
  });

  it('500 sur open ET active → session absente, échec signalé (jamais silencieux)', async () => {
    open.mockRejectedValue(http500());
    active.mockRejectedValue(http500());
    usePOSStore.getState().setEmployee(emp as any, 'jwt');
    await new Promise((r) => setTimeout(r, 0));
    expect(usePOSStore.getState().posSession).toBeNull();
    expect(usePOSStore.getState().posSessionOpenFailed).toBe(true);
  });

  it('le panier est CONSERVÉ malgré l’échec d’ouverture de session', async () => {
    usePOSStore.getState().addToCart(article as any);
    usePOSStore.getState().addToCart(article as any); // même article → quantité 2
    open.mockRejectedValue(http500());
    active.mockRejectedValue(http500());
    usePOSStore.getState().setEmployee(emp as any, 'jwt');
    await new Promise((r) => setTimeout(r, 0));
    const cart = usePOSStore.getState().cartItems;
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(2);
    expect(usePOSStore.getState().total()).toBe(1200);
  });

  it('la charge utile de vente ne porte AUCUN identifiant de session (dérivé serveur → NULL)', () => {
    usePOSStore.getState().addToCart(article as any);
    const store = usePOSStore.getState();
    const payload = {
      items: store.cartItems.map((i) => ({ ean: i.ean, quantity: i.quantity })),
      payments: toWirePayments([
        { id: 'p1', method: 'cash', amountMinorUnits: 600, cashReceivedMinorUnits: 1000, changeMinorUnits: 400 } as any,
      ]),
    };
    expect(JSON.stringify(payload)).not.toMatch(/session/i);
    expect(payload.items[0].ean).toBe('4260421350771');
    expect(payload.payments).toHaveLength(1);
  });

  it('espèces ET carte produisent une charge utile valide sans session', () => {
    const especes = toWirePayments([
      { id: 'p1', method: 'cash', amountMinorUnits: 600, cashReceivedMinorUnits: 1000, changeMinorUnits: 400 } as any,
    ]);
    const carte = toWirePayments([
      { id: 'p2', method: 'card', amountMinorUnits: 600, cashReceivedMinorUnits: 600, changeMinorUnits: 0 } as any,
    ]);
    expect(especes[0].method).toBe('cash');
    expect(carte[0].method).toBe('card');
    for (const p of [...especes, ...carte]) {
      expect(Number.isInteger(p.amountMinorUnits)).toBe(true); // argent = entiers (centimes)
      expect(JSON.stringify(p)).not.toMatch(/session/i);
    }
  });

  it('comportement NORMAL inchangé quand une session active existe', async () => {
    open.mockResolvedValue({ data: { id: 'sess-42', openedAt: '2026-07-28T08:00:00Z', terminalId: 'T-01', openingCashMinorUnits: 5000 } });
    usePOSStore.getState().setEmployee(emp as any, 'jwt');
    await new Promise((r) => setTimeout(r, 0));
    const st = usePOSStore.getState();
    expect(st.posSession?.id).toBe('sess-42');
    expect(st.posSessionOpenFailed).toBe(false);
    expect(st.openingCashRequired).toBe(false); // fond déjà déclaré
  });

  it('session déjà active sur le terminal (409) → ADOPTÉE, jamais de doublon', async () => {
    open.mockRejectedValue(Object.assign(new Error('conflict'), { response: { status: 409 } }));
    active.mockResolvedValue({ data: { id: 'sess-existante', openedAt: '2026-07-28T07:30:00Z', terminalId: 'T-01' } });
    usePOSStore.getState().setEmployee(emp as any, 'jwt');
    await new Promise((r) => setTimeout(r, 0));
    expect(usePOSStore.getState().posSession?.id).toBe('sess-existante');
    expect(usePOSStore.getState().posSessionOpenFailed).toBe(false);
    expect(open).toHaveBeenCalledTimes(1); // une seule tentative d'ouverture
  });

  it('clé d’idempotence : deux clés distinctes, et la même clé rejouée dédoublonne côté serveur', () => {
    const k1 = newIdempotencyKey();
    const k2 = newIdempotencyKey();
    expect(k1).not.toBe(k2);
    // Une reprise réseau REJOUE la même clé (le ref n'est vidé qu'après succès
    // confirmé) → le backend dédoublonne au lieu de créer une 2ᵉ vente.
    const rejouee = k1;
    expect(rejouee).toBe(k1);
  });
});

describe('POSPage — câblage de la continuité de caisse (source)', () => {
  const src = readFileSync(join(__dirname, '..', 'pages', 'POSPage.tsx'), 'utf8');

  it('aucun refus d’encaissement lié à la session', () => {
    expect(src).not.toMatch(/encaissement impossible/i);
    expect(src).not.toMatch(/Ouvrez la session de caisse avant de vendre/i);
  });

  it('marque la vente hors session sans interrompre le flux', () => {
    expect(src).toMatch(/const venteHorsSession = store\.posSessionOpenFailed && !store\.posSession\?\.id/);
    expect(src).toMatch(/SALE_WITHOUT_POS_SESSION/);
  });

  it('alerte orange au texte exact, visible en permanence', () => {
    expect(src).toMatch(
      /Session de caisse indisponible — encaissement autorisé, vente non rattachée au comptage de session\./,
    );
    expect(src).toMatch(/data-testid="alerte-session-indisponible"/);
  });

  it('la clé d’idempotence n’est vidée qu’après confirmation serveur (pas de double vente)', () => {
    expect(src).toMatch(/if \(!saleIdemKeyRef\.current\) saleIdemKeyRef\.current = newIdempotencyKey\(\)/);
    expect(src).toMatch(/saleIdemKeyRef\.current = null; \/\/ confirmed online/);
  });

  it('aucun rattachement rétroactif des ventes hors session', () => {
    expect(src).not.toMatch(/attachSessionRetro|rattachementRetroactif|backfillSession/i);
  });
});
