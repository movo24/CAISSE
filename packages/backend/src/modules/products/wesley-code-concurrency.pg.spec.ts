import { DataSource } from 'typeorm';
import { formatWesleyCode } from './products.service';
import { WESLEY_CODE_REGEX } from '../../common/validators/gtin.validator';

/**
 * Atomicité RÉELLE de la séquence Wesley sur Postgres (test 4 du cahier des
 * charges) : des générations simultanées ne produisent JAMAIS deux fois le
 * même code, et un numéro consommé n'est jamais réémis.
 *
 * CI-safety (règle D23) : ce spec tourne sur la base PARTAGÉE de la CI —
 * il n'appelle PAS runMigrations, crée la séquence de façon idempotente
 * (IF NOT EXISTS, même DDL que la migration 1773) et ne touche à aucune
 * table. Insensible à l'ordre d'exécution des autres specs.
 */
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Séquence wesley_product_code_seq — concurrence (vrai Postgres)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = new DataSource({ type: 'postgres', url });
    await ds.initialize();
    await ds.query(
      `CREATE SEQUENCE IF NOT EXISTS wesley_product_code_seq START WITH 1 INCREMENT BY 1 NO CYCLE`,
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('50 générations simultanées → 50 codes distincts, tous au format WES-P-############', async () => {
    const codes = await Promise.all(
      Array.from({ length: 50 }, async () => {
        const rows: Array<{ n: string }> = await ds.query(
          `SELECT nextval('wesley_product_code_seq') AS n`,
        );
        return formatWesleyCode(rows[0].n);
      }),
    );
    expect(new Set(codes).size).toBe(50);
    for (const code of codes) expect(code).toMatch(WESLEY_CODE_REGEX);
  });

  it('la séquence ne revient jamais en arrière (numéro consommé = jamais réutilisé)', async () => {
    const [{ n: a }] = await ds.query(`SELECT nextval('wesley_product_code_seq') AS n`);
    const [{ n: b }] = await ds.query(`SELECT nextval('wesley_product_code_seq') AS n`);
    expect(BigInt(b)).toBeGreaterThan(BigInt(a));
  });
});
