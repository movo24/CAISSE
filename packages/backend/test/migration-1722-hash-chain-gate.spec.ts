/**
 * A6 — the 1722 pre-deploy gate is INTERNAL: the migration itself counts the
 * un-sealed sales rows and RAISES before any ALTER (no human checklist on the
 * deploy path). Decisive: a dirty table stops the deploy with a diagnosis and
 * ZERO schema change; a clean table tightens both columns.
 */
import { SalesHashChainNotNull1722000000000 } from '../src/database/migrations/1722000000000-SalesHashChainNotNull';

const runnerWith = (unsealed: number) => {
  const executed: string[] = [];
  const queryRunner = {
    query: jest.fn(async (sql: string) => {
      executed.push(sql);
      if (sql.includes('SELECT count(*)')) return [{ unsealed }];
      return undefined;
    }),
  } as any;
  return { queryRunner, executed };
};

describe('A6 — migration 1722 internal gate (un-sealed fiscal rows)', () => {
  it('DECISIVE — >0 un-sealed rows: RAISES with the diagnosis, NO ALTER is emitted', async () => {
    const { queryRunner, executed } = runnerWith(2);
    await expect(new SalesHashChainNotNull1722000000000().up(queryRunner)).rejects.toThrow(
      /\[H4 GATE\] 2 sales row\(s\).*cannot be retro-sealed/s,
    );
    expect(executed.some((sql) => sql.includes('ALTER TABLE'))).toBe(false); // gate fires BEFORE any DDL
  });

  it('0 un-sealed rows: both columns tighten', async () => {
    const { queryRunner, executed } = runnerWith(0);
    await new SalesHashChainNotNull1722000000000().up(queryRunner);
    const alters = executed.filter((sql) => sql.includes('SET NOT NULL'));
    expect(alters).toHaveLength(2);
    expect(alters.join(' ')).toContain('hash_chain_prev');
    expect(alters.join(' ')).toContain('hash_chain_current');
  });
});
