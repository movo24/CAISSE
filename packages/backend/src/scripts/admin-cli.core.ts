/**
 * Admin CLI — pure core (no DB, no I/O → unit-testable).
 *
 * Encapsulates the SAFETY logic for `admin:create` / `admin:reset`:
 *  - an explicit gate must be set (no accidental runs);
 *  - production requires a second explicit opt-in (no silent admin creation in prod);
 *  - the admin email is mandatory and validated;
 *  - the temporary password is either explicitly imposed (min length) or securely generated.
 *
 * NO credential is ever hardcoded here. Generated passwords come from
 * crypto-strong randomness and are returned to the caller to print ONCE — they
 * are never logged to the audit/business log.
 */
import { randomInt } from 'crypto';

export type AdminCliMode = 'create' | 'reset';

/** A clear, user-facing failure — the CLI prints its message and exits non-zero. */
export class AdminCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminCliError';
  }
}

export interface AdminCliConfig {
  mode: AdminCliMode;
  email: string;
  /** The temporary password (imposed or generated). Becomes the bcrypt PIN hash. */
  password: string;
  /** True when the password was generated (must be shown to the operator once). */
  generated: boolean;
  storeCode: string | null;
  storeId: string | null;
  firstName: string;
  lastName: string;
  isProduction: boolean;
}

/** Unambiguous charset (no 0/O/1/l/I) for generated temporary passwords. */
const SAFE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** Generate a crypto-strong temporary password. Default length 12. */
export function generateTempPassword(length = 12): string {
  const n = Math.max(8, Math.min(64, Math.floor(length)));
  let out = '';
  for (let i = 0; i < n; i++) {
    out += SAFE_CHARSET[randomInt(SAFE_CHARSET.length)];
  }
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Minimum length for an operator-imposed temporary password. */
export const MIN_IMPOSED_PASSWORD_LENGTH = 6;

/** The exact value the operator must set to acknowledge the operation. */
export const CONFIRM_TOKEN = 'I_UNDERSTAND';

/**
 * Validate the environment and resolve a config, or throw AdminCliError with a
 * precise, actionable message. Pure — takes the env map explicitly.
 */
export function resolveAdminCliConfig(
  env: Record<string, string | undefined>,
  mode: AdminCliMode,
): AdminCliConfig {
  // 1) Explicit gate — nothing runs by accident.
  if (env.ADMIN_CLI_CONFIRM !== CONFIRM_TOKEN) {
    throw new AdminCliError(
      `Refus : cette commande crée/réinitialise un accès admin. Confirmez en exportant ADMIN_CLI_CONFIRM=${CONFIRM_TOKEN}.`,
    );
  }

  // 2) Production requires a second, explicit opt-in — never silent in prod.
  const isProduction = (env.NODE_ENV || '').toLowerCase() === 'production';
  if (isProduction && env.ADMIN_CLI_ALLOW_PROD !== 'YES') {
    throw new AdminCliError(
      'Refus : NODE_ENV=production. Aucune création admin silencieuse en production. ' +
        'Pour autoriser explicitement, exportez ADMIN_CLI_ALLOW_PROD=YES.',
    );
  }

  // 3) Email is mandatory and validated.
  const email = (env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) {
    throw new AdminCliError('Refus : ADMIN_EMAIL est requis (email de l’administrateur).');
  }
  if (!EMAIL_RE.test(email)) {
    throw new AdminCliError(`Refus : ADMIN_EMAIL invalide : "${email}".`);
  }

  // 4) Temporary password — imposed (validated) or generated.
  let password: string;
  let generated: boolean;
  const imposed = env.ADMIN_PASSWORD;
  if (imposed !== undefined && imposed !== '') {
    if (imposed.length < MIN_IMPOSED_PASSWORD_LENGTH) {
      throw new AdminCliError(
        `Refus : ADMIN_PASSWORD trop court (min ${MIN_IMPOSED_PASSWORD_LENGTH} caractères).`,
      );
    }
    password = imposed;
    generated = false;
  } else {
    password = generateTempPassword();
    generated = true;
  }

  const storeCode = (env.ADMIN_STORE_CODE || '').trim() || null;
  const storeId = (env.ADMIN_STORE_ID || '').trim() || null;

  return {
    mode,
    email,
    password,
    generated,
    storeCode,
    storeId,
    firstName: (env.ADMIN_FIRST_NAME || '').trim() || 'Admin',
    lastName: (env.ADMIN_LAST_NAME || '').trim() || 'Caisse',
    isProduction,
  };
}

/** Parse the CLI mode from argv (npm passes it as a positional arg). */
export function parseMode(argv: string[]): AdminCliMode {
  const arg = argv.find((a) => a === 'create' || a === 'reset');
  if (!arg) {
    throw new AdminCliError('Usage : admin-cli <create|reset>. Mode manquant ou invalide.');
  }
  return arg;
}
