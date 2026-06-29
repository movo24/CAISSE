import {
  isFreshEventId,
  dedupeBatch,
  freshOnly,
  seenSetFrom,
} from './consumer-dedup';

const ev = (id: string) => ({ id, type: 'sale.completed' });

describe('consumer-dedup (POS-INT-102 exactly-once contract)', () => {
  describe('isFreshEventId', () => {
    it('fresh when id absent from seen set', () => {
      expect(isFreshEventId('a', new Set())).toBe(true);
      expect(isFreshEventId('a', new Set(['a']))).toBe(false);
    });
    it('empty id is never fresh', () => {
      expect(isFreshEventId('', new Set())).toBe(false);
    });
  });

  describe('dedupeBatch', () => {
    it('keeps order and marks fresh ids as seen', () => {
      const seen = new Set<string>();
      const r = dedupeBatch([ev('a'), ev('b'), ev('c')], seen);
      expect(r.fresh.map((e) => e.id)).toEqual(['a', 'b', 'c']);
      expect(r.duplicates).toEqual([]);
      expect([...seen].sort()).toEqual(['a', 'b', 'c']);
    });

    it('skips events already seen from a prior batch', () => {
      const seen = seenSetFrom(['a']);
      const r = dedupeBatch([ev('a'), ev('b')], seen);
      expect(r.fresh.map((e) => e.id)).toEqual(['b']);
      expect(r.duplicates.map((e) => e.id)).toEqual(['a']);
    });

    it('collapses intra-batch repeats (idempotent within a single delivery)', () => {
      const r = dedupeBatch([ev('a'), ev('a'), ev('b'), ev('a')]);
      expect(r.fresh.map((e) => e.id)).toEqual(['a', 'b']);
      expect(r.duplicates.map((e) => e.id)).toEqual(['a', 'a']);
    });

    it('treats empty-id events as duplicates (cannot be deduped safely)', () => {
      const r = dedupeBatch([{ id: '' }, ev('x')]);
      expect(r.fresh.map((e) => e.id)).toEqual(['x']);
      expect(r.duplicates.map((e) => e.id)).toEqual(['']);
    });

    it('defaults to a fresh empty seen set when none provided', () => {
      const r = dedupeBatch([ev('a')]);
      expect(r.seen.has('a')).toBe(true);
    });

    it('replaying the exact same batch yields zero fresh the second time', () => {
      const seen = new Set<string>();
      const batch = [ev('a'), ev('b')];
      expect(dedupeBatch(batch, seen).fresh).toHaveLength(2);
      expect(dedupeBatch(batch, seen).fresh).toHaveLength(0);
    });
  });

  describe('freshOnly', () => {
    it('returns only fresh events and mutates the seen set', () => {
      const seen = new Set<string>();
      expect(freshOnly([ev('a'), ev('a')], seen).map((e) => e.id)).toEqual(['a']);
      expect(seen.has('a')).toBe(true);
    });
  });

  describe('seenSetFrom', () => {
    it('builds a set, dropping empty ids', () => {
      expect([...seenSetFrom(['a', '', 'b'])].sort()).toEqual(['a', 'b']);
    });
  });
});
