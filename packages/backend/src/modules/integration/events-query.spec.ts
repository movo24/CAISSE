import {
  normalizeEventsQuery,
  MAX_EVENTS_PAGE,
  DEFAULT_EVENTS_PAGE,
} from './events-query';

describe('POS integration events-query', () => {
  it('parses a valid since cursor', () => {
    const q = normalizeEventsQuery({ since: '2026-06-29T10:00:00.000Z' });
    expect(q.sinceDate?.toISOString()).toBe('2026-06-29T10:00:00.000Z');
  });
  it('invalid/absent since → null', () => {
    expect(normalizeEventsQuery({ since: 'nope' }).sinceDate).toBeNull();
    expect(normalizeEventsQuery({}).sinceDate).toBeNull();
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
