// @vitest-environment jsdom
/**
 * AUDIT `syncEngine` — tests d'EXÉCUTION (audit 2026-08-06).
 *
 * Avant cet audit : 451 lignes, **0 % de couverture, aucun fichier de test**.
 * C'est le chemin qui remonte au serveur les ventes encaissées hors ligne —
 * la caisse est en « MODE SECOURS — SYNCHRONISATION EN ATTENTE » depuis
 * plusieurs jours, donc de l'argent réel transite ici.
 *
 * Ces tests EXÉCUTENT le moteur (store zustand réel, dedup HMAC réel) et ne se
 * contentent pas de lire le source. Seules les API réseau sont doublées, afin
 * qu'aucun test n'écrive dans la comptabilité de production.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/* ── Doublures réseau : AUCUN appel réel vers un backend ─────────────── */
const salesCreate = vi.fn();
const salesVoid = vi.fn();
const returnsCreateByTicket = vi.fn();
const timewinPushEvent = vi.fn();
const employeeScoreLogEvent = vi.fn();

vi.mock('./api', () => ({
  salesApi: {
    create: (...a: unknown[]) => salesCreate(...a),
    void: (...a: unknown[]) => salesVoid(...a),
  },
  returnsApi: { createByTicket: (...a: unknown[]) => returnsCreateByTicket(...a) },
  timewinApi: { pushEvent: (...a: unknown[]) => timewinPushEvent(...a) },
  employeeScoreApi: { logEvent: (...a: unknown[]) => employeeScoreLogEvent(...a) },
}));

import { runSync } from './syncEngine';
import { useOfflineStore } from '../stores/offlineStore';

/** Erreur HTTP telle que la produit axios (utilisée par le moteur). */
function httpError(status: number, message = 'refus serveur') {
  const e = new Error(message) as Error & { response?: unknown };
  e.response = { status, data: { message } };
  return e;
}

/** Met le réseau « en ligne » : navigator.onLine + /api/health répond OK. */
function goOnline(): void {
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true } as Response));
}

function goOffline(): void {
  Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
}

/** Met en file une vente encaissée hors ligne. */
function enqueueTicket(ticketNumber: string, extra: Record<string, unknown> = {}): string {
  return useOfflineStore.getState().enqueue({
    type: 'ticket',
    storeId: 'store-test',
    cashierId: 'emp-1',
    cashierName: 'Alice',
    payload: {
      ticketNumber,
      items: [{ productId: 'p1', quantity: 1, unitPriceMinorUnits: 600 }],
      payments: [{ method: 'cash', amountMinorUnits: 600 }],
      totalMinorUnits: 600,
      ...extra,
    },
  } as never);
}

function entryById(id: string) {
  return useOfflineStore.getState().queue.find((e) => e.id === id);
}

/** Réinitialise complètement le store persisté entre deux tests. */
function resetStore(): void {
  localStorage.clear();
  useOfflineStore.setState({
    queue: [],
    pendingCount: 0,
    syncedCount: 0,
    conflictCount: 0,
    isSyncing: false,
    syncErrors: [],
    conflicts: [],
    networkStatus: 'online',
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  goOnline();
  salesCreate.mockResolvedValue({ data: {} });
  salesVoid.mockResolvedValue({ data: {} });
  returnsCreateByTicket.mockResolvedValue({ data: {} });
  timewinPushEvent.mockResolvedValue({ data: {} });
  employeeScoreLogEvent.mockResolvedValue({ data: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ═══════════════════════════════════════════════════════════════════
   1. Remontée nominale d'une vente hors ligne
   ═══════════════════════════════════════════════════════════════════ */

describe('syncEngine — remontée nominale', () => {
  it('une vente en file est envoyée au serveur et marquée synchronisée', async () => {
    const id = enqueueTicket('T-001');
    const res = await runSync();

    expect(salesCreate).toHaveBeenCalledTimes(1);
    expect(res.synced).toBe(1);
    expect(res.failed).toBe(0);
    expect(entryById(id)?.status).toBe('synced');
  });

  it('une clé d’idempotence est TOUJOURS transmise (NF525 : jamais de vente en double)', async () => {
    enqueueTicket('T-002');
    await runSync();
    const idemKey = salesCreate.mock.calls[0][1];
    expect(typeof idemKey).toBe('string');
    expect((idemKey as string).length).toBeGreaterThan(8);
  });

  it('la clé d’idempotence de la tentative EN LIGNE est réutilisée si elle existe', async () => {
    // Cas réel : la vente est partie, la réponse s'est perdue. Rejouer avec la
    // MÊME clé laisse le backend dédupliquer au lieu de créer un doublon.
    enqueueTicket('T-003', { idempotencyKey: 'sale-abc-123' });
    await runSync();
    expect(salesCreate.mock.calls[0][1]).toBe('sale-abc-123');
  });

  it('rien en file → aucun appel réseau', async () => {
    const res = await runSync();
    expect(salesCreate).not.toHaveBeenCalled();
    expect(res).toEqual({ synced: 0, failed: 0, conflicts: 0 });
  });
});

/* ═══════════════════════════════════════════════════════════════════
   2. Ordre FIFO + priorité métier
   ═══════════════════════════════════════════════════════════════════ */

describe('syncEngine — ordre de remontée', () => {
  it('les tickets partent AVANT les pointages (priorité métier)', async () => {
    const ordre: string[] = [];
    salesCreate.mockImplementation(async () => { ordre.push('ticket'); return { data: {} }; });
    timewinPushEvent.mockImplementation(async () => { ordre.push('pointage'); return { data: {} }; });

    useOfflineStore.getState().enqueue({
      type: 'pointage', storeId: 's', cashierId: 'e', cashierName: 'A',
      payload: { punchType: 'in', employeeName: 'A' },
    } as never);
    enqueueTicket('T-010');

    await runSync();
    expect(ordre).toEqual(['ticket', 'pointage']);
  });
});

/* ═══════════════════════════════════════════════════════════════════
   3. Réseau
   ═══════════════════════════════════════════════════════════════════ */

describe('syncEngine — réseau', () => {
  it('hors ligne : AUCUN envoi, la file est préservée', async () => {
    const id = enqueueTicket('T-020');
    goOffline();
    const res = await runSync();

    expect(salesCreate).not.toHaveBeenCalled();
    expect(res.synced).toBe(0);
    expect(entryById(id)?.status).toBe('local_pending'); // la vente n'est PAS perdue
  });

  it('une synchro déjà en cours n’est pas relancée en parallèle', async () => {
    enqueueTicket('T-021');
    useOfflineStore.setState({ isSyncing: true } as never);
    const res = await runSync();
    expect(salesCreate).not.toHaveBeenCalled();
    expect(res.synced).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════
   4. Refus serveur (4xx) — échec DÉFINITIF, jamais de rejeu
   ═══════════════════════════════════════════════════════════════════ */

describe('syncEngine — refus métier du serveur', () => {
  it('un 4xx marque l’entrée en échec définitif et remonte le motif serveur', async () => {
    const id = enqueueTicket('T-030');
    salesCreate.mockRejectedValue(httpError(409, 'quantité déjà retournée'));

    const res = await runSync();

    expect(res.failed).toBe(1);
    expect(entryById(id)?.status).toBe('failed');
    const errs = useOfflineStore.getState().syncErrors.join(' | ');
    expect(errs).toContain('quantité déjà retournée');
  });

  it('après un 4xx, l’entrée n’est PAS renvoyée à la synchro suivante', async () => {
    enqueueTicket('T-031');
    salesCreate.mockRejectedValue(httpError(400, 'payload invalide'));
    await runSync();
    salesCreate.mockClear();

    await runSync(); // 2ᵉ passage
    expect(salesCreate).not.toHaveBeenCalled();
  });
});

/* ═══════════════════════════════════════════════════════════════════
   5. DÉFAUT CONFIRMÉ — le compteur de tentatives ne progresse jamais
   ═══════════════════════════════════════════════════════════════════ */

describe('syncEngine — plafond de tentatives (DÉFAUT)', () => {
  it('une panne serveur (5xx) renvoie l’entrée en attente pour rejeu', async () => {
    const id = enqueueTicket('T-040');
    salesCreate.mockRejectedValue(httpError(500, 'boom'));

    const res = await runSync();
    expect(res.failed).toBe(1);
    expect(entryById(id)?.status).toBe('local_pending'); // rejouable : correct
  });

  /**
   * NON-RÉGRESSION d'un défaut RÉEL corrigé le 2026-08-06.
   *
   * `syncEntry` teste `entry.retryCount >= entry.maxRetries` (5) pour déclarer
   * un échec définitif, mais le chemin de rejeu écrit le statut
   * `local_pending` — or `offlineStore.updateEntryStatus` n'incrémentait
   * `retryCount` QUE lorsque le statut valait `failed` :
   *
   *     retryCount: status === 'failed' ? e.retryCount + 1 : e.retryCount
   *
   * `retryCount` restait donc bloqué à 0, le plafond n'était JAMAIS atteint, et
   * une entrée définitivement cassée était rejouée à l'infini — sans que
   * l'opérateur voie jamais un échec franc. Constaté par exécution (le serveur
   * était sollicité 8 fois sur 8 tentatives).
   *
   * Correctif : une tentative est consommée aussi lors du passage
   * `syncing` → `local_pending`.
   */
  it('un rejeu consomme une tentative (le compteur progresse)', async () => {
    const id = enqueueTicket('T-041');
    salesCreate.mockRejectedValue(httpError(503, 'indisponible'));

    await runSync();
    expect(entryById(id)!.retryCount).toBe(1);
    await runSync();
    expect(entryById(id)!.retryCount).toBe(2);
  });

  it('le plafond de tentatives est ATTEINT : l’entrée finit en échec définitif', async () => {
    const id = enqueueTicket('T-042');
    salesCreate.mockRejectedValue(httpError(503, 'indisponible'));

    for (let i = 0; i < 8; i++) await runSync();

    const e = entryById(id)!;
    expect(e.maxRetries).toBe(5);
    expect(e.status).toBe('failed'); // plus de rejeu infini
    // Le serveur n'est PAS sollicité indéfiniment : les tentatives sont bornées.
    expect(salesCreate.mock.calls.length).toBeLessThanOrEqual(6);
    // Et l'échec est remonté à l'opérateur.
    expect(useOfflineStore.getState().syncErrors.join(' | ')).toContain('Echec definitif');
  });
});

/* ═══════════════════════════════════════════════════════════════════
   6. Anti-doublon
   ═══════════════════════════════════════════════════════════════════ */

describe('syncEngine — anti-doublon', () => {
  it('une entrée déjà remontée n’est pas renvoyée une seconde fois', async () => {
    enqueueTicket('T-050');
    await runSync();
    expect(salesCreate).toHaveBeenCalledTimes(1);

    // On la repasse en attente : le marqueur d'envoi doit bloquer le rejeu.
    const id = useOfflineStore.getState().queue[0].id;
    useOfflineStore.getState().updateEntryStatus(id, 'local_pending');
    salesCreate.mockClear();

    await runSync();
    expect(salesCreate).not.toHaveBeenCalled();
    expect(entryById(id)?.status).toBe('synced');
  });
});

/* ═══════════════════════════════════════════════════════════════════
   7. Détection de conflits — NON IMPLÉMENTÉE
   ═══════════════════════════════════════════════════════════════════ */

describe('syncEngine — conflits', () => {
  /**
   * `checkForConflicts` retourne `{ hasConflict: false }` sur TOUS les chemins :
   * le corps réel est en commentaire (`// TODO`, `// En production :`). La
   * résolution de conflit, le statut `conflict` et le compteur associé sont donc
   * du code MORT. Un stock modifié côté serveur pendant la coupure n'est jamais
   * détecté.
   */
  it('NON IMPLÉMENTÉ : un mouvement de stock ne déclenche jamais de conflit', async () => {
    useOfflineStore.getState().enqueue({
      type: 'stock_movement', storeId: 's', cashierId: 'e', cashierName: 'A',
      payload: { productId: 'p1', delta: -3, expectedVersion: 1 },
    } as never);

    const res = await runSync();

    expect(res.conflicts).toBe(0);
    expect(useOfflineStore.getState().conflicts).toHaveLength(0);
    expect(res.synced).toBe(1); // remontée « réussie » sans aucune vérification
  });
});

/* ═══════════════════════════════════════════════════════════════════
   8. Types délégués — aucune donnée silencieusement perdue
   ═══════════════════════════════════════════════════════════════════ */

describe('syncEngine — types délégués au ticket', () => {
  it('paiement et log antifraude sont marqués synchronisés sans appel propre', async () => {
    // Ils voyagent DANS le ticket : c'est voulu. Le test fige ce contrat pour
    // qu'un futur changement ne les fasse pas disparaître en silence.
    const idPay = useOfflineStore.getState().enqueue({
      type: 'payment', storeId: 's', cashierId: 'e', cashierName: 'A',
      payload: { ticketNumber: 'T-060' },
    } as never);
    const idLog = useOfflineStore.getState().enqueue({
      type: 'antifraude_log', storeId: 's', cashierId: 'e', cashierName: 'A',
      payload: { event: 'VOID' },
    } as never);

    await runSync();

    expect(entryById(idPay)?.status).toBe('synced');
    expect(entryById(idLog)?.status).toBe('synced');
    expect(salesCreate).not.toHaveBeenCalled();
  });

  it('un avoir différé passe par returnsApi.createByTicket (et non par un void)', async () => {
    useOfflineStore.getState().enqueue({
      type: 'credit_note_return', storeId: 's', cashierId: 'e', cashierName: 'A',
      payload: { ticketNumber: 'T-070', lines: [{ productId: 'p1', quantity: 1 }] },
    } as never);

    await runSync();

    expect(returnsCreateByTicket).toHaveBeenCalledTimes(1);
    expect(salesVoid).not.toHaveBeenCalled();
  });
});
