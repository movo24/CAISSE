import { useOfflineStore, OfflineQueueEntry } from '../stores/offlineStore';
import { signSyncRequest, markAsSent, unmarkSent, isAlreadySent, idempotencyKeyFor, logSecurityEvent } from './hmacSecurity';
import { salesApi, timewinApi, returnsApi } from './api';
import { toSyncCreateBody } from './salePayload';
import { API_URL } from '../utils/apiConfig';

/* ═══════════════════════════════════════════════════════════════
   SYNC ENGINE — Resynchronisation automatique FIFO
   Tickets → Paiements → Stock → Returns → Logs
   ═══════════════════════════════════════════════════════════════ */

// ── Sync Order Priority ──
const SYNC_ORDER: Record<string, number> = {
  ticket: 1,
  payment: 2,
  stock_movement: 3,
  return: 4,
  void: 5,
  antifraude_log: 6,
  pointage: 7,
  cashier_metrics: 8,
  staffing_snapshot: 9,
};

// ── Network Check ──

let networkCheckInterval: ReturnType<typeof setInterval> | null = null;
let syncTimeout: ReturnType<typeof setTimeout> | null = null;

async function checkNetworkStatus(): Promise<boolean> {
  // 1. navigator.onLine (fast but unreliable)
  if (!navigator.onLine) return false;

  // 2. Actual ping to backend (reliable)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(
      API_URL + '/api/health',
      { method: 'HEAD', signal: controller.signal },
    );
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

// ── Conflict Resolution ──

interface ConflictCheckResult {
  hasConflict: boolean;
  serverData?: any;
  resolution?: 'ticket_priority' | 'server_priority';
  description?: string;
}

async function checkForConflicts(entry: OfflineQueueEntry): Promise<ConflictCheckResult> {
  // TODO: check server-side versions for conflict detection

  if (entry.type === 'ticket' || entry.type === 'payment') {
    // Règle métier : le ticket vendu a TOUJOURS priorité
    return { hasConflict: false };
  }

  if (entry.type === 'stock_movement') {
    // Vérifier si le stock a été modifié sur le serveur pendant le offline
    // En production :
    // const serverStock = await productsApi.getStock(entry.payload.productId);
    // if (serverStock.version !== entry.payload.expectedVersion) {
    //   return {
    //     hasConflict: true,
    //     serverData: serverStock,
    //     resolution: 'ticket_priority',
    //     description: `Stock modifié sur serveur pour ${entry.payload.productName}. Recalcul en cours.`,
    //   };
    // }
    return { hasConflict: false };
  }

  return { hasConflict: false };
}

// ── Sync Single Entry ──

async function syncEntry(entry: OfflineQueueEntry): Promise<{ success: boolean; error?: string }> {
  const store = useOfflineStore.getState();

  try {
    store.updateEntryStatus(entry.id, 'syncing');

    // Anti-double sync check
    if (isAlreadySent(entry.type, entry.id)) {
      console.log(`[SYNC] Duplicate blocked: ${entry.type} #${entry.id.slice(0, 8)}`);
      store.updateEntryStatus(entry.id, 'synced');
      return { success: true };
    }

    // HMAC device-signing layer — ⚠️ NON CÂBLÉ (TECHNICAL_DEBT D19, M607).
    // signSyncRequest renvoie toujours null aujourd'hui (token jamais provisionné) et,
    // même non-null, la signature N'EST PAS posée en header ci-dessous ni vérifiée
    // côté backend. Les requêtes sync restent authentifiées par le JWT employé.
    // Câbler la couche = feature coordonnée (provisioning + attach + vérif + anti-replay).
    const signed = await signSyncRequest(entry.payload, entry.type, entry.id);
    if (signed) {
      logSecurityEvent('sync_signed', { type: entry.type, idempotencyKey: signed.idempotencyKey });
    }

    // Check conflicts first
    const conflictResult = await checkForConflicts(entry);
    if (conflictResult.hasConflict) {
      store.addConflict({
        queueEntryId: entry.id,
        type: entry.type,
        description: conflictResult.description || 'Conflit detecte',
        localData: entry.payload,
        serverData: conflictResult.serverData,
        resolution: conflictResult.resolution || 'ticket_priority',
      });

      if (conflictResult.resolution === 'ticket_priority') {
        // On force la version locale (le ticket vendu prime)
        console.log(`[SYNC] Conflict resolved with ticket priority for ${entry.id}`);
      } else {
        store.updateEntryStatus(entry.id, 'conflict', conflictResult.description);
        return { success: false, error: conflictResult.description };
      }
    }

    // Stable idempotency key (durable: derived from the persisted queue entry id).
    // Sent to the backend so a replayed write is deduped server-side (NF525).
    const idemKey = idempotencyKeyFor(entry.type, entry.id);

    // Persist the dedup marker BEFORE the network call (closes the crash-after-
    // success window). On failure we roll it back below so the entry retries —
    // and the backend dedupes on idemKey, so a retried-but-already-applied write
    // never creates a duplicate.
    markAsSent(entry.type, entry.id);

    // Sync by type — actual API calls
    switch (entry.type) {
      case 'ticket':
        // M603: reshape the queued payload to the exact CreateSaleDto — the offline
        // entry carries display-only extras (ticketNumber/totalMinorUnits/item names)
        // that forbidNonWhitelisted would 400. Keeps items/payments/discount/promo.
        await salesApi.create(toSyncCreateBody(entry.payload), idemKey);
        console.log(`[SYNC] Ticket ${entry.payload.ticketNumber} synced to server`);
        break;

      case 'payment':
        // Payment is part of ticket creation — already synced with ticket
        console.log(`[SYNC] Payment synced for ticket ${entry.payload.ticketNumber}`);
        break;

      case 'stock_movement':
        // Stock adjustments are handled server-side when tickets sync
        console.log(`[SYNC] Stock movement noted: ${entry.payload.productId} (${entry.payload.delta})`);
        break;

      case 'return':
        await salesApi.void(entry.payload.ticketId, idemKey);
        console.log(`[SYNC] Return synced: ${entry.payload.ticketNumber}`);
        break;

      case 'void':
        await salesApi.void(entry.payload.ticketId, idemKey);
        console.log(`[SYNC] Void synced: ${entry.payload.ticketNumber}`);
        break;

      case 'credit_note_return':
        // Deferred return: resolved + validated server-side by ticket number.
        // A conflict (qty already returned) → 4xx → permanent fail + notification.
        await returnsApi.createByTicket(entry.payload, idemKey);
        console.log(`[SYNC] Offline return synced (avoir): ${entry.payload.ticketNumber}`);
        break;

      case 'antifraude_log':
        // Anti-fraud logs are sent as part of the ticket payload
        console.log(`[SYNC] Antifraude log synced: ${entry.payload.event}`);
        break;

      case 'pointage':
        // Pointage now managed by TimeWin24
        await timewinApi.pushEvent({
          eventType: 'pointage',
          storeId: entry.storeId,
          employeeId: entry.cashierId,
          data: entry.payload,
        });
        console.log(`[SYNC] Pointage synced via TimeWin24: ${entry.payload.punchType} for ${entry.payload.employeeName}`);
        break;

      case 'cashier_metrics':
        await timewinApi.pushEvent({
          eventType: 'cashier_metrics',
          storeId: entry.storeId,
          employeeId: entry.cashierId,
          data: entry.payload,
        });
        console.log(`[SYNC] Cashier metrics synced via TimeWin24: ${entry.payload.employeeName}`);
        break;

      case 'staffing_snapshot':
        await timewinApi.pushEvent({
          eventType: 'staffing_snapshot',
          storeId: entry.storeId,
          data: entry.payload,
        });
        console.log(`[SYNC] Staffing snapshot synced via TimeWin24: ${entry.payload.activeCashiers} cashiers`);
        break;

      default:
        console.warn(`[SYNC] Unknown entry type: ${entry.type}`);
    }

    store.updateEntryStatus(entry.id, 'synced');
    return { success: true };

  } catch (error: any) {
    const errorMsg = error?.message || 'Erreur de synchronisation';

    // Roll back the pre-call dedup marker so this entry is retried. The backend
    // is idempotent on idemKey, so a retry of a write that actually succeeded
    // (lost response) returns the cached result instead of duplicating it.
    unmarkSent(entry.type, entry.id);

    // A 4xx is a deterministic business rejection (e.g. a deferred offline return
    // whose quantity was already returned meanwhile) — retrying will never succeed.
    // Fail permanently and surface a notification so staff can reconcile.
    const httpStatus = error?.response?.status;
    if (typeof httpStatus === 'number' && httpStatus >= 400 && httpStatus < 500) {
      const serverMsg = error?.response?.data?.message || errorMsg;
      store.updateEntryStatus(entry.id, 'failed', `Rejeté par le serveur: ${serverMsg}`);
      store.addSyncError(`Refusé au sync: ${entry.type} #${entry.id.slice(0, 8)} — ${serverMsg}`);
      return { success: false, error: serverMsg };
    }

    if (entry.retryCount >= entry.maxRetries) {
      store.updateEntryStatus(entry.id, 'failed', `Max retries atteint: ${errorMsg}`);
      store.addSyncError(`Echec definitif: ${entry.type} #${entry.id.slice(0, 8)} — ${errorMsg}`);
      return { success: false, error: errorMsg };
    }

    // Revert to pending for retry
    store.updateEntryStatus(entry.id, 'local_pending', `Retry ${entry.retryCount + 1}: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// ── Main Sync Process ──

export async function runSync(): Promise<{ synced: number; failed: number; conflicts: number }> {
  const store = useOfflineStore.getState();

  if (store.isSyncing) {
    console.log('[SYNC] Already syncing, skipping');
    return { synced: 0, failed: 0, conflicts: 0 };
  }

  const pending = store.getPendingEntries();
  if (pending.length === 0) {
    console.log('[SYNC] No pending entries');
    return { synced: 0, failed: 0, conflicts: 0 };
  }

  // Check network before starting
  const isOnline = await checkNetworkStatus();
  if (!isOnline) {
    console.log('[SYNC] Network not available, aborting sync');
    return { synced: 0, failed: 0, conflicts: 0 };
  }

  store.setSyncing(true);
  store.clearSyncErrors();

  let synced = 0;
  let failed = 0;
  let conflicts = 0;

  // Sort by FIFO + priority (tickets first, then payments, etc.)
  const sorted = [...pending].sort((a, b) => {
    const orderA = SYNC_ORDER[a.type] || 99;
    const orderB = SYNC_ORDER[b.type] || 99;
    if (orderA !== orderB) return orderA - orderB;
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });

  console.log(`[SYNC] Starting sync of ${sorted.length} entries...`);

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];

    // Update progress
    store.setSyncProgress(Math.round(((i + 1) / sorted.length) * 100));

    // Check network mid-sync (connection might drop during sync)
    if (i > 0 && i % 5 === 0) {
      const stillOnline = await checkNetworkStatus();
      if (!stillOnline) {
        console.log(`[SYNC] Connection lost during sync at entry ${i + 1}/${sorted.length}`);
        store.goOffline();
        break;
      }
    }

    const result = await syncEntry(entry);

    if (result.success) {
      synced++;
    } else {
      // Check updated status from store (not stale local entry)
      const updatedEntry = store.queue.find((e) => e.id === entry.id);
      if (updatedEntry?.status === 'conflict') {
        conflicts++;
      } else {
        failed++;
      }
    }

    // Small delay between entries to avoid overwhelming the server
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  store.setSyncing(false);
  store.setSyncProgress(100);
  store.setLastSyncAt(new Date().toISOString());

  // Post-sync: check anomalies and alert manager
  const anomalies = store.getAnomaliesForResync();
  if (anomalies.length > 0 && store.fraudGuard.alertOnResync) {
    console.log(`[SYNC] Post-sync anomalies detected for ${anomalies.length} cashier(s):`);
    anomalies.forEach((a) => {
      console.log(`  - ${a.cashierId}: ${a.anomalies.join(', ')}`);
    });
    // En production : envoyer notification au manager
    // await notificationsApi.alertManager({ type: 'offline_anomalies', data: anomalies });
  }

  // Clean up synced entries older than 24h
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const oldSynced = store.queue.filter(
    (e) => e.status === 'synced' && e.syncedAt && e.syncedAt < dayAgo,
  );
  oldSynced.forEach((e) => store.removeEntry(e.id));

  console.log(`[SYNC] Complete: ${synced} synced, ${failed} failed, ${conflicts} conflicts`);
  return { synced, failed, conflicts };
}

// ── Auto-sync watcher ──

export function startNetworkWatcher() {
  // Browser online/offline events
  window.addEventListener('online', async () => {
    console.log('[NETWORK] Browser reports online');
    const reallyOnline = await checkNetworkStatus();
    if (reallyOnline) {
      useOfflineStore.getState().goOnline();
      // Auto-sync after short delay
      if (syncTimeout) clearTimeout(syncTimeout);
      syncTimeout = setTimeout(() => runSync(), 2000);
    }
  });

  window.addEventListener('offline', () => {
    console.log('[NETWORK] Browser reports offline');
    useOfflineStore.getState().goOffline();
  });

  // Periodic check (every 15 seconds)
  if (networkCheckInterval) clearInterval(networkCheckInterval);
  networkCheckInterval = setInterval(async () => {
    const store = useOfflineStore.getState();
    const isOnline = await checkNetworkStatus();

    if (isOnline && store.networkStatus === 'offline') {
      store.goOnline();
      // Trigger sync
      if (syncTimeout) clearTimeout(syncTimeout);
      syncTimeout = setTimeout(() => runSync(), 2000);
    } else if (!isOnline && store.networkStatus === 'online') {
      store.goOffline();
    }
  }, 15000);

  // Load persisted data on startup
  useOfflineStore.getState().loadPersistedQueue();

  // Initial network check
  checkNetworkStatus().then((isOnline) => {
    if (!isOnline) {
      useOfflineStore.getState().goOffline();
    }
  });

  console.log('[NETWORK] Watcher started');
}

export function stopNetworkWatcher() {
  if (networkCheckInterval) {
    clearInterval(networkCheckInterval);
    networkCheckInterval = null;
  }
  if (syncTimeout) {
    clearTimeout(syncTimeout);
    syncTimeout = null;
  }
  console.log('[NETWORK] Watcher stopped');
}

// ── Manual sync trigger ──

export async function triggerManualSync(): Promise<void> {
  const isOnline = await checkNetworkStatus();
  if (!isOnline) {
    console.log('[SYNC] Cannot sync — no connection');
    return;
  }
  useOfflineStore.getState().goOnline();
  await runSync();
}
