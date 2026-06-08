import { analyzeProduct, computeProductAnalytics, ProductSalesRow, AnalyticsOptions } from './product-analytics.util';

const NOW = '2026-06-07T12:00:00.000Z';
const opts: AnalyticsOptions = { now: NOW };

function row(over: Partial<ProductSalesRow>): ProductSalesRow {
  return {
    productId: 'p', name: 'Produit', stockQuantity: 50, priceMinorUnits: 1000,
    isActive: true, unitsSold7d: 0, unitsSold30d: 0, lastSoldAt: NOW, ...over,
  };
}

describe('analyzeProduct — vélocité / rupture / réassort', () => {
  it('calcule la vélocité et les jours avant rupture', () => {
    const a = analyzeProduct(row({ unitsSold30d: 60, stockQuantity: 20, lastSoldAt: NOW }), opts);
    expect(a.dailyVelocity).toBe(2); // 60/30
    expect(a.daysUntilStockout).toBe(10); // 20 / 2
  });

  it('suggère un réassort quand rupture imminente (couvre lead+cover)', () => {
    // vélocité 2/j, stock 6 → rupture dans 3j (≤7) → réassort
    const a = analyzeProduct(row({ unitsSold30d: 60, stockQuantity: 6, lastSoldAt: NOW }), opts);
    expect(a.needsReorder).toBe(true);
    // ceil(2*(7+14)) - 6 = 42 - 6 = 36
    expect(a.suggestedReorderQty).toBe(36);
  });

  it('pas de réassort si stock large', () => {
    const a = analyzeProduct(row({ unitsSold30d: 30, stockQuantity: 500, lastSoldAt: NOW }), opts);
    expect(a.needsReorder).toBe(false);
    expect(a.suggestedReorderQty).toBe(0);
  });

  it('produit jamais vendu mais en stock → dormant, pas de rupture', () => {
    const a = analyzeProduct(row({ unitsSold30d: 0, stockQuantity: 10, lastSoldAt: null }), opts);
    expect(a.classification).toBe('dormant');
    expect(a.daysUntilStockout).toBeNull();
    expect(a.daysSinceLastSale).toBeNull();
  });

  it('vendu il y a longtemps (> dormantDays) → dormant', () => {
    const a = analyzeProduct(row({ unitsSold30d: 0, stockQuantity: 5, lastSoldAt: '2026-03-01T00:00:00.000Z' }), opts);
    expect(a.classification).toBe('dormant');
    expect(a.daysSinceLastSale).toBeGreaterThan(30);
  });

  it('forte vélocité + tendance positive → star', () => {
    const a = analyzeProduct(row({ unitsSold30d: 60, unitsSoldPrev30d: 30, stockQuantity: 100, lastSoldAt: NOW }), opts);
    expect(a.trendPct).toBe(100);
    expect(a.classification).toBe('star');
  });

  it('chute marquée (≤ -40%) → declining', () => {
    const a = analyzeProduct(row({ unitsSold30d: 10, unitsSoldPrev30d: 100, stockQuantity: 50, lastSoldAt: NOW }), opts);
    expect(a.trendPct).toBe(-90);
    expect(a.declining).toBe(true);
  });

  it('valeur de stock = stock × prix (pas de recalcul fiscal)', () => {
    const a = analyzeProduct(row({ stockQuantity: 8, priceMinorUnits: 1990 }), opts);
    expect(a.valeurStockMinorUnits).toBe(15920);
  });
});

describe('computeProductAnalytics — agrégats', () => {
  const rows: ProductSalesRow[] = [
    row({ productId: 'star', name: 'Star', unitsSold30d: 90, unitsSold7d: 25, unitsSoldPrev30d: 40, stockQuantity: 200, lastSoldAt: NOW }),
    row({ productId: 'reorder', name: 'Réassort', unitsSold30d: 60, unitsSold7d: 15, stockQuantity: 6, lastSoldAt: NOW }),
    row({ productId: 'slow', name: 'Lent', unitsSold30d: 2, unitsSold7d: 0, unitsSoldPrev30d: 2, stockQuantity: 30, lastSoldAt: NOW }),
    row({ productId: 'declining', name: 'Déclin', unitsSold30d: 10, unitsSold7d: 1, unitsSoldPrev30d: 100, stockQuantity: 40, lastSoldAt: NOW }),
    row({ productId: 'dormant', name: 'Dormant', unitsSold30d: 0, unitsSold7d: 0, stockQuantity: 12, lastSoldAt: null }),
    row({ productId: 'inactive', name: 'Inactif', isActive: false, unitsSold30d: 100, stockQuantity: 5, lastSoldAt: NOW }),
  ];
  const rep = computeProductAnalytics(rows, opts);

  it('exclut les produits inactifs', () => {
    expect(rep.items.find((i) => i.productId === 'inactive')).toBeUndefined();
  });
  it('top trié par ventes 30j', () => {
    expect(rep.top[0].productId).toBe('star');
  });
  it('flop contient le lent et le déclinant, pas le star', () => {
    const ids = rep.flop.map((i) => i.productId);
    expect(ids).toContain('slow');
    expect(ids).toContain('declining');
    expect(ids).not.toContain('star');
  });
  it('dormant détecté', () => {
    expect(rep.dormant.map((i) => i.productId)).toContain('dormant');
  });
  it('réassort détecté (rupture imminente)', () => {
    expect(rep.reorder.map((i) => i.productId)).toContain('reorder');
    expect(rep.reorder[0].suggestedReorderQty).toBeGreaterThan(0);
  });
});
