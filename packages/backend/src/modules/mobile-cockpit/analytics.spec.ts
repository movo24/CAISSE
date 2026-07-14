// P366 — pure helpers of the read-only mobile analytics API.
// Locks: window math (prev / N-1), never-invented values (null over fabricated),
// ranking merge determinism, comparison deltas, category share math.

import {
  buildCategories,
  fillSeries,
  resolveBucket,
  parseWindow as pw,
  buildCompareDelta,
  buildKpis,
  buildStoreRanking,
  growthPct,
  parseWindow,
  previousWindow,
  ratioPct,
  safeTimezone,
  yearAgoWindow,
} from './analytics';

describe('analytics pure helpers (P366)', () => {
  describe('growthPct / ratioPct — never invent a number', () => {
    it('returns null when the baseline is 0 (no fabricated growth)', () => {
      expect(growthPct(500, 0)).toBeNull();
      expect(ratioPct(10, 0)).toBeNull();
    });
    it('computes signed growth with 2-decimal rounding', () => {
      expect(growthPct(150, 100)).toBe(50);
      expect(growthPct(50, 100)).toBe(-50);
      expect(growthPct(1, 3)).toBe(-66.67);
    });
  });

  describe('window math', () => {
    it('previousWindow is the same span immediately before', () => {
      const w = parseWindow('2026-07-08T00:00:00.000Z', '2026-07-15T00:00:00.000Z');
      const p = previousWindow(w);
      expect(p.from.toISOString()).toBe('2026-07-01T00:00:00.000Z');
      expect(p.to.toISOString()).toBe('2026-07-08T00:00:00.000Z');
    });
    it('yearAgoWindow shifts both bounds by one calendar year', () => {
      const w = parseWindow('2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
      const y = yearAgoWindow(w);
      expect(y.from.toISOString()).toBe('2025-07-01T00:00:00.000Z');
      expect(y.to.toISOString()).toBe('2025-08-01T00:00:00.000Z');
    });
    it('rejects missing, malformed, inverted, and over-long windows', () => {
      expect(() => parseWindow(undefined, undefined)).toThrow(/requis/);
      expect(() => parseWindow('not-a-date', '2026-07-01')).toThrow(/invalides/);
      expect(() =>
        parseWindow('2026-07-02T00:00:00Z', '2026-07-01T00:00:00Z'),
      ).toThrow(/après/);
      expect(() =>
        parseWindow('2019-01-01T00:00:00Z', '2026-07-01T00:00:00Z'),
      ).toThrow(/trop longue/);
    });
  });

  describe('safeTimezone — SQL injection guard', () => {
    it('accepts IANA names and falls back to Europe/Paris otherwise', () => {
      expect(safeTimezone('Europe/Paris')).toBe('Europe/Paris');
      expect(safeTimezone('America/New_York')).toBe('America/New_York');
      expect(safeTimezone("Europe'; DROP TABLE sales;--")).toBe('Europe/Paris');
      expect(safeTimezone(undefined)).toBe('Europe/Paris');
    });
  });

  describe('buildKpis', () => {
    it('computes avg ticket and discount rate, null on empty period', () => {
      const k = buildKpis(
        { revenue: '10000', tickets: '4', discount: '1000', active_stores: '2' },
        12,
        { count: 1, amountMinorUnits: 500 },
        2,
      );
      expect(k.avgTicketMinorUnits).toBe(2500);
      expect(k.discountRatePct).toBe(9.09); // 1000 / 11000
      expect(k.itemsSold).toBe(12);
      expect(k.refunds).toEqual({ count: 1, amountMinorUnits: 500 });
      expect(k.cancellations).toBe(2);

      const empty = buildKpis(
        { revenue: '0', tickets: '0', discount: '0', active_stores: '0' },
        0,
        { count: 0, amountMinorUnits: 0 },
        0,
      );
      expect(empty.avgTicketMinorUnits).toBeNull();
      expect(empty.discountRatePct).toBeNull();
    });
  });

  describe('buildStoreRanking', () => {
    const input = {
      current: [
        { store_id: 'a', name: 'Cergy', city: 'Cergy', revenue: '20000', tickets: '10', discount: '0', active_hours: '5' },
        { store_id: 'b', name: 'Paris', city: 'Paris', revenue: '50000', tickets: '20', discount: '5000', active_hours: '10' },
      ],
      previous: [{ store_id: 'a', revenue: '10000' }],
      items: [{ store_id: 'b', qty: '40' }],
      margins: [
        { store_id: 'b', margin: '15000', covered_revenue: '30000', total_revenue: '50000' },
        { store_id: 'a', margin: '0', covered_revenue: '0', total_revenue: '20000' },
      ],
      refunds: [{ store_id: 'b', count: '2', amount: '3000' }],
      cancellations: [{ store_id: 'a', count: '1' }],
    };

    it('ranks by revenue by default, ranks are 1-based and dense', () => {
      const r = buildStoreRanking(input);
      expect(r.map((e) => e.storeId)).toEqual(['b', 'a']);
      expect(r.map((e) => e.rank)).toEqual([1, 2]);
    });

    it('merges side tables without inventing values', () => {
      const [b, a] = buildStoreRanking(input);
      expect(b.marginMinorUnits).toBe(15000);
      expect(b.marginCoveragePct).toBe(60);
      // Aucun coût produit renseigné → marge null (pas 0 fabriqué).
      expect(a.marginMinorUnits).toBeNull();
      expect(a.growthPct).toBe(100); // 20000 vs 10000
      expect(b.growthPct).toBeNull(); // pas de baseline
      expect(b.refundRatePct).toBe(10); // 2 avoirs / 20 tickets
      expect(a.cancellations).toBe(1);
      expect(b.revenuePerActiveHourMinorUnits).toBe(5000);
      // Surface m² absente du modèle — toujours null, jamais estimé.
      expect(b.revenuePerSqmMinorUnits).toBeNull();
    });

    it('sorts by growth when requested, null growth last', () => {
      const r = buildStoreRanking({ ...input, sort: 'growth' });
      expect(r[0].storeId).toBe('a');
    });
  });

  describe('buildCompareDelta', () => {
    it('computes A−B deltas with pct relative to B', () => {
      const a = buildKpis(
        { revenue: '12000', tickets: '6', discount: '600', active_stores: '1' },
        20,
        { count: 2, amountMinorUnits: 100 },
        0,
      );
      const b = buildKpis(
        { revenue: '10000', tickets: '5', discount: '0', active_stores: '1' },
        15,
        { count: 1, amountMinorUnits: 50 },
        0,
      );
      const d = buildCompareDelta(a, b);
      expect(d.revenueDeltaMinorUnits).toBe(2000);
      expect(d.revenueDeltaPct).toBe(20);
      expect(d.ticketsDelta).toBe(1);
      expect(d.avgTicketDeltaMinorUnits).toBe(0); // 2000 vs 2000
      expect(d.itemsDelta).toBe(5);
      expect(d.refundCountDelta).toBe(1);
    });
  });

  describe('buildCategories', () => {
    it('computes share of total, growth vs previous, and attaches top store/products', () => {
      const cats = buildCategories({
        current: [
          { category: 'Bonbons', revenue: '7500', qty: '30' },
          { category: null, revenue: '2500', qty: '5' },
        ],
        previous: [{ category: 'Bonbons', revenue: '5000' }],
        topStores: [
          { category: 'Bonbons', store_id: 's1', store_name: 'Cergy', revenue: '6000', rn: '1' },
        ],
        topProducts: [
          { category: 'Bonbons', ean: 'e1', name: 'Fraises', qty: '12', rn: '1' },
          { category: 'Bonbons', ean: 'e2', name: 'Colas', qty: '8', rn: '2' },
        ],
      });
      expect(cats[0].category).toBe('Bonbons');
      expect(cats[0].sharePct).toBe(75);
      expect(cats[0].growthPct).toBe(50);
      expect(cats[0].topStore?.name).toBe('Cergy');
      expect(cats[0].topProducts).toHaveLength(2);
      expect(cats[1].category).toBe('Sans catégorie');
      expect(cats[1].growthPct).toBeNull(); // pas de baseline → null
    });
  });
});

describe('resolveBucket / fillSeries (P367)', () => {
  it('adapte le regroupement à la durée (heure/jour/semaine/mois)', () => {
    expect(resolveBucket(pw('2026-07-14T00:00:00Z', '2026-07-15T00:00:00Z'))).toBe('hour');
    expect(resolveBucket(pw('2026-07-01T00:00:00Z', '2026-07-31T00:00:00Z'))).toBe('day');
    expect(resolveBucket(pw('2026-01-01T00:00:00Z', '2026-07-01T00:00:00Z'))).toBe('week');
    expect(resolveBucket(pw('2025-01-01T00:00:00Z', '2026-07-01T00:00:00Z'))).toBe('month');
  });
  it('refuse un bucket explicite trop dense et un bucket inconnu', () => {
    expect(() => resolveBucket(pw('2026-01-01T00:00:00Z', '2026-07-01T00:00:00Z'), 'hour')).toThrow(/trop de points/);
    expect(() => resolveBucket(pw('2026-07-14T00:00:00Z', '2026-07-15T00:00:00Z'), 'minute')).toThrow(/invalide/);
    // Explicite accepté tant qu'il reste sous la borne (10 j × 24 h = 240 points).
    expect(resolveBucket(pw('2026-07-01T00:00:00Z', '2026-07-11T00:00:00Z'), 'hour')).toBe('hour');
  });
  it('fillSeries : zéro réel sur les trous, marge null jamais inventée', () => {
    const pts = fillSeries(
      ['a', 'b', 'c'],
      new Map([['b', { revenue: '100', tickets: '1', margin: '40' } as any]]),
    );
    expect(pts.map((p) => p.revenue)).toEqual([0, 100, 0]);
    expect(pts[0].margin).toBeNull();
    expect(pts[1].margin).toBe(40);
  });
});
