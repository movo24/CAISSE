/**
 * Offline employee auth V1 (décision produit ratifiée, PR #28) — sécurisée,
 * limitée, traçable :
 *
 * - cache local UNIQUEMENT après une authentification ONLINE réussie (jamais
 *   de PIN en clair : SHA-256(salt aléatoire + PIN) via Web Crypto) ;
 * - expiration stricte (24 h) — au-delà, retour online obligatoire ;
 * - anti-brute-force : 5 échecs → l'entrée est BRÛLÉE (retour online requis) ;
 * - déverrouillage hors ligne du TITULAIRE uniquement (jamais de switch
 *   d'employé offline — un changement de caissier exige le serveur) ;
 * - aucun droit inventé : le rôle rendu offline est plafonné à 'cashier',
 *   et toute action privilégiée reste gated serveur de toute façon ;
 * - traçable : chaque unlock offline est journalisé en file durable et
 *   synchronisé au retour online (SESSION_UNLOCKED_OFFLINE).
 */

const STORAGE_KEY = 'caisse_offline_auth_v1';
export const OFFLINE_AUTH_TTL_MS = 24 * 60 * 60 * 1000; // expiration stricte 24 h
export const OFFLINE_AUTH_MAX_ATTEMPTS = 5;

export interface OfflineAuthEntry {
  employeeId: string;
  storeId: string;
  firstName: string;
  lastName: string;
  /** Rôle réel au moment du cache — jamais rendu tel quel offline (cap cashier). */
  role: string;
  salt: string;
  pinHash: string;
  cachedAt: number;
  expiresAt: number;
  failedAttempts: number;
}

export type OfflineVerifyResult =
  | { ok: true; employee: { id: string; firstName: string; lastName: string; storeId: string; role: 'cashier'; cachedRole: string } }
  | { ok: false; reason: 'no_cache' | 'expired' | 'wrong_pin' | 'burned' };

function loadAll(): Record<string, OfflineAuthEntry> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveAll(entries: Record<string, OfflineAuthEntry>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

async function hashPin(salt: string, pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomSalt(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Cache the employee's PIN AFTER a successful ONLINE authentication — the only
 * moment a cache entry may be (re)created. Resets expiry and failed attempts.
 */
export async function cacheEmployeePin(
  employee: { id: string; firstName: string; lastName: string; storeId: string; role: string },
  pin: string,
  now: number = Date.now(),
): Promise<void> {
  const salt = randomSalt();
  const pinHash = await hashPin(salt, pin);
  const entries = loadAll();
  entries[employee.id] = {
    employeeId: employee.id,
    storeId: employee.storeId,
    firstName: employee.firstName,
    lastName: employee.lastName,
    role: employee.role,
    salt,
    pinHash,
    cachedAt: now,
    expiresAt: now + OFFLINE_AUTH_TTL_MS,
    failedAttempts: 0,
  };
  saveAll(entries);
}

/**
 * Verify a PIN against the local cache (network down). Strict expiry; 5 wrong
 * attempts burn the entry; the returned role is CAPPED at 'cashier' — no
 * invented rights offline.
 */
export async function verifyOfflinePin(
  employeeId: string,
  pin: string,
  now: number = Date.now(),
): Promise<OfflineVerifyResult> {
  const entries = loadAll();
  const entry = entries[employeeId];
  if (!entry) return { ok: false, reason: 'no_cache' };

  if (now > entry.expiresAt) {
    delete entries[employeeId];
    saveAll(entries);
    return { ok: false, reason: 'expired' };
  }

  const hash = await hashPin(entry.salt, pin);
  if (hash !== entry.pinHash) {
    entry.failedAttempts += 1;
    if (entry.failedAttempts >= OFFLINE_AUTH_MAX_ATTEMPTS) {
      delete entries[employeeId]; // burned — back online required
      saveAll(entries);
      return { ok: false, reason: 'burned' };
    }
    saveAll(entries);
    return { ok: false, reason: 'wrong_pin' };
  }

  entry.failedAttempts = 0;
  saveAll(entries);
  return {
    ok: true,
    employee: {
      id: entry.employeeId,
      firstName: entry.firstName,
      lastName: entry.lastName,
      storeId: entry.storeId,
      role: 'cashier', // cap — no invented admin/manager rights offline
      cachedRole: entry.role,
    },
  };
}

/** Wipe the whole offline auth cache (logout / employee switch / store change). */
export function clearOfflineAuthCache(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export const OFFLINE_UNLOCK_MESSAGES: Record<Exclude<OfflineVerifyResult & { ok: false }, never>['reason'] | 'switch_refused', string> = {
  no_cache: 'Déverrouillage hors ligne impossible : aucune authentification récente sur ce poste. Connexion internet requise.',
  expired: 'Authentification hors ligne expirée (24 h). Connexion internet requise.',
  wrong_pin: 'PIN invalide.',
  burned: 'Trop de tentatives — déverrouillage hors ligne bloqué. Connexion internet requise.',
  switch_refused: 'Changement de caissier impossible hors ligne. Connexion internet requise.',
};
