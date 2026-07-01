import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { createPgMemDataSource } from '../../../test/helpers/pgmem';
import { SalesGuardsService } from './sales-guards.service';
import { SalesGuardsConfigProvider } from './sales-guards.config';
import { SaleAnomalyLogEntity } from '../../database/entities/sale-anomaly-log.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { StoreEntity } from '../../database/entities/store.entity';

// PAQUET 275 — SalesGuardsService against a real in-memory Postgres (pg-mem):
// proves the REAL queries of the pre-sale money guard — server-side cost
// enrichment (tenant-scoped product lookup), anomaly persistence, list
// filters/pagination, summary grouping, and the review state machine.
// The pure engine matrix is already covered by sales-guards engine specs.

const SELLER = uuidv4();

describe('SalesGuardsService (pg-mem)', () => {
  let dataSource: DataSource;
  let anomalyRepo: Repository<SaleAnomalyLogEntity>;
  let productRepo: Repository<ProductEntity>;
  let service: SalesGuardsService;

  let storeId: string;
  let otherStoreId: string;
  let productId: string; // price 200, cost 300 → selling at catalog is below cost

  beforeAll(async () => {
    const built = createPgMemDataSource();
    dataSource = built.dataSource;
    await dataSource.initialize();
    anomalyRepo = dataSource.getRepository(SaleAnomalyLogEntity);
    productRepo = dataSource.getRepository(ProductEntity);
    const storeRepo = dataSource.getRepository(StoreEntity);
    service = new SalesGuardsService(anomalyRepo, productRepo, new SalesGuardsConfigProvider());

    storeId = (await storeRepo.save(storeRepo.create({ name: 'Wesley' }))).id;
    otherStoreId = (await storeRepo.save(storeRepo.create({ name: 'Other' }))).id;
    productId = (
      await productRepo.save(
        productRepo.create({
          ean: '3000000000001',
          name: 'Marshmallow géant',
          priceMinorUnits: 200,
          costMinorUnits: 300,
          storeId,
        } as Partial<ProductEntity>),
      )
    ).id;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('enriches cost server-side (real product query) → below-cost sale is CRITICAL, blocking, persisted as detected', async () => {
    const res = await service.evaluate({
      storeId,
      sellerId: SELLER,
      items: [{ productId, quantity: 1, sellPriceMinorUnits: 200 }], // sell = catalog, cost 300 from DB
    });
    const belowCost = res.results.find((r) => r.code === 'SALE_BELOW_COST')!;
    expect(belowCost.severity).toBe('critical');
    expect(res.hasBlocking).toBe(true);
    expect(res.requiresManagerApproval).toBe(true);
    expect(res.anomalyIds.length).toBeGreaterThan(0);

    const row = await anomalyRepo.findOne({ where: { id: res.anomalyIds[0] } });
    expect(row).not.toBeNull();
    expect(row!.status).toBe('detected');
    expect(row!.storeId).toBe(storeId);
  });

  it('product lookup is tenant-scoped: same productId evaluated for another store finds no cost → COST_MISSING, not below-cost', async () => {
    const res = await service.evaluate({
      storeId: otherStoreId,
      sellerId: SELLER,
      items: [{ productId, quantity: 1, sellPriceMinorUnits: 200 }],
    });
    expect(res.results.some((r) => r.code === 'SALE_BELOW_COST')).toBe(false);
    expect(res.results.some((r) => r.code === 'COST_MISSING')).toBe(true);
    expect(res.hasBlocking).toBe(false);
  });

  it('listAnomalies filters by store + severity, newest first, with a real total count', async () => {
    const page = await service.listAnomalies({ storeId, severity: 'critical', page: 1, limit: 10 } as any);
    expect(page.total).toBeGreaterThanOrEqual(1);
    expect(page.data.every((a) => a.storeId === storeId && a.severity === 'critical')).toBe(true);
    const times = page.data.map((a) => new Date(a.createdAt).getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times); // DESC
    // other store's anomalies are excluded
    const other = await service.listAnomalies({ storeId: otherStoreId } as any);
    expect(other.data.every((a) => a.storeId === otherStoreId)).toBe(true);
  });

  it('getSummary groups counts by code and severity (grouped SQL, per store)', async () => {
    const summary = await service.getSummary(storeId);
    expect(summary.byCode.SALE_BELOW_COST).toBeGreaterThanOrEqual(1);
    expect(summary.bySeverity.critical).toBeGreaterThanOrEqual(1);
    expect(summary.total).toBe(
      Object.values(summary.byCode).reduce((s, n) => s + n, 0),
    );
    const otherSummary = await service.getSummary(otherStoreId);
    expect(otherSummary.byCode.SALE_BELOW_COST).toBeUndefined();
  });

  it("review state machine: detected → approved once; a second transition is rejected; unknown id → 404", async () => {
    const target = (await service.listAnomalies({ storeId } as any)).data[0];
    const approved = await service.approveAnomaly(target.id, SELLER);
    expect(approved.status).toBe('approved');
    expect(approved.reviewedBy).toBe(SELLER);
    await expect(service.ignoreAnomaly(target.id, SELLER)).rejects.toThrow(BadRequestException);
    await expect(service.approveAnomaly(uuidv4(), SELLER)).rejects.toThrow(NotFoundException);
  });
});
