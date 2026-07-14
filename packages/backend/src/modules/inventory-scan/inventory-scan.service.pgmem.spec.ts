import { DataSource, Repository } from 'typeorm';

import { createPgMemDataSource } from '../../../test/helpers/pgmem';
import { InventoryScanService } from './inventory-scan.service';
import { InventoryScanEntity } from '../../database/entities/inventory-scan.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { StoreEntity } from '../../database/entities/store.entity';

// PAQUET 301 (bloc D1) — InventoryScanService against a real in-memory
// Postgres: idempotent replay (clientEntryId), tenant-scoped barcode lookup,
// matched/new classification, ATOMIC apply-to-stock (absolute vs delta modes,
// pessimistic lock, skip unmatched), filtered listing and session stats.
// stockService is not used by the paths under test (kept as inert fake).

describe('InventoryScanService (pg-mem)', () => {
  let dataSource: DataSource;
  let scanRepo: Repository<InventoryScanEntity>;
  let productRepo: Repository<ProductEntity>;
  let service: InventoryScanService;

  let storeId: string;
  let otherStoreId: string;
  let noCodeStoreId: string;
  let productId: string;

  beforeAll(async () => {
    const built = createPgMemDataSource();
    dataSource = built.dataSource;
    await dataSource.initialize();
    scanRepo = dataSource.getRepository(InventoryScanEntity);
    productRepo = dataSource.getRepository(ProductEntity);
    const storeRepo = dataSource.getRepository(StoreEntity);
    service = new InventoryScanService(
      scanRepo,
      productRepo,
      storeRepo,
      {} as any, // StockService: not exercised by recordScan/applyScansToStock
      dataSource,
    );

    storeId = (await storeRepo.save(storeRepo.create({ name: 'Wesley', storeCode: 'WSL-1' }))).id;
    otherStoreId = (await storeRepo.save(storeRepo.create({ name: 'Other', storeCode: 'OTH-1' }))).id;
    noCodeStoreId = (await storeRepo.save(storeRepo.create({ name: 'SansCode' }))).id;

    productId = (
      await productRepo.save(
        productRepo.create({
          ean: 'EAN-SCAN-1', name: 'Dragée inventaire', priceMinorUnits: 100,
          stockQuantity: 40, storeId,
        } as Partial<ProductEntity>),
      )
    ).id;
    // same barcode in the OTHER store — must never match a scan for storeId
    await productRepo.save(
      productRepo.create({
        ean: 'EAN-FOREIGN', name: 'Produit voisin', priceMinorUnits: 100,
        stockQuantity: 5, storeId: otherStoreId,
      } as Partial<ProductEntity>),
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('refuses a store without store_code; unknown store → not found', async () => {
    await expect(
      service.recordScan(noCodeStoreId, 'emp-1', { barcode: 'EAN-SCAN-1' } as any),
    ).rejects.toThrow(/code magasin/);
    await expect(
      service.recordScan('00000000-0000-4000-8000-000000000000', 'emp-1', { barcode: 'x' } as any),
    ).rejects.toThrow();
  });

  it('classifies matched vs new, and the barcode lookup is TENANT-scoped (foreign-store EAN = new)', async () => {
    const matched = await service.recordScan(storeId, 'emp-1', { barcode: 'EAN-SCAN-1', quantity: 3, scanType: 'inventory', sessionId: '11111111-1111-4111-8111-111111111111' } as any);
    expect(matched.status).toBe('matched');
    expect(matched.productId).toBe(productId);
    expect(matched.storeCode).toBe('WSL-1');

    const foreign = await service.recordScan(storeId, 'emp-1', { barcode: 'EAN-FOREIGN', sessionId: '11111111-1111-4111-8111-111111111111' } as any);
    expect(foreign.status).toBe('new'); // exists ONLY in the other store → not matched here
    expect(foreign.productId).toBeNull();
  });

  it('idempotent replay: same clientEntryId returns the SAME row, no duplicate scan', async () => {
    const dto = { barcode: 'EAN-SCAN-1', quantity: 2, clientEntryId: 'client-42', sessionId: '11111111-1111-4111-8111-111111111111' } as any;
    const first = await service.recordScan(storeId, 'emp-1', dto);
    const replay = await service.recordScan(storeId, 'emp-1', dto);
    expect(replay.id).toBe(first.id);
    expect(await scanRepo.countBy({ clientEntryId: 'client-42' } as any)).toBe(1);
  });

  it('applyScansToStock: inventory = ABSOLUTE recount, applied atomically; unmatched scans skipped; re-apply is a no-op', async () => {
    // 11111111-1111-4111-8111-111111111111 currently holds: matched(qty 3, inventory), new(EAN-FOREIGN), matched replayed (qty 2, client-42)
    const res = await service.applyScansToStock(storeId, 'emp-1', '11111111-1111-4111-8111-111111111111');
    expect(res.applied).toBe(2); // the two matched scans
    // the 'new' scan is not even selected (WHERE status='matched') — it stays 'new'
    expect(res.skipped).toBe(0);
    expect((await scanRepo.findBy({ status: 'new' } as any)).length).toBeGreaterThanOrEqual(1);

    const p = (await productRepo.findOneBy({ id: productId }))!;
    expect(p.stockQuantity).toBe(2); // absolute mode: last recount wins (client-42 qty 2)

    const again = await service.applyScansToStock(storeId, 'emp-1', '11111111-1111-4111-8111-111111111111');
    expect(again).toEqual({ applied: 0, skipped: 0 }); // all already 'applied'
  });

  it('receiving scans are DELTA adjustments on top of the current quantity', async () => {
    await service.recordScan(storeId, 'emp-1', { barcode: 'EAN-SCAN-1', quantity: 10, scanType: 'receiving', sessionId: '22222222-2222-4222-8222-222222222222' } as any);
    const res = await service.applyScansToStock(storeId, 'emp-1', '22222222-2222-4222-8222-222222222222');
    expect(res.applied).toBe(1);
    expect((await productRepo.findOneBy({ id: productId }))!.stockQuantity).toBe(12); // 2 + 10
  });

  it('listScans filters by session/status and is tenant-scoped; session stats add up', async () => {
    const list = await service.listScans(storeId, { sessionId: '11111111-1111-4111-8111-111111111111', status: 'applied' });
    expect(list.length).toBe(2);
    expect(list.every((s) => s.storeId === storeId)).toBe(true);

    const stats = await service.getSessionStats(storeId, '11111111-1111-4111-8111-111111111111');
    expect(stats.total).toBe(3);
    expect(stats.applied).toBe(2);
    expect(stats.newProducts).toBe(1);
    expect(stats.pending).toBe(0);
  });
});
