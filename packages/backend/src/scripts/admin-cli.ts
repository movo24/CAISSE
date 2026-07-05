/**
 * Admin CLI — create or reset a POS Caisse administrator, safely.
 *
 *   npm run admin:create     # create a new admin
 *   npm run admin:reset      # reset an existing admin's temporary password (PIN)
 *
 * Auth model reminder: the backoffice/admin logs in with EMAIL + PIN. There is
 * no separate password field — the "temporary password" here becomes the
 * bcrypt-hashed PIN. Change it immediately after the first login.
 *
 * SAFETY (all enforced in admin-cli.core.ts, unit-tested):
 *  - ADMIN_CLI_CONFIRM=I_UNDERSTAND is required (no accidental runs);
 *  - in production (NODE_ENV=production) you MUST also set ADMIN_CLI_ALLOW_PROD=YES
 *    (no silent admin creation in prod);
 *  - ADMIN_EMAIL is required and validated;
 *  - ADMIN_PASSWORD is optional — if omitted a crypto-strong temporary password
 *    is generated and printed ONCE (never logged, never committed).
 *
 * Env:
 *   DATABASE_URL           (required) Postgres connection string
 *   ADMIN_CLI_CONFIRM      (required) must equal I_UNDERSTAND
 *   ADMIN_EMAIL            (required) admin email
 *   ADMIN_PASSWORD         (optional) impose a temp password; else generated
 *   ADMIN_STORE_CODE       (create)  store code to attach the admin to
 *   ADMIN_STORE_ID         (create)  store id (alternative to store code)
 *   ADMIN_FIRST_NAME       (optional) default "Admin"
 *   ADMIN_LAST_NAME        (optional) default "Caisse"
 *   ADMIN_CLI_ALLOW_PROD   (prod)    must equal YES to run in production
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { StoreEntity } from '../database/entities/store.entity';
import { EmployeeEntity } from '../database/entities/employee.entity';
import { resolveAdminCliConfig, parseMode, AdminCliError, type AdminCliConfig } from './admin-cli.core';

const BCRYPT_ROUNDS = 12;

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

/** Resolve the target store for a create (by code, id, or the only store). */
async function resolveStore(ds: DataSource, cfg: AdminCliConfig): Promise<StoreEntity> {
  const storeRepo = ds.getRepository(StoreEntity);
  if (cfg.storeId) {
    const s = await storeRepo.findOne({ where: { id: cfg.storeId } });
    if (!s) throw new AdminCliError(`Magasin introuvable pour ADMIN_STORE_ID=${cfg.storeId}.`);
    return s;
  }
  if (cfg.storeCode) {
    const s = await storeRepo.findOne({ where: { storeCode: cfg.storeCode.toUpperCase() } });
    if (!s) throw new AdminCliError(`Magasin introuvable pour ADMIN_STORE_CODE=${cfg.storeCode}.`);
    return s;
  }
  const all = await storeRepo.find();
  if (all.length === 1) return all[0];
  if (all.length === 0) throw new AdminCliError('Aucun magasin en base. Créez un magasin (seed) avant un admin.');
  throw new AdminCliError(
    `${all.length} magasins trouvés — précisez ADMIN_STORE_CODE ou ADMIN_STORE_ID.`,
  );
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv);
  const cfg = resolveAdminCliConfig(process.env, mode);

  if (!process.env.DATABASE_URL) fail('DATABASE_URL est requis.');

  if (cfg.isProduction) {
    console.warn('\n⚠  PRODUCTION — opération admin explicitement autorisée (ADMIN_CLI_ALLOW_PROD=YES).');
  }

  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [path.join(__dirname, '../database/entities/*.entity.{ts,js}')],
    synchronize: false,
  });
  await ds.initialize();

  try {
    const empRepo = ds.getRepository(EmployeeEntity);
    const existing = await empRepo.findOne({ where: { email: cfg.email } });
    const pinHash = await bcrypt.hash(cfg.password, BCRYPT_ROUNDS);

    if (mode === 'create') {
      if (existing) {
        throw new AdminCliError(
          `Un compte existe déjà pour ${cfg.email}. Utilisez "npm run admin:reset" pour réinitialiser.`,
        );
      }
      const store = await resolveStore(ds, cfg);
      const admin = await empRepo.save(
        empRepo.create({
          firstName: cfg.firstName,
          lastName: cfg.lastName,
          email: cfg.email,
          pinHash,
          qrCode: `EMP-${uuidv4().slice(0, 8).toUpperCase()}`,
          role: 'admin',
          storeId: store.id,
          maxDiscountPercent: 100,
          isActive: true,
        }),
      );
      // Operation log — NEVER logs the password.
      console.log(
        `\n[admin-cli] CREATED admin id=${admin.id} email=${cfg.email} role=admin ` +
          `store=${store.storeCode || store.id} at=${new Date().toISOString()}`,
      );
      report(cfg, 'créé', store.storeCode || store.id);
    } else {
      // reset
      if (!existing) {
        throw new AdminCliError(
          `Aucun compte pour ${cfg.email}. Utilisez "npm run admin:create" pour le créer.`,
        );
      }
      existing.pinHash = pinHash;
      existing.isActive = true;
      await empRepo.save(existing);
      console.log(
        `\n[admin-cli] RESET admin id=${existing.id} email=${cfg.email} at=${new Date().toISOString()}`,
      );
      report(cfg, 'réinitialisé', existing.storeId);
    }
  } finally {
    await ds.destroy();
  }
}

/** Print the temporary password ONCE to the operator, with change instructions. */
function report(cfg: AdminCliConfig, verb: string, store: string): void {
  const line = '─'.repeat(56);
  console.log(`\n${line}`);
  console.log(`  Administrateur ${verb} :`);
  console.log(`    Email          : ${cfg.email}`);
  console.log(`    Magasin        : ${store}`);
  if (cfg.generated) {
    console.log(`    Mot de passe   : ${cfg.password}   ← TEMPORAIRE (généré)`);
  } else {
    console.log(`    Mot de passe   : (imposé via ADMIN_PASSWORD)`);
  }
  console.log(`${line}`);
  console.log('  → Connexion backoffice/POS : EMAIL + ce mot de passe (PIN).');
  console.log('  → CHANGEZ-LE immédiatement après la première connexion.');
  console.log('  → Ne le committez jamais, ne le partagez pas en clair.\n');
}

main().catch((err) => {
  if (err instanceof AdminCliError) fail(err.message);
  fail(`Erreur inattendue : ${err?.message || err}`);
});
