import {
  normalizeEventsQuery,
  parseEventsCursor,
  encodeEventsCursor,
  MAX_EVENTS_PAGE,
  DEFAULT_EVENTS_PAGE,
} from './events-query';

describe('POS integration events-query', () => {
  it('parses a valid since cursor', () => {
    const q = normalizeEventsQuery({ since: '2026-06-29T10:00:00.000Z' });
    expect(q.sinceDate?.toISOString()).toBe('2026-06-29T10:00:00.000Z');
    expect(q.sinceId).toBeNull(); // bare timestamp = legacy
  });
  it('invalid/absent since → null', () => {
    expect(normalizeEventsQuery({ since: 'nope' }).sinceDate).toBeNull();
    expect(normalizeEventsQuery({}).sinceDate).toBeNull();
    expect(normalizeEventsQuery({}).sinceId).toBeNull();
  });

  describe('composite cursor (POS-INT-103)', () => {
    it('parses "<iso>|<id>" into occurredAt + id', () => {
      const c = parseEventsCursor('2026-06-29T10:00:00.000Z|evt-7');
      expect(c.occurredAt?.toISOString()).toBe('2026-06-29T10:00:00.000Z');
      expect(c.id).toBe('evt-7');
    });
    it('bare ISO parses to id=null (back-compat)', () => {
      const c = parseEventsCursor('2026-06-29T10:00:00.000Z');
      expect(c.occurredAt?.toISOString()).toBe('2026-06-29T10:00:00.000Z');
      expect(c.id).toBeNull();
    });
    it('invalid date → both null', () => {
      expect(parseEventsCursor('nope|evt-1')).toEqual({ occurredAt: null, id: null });
      expect(parseEventsCursor(undefined)).toEqual({ occurredAt: null, id: null });
    });
    it('normalizeEventsQuery exposes sinceId from composite cursor', () => {
      const q = normalizeEventsQuery({ since: '2026-06-29T10:00:00.000Z|evt-9' });
      expect(q.sinceId).toBe('evt-9');
    });
    it('encode/parse round-trips', () => {
      const cur = encodeEventsCursor('2026-06-29T10:00:00.000Z', 'evt-42');
      expect(cur).toBe('2026-06-29T10:00:00.000Z|evt-42');
      const c = parseEventsCursor(cur);
      expect(c.occurredAt?.toISOString()).toBe('2026-06-29T10:00:00.000Z');
      expect(c.id).toBe('evt-42');
    });
  });
  it('clamps limit to [1, MAX] with default', () => {
    expect(normalizeEventsQuery({ limit: 50 }).limit).toBe(50);
    expect(normalizeEventsQuery({ limit: 9999 }).limit).toBe(MAX_EVENTS_PAGE);
    expect(normalizeEventsQuery({ limit: 0 }).limit).toBe(1);
    expect(normalizeEventsQuery({}).limit).toBe(DEFAULT_EVENTS_PAGE);
  });
  it('splits and trims type filter', () => {
    expect(normalizeEventsQuery({ type: 'sale.completed, payment.captured' }).types).toEqual([
      'sale.completed',
      'payment.captured',
    ]);
    expect(normalizeEventsQuery({ type: '' }).types).toEqual([]);
  });
});
