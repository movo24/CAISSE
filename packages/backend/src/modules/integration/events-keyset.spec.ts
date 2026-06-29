import {
  compareKeyset,
  isAfterCursor,
  selectPage,
  drainAll,
  KeysetEvent,
} from './events-keyset';
import { parseEventsCursor } from './events-query';

const at = (ms: number) => new Date(ms);
const ev = (id: string, ms: number): KeysetEvent => ({ id, occurredAt: at(ms) });

describe('events-keyset reference (POS-INT-104)', () => {
  describe('compareKeyset', () => {
    it('orders by occurredAt then id', () => {
      const arr = [ev('b', 100), ev('a', 100), ev('z', 50)].sort(compareKeyset);
      expect(arr.map((e) => e.id)).toEqual(['z', 'a', 'b']);
    });
  });

  describe('isAfterCursor', () => {
    const cur = parseEventsCursor('1970-01-01T00:00:00.100Z|m');
    it('strictly later timestamp passes', () => {
      expect(isAfterCursor(ev('a', 200), cur)).toBe(true);
    });
    it('earlier timestamp fails', () => {
      expect(isAfterCursor(ev('z', 50), cur)).toBe(false);
    });
    it('same timestamp advances only for greater id', () => {
      expect(isAfterCursor(ev('n', 100), cur)).toBe(true); // 'n' > 'm'
      expect(isAfterCursor(ev('m', 100), cur)).toBe(false); // equal id
      expect(isAfterCursor(ev('a', 100), cur)).toBe(false); // 'a' < 'm'
    });
    it('no cursor → everything passes', () => {
      expect(isAfterCursor(ev('a', 1), { occurredAt: null, id: null })).toBe(true);
    });
  });

  describe('selectPage + drainAll — no skip / no duplicate across boundaries', () => {
    // 5 events sharing the SAME timestamp, plus neighbours — the historical bug.
    const sameTs = [
      ev('e5', 100),
      ev('e1', 100),
      ev('e3', 100),
      ev('e2', 100),
      ev('e4', 100),
      ev('before', 50),
      ev('after', 150),
    ];
    const expectedOrder = ['before', 'e1', 'e2', 'e3', 'e4', 'e5', 'after'];

    it('full ordered delivery with a page size that cuts the same-timestamp group', () => {
      // limit=2 forces a page boundary inside the 5 same-ts events
      expect(drainAll(sameTs, 2)).toEqual(expectedOrder);
    });

    it.each([1, 2, 3, 4, 7, 100])('covers every event exactly once at limit=%i', (limit) => {
      const ids = drainAll(sameTs, limit);
      expect(ids.sort()).toEqual([...expectedOrder].sort());
      expect(new Set(ids).size).toBe(sameTs.length); // no duplicates
    });

    it('timestamp-only cursor (legacy) WOULD skip same-ts events — composite does not', () => {
      // legacy behaviour: resume strictly after timestamp 100 → loses e2..e5
      const legacyAfter = sameTs.filter((e) => e.occurredAt.getTime() > 100).map((e) => e.id);
      expect(legacyAfter).toEqual(['after']); // demonstrates the old loss
      // composite: resume after (100, e1) → keeps e2..e5 then after
      const page = selectPage(sameTs, '1970-01-01T00:00:00.100Z|e1', 100);
      expect(page.events.map((e) => e.id)).toEqual(['e2', 'e3', 'e4', 'e5', 'after']);
    });

    it('nextCursor is null when the page is the last', () => {
      const page = selectPage([ev('only', 10)], undefined, 50);
      expect(page.events.map((e) => e.id)).toEqual(['only']);
      const tail = selectPage([ev('only', 10)], page.nextCursor!, 50);
      expect(tail.events).toEqual([]);
      expect(tail.nextCursor).toBeNull();
    });
  });
});
