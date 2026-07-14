import { AddWebauthnCredentials1759000000000 } from '../src/database/migrations/1759000000000-AddWebauthnCredentials';

// P372 — migration 1759 (passkeys WebAuthn). Renumérotée depuis 1730 (branche
// divergente) vers 1759 = strictement au-dessus de la dernière migration
// officielle (1758-AddStoreGeoAndNetwork sur origin/main).
//
// pg-mem ne sait pas parser « CREATE TABLE IF NOT EXISTS » → l'exécution SQL
// réelle est prouvée sur PostgreSQL (3 scénarios : base vierge branche, base à
// jour lignée-main + 1759 seule, base partielle — voir EXECUTION_LOG P372).
// Ce test capture les requêtes émises et VERROUILLE les garde-fous
// d'idempotence + le caractère « public only » du schéma (aucune biométrie).

function captureRunner() {
  const queries: string[] = [];
  return {
    queries,
    runner: { query: async (sql: string) => void queries.push(sql) } as any,
  };
}

describe('migration 1759-AddWebauthnCredentials — garde-fous (capture SQL)', () => {
  it('up() : CREATE TABLE + index tous en IF NOT EXISTS (idempotent, sûr sur base partielle)', async () => {
    const { queries, runner } = captureRunner();
    await new AddWebauthnCredentials1759000000000().up(runner);

    const create = queries.find((q) => /CREATE TABLE/i.test(q))!;
    expect(create).toMatch(/CREATE TABLE IF NOT EXISTS "webauthn_credentials"/i);

    const indexes = queries.filter((q) => /CREATE (UNIQUE )?INDEX/i.test(q));
    expect(indexes.length).toBeGreaterThanOrEqual(2);
    for (const idx of indexes) expect(idx).toMatch(/IF NOT EXISTS/i);
  });

  it('schéma PUBLIC uniquement : clé publique + compteur, jamais de biométrie/clé privée', async () => {
    const { queries, runner } = captureRunner();
    await new AddWebauthnCredentials1759000000000().up(runner);
    const create = queries.find((q) => /CREATE TABLE/i.test(q))!.toLowerCase();

    for (const col of ['credential_id', 'public_key', 'counter', 'device_name', 'last_used_at', 'revoked_at']) {
      expect(create).toContain(`"${col}"`);
    }
    for (const forbidden of ['private_key', 'biometric', 'face', 'fingerprint', 'template']) {
      expect(create).not.toContain(forbidden);
    }
  });

  it('down() : DROP TABLE IF EXISTS (revert propre, jamais destructif à l’aveugle)', async () => {
    const { queries, runner } = captureRunner();
    await new AddWebauthnCredentials1759000000000().down(runner);
    expect(queries.some((q) => /DROP TABLE IF EXISTS "webauthn_credentials"/i.test(q))).toBe(true);
  });

  it('classe correctement numérotée (>1758 officielle)', () => {
    const mig = new AddWebauthnCredentials1759000000000();
    expect((mig as any).name).toBe('AddWebauthnCredentials1759000000000');
    expect(1759000000000).toBeGreaterThan(1758000000000);
  });
});
