/**
 * POS-INT-121 — faithful pure-JS bcrypt stand-in for unit tests.
 *
 * The real `bcrypt` ships a native binding (bcrypt_lib.node) built per-platform;
 * in a cross-platform sandbox its load fails with "invalid ELF header", which
 * makes every spec that (transitively) imports bcrypt unrunnable. This mock keeps
 * the exact contract the code relies on — `hash(value, rounds)` and
 * `compare(value, hash)` — with deterministic round-trip semantics, so login,
 * PIN duplicate-detection and sale-PIN checks behave identically. It is wired via
 * jest `moduleNameMapper` (^bcrypt$) — test-only, never in production code.
 *
 * NOTE: this is NOT cryptographically secure. It only preserves the round-trip
 * invariant compare(v, hash(v)) === true and compare(w, hash(v)) === false.
 */

const PREFIX = 'bcrypt-mock:';

function encode(value: string): string {
  return PREFIX + Buffer.from(String(value), 'utf8').toString('base64');
}

export async function hash(value: string, _rounds?: number | string): Promise<string> {
  return encode(value);
}

export async function compare(value: string, hashed: string): Promise<boolean> {
  if (typeof hashed !== 'string' || !hashed.startsWith(PREFIX)) return false;
  return hashed === encode(value);
}

export async function genSalt(_rounds?: number): Promise<string> {
  return PREFIX + 'salt';
}

export function hashSync(value: string, _rounds?: number | string): string {
  return encode(value);
}

export function compareSync(value: string, hashed: string): boolean {
  return typeof hashed === 'string' && hashed.startsWith(PREFIX) && hashed === encode(value);
}

// Support both `import * as bcrypt` and `import bcrypt from 'bcrypt'`.
const bcryptMock = { hash, compare, genSalt, hashSync, compareSync };
export default bcryptMock;
