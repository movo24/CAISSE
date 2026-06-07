import { describe, it, expect, beforeEach } from 'vitest';
import { deleteDB } from 'idb';
import { DB_NAME, closeDb } from './db';
import {
  enqueueCount,
  getSyncable,
  countByStatus,
  countOutstanding,
  markSynced,
  markFailed,
  purgeSynced,
  QueueEntry,
} from './queue';

const audit = { employeeId: 'emp-1', storeId: 'store-1', deviceId: 'dev-1' };

beforeEach(async () => {
  await closeDb();
  await deleteDB(DB_NAME);
});

describe('offline inventory queue', () => {
  it('enfile un comptage avec enveloppe d\'audit complète', async () => {
    const e = await enqueueCount({ ...audit, payload: { barcode: '3760001000001', quantity: 3 } });
    expect(e.id).toMatch(/[0-9a-f-]{36}/);
    expect(e.status).toBe('pending');
    expect(e.employeeId).toBe('emp-1');
    expect(e.storeId).toBe('store-1');
    expect(e.deviceId).toBe('dev-1');
    expect(e.timezone).toBeTruthy();
    expect(e.createdAt).toBeTruthy();
    expect(e.payload).toEqual({ barcode: '3760001000001', quantity: 3 });
  });

  it('persiste et compte les éléments en attente (FIFO)', async () => {
    await enqueueCount({ ...audit, payload: { barcode: 'A', quantity: 1 } });
    await new Promise((r) => setTimeout(r, 2));
    await enqueueCount({ ...audit, payload: { barcode: 'B', quantity: 2 } });

    expect(await countOutstanding()).toBe(2);
    const syncable = await getSyncable();
    expect(syncable.map((s: QueueEntry) => s.payload.barcode)).toEqual(['A', 'B']); // ordre FIFO
  });

  it('marque synced → sort du compteur en attente', async () => {
    const e = await enqueueCount({ ...audit, payload: { barcode: 'A', quantity: 1 } });
    await markSynced(e.id);
    expect(await countOutstanding()).toBe(0);
    expect((await countByStatus()).synced).toBe(1);
  });

  it('marque failed avec retryCount et reste re-synchronisable sous le plafond', async () => {
    const e = await enqueueCount({ ...audit, payload: { barcode: 'A', quantity: 1 }, maxRetries: 2 });
    await markFailed(e.id, 'network_error', 1);
    let syncable = await getSyncable();
    expect(syncable).toHaveLength(1); // 1 < maxRetries → encore tentable
    await markFailed(e.id, 'network_error', 2);
    syncable = await getSyncable();
    expect(syncable).toHaveLength(0); // plafond atteint → plus tentée automatiquement
    expect(await countOutstanding()).toBe(1); // mais toujours comptée comme non confirmée
  });

  it('purge les entrées synced', async () => {
    const e = await enqueueCount({ ...audit, payload: { barcode: 'A', quantity: 1 } });
    await markSynced(e.id);
    expect(await purgeSynced()).toBe(1);
    expect((await countByStatus()).synced).toBe(0);
  });
});
