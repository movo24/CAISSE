/* ═══════════════════════════════════════════════════════════════
   HMAC SECURITY — helpers de signature des requêtes sync

   ⚠️ NON CÂBLÉ END-TO-END (voir TECHNICAL_DEBT D19, M607). Ces helpers existent
   mais la couche n'est PAS active :
     - `setStoreToken` n'est jamais appelé → `getStoreToken()` renvoie null →
       `signSyncRequest` renvoie null → AUCUNE requête n'est signée ;
     - syncEngine ne pose PAS la signature en header (commentaire seulement) ;
     - le backend `/sync` ne vérifie AUCUNE signature.
   Les requêtes sync restent authentifiées par le JWT employé (axios bearer) — ce
   n'est donc pas un trou ouvert, mais NE PAS lire ce fichier comme « le sync est
   signé HMAC ». Câbler la couche = feature coordonnée (provisioning token +
   attach header + vérif backend + anti-replay) — décision/design (chemin d'écriture sync).
   Contenu : token par magasin · HMAC-SHA256 · nonce/timestamp anti-replay · dedup idempotency.
   ═══════════════════════════════════════════════════════════════ */

// ── Types ──

export interface SignedRequest {
  payload: string;           // JSON stringified
  signature: string;         // HMAC-SHA256 hex
  nonce: string;             // unique per request
  timestamp: string;         // ISO 8601
  storeId: string;
  idempotencyKey: string;    // prevent double sync
}

export interface StoreToken {
  storeId: string;
  secret: string;            // HMAC secret key (hex)
  issuedAt: string;
  expiresAt: string;
}

// ── localStorage keys ──

const LS_STORE_TOKEN = 'caisse_store_token';
const LS_SENT_IDEMPOTENCY = 'caisse_sent_idempotency_keys';
const MAX_IDEMPOTENCY_CACHE = 500;

// ── Crypto helpers (Web Crypto API — works in Electron/Chromium) ──

async function hmacSign(message: string, secretHex: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = hexToBytes(secretHex);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const msgBuffer = encoder.encode(message);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgBuffer.buffer as ArrayBuffer);
  return bytesToHex(new Uint8Array(signature));
}

export async function hmacVerify(message: string, signatureHex: string, secretHex: string): Promise<boolean> {
  const expected = await hmacSign(message, secretHex);
  // Constant-time compare
  if (expected.length !== signatureHex.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signatureHex.charCodeAt(i);
  }
  return diff === 0;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function generateNonce(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

function generateIdempotencyKey(type: string, entryId: string): string {
  return `${type}:${entryId}`;
}

// ── Store token management ──

export function getStoreToken(): StoreToken | null {
  try {
    const raw = localStorage.getItem(LS_STORE_TOKEN);
    if (!raw) return null;
    const token: StoreToken = JSON.parse(raw);
    // Check expiry
    if (new Date(token.expiresAt) < new Date()) {
      console.warn('[HMAC] Store token expired');
      localStorage.removeItem(LS_STORE_TOKEN);
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

export function setStoreToken(token: StoreToken): void {
  try {
    localStorage.setItem(LS_STORE_TOKEN, JSON.stringify(token));
    console.log(`[HMAC] Store token set for ${token.storeId} (expires ${token.expiresAt})`);
  } catch { /* quota */ }
}

// ── Idempotency tracking ──

function getSentKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_SENT_IDEMPOTENCY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function addSentKey(key: string): void {
  const keys = getSentKeys();
  keys.add(key);
  // Prune if too large
  const arr = Array.from(keys);
  const trimmed = arr.length > MAX_IDEMPOTENCY_CACHE ? arr.slice(-MAX_IDEMPOTENCY_CACHE) : arr;
  try {
    localStorage.setItem(LS_SENT_IDEMPOTENCY, JSON.stringify(trimmed));
  } catch { /* quota */ }
}

export function isAlreadySent(type: string, entryId: string): boolean {
  const key = generateIdempotencyKey(type, entryId);
  return getSentKeys().has(key);
}

export function markAsSent(type: string, entryId: string): void {
  const key = generateIdempotencyKey(type, entryId);
  addSentKey(key);
}

/** Roll back a `markAsSent` when the network call failed, so the entry retries. */
export function unmarkSent(type: string, entryId: string): void {
  const key = generateIdempotencyKey(type, entryId);
  const keys = getSentKeys();
  if (!keys.delete(key)) return;
  try {
    localStorage.setItem(LS_SENT_IDEMPOTENCY, JSON.stringify(Array.from(keys)));
  } catch {
    /* quota */
  }
}

/** Stable idempotency key for a queue entry — sent to the backend as `Idempotency-Key`. */
export function idempotencyKeyFor(type: string, entryId: string): string {
  return generateIdempotencyKey(type, entryId);
}

// ── Sign a sync request ──

export async function signSyncRequest(
  payload: any,
  entryType: string,
  entryId: string,
): Promise<SignedRequest | null> {
  const token = getStoreToken();
  if (!token) {
    console.warn('[HMAC] No store token — request will be unsigned');
    return null;
  }

  const idempotencyKey = generateIdempotencyKey(entryType, entryId);

  // Check for double sync
  if (isAlreadySent(entryType, entryId)) {
    console.warn(`[HMAC] Duplicate sync blocked: ${idempotencyKey}`);
    return null;
  }

  const nonce = generateNonce();
  const timestamp = new Date().toISOString();
  const payloadStr = JSON.stringify(payload);

  // Message to sign: timestamp + nonce + storeId + payload
  const message = `${timestamp}|${nonce}|${token.storeId}|${payloadStr}`;
  const signature = await hmacSign(message, token.secret);

  return {
    payload: payloadStr,
    signature,
    nonce,
    timestamp,
    storeId: token.storeId,
    idempotencyKey,
  };
}

// ── Log security events ──

export function logSecurityEvent(event: string, details?: Record<string, any>): void {
  const entry = {
    event,
    timestamp: new Date().toISOString(),
    storeId: getStoreToken()?.storeId || 'unknown',
    ...details,
  };

  // Append to security log in localStorage
  try {
    const LS_SECURITY_LOG = 'caisse_security_log';
    const raw = localStorage.getItem(LS_SECURITY_LOG);
    const log: any[] = raw ? JSON.parse(raw) : [];
    log.push(entry);
    // Keep only last 200 entries
    const trimmed = log.length > 200 ? log.slice(-200) : log;
    localStorage.setItem(LS_SECURITY_LOG, JSON.stringify(trimmed));
  } catch { /* quota */ }

  console.log(`[SECURITY] ${event}`, details || '');
}
