/**
 * Moteur de sync différée — vide la file FIFO vers le backend.
 *
 * Le « poster » est injecté (testable sans réseau). En prod, l'offlineStore
 * fournit inventoryScanApi.record (POST /api/inventory-scans, JWT auto).
 *
 * Idempotence : chaque entrée n'est envoyée qu'une fois tant qu'elle n'est pas
 * confirmée ; sur succès → 'synced', sur échec → 'failed' + retryCount.
 * NB : une vraie dé-duplication côté serveur (clé = entry.id) reste à ajouter
 * pour couvrir le cas « 2xx perdu après commit serveur » (voir README).
 */
import { getSyncable, markSyncing, markSynced, markFailed, QueueEntry, CountPayload } from './queue';
import { checkOnline } from './network';

export type Poster = (payload: CountPayload & { clientEntryId: string }) => Promise<unknown>;

export interface DrainResult {
  attempted: number;
  synced: number;
  failed: number;
  skippedOffline: boolean;
}

let draining = false;

export async function drainQueue(poster: Poster): Promise<DrainResult> {
  const result: DrainResult = { attempted: 0, synced: 0, failed: 0, skippedOffline: false };
  if (draining) return result; // pas de drain concurrent
  draining = true;
  try {
    if (!(await checkOnline())) {
      result.skippedOffline = true;
      return result;
    }
    const entries = await getSyncable();
    for (const entry of entries) {
      result.attempted++;
      await markSyncing(entry.id);
      try {
        await poster({ ...entry.payload, clientEntryId: entry.id });
        await markSynced(entry.id);
        result.synced++;
      } catch (e: any) {
        const msg = e?.response?.data?.message || e?.message || 'sync_error';
        await markFailed(entry.id, String(msg), entry.retryCount + 1);
        result.failed++;
      }
    }
    return result;
  } finally {
    draining = false;
  }
}

export type { QueueEntry };
