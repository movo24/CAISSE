/**
 * P314 (cycle H) — TD-AUDIT-HASH-DUP drift guard.
 *
 * Two copies of the audit chain formula exist: `modules/audit/audit-hash.ts`
 * (backend, USED) and `shared/utils/hash.ts#createAuditHash` (not imported by
 * the backend). Unifying them is a BUILD decision (gated). Until then, this
 * guard removes the actual risk: if the two formulas ever diverge on ANY of a
 * battery of adversarial inputs, this spec fails and names the culprit.
 * If you are here because it went red: do NOT "fix the test" — reconcile the
 * formulas (or finally unify, TD-AUDIT-HASH-DUP) — audit chains are legal data.
 */
import { computeAuditHash, GENESIS_HASH } from '../src/modules/audit/audit-hash';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { createAuditHash } from '../../../shared/utils/hash';

const CASES: Array<[string, Record<string, unknown>]> = [
  [GENESIS_HASH, {}],
  [GENESIS_HASH, { a: 1, b: 'x' }],
  ['a'.repeat(64), { b: 'x', a: 1 }], // key order must not matter (sorted keys)
  ['b'.repeat(64), { nested: { z: 1, a: [1, 2, 3] }, when: '2026-07-02T10:00:00.000Z' }],
  ['c'.repeat(64), { accents: 'Café Bérlingot ✓', emoji: '💶', empty: '', zero: 0, neg: -5 }],
  ['d'.repeat(64), { nullValue: null, bool: false, big: 123456789012345 }],
  ['e'.repeat(64), { storeId: 'store-1', action: 'stock_adjustment', details: { old: 10, new: 0 } }],
];

describe('TD-AUDIT-HASH-DUP — the two audit hash formulas MUST stay identical', () => {
  it.each(CASES.map((c, i) => [i, ...c] as [number, string, Record<string, unknown>]))(
    'case #%s: backend computeAuditHash === shared createAuditHash',
    (_i, prev, data) => {
      expect(computeAuditHash(prev, data)).toBe(createAuditHash(prev, data));
    },
  );

  it('and both chain deterministically from genesis', () => {
    const h1 = computeAuditHash(GENESIS_HASH, { seq: 1 });
    const h2 = computeAuditHash(h1, { seq: 2 });
    expect(createAuditHash(createAuditHash(GENESIS_HASH, { seq: 1 }), { seq: 2 })).toBe(h2);
  });
});
