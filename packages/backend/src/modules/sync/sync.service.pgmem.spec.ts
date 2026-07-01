import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { BadRequestException } from '@nestjs/common';

import { createPgMemDataSource } from '../../../test/helpers/pgmem';
import { SyncService, SyncPushPayload } from './sync.service';
import { SaleEntity } from '../../database/entities/sale.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { StoreEntity } from '../../database/entities/store.entity';

// PAQUET 280 — SyncService against a real in-memory Postgres (pg-mem):
// the OFFLINE REPLAY invariant proven on real SQL — a re-pushed payload must
// never duplicate a sale (batch dedup by client id), sales without a client id
// are rejected (never inserted), customer conflicts go server-wins, stock
// deltas are tenant-scoped, and pull is incremental (updatedAt > lastSyncAt).
// Note: the stock delta SQL uses `+ :param` (commutative), so the documented
// pg-mem operand-swap bug on `- :param` does not affect this suite.

describe('SyncService (pg-mem)', () => {
  let dataSource: DataSource;
  let salesRepo: Repository<SaleEntity>;
  let productRepo: Repository<ProductEntity>;
  let customerRepo: Repository<CustomerEntity>;
  let service: SyncService;
  const auditLog = jest.fn().mockResolvedValue(undefined);

  let storeId: string;
  let otherStoreId: string;

  const mkSale = (over: Partial<SaleEntity> = {}): Partial<SaleEntity> => ({
    id: uuidv4(),
    storeId,
    employeeId: uuidv4(),
    status: 'completed',
    ticketNumber: `T-${uuidv4().slice(0, 12)}`,
    totalMinorUnits: 500,
    ...over,
  });

  const basePayload = (over: Partial<SyncPushPayload> = {}): SyncPushPayload => ({
    storeId,
    deviceId: 'pos-1',
    lastSyncAt: new Date(Date.now() - 3600_000).toISOString(),
    sales: [],
    customers: [],
    stockAdjustments: [],
    ...over,
  });

  beforeAll(async () => {
    const built = createPgMemDataSource();
    dataSource = built.dataSource;
    await dataSource.initialize();
    salesRepo = dataSource.getRepository(SaleEntity);
    productRepo = dataSource.getRepository(ProductEntity);
    customerRepo = dataSource.getRepository(CustomerEntity);
    service = new SyncService(
      salesRepo,
      productRepo,
      customerRepo,
      dataSource,
      { log: auditLog } as any, // audit hash-chain has its own suites
    );
    const storeRepo = dataSource.getRepository(StoreEntity);
    storeId = (await storeRepo.save(storeRepo.create({ name: 'Wesley' }))).id;
    otherStoreId = (await storeRepo.save(storeRepo.create({ name: 'Other' }))).id;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('OFFLINE REPLAY invariant: re-pushing the same sales payload never creates a duplicate sale', async () => {
    const sales = [mkSale(), mkSale()];
    const payload = basePayload({ sales });

    const first = await service.push(payload);
    expect(first.accepted).toBe(2);
    expect(await salesRepo.countBy({ storeId })).toBe(2);

    const replay = await service.push(payload); // network retry / double submission
    expect(replay.accepted).toBe(0); // all deduped by client id
    expect(await salesRepo.countBy({ storeId })).toBe(2); // STILL 2 — no duplicate money
  });

  it('a sale WITHOUT a client id is rejected (rejected_no_id), reported, and never inserted', async () => {
    const before = await salesRepo.count();
    const res = await service.push(
      basePayload({ sales: [{ ...mkSale(), id: undefined } as any] }),
    );
    expect(res.accepted).toBe(0);
    expect(res.conflicts).toEqual([
      expect.objectContaining({ entity: 'sale', resolution: 'rejected_no_id' }),
    ]);
    expect(await salesRepo.count()).toBe(before);
  });

  it('customer conflict is server-wins: a server row updated AFTER lastSyncAt is not overwritten', async () => {
    const customer = await customerRepo.save(
      customerRepo.create({
        firstName: 'Ada', lastName: 'L', qrCode: `QR-${uuidv4().slice(0, 8)}`,
        storeId, loyaltyPoints: 100,
      } as Partial<CustomerEntity>),
    );
    // lastSyncAt BEFORE the server row's updatedAt → offline copy is stale
    const res = await service.push(
      basePayload({
        lastSyncAt: new Date(Date.now() - 3600_000).toISOString(),
        customers: [{ id: customer.id, loyaltyPoints: 5 }],
      }),
    );
    expect(res.conflicts.some((c) => c.resolution === 'server_wins')).toBe(true);
    expect((await customerRepo.findOneBy({ id: customer.id }))!.loyaltyPoints).toBe(100); // untouched
  });

  it('stock deltas are applied tenant-scoped and non-integer deltas are refused (400) before any write', async () => {
    const p = await productRepo.save(
      productRepo.create({ ean: `e-${uuidv4().slice(0, 8)}`, name: 'p', priceMinorUnits: 100, stockQuantity: 10, storeId } as Partial<ProductEntity>),
    );
    await service.push(basePayload({ stockAdjustments: [{ productId: p.id, delta: 5, reason: 'recount' }] }));
    expect((await productRepo.findOneBy({ id: p.id }))!.stockQuantity).toBe(15);

    // wrong store → row untouched
    await service.push(basePayload({ storeId: otherStoreId, stockAdjustments: [{ productId: p.id, delta: 5, reason: 'x' }] }));
    expect((await productRepo.findOneBy({ id: p.id }))!.stockQuantity).toBe(15);

    await expect(
      service.push(basePayload({ stockAdjustments: [{ productId: p.id, delta: 1.5 as any, reason: 'x' }] })),
    ).rejects.toThrow(BadRequestException);
    expect((await productRepo.findOneBy({ id: p.id }))!.stockQuantity).toBe(15);
  });

  it('pull is incremental and tenant-scoped: only rows updated after lastSyncAt, only this store', async () => {
    const cutoff = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5)); // ensure updatedAt > cutoff
    const fresh = await productRepo.save(
      productRepo.create({ ean: `e-${uuidv4().slice(0, 8)}`, name: 'fresh', priceMinorUnits: 100, storeId } as Partial<ProductEntity>),
    );
    await productRepo.save(
      productRepo.create({ ean: `e-${uuidv4().slice(0, 8)}`, name: 'foreign', priceMinorUnits: 100, storeId: otherStoreId } as Partial<ProductEntity>),
    );

    const res = await service.pull(storeId, cutoff);
    expect(res.products.map((p) => p.id)).toEqual([fresh.id]); // old + foreign excluded
    expect(res.products.every((p) => p.storeId === storeId)).toBe(true);
  });
});
