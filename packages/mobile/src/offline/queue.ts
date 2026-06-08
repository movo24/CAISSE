/**
 * File de comptage offline — persistante (IndexedDB), avec enveloppe d'audit.
 *
 * Chaque entrée conserve employeeId / storeId / deviceId / timestamp pour la
 * traçabilité (exigence inventaire), et un statut de sync. Aucune logique
 * fiscale ici : ce sont des comptages d'inventaire en attente d'envoi.
 */
import { getDb, STORE } from './db';

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

/** Charge utile métier alignée sur POST /api/inventory-scans. */
export interface CountPayload {
  barcode: string;
  quantity: number;
  scanType?: 'inventory' | 'receiving';
  sessionId?: string;
  notes?: string;
}

export interface QueueEntry {
  id: string; // UUID v4 — clé locale + référence d'idempotence côté client
  status: SyncStatus;
  createdAt: string; // ISO 8601
  timezone: string;
  retryCount: number;
  maxRetries: number;
  lastError?: string;
  // ── Enveloppe d'audit (figée à l'enfilement) ──
  employeeId: string;
  storeId: string;
  deviceId: string;
  // ── Données métier ──
  payload: CountPayload;
}

function uuid(): string {
  // crypto.randomUUID dispo en WebView moderne / navigateur ; repli simple.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface EnqueueInput {
  employeeId: string;
  storeId: string;
  deviceId: string;
  payload: CountPayload;
  maxRetries?: number;
}

export async function enqueueCount(input: EnqueueInput): Promise<QueueEntry> {
  const entry: QueueEntry = {
    id: uuid(),
    status: 'pending',
    createdAt: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris',
    retryCount: 0,
    maxRetries: input.maxRetries ?? 5,
    employeeId: input.employeeId,
    storeId: input.storeId,
    deviceId: input.deviceId,
    payload: input.payload,
  };
  const db = await getDb();
  await db.put(STORE, entry);
  return entry;
}

/** Entrées à envoyer (pending + failed sous le plafond de retry), ordre FIFO. */
export async function getSyncable(): Promise<QueueEntry[]> {
  const db = await getDb();
  const all = (await db.getAll(STORE)) as QueueEntry[];
  return all
    .filter((e) => e.status === 'pending' || (e.status === 'failed' && e.retryCount < e.maxRetries))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function countByStatus(): Promise<Record<SyncStatus, number>> {
  const db = await getDb();
  const all = (await db.getAll(STORE)) as QueueEntry[];
  const acc: Record<SyncStatus, number> = { pending: 0, syncing: 0, synced: 0, failed: 0 };
  for (const e of all) acc[e.status]++;
  return acc;
}

/** Nombre d'éléments non encore confirmés côté serveur. */
export async function countOutstanding(): Promise<number> {
  const c = await countByStatus();
  return c.pending + c.syncing + c.failed;
}

async function patch(id: string, patch: Partial<QueueEntry>): Promise<void> {
  const db = await getDb();
  const cur = (await db.get(STORE, id)) as QueueEntry | undefined;
  if (!cur) return;
  await db.put(STORE, { ...cur, ...patch });
}

export const markSyncing = (id: string) => patch(id, { status: 'syncing' });
export const markSynced = (id: string) => patch(id, { status: 'synced' });
export const markFailed = (id: string, error: string, retryCount: number) =>
  patch(id, { status: 'failed', lastError: error, retryCount });

/** Purge des entrées déjà synchronisées (housekeeping). */
export async function purgeSynced(): Promise<number> {
  const db = await getDb();
  const all = (await db.getAll(STORE)) as QueueEntry[];
  const synced = all.filter((e) => e.status === 'synced');
  const tx = db.transaction(STORE, 'readwrite');
  await Promise.all(synced.map((e) => tx.store.delete(e.id)));
  await tx.done;
  return synced.length;
}
