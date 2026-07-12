/**
 * POS access CLI — create (idempotently) a test store + a cashier so a fresh
 * register (the .exe) can log in immediately. TARGETED, not a global seed:
 * it touches only ONE store row and ONE employee row, creates no fixtures,
 * and never duplicates an existing store code or cashier.
 *
 *   DATABASE_URL=<Backend B Neon URL> \
 *   POS_ACCESS_CONFIRM=I_UNDERSTAND \
 *   POS_ACCESS_ALLOW_PROD=YES \
 *   npm run pos:access
 *
 * Defaults (override via env): STORE_NAME="The Wesley Test",
 * STORE_CODE="WESLEY01", CASHIER_PIN="5678", role cashier.
 *
 * Uses raw parameterized SQL on the EXACT columns the login needs — it never
 * loads a TypeORM entity, so it is immune to entity/migration drift (e.g. the
 * StoreEntity has latitude/longitude columns no migration creates; a full-entity
 * SELECT would crash on the real migrated schema — this script does not).
 *
 * After the DB write it VERIFIES the credential two ways:
 *   1. DB-level: re-reads the cashier's pin_hash and bcrypt-compares the PIN.
 *   2. HTTP (optional): POSTs the real /api/auth/login/pin against POS_API_URL
 *      (default = Backend B) with { storeId: <code>, pin } and prints the HTTP
 *      status + whether a token came back. Skipped only if POS_API_URL='' .
 *
 * SAFETY:
 *  - POS_ACCESS_CONFIRM=I_UNDERSTAND is required (no accidental runs);
 *  - against a production DB you MUST also set POS_ACCESS_ALLOW_PROD=YES;
 *  - the PIN is never logged beyond the value you passed in.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

const BCRYPT_ROUNDS = 12;

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

const env = process.env;
const STORE_NAME = env.STORE_NAME || 'The Wesley Test';
const STORE_CODE = (env.STORE_CODE || 'WESLEY01').toUpperCase();
const CASHIER_PIN = env.CASHIER_PIN || '5678';
const CASHIER_FIRST = env.CASHIER_FIRST || 'Caisse';
const CASHIER_LAST = env.CASHIER_LAST || 'Test';
const CASHIER_EMAIL = (env.CASHIER_EMAIL || `caissier.${STORE_CODE.toLowerCase()}@wesley.test`).toLowerCase();
// Default: test the login against Backend B. Set POS_API_URL='' to skip HTTP.
const POS_API_URL =
  env.POS_API_URL === undefined ? 'https://caisse-backend-production.up.railway.app' : env.POS_API_URL;

async function main(): Promise<void> {
  if (!env.DATABASE_URL) fail('DATABASE_URL est requis (URL Postgres de Backend B).');
  if (env.POS_ACCESS_CONFIRM !== 'I_UNDERSTAND') {
    fail('POS_ACCESS_CONFIRM=I_UNDERSTAND est requis (garde-fou anti-exécution accidentelle).');
  }
  const isProd = (env.NODE_ENV || '').toLowerCase() === 'production';
  if (isProd && env.POS_ACCESS_ALLOW_PROD !== 'YES') {
    fail('Base en production : POS_ACCESS_ALLOW_PROD=YES est requis pour continuer.');
  }
  if (!/^\d{4,}$/.test(CASHIER_PIN)) fail('CASHIER_PIN doit contenir au moins 4 chiffres.');

  // No entities loaded on purpose → immune to entity/migration drift.
  const ds = new DataSource({ type: 'postgres', url: env.DATABASE_URL, entities: [], synchronize: false });
  await ds.initialize();

  try {
    // ── 1. Store (idempotent by store_code) ──────────────────────────────
    const foundStore = await ds.query(`SELECT id FROM stores WHERE store_code = $1 LIMIT 1`, [STORE_CODE]);
    let storeId: string;
    let storeCreated = false;
    if (foundStore.length > 0) {
      storeId = foundStore[0].id;
      console.log(`[pos-access] store EXISTS: ${STORE_CODE} (id=${storeId}) — reusing, no duplicate`);
    } else {
      storeId = uuidv4();
      await ds.query(
        `INSERT INTO stores (id, name, store_code, currency_code, timezone, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, 'EUR', 'Europe/Paris', true, NOW(), NOW())`,
        [storeId, STORE_NAME, STORE_CODE],
      );
      storeCreated = true;
      console.log(`[pos-access] store CREATED: ${STORE_CODE} (id=${storeId})`);
    }

    // ── 2. Cashier (idempotent by store_id + email) ──────────────────────
    const pinHash = await bcrypt.hash(CASHIER_PIN, BCRYPT_ROUNDS);
    const foundEmp = await ds.query(
      `SELECT id FROM employees WHERE store_id = $1 AND lower(email) = $2 LIMIT 1`,
      [storeId, CASHIER_EMAIL],
    );
    let employeeId: string;
    let cashierCreated = false;
    if (foundEmp.length > 0) {
      employeeId = foundEmp[0].id;
      await ds.query(
        `UPDATE employees SET pin_hash = $1, role = 'cashier', is_active = true WHERE id = $2`,
        [pinHash, employeeId],
      );
      console.log(`[pos-access] cashier EXISTS: ${CASHIER_EMAIL} (id=${employeeId}) — PIN refreshed, no duplicate`);
    } else {
      employeeId = uuidv4();
      await ds.query(
        `INSERT INTO employees
           (id, store_id, first_name, last_name, email, pin_hash, qr_code, role, max_discount_percent, is_active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'cashier', 5, true, NOW())`,
        [employeeId, storeId, CASHIER_FIRST, CASHIER_LAST, CASHIER_EMAIL, pinHash, `EMP-${uuidv4().slice(0, 8).toUpperCase()}`],
      );
      cashierCreated = true;
      console.log(`[pos-access] cashier CREATED: ${CASHIER_EMAIL} (id=${employeeId})`);
    }

    // ── 3. DB-level credential verification ──────────────────────────────
    const row = await ds.query(`SELECT pin_hash FROM employees WHERE id = $1`, [employeeId]);
    const dbPinOk = row.length > 0 && (await bcrypt.compare(CASHIER_PIN, row[0].pin_hash));
    console.log(`[pos-access] DB credential check (bcrypt): ${dbPinOk ? 'OK' : 'FAILED'}`);

    // ── 4. Real HTTP login test against Backend B (optional) ─────────────
    let httpResult = 'skipped (POS_API_URL empty)';
    if (POS_API_URL) {
      try {
        const res = await fetch(`${POS_API_URL.replace(/\/$/, '')}/api/auth/login/pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storeId: STORE_CODE, pin: CASHIER_PIN }),
        });
        let hasToken = false;
        try {
          const body: any = await res.json();
          hasToken = !!(body?.accessToken || body?.token || body?.tokens);
        } catch {
          /* non-JSON body */
        }
        httpResult = `HTTP ${res.status}${res.ok ? ` (token=${hasToken})` : ''}`;
      } catch (e: any) {
        httpResult = `network error: ${e?.message || e}`;
      }
    }
    console.log(`[pos-access] HTTP login test (${POS_API_URL || 'n/a'}): ${httpResult}`);

    // ── Report ───────────────────────────────────────────────────────────
    const line = '─'.repeat(56);
    console.log(`\n${line}`);
    console.log('  ACCÈS CAISSE');
    console.log(`    Magasin        : ${STORE_NAME} (${storeCreated ? 'créé' : 'déjà existant'})`);
    console.log(`    Code magasin   : ${STORE_CODE}`);
    console.log(`    Store id       : ${storeId}`);
    console.log(`    Employé        : ${CASHIER_FIRST} ${CASHIER_LAST} <${CASHIER_EMAIL}> (${cashierCreated ? 'créé' : 'déjà existant'})`);
    console.log(`    Rôle           : cashier`);
    console.log(`    PIN            : ${CASHIER_PIN}`);
    console.log(`    DB check       : ${dbPinOk ? 'OK' : 'ÉCHEC'}`);
    console.log(`    Login HTTP     : ${httpResult}`);
    console.log(`${line}`);
    console.log(`  → Caisse : ID Magasin = ${STORE_CODE}  ·  PIN = ${CASHIER_PIN}\n`);

    if (!dbPinOk) fail('La vérification DB du PIN a échoué — accès NON prêt.');
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => fail(`Erreur inattendue : ${err?.message || err}`));
