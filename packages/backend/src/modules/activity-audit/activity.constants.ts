import { createHash } from 'crypto';

/** Méthodes d'authentification (spec §6). */
export const AUTH_METHODS = [
  'PIN',
  'PASSWORD',
  'ADMIN_EMAIL',
  'QR',
  'PASSKEY',
  'WEBAUTHN',
  'MAGIC_LINK',
  'ADMIN_IMPERSONATION',
  'SESSION_REFRESH',
] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

/** Types d'événements de connexion. */
export const LOGIN_EVENT_TYPES = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGOUT',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
  'TOKEN_REFRESH',
  'NEW_DEVICE',
] as const;
export type LoginEventType = (typeof LOGIN_EVENT_TYPES)[number];

/** Hash d'IP pour vues masquées (spec §15) — jamais l'IP en clair dans les vues standard. */
export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

/** Nettoie un motif d'échec : borne la longueur, aucune donnée sensible (nos messages n'en contiennent pas). */
export function sanitizeFailureReason(msg: unknown): string {
  const s = typeof msg === 'string' ? msg : (msg as any)?.message || 'unknown';
  return String(s).slice(0, 200);
}

/** Clés interdites dans toute métadonnée journalisée (spec §9/§15). */
export const FORBIDDEN_METADATA_KEYS = [
  'password',
  'pin',
  'pinhash',
  'pin_hash',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'authorization',
  'card',
  'pan',
  'cardnumber',
  'cvv',
  'cvc',
  'iban',
];

/**
 * Supprime récursivement toute clé sensible d'un objet de métadonnée + borne la taille.
 * Utilisé pour metadata_json (view-events) et toute donnée libre journalisée.
 */
export function scrubMetadata(input: unknown, maxKeys = 50): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (count >= maxKeys) break;
    if (FORBIDDEN_METADATA_KEYS.includes(k.toLowerCase().replace(/[^a-z]/g, ''))) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = scrubMetadata(v, maxKeys);
    } else if (typeof v === 'string') {
      out[k] = v.slice(0, 500);
    } else {
      out[k] = v;
    }
    count += 1;
  }
  return out;
}
