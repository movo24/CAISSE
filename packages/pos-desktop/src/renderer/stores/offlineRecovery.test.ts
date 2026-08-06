// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useOfflineStore } from './offlineStore';

/**
 * PERTE SILENCIEUSE DE VENTE APRÈS CRASH — reproduction comportementale.
 *
 * Séquence terrain : vente hors ligne mise en file → la synchro démarre et
 * persiste le statut `syncing` → coupure de courant pendant l'appel réseau →
 * au redémarrage l'entrée est rechargée telle quelle. `getPendingEntries()` ne
 * regarde que `local_pending`, donc la vente n'était plus JAMAIS rejouée, et
 * `pendingCount` retombait à 0 : l'écran affichait « ONLINE, tout synchronisé ».
 *
 * Le rejeu est sûr : la clé d'idempotence serveur renvoie la réponse mise en
 * cache au lieu de créer une seconde vente.
 *
 * `syncEngine` n'avait AUCUN test dans le dépôt. Ceux-ci couvrent l'état
 * persistant, qui est le siège du défaut.
 */

const QUEUE_KEY = 'caisse_offline_queue';

/** Écrit une file persistée comme le ferait un crash à l'instant voulu. */
function persistQueue(entries: Array<Record<string, unknown>>) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(entries));
}

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'sale-abcdef12',
  type: 'ticket',
  payload: { ticketNumber: 'OFF-M3K2P1', total: 1750 },
  status: 'local_pending',
  timestamp: 1_700_000_000_000,
  retryCount: 0,
  maxRetries: 5,
  createdOffline: true,
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  useOfflineStore.setState({ queue: [], pendingCount: 0, syncedCount: 0, failedCount: 0 });
});

describe('reprise après crash pendant l’envoi', () => {
  it('une entrée bloquée en `syncing` est REMISE EN ATTENTE au démarrage', () => {
    persistQueue([entry({ status: 'syncing' })]);

    useOfflineStore.getState().loadPersistedQueue();

    expect(useOfflineStore.getState().queue[0].status).toBe('local_pending');
  });

  it('elle redevient visible pour la synchronisation (le cœur du défaut)', () => {
    persistQueue([entry({ status: 'syncing' })]);

    useOfflineStore.getState().loadPersistedQueue();

    // AVANT le correctif : 0 → la vente n'était jamais rejouée.
    expect(useOfflineStore.getState().getPendingEntries()).toHaveLength(1);
  });

  it('le compteur « en attente » cesse de mentir', () => {
    persistQueue([entry({ status: 'syncing' })]);

    useOfflineStore.getState().loadPersistedQueue();

    expect(useOfflineStore.getState().pendingCount).toBe(1);
  });

  it('la raison de la reprise est tracée sur l’entrée', () => {
    persistQueue([entry({ status: 'syncing' })]);

    useOfflineStore.getState().loadPersistedQueue();

    expect(String(useOfflineStore.getState().queue[0].conflictDetails)).toMatch(/interruption/i);
  });

  it('les entrées déjà synchronisées ne sont PAS ressuscitées', () => {
    persistQueue([entry({ id: 'a', status: 'synced' }), entry({ id: 'b', status: 'syncing' })]);

    useOfflineStore.getState().loadPersistedQueue();

    const byId = Object.fromEntries(useOfflineStore.getState().queue.map((e) => [e.id, e.status]));
    expect(byId.a).toBe('synced');
    expect(byId.b).toBe('local_pending');
  });

  it('une file saine traverse le démarrage sans modification', () => {
    persistQueue([entry({ status: 'local_pending' }), entry({ id: 'z', status: 'synced' })]);

    useOfflineStore.getState().loadPersistedQueue();

    expect(useOfflineStore.getState().getPendingEntries()).toHaveLength(1);
    expect(useOfflineStore.getState().syncedCount).toBe(1);
  });
});

describe('les rejets définitifs ne sont plus silencieux', () => {
  it('les entrées `failed` sont comptées au démarrage', () => {
    persistQueue([entry({ status: 'failed' }), entry({ id: 'c', status: 'failed' })]);

    useOfflineStore.getState().loadPersistedQueue();

    expect(useOfflineStore.getState().failedCount).toBe(2);
  });

  it('un rejet survenu en cours de session est compté immédiatement', () => {
    const s = useOfflineStore.getState();
    const id = s.enqueue({ type: 'ticket', payload: { total: 1200 } } as never);
    useOfflineStore.getState().updateEntryStatus(id, 'failed', 'Rejeté par le serveur');

    expect(useOfflineStore.getState().failedCount).toBe(1);
    expect(useOfflineStore.getState().pendingCount).toBe(0);
  });
});

describe('compteur de tentatives', () => {
  it('`bumpRetryCount` incrémente et persiste', () => {
    const s = useOfflineStore.getState();
    const id = s.enqueue({ type: 'ticket', payload: { total: 500 } } as never);

    useOfflineStore.getState().bumpRetryCount(id);
    useOfflineStore.getState().bumpRetryCount(id);

    expect(useOfflineStore.getState().queue.find((e) => e.id === id)?.retryCount).toBe(2);
    const persisted = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    expect(persisted.find((e: { id: string }) => e.id === id).retryCount).toBe(2);
  });

  it('la borne `maxRetries` devient donc atteignable', () => {
    const s = useOfflineStore.getState();
    const id = s.enqueue({ type: 'ticket', payload: { total: 500 } } as never);
    for (let i = 0; i < 5; i++) useOfflineStore.getState().bumpRetryCount(id);

    const e = useOfflineStore.getState().queue.find((x) => x.id === id)!;
    expect(e.retryCount).toBeGreaterThanOrEqual(e.maxRetries);
  });
});
