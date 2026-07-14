// P366 — read-only mobile analytics service. DI-mocked repository.query.
// Locks the NON-NEGOTIABLE invariants of the pilot app:
//   1. the service only ever SELECTs (no INSERT/UPDATE/DELETE reachable);
//   2. CA/tickets aggregate ONLY completed sales; annulations counted apart
//      (voided), remboursements read from credit_notes;
//   3. a storeId scope is applied to every sales aggregate when provided.

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { MobileAnalyticsService } from './mobile-analytics.service';
import { SaleEntity } from '../../database/entities/sale.entity';

describe('MobileAnalyticsService (P366)', () => {
  let service: MobileAnalyticsService;
  let query: jest.Mock;

  const FROM = '2026-07-01T00:00:00.000Z';
  const TO = '2026-07-08T00:00:00.000Z';

  beforeEach(async () => {
    query = jest.fn().mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MobileAnalyticsService,
        { provide: getRepositoryToken(SaleEntity), useValue: { query } },
      ],
    }).compile();
    service = module.get(MobileAnalyticsService);
  });

  it('kpis(): aggregates completed sales only, voided apart, refunds from credit_notes', async () => {
    await service.kpis({ from: new Date(FROM), to: new Date(TO) }, 'store-1');

    const sqls = query.mock.calls.map((c) => c[0] as string);
    const mainSql = sqls.find((s) => s.includes('FROM sales s') && s.includes('SUM(s.total_minor_units)'));
    expect(mainSql).toContain(`s.status = 'completed'`);
    expect(mainSql).toContain('s.store_id =');

    const refundSql = sqls.find((s) => s.includes('credit_notes'));
    expect(refundSql).toBeDefined();

    const voidedSql = sqls.find((s) => s.includes(`s.status = 'voided'`));
    expect(voidedSql).toBeDefined();
    // Le comptage des annulations n'entre JAMAIS dans le CA.
    expect(voidedSql).not.toContain('SUM(s.total_minor_units)');
  });

  it('kpis(): network scope (storeId null) issues no store filter', async () => {
    await service.kpis({ from: new Date(FROM), to: new Date(TO) }, null);
    for (const [sql] of query.mock.calls) {
      expect(sql).not.toContain('s.store_id =');
    }
  });

  it('READ-ONLY guarantee: no query ever mutates (all endpoints exercised)', async () => {
    // Chaque appel public — le mock renvoie des lignes vides plausibles.
    query.mockResolvedValue([]);
    await service.getOverview(FROM, TO, null, 'Europe/Paris');
    await service.getRevenueWindows('store-1', 'Europe/Paris');
    await service.getStoreRanking(FROM, TO, null, 'revenue', 'Europe/Paris');
    await service.searchProducts({ from: FROM, to: TO, storeId: 'store-1', q: 'fraise' });
    await service.searchCatalog({ q: 'fraise', storeId: null });
    await service.getCategories(FROM, TO, null);
    await service.getHeatmap(FROM, TO, 'store-1');
    await service.getCompare({ aFrom: FROM, aTo: TO, bFrom: FROM, bTo: TO, storeA: 's1', storeB: null });
    await service.getSeries({ from: FROM, to: TO, storeIds: ['s1', 's2'], bucket: 'day', includeNetwork: true });
    await service.getProductsMatrix({ from: FROM, to: TO, storeIds: ['s1', 's2'] });

    expect(query.mock.calls.length).toBeGreaterThan(10);
    for (const [sql] of query.mock.calls) {
      const s = (sql as string).toUpperCase();
      expect(s).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/);
    }
  });

  it('getRevenueWindows: single scan, store filter applied when scoped', async () => {
    query.mockResolvedValue([{ today: '100', yesterday: '200', week: '300', month: '400', semester: '500', year: '600' }]);
    const r = await service.getRevenueWindows('store-9', 'Europe/Paris');
    expect(r.todayMinorUnits).toBe(100);
    expect(r.semesterMinorUnits).toBe(500);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain(`s.status = 'completed'`);
    expect(sql).toContain('s.store_id = $2');
    expect(params).toEqual(['Europe/Paris', 'store-9']);
  });

  it('getStoreDetail: 404 on unknown store, never a fabricated payload', async () => {
    query.mockResolvedValueOnce([]); // store lookup
    await expect(service.getStoreDetail('ghost', FROM, TO)).rejects.toThrow('Magasin introuvable');
  });

  it('searchProducts: paramètres de tri whitelistés (pas d’injection par sort)', async () => {
    query.mockResolvedValue([]);
    await service.searchProducts({
      from: FROM,
      to: TO,
      storeId: null,
      sort: 'qty; DROP TABLE sales;--',
    });
    const [sql] = query.mock.calls[0];
    expect(sql).toContain('ORDER BY qty DESC');
    expect(sql).not.toContain('DROP');
  });

  it('getProductDetail: 404 quand l’EAN est inconnu du catalogue', async () => {
    query.mockResolvedValueOnce([]); // info lookup
    await expect(
      service.getProductDetail('0000000000000', FROM, TO, null),
    ).rejects.toThrow('Produit introuvable');
  });
});

describe('MobileAnalyticsService — séries multi-magasins (P367)', () => {
  let service: MobileAnalyticsService;
  let query: jest.Mock;
  const FROM = '2026-07-01T00:00:00.000Z';
  const TO = '2026-07-08T00:00:00.000Z';

  beforeEach(async () => {
    query = jest.fn().mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MobileAnalyticsService,
        { provide: getRepositoryToken(SaleEntity), useValue: { query } },
      ],
    }).compile();
    service = module.get(MobileAnalyticsService);
  });

  it('getSeries : refuse une sélection vide ou > 30 magasins', async () => {
    await expect(service.getSeries({ from: FROM, to: TO, storeIds: [] })).rejects.toThrow('storeIds requis');
    const many = Array.from({ length: 31 }, (_, i) => `s${i}`);
    await expect(service.getSeries({ from: FROM, to: TO, storeIds: many })).rejects.toThrow('30 magasins');
  });

  it('getSeries : refuse un bucket qui produirait trop de points', async () => {
    await expect(
      service.getSeries({ from: '2026-01-01T00:00:00Z', to: '2026-07-01T00:00:00Z', storeIds: ['s1'], bucket: 'hour' }),
    ).rejects.toThrow('trop de points');
  });

  it('getSeries : zéro-remplit tout le domaine (0 = aucune vente réelle)', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('generate_series')) return [{ t: '2026-07-01 00:00' }, { t: '2026-07-02 00:00' }];
      if (sql.includes('FROM stores st')) return [{ id: 's1', name: 'Cergy', city: 'Cergy' }];
      if (sql.includes("s.status = 'completed'") && sql.includes('GROUP BY s.store_id, 2') && sql.includes('total_minor_units'))
        return [{ store_id: 's1', t: '2026-07-02 00:00', revenue: '500', tickets: '2', discount: '0' }];
      return [];
    });
    const r = await service.getSeries({ from: FROM, to: TO, storeIds: ['s1'], bucket: 'day' });
    expect(r.series[0].points).toHaveLength(2);
    expect(r.series[0].points[0]).toMatchObject({ t: '2026-07-01 00:00', revenue: 0, tickets: 0 });
    expect(r.series[0].points[1]).toMatchObject({ t: '2026-07-02 00:00', revenue: 500, tickets: 2 });
    // Horaires d'ouverture absents du modèle — signalé honnêtement.
    expect(r.openingHoursAvailable).toBe(false);
  });

  it('getProductsMatrix : matrice EAN × magasin avec rang et total réseau', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('ROW_NUMBER() OVER (PARTITION BY s.store_id'))
        return [
          { store_id: 's1', ean: 'e1', name: 'Fraises', qty: '10', revenue: '3500', tickets: '6', rank: '1' },
          { store_id: 's2', ean: 'e1', name: 'Fraises', qty: '4', revenue: '1400', tickets: '3', rank: '2' },
          { store_id: 's2', ean: 'e2', name: 'Colas', qty: '9', revenue: '2100', tickets: '5', rank: '1' },
        ];
      if (sql.includes('li.ean = ANY')) return [{ ean: 'e1', qty: '20', revenue: '7000' }, { ean: 'e2', qty: '9', revenue: '2100' }];
      if (sql.includes('FROM stores st')) return [{ id: 's1', name: 'Cergy' }, { id: 's2', name: 'Évry' }];
      return [];
    });
    const r = await service.getProductsMatrix({ from: FROM, to: TO, storeIds: ['s1', 's2'] });
    expect(r.products[0].ean).toBe('e1'); // 14 unités > 9
    expect(r.products[0].perStore['s1']).toMatchObject({ quantity: 10, rank: 1, avgUnitPriceMinorUnits: 350 });
    expect(r.products[0].perStore['s2']).toMatchObject({ quantity: 4, rank: 2 });
    expect(r.products[0].network).toEqual({ qty: 20, revenue: 7000 });
    // Produit vendu dans un seul magasin : cellule absente = null (pas 0 inventé).
    expect(r.products[1].perStore['s1']).toBeNull();
  });

  it('getProductsMatrix : tri par magasin demandé', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('ROW_NUMBER() OVER (PARTITION BY s.store_id'))
        return [
          { store_id: 's1', ean: 'e1', name: 'Fraises', qty: '10', revenue: '3500', tickets: '6', rank: '1' },
          { store_id: 's2', ean: 'e2', name: 'Colas', qty: '9', revenue: '2100', tickets: '5', rank: '1' },
        ];
      if (sql.includes('FROM stores st')) return [];
      return [];
    });
    const r = await service.getProductsMatrix({ from: FROM, to: TO, storeIds: ['s1', 's2'], sortStoreId: 's2' });
    expect(r.products[0].ean).toBe('e2');
  });
});
