/**
 * POS-INT-121/122 — faithful pure-JS bcrypt stand-in for unit tests.
 *
 * The real `bcrypt` ships a native binding (bcrypt_lib.node) built per-platform;
 * in a cross-platform sandbox its load fails with "invalid ELF header", which
 * makes every spec that (transitively) imports bcrypt unrunnable. This mock keeps
 * the exact observable contract the tests rely on:
 *   - format: `$2b$<rounds>$<22-char salt><31-char payload>` (60 chars, matches /^\$2[aby]\$\d\d\$/),
 *   - salting: each hash() of the same value differs (random salt),
 *   - round-trip: compare(v, hash(v)) === true, compare(w, hash(v)) === false,
 *     independent of the salt (compare re-derives the payload from the value).
 * It is wired via jest `moduleNameMapper` (^bcrypt$) — test-only, never in prod.
 *
 * NOTE: NOT cryptographically secure. Only preserves the observable invariants.
 */

const SALT_ALPHABET = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomSalt(len = 22): string {
  let s = '';
  for (let i = 0; i < len; i++) s += SALT_ALPHABET[Math.floor(Math.random() * SALT_ALPHABET.length)];
  return s;
}

/** Deterministic 31-char payload derived from the value (salt-independent). */
function payloadFor(value: string): string {
  let h = Buffer.from(String(value), 'utf8').toString('base64').replace(/[^A-Za-z0-9]/g, '');
  while (h.length < 31) h += h;
  return h.slice(0, 31);
}

function rounds2(rounds?: number | string): string {
  const n = typeof rounds === 'number' ? rounds : parseInt(String(rounds ?? 12), 10) || 12;
  return String(n).padStart(2, '0');
}

export function hashSync(value: string, rounds?: number | string): string {
  return `$2b$${rounds2(rounds)}$${randomSalt()}${payloadFor(value)}`;
}

export function compareSync(value: string, hashed: string): boolean {
  if (typeof hashed !== 'string' || !/^\$2[aby]\$\d\d\$.{53}$/.test(hashed)) return false;
  const rest = hashed.slice(7); // strip "$2b$12$"
  return rest.slice(22) === payloadFor(value);
}

export async function hash(value: string, rounds?: number | string): Promise<string> {
  return hashSync(value, rounds);
}

export async function compare(value: string, hashed: string): Promise<boolean> {
  return compareSync(value, hashed);
}

export async function genSalt(rounds?: number): Promise<string> {
  return `$2b$${rounds2(rounds)}$${randomSalt()}`;
}

// Support both `import * as bcrypt` and `import bcrypt from 'bcrypt'`.
const bcryptMock = { hash, compare, genSalt, hashSync, compareSync };
export default bcryptMock;
