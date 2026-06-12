/**
 * Couche 0 (ADR-012 AMENDMENT-1) — the structural chain walk that backfills the
 * `credit_note_seq` / `journal_seq` cursors AND audits the existing corrective
 * chains. Pure function (no DB) → every STOP predicate is exercised
 * deterministically. A walk that unrolls cleanly = a well-defined sequence; any
 * break = a pre-existing fork surfaced → throw (incident, the 1722 pattern).
 *
 * Scope tested = STRUCTURAL only (root / fork / orphan / link). The walk does
 * NOT recompute payload hashes — that is fiscal:verify-z (layer 3).
 */
import {
  walkChainSequence,
  CHAIN_GENESIS,
  ChainRow,
} from '../src/database/migrations/1720000000001-AddCorrectiveChainSeqCursors';

const H = (n: number) => String(n).padStart(64, '0'); // distinct 64-char hashes
const row = (id: string, prev: string | null, cur: string | null): ChainRow => ({ id, prev, cur });

describe('walkChainSequence — backfill order + structural audit', () => {
  it('empty chain → empty plan', () => {
    expect(walkChainSequence('t', [])).toEqual([]);
  });

  it('single genesis row → seq 1', () => {
    const plan = walkChainSequence('t', [row('g', CHAIN_GENESIS, H(1))]);
    expect(plan).toEqual([{ id: 'g', seq: 1 }]);
  });

  it('orders by the hash links, NOT array/created_at order', () => {
    // Chain: g → a → b. Presented SCRAMBLED (b, g, a) — created_at would put them
    // in insertion order; the walk must recover the LINK order regardless.
    const g = row('g', CHAIN_GENESIS, H(1));
    const a = row('a', H(1), H(2));
    const b = row('b', H(2), H(3));
    const plan = walkChainSequence('t', [b, g, a]);
    expect(plan).toEqual([
      { id: 'g', seq: 1 },
      { id: 'a', seq: 2 },
      { id: 'b', seq: 3 },
    ]);
  });

  it('STOP (1) — no genesis (rootless chain)', () => {
    expect(() =>
      walkChainSequence('t', [row('a', H(1), H(2)), row('b', H(2), H(3))]),
    ).toThrow(/NO genesis/);
  });

  it('STOP (2) — multiple genesis roots', () => {
    expect(() =>
      walkChainSequence('t', [
        row('g1', CHAIN_GENESIS, H(1)),
        row('g2', CHAIN_GENESIS, H(2)),
      ]),
    ).toThrow(/multiple roots/);
  });

  it('STOP (3) — fork: two successors of one node', () => {
    expect(() =>
      walkChainSequence('t', [
        row('g', CHAIN_GENESIS, H(1)),
        row('a', H(1), H(2)),
        row('b', H(1), H(3)), // also chains off H(1) → fork
      ]),
    ).toThrow(/fork/);
  });

  it('STOP (4) — duplicate hash_chain_current (ambiguous head, subsumes cycle)', () => {
    expect(() =>
      walkChainSequence('t', [
        row('g', CHAIN_GENESIS, H(1)),
        row('a', H(1), H(1)), // current collides with genesis' current
      ]),
    ).toThrow(/duplicate hash_chain_current/);
  });

  it('STOP (5) — orphan row unreachable from genesis', () => {
    expect(() =>
      walkChainSequence('t', [
        row('g', CHAIN_GENESIS, H(1)),
        row('a', H(1), H(2)),
        row('x', H(9), H(8)), // prev points at no node → unreachable
      ]),
    ).toThrow(/orphan/);
  });

  it('STOP (6) — NULL hash (legacy unchained credit_notes row)', () => {
    expect(() =>
      walkChainSequence('t', [
        row('g', CHAIN_GENESIS, H(1)),
        row('legacy', null, null),
      ]),
    ).toThrow(/NULL hash/);
  });

  it('a longer clean chain stays 1..n in link order', () => {
    const rows: ChainRow[] = [];
    let prev = CHAIN_GENESIS;
    const ids = ['a', 'b', 'c', 'd', 'e'];
    for (let i = 0; i < ids.length; i++) {
      const cur = H(i + 1);
      rows.push(row(ids[i], prev, cur));
      prev = cur;
    }
    // shuffle the presentation
    const plan = walkChainSequence('t', [rows[3], rows[0], rows[4], rows[1], rows[2]]);
    expect(plan.map((p) => p.id)).toEqual(ids);
    expect(plan.map((p) => p.seq)).toEqual([1, 2, 3, 4, 5]);
  });
});
