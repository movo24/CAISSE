/**
 * IndexedDB (via idb) — couche de stockage bas niveau pour l'offline Inventaire.
 *
 * On garde idb UNIQUEMENT comme persistance ; toute la logique métier (file,
 * statuts, audit) vit dans queue.ts / syncEngine.ts. Inspiré du pattern POS
 * desktop (offlineStore + syncEngine) mais réduit à un socle Inventaire.
 */
import { openDB, IDBPDatabase } from 'idb';

export const DB_NAME = 'caisse-inventaire-offline';
export const STORE = 'inventory_queue';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('by_status', 'status');
          os.createIndex('by_createdAt', 'createdAt');
        }
      },
    });
  }
  return dbPromise;
}

/** Ferme la connexion ouverte (nécessaire avant un deleteDB, ex. en test). */
export async function closeDb(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
}

/** Pour les tests : réinitialise le handle (sans fermer — préférer closeDb). */
export function _resetDbHandle(): void {
  dbPromise = null;
}
