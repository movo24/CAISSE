/**
 * POS-020 — mode dégradé / offline-first : preuve du comportement du store
 * (zustand, node env, localStorage shim du setup). On teste le CONTRAT :
 * bascule online↔offline visible + journalisée, disponibilité des moyens de
 * paiement selon le TPE, file locale persistante, garde-fous anti-fraude.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useOfflineStore } from './offlineStore';

const S = () => useOfflineStore.getState();

const resetStore = () => {
  localStorage.clear();
  useOfflineStore.setState({
    networkStatus: 'online',
    offlineSince: null,
    queue: [],
    cashierTrackers: {},
    tpeConfig: { ...S().tpeConfig, mode: 'internet_dependent' },
  } as any);
  S().updatePaymentAvailability();
};

beforeEach(resetStore);

describe('POS-020 — bascule online/offline', () => {
  it('goOffline marque le statut, horodate, et JOURNALISE l’événement dans la file', () => {
    S().goOffline();
    expect(S().networkStatus).toBe('offline');
    expect(S().offlineSince).toBeTruthy();
    const logs = S().getEntriesByType('antifraude_log');
    expect(logs.some((e) => e.payload?.event === 'connection_lost')).toBe(true);
  });

  it('goOnline restaure le statut et journalise la durée offline', () => {
    S().goOffline();
    S().goOnline();
    expect(S().networkStatus).toBe('online');
    expect(S().offlineSince).toBeNull();
    const logs = S().getEntriesByType('antifraude_log');
    const restored = logs.find((e) => e.payload?.event === 'connection_restored');
    expect(restored).toBeTruthy();
    expect(restored!.payload.offlineDurationSeconds).toBeGreaterThanOrEqual(0);
  });

  it('paiements en mode dégradé : cash TOUJOURS ; carte seulement si TPE autonome ; QR/wallet jamais', () => {
    S().goOffline();
    expect(S().paymentAvailability).toEqual({ cash: true, card: false, qr: false, wallet: false });

    S().setTpeConfig({ ...S().tpeConfig, mode: 'autonomous' });
    expect(S().paymentAvailability.card).toBe(true); // TPE 4G indépendant de la caisse
    expect(S().paymentAvailability.qr).toBe(false);

    S().goOnline();
    expect(S().paymentAvailability).toEqual({ cash: true, card: true, qr: true, wallet: true });
  });
});

describe('POS-020 — file locale persistante', () => {
  it('enqueue → local_pending ; le cycle de vie synced sort de getPendingEntries et clearSyncedEntries purge', () => {
    S().enqueue({ type: 'ticket', payload: { t: 1 }, cashierId: 'c1', cashierName: 'Alice', storeId: 's1' } as any);
    const [entry] = S().getPendingEntries();
    expect(entry.status).toBe('local_pending');
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/); // UUID v4

    S().updateEntryStatus(entry.id, 'synced');
    expect(S().getPendingEntries()).toHaveLength(0);
    S().clearSyncedEntries();
    expect(S().queue.find((e) => e.id === entry.id)).toBeUndefined();
  });

  it('la file survit à un redémarrage (persist → load sur store vidé)', () => {
    S().enqueue({ type: 'payment', payload: { amount: 500 }, cashierId: 'c1', cashierName: 'Alice', storeId: 's1' } as any);
    S().persistQueue();
    useOfflineStore.setState({ queue: [] } as any);
    expect(S().queue).toHaveLength(0);
    S().loadPersistedQueue();
    expect(S().queue.some((e) => e.type === 'payment' && e.payload.amount === 500)).toBe(true);
  });
});

describe('POS-020 — garde-fous anti-fraude offline', () => {
  it('annulations consécutives bloquées à la limite (2), reset après vente', () => {
    expect(S().trackVoid('c1').allowed).toBe(true);
    expect(S().trackVoid('c1').allowed).toBe(true);
    const third = S().trackVoid('c1');
    expect(third.allowed).toBe(false);
    expect(third.reason).toContain('consecutives');

    S().resetConsecutiveVoids('c1'); // une vente normale casse la série
    expect(S().trackVoid('c1').allowed).toBe(true);
  });

  it('plafond quotidien d’annulations par caissier (5/jour) même non consécutives', () => {
    for (let i = 0; i < 5; i++) {
      S().trackVoid('c2');
      S().resetConsecutiveVoids('c2');
    }
    const sixth = S().trackVoid('c2');
    expect(sixth.allowed).toBe(false);
    expect(sixth.reason).toContain('Limite annulations');
  });

  it('remboursement espèces offline plafonné à 50 € cumulés / caissier', () => {
    expect(S().trackCashRefund('c3', 3000).allowed).toBe(true);
    expect(S().trackCashRefund('c3', 2000).allowed).toBe(true); // 50,00 € pile
    const over = S().trackCashRefund('c3', 1);
    expect(over.allowed).toBe(false);
    expect(over.reason).toContain('Seuil remboursement');
  });

  it('ticket offline plafonné à 500 € ; anomalies remontées pour la resync', () => {
    expect(S().checkTicketLimit(50000).allowed).toBe(true);
    expect(S().checkTicketLimit(50001).allowed).toBe(false);

    // 4 voids = 80% du plafond quotidien → anomalie trackée pour le manager
    for (let i = 0; i < 4; i++) {
      S().trackVoid('c4');
      S().resetConsecutiveVoids('c4');
    }
    const anomalous = S().getAnomaliesForResync();
    expect(anomalous.some((t) => t.cashierId === 'c4' && t.anomalies.length > 0)).toBe(true);
  });
});
