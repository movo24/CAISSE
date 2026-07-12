/**
 * Bloc 6 (POS mission) — multi-location stock subsystem. This coverage was
 * ABSENT: the StockLocationsService (receive / transfer / dispatch / movement
 * journal) shipped with entities + migration 1735 but no end-to-end test. This
 * exercises the real flow (receive → transfer → journal → balances) and the
 * insufficient-stock guard, proving the subsystem the migration unblocks.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { ProductEntity } from '../src/database/entities/product.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { StockLocationEntity } from '../src/database/entities/stock-location.entity';
import { StockBalanceEntity } from '../src/database/entities/stock-balance.entity';
import { StockMovementEntity } from '../src/database/entities/stock-movement.entity';
import { AuditEntryEntity } from '../src/database/entities/audit-entry.entity';
import { AuditService } from '../src/modules/audit/audit.service';
import { StockLocationsService } from '../src/modules/stock-locations/stock-locations.service';

describe('Bloc 6 — multi-location stock (runnable via migration 1735)', () => {
  let ds: DataSource;
  let svc: StockLocationsService;
  const STORE = uuidv4();
  const P1 = uuidv4();
  let central: StockLocationEntity;
  let store: StockLocationEntity;
  const actor = { employeeId: uuidv4(), employeeName: 'Alice' };

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'B43', isActive: true, currencyCode: 'EUR' } as any);
    await ds.getRepository(ProductEntity).save({
      id: P1, ean: '3600000000017', name: 'Bonbon', priceMinorUnits: 500, taxRate: 20, storeId: STORE,
    } as any);

    svc = new StockLocationsService(
      ds.getRepository(StockLocationEntity),
      ds.getRepository(StockBalanceEntity),
      ds.getRepository(StockMovementEntity),
      ds.getRepository(ProductEntity),
      ds,
      new AuditService(ds.getRepository(AuditEntryEntity), ds),
    );
    central = await svc.createLocation({ name: 'Entrepôt', code: 'CENTRAL-001', type: 'central' });
    store = await svc.createLocation({ name: 'B43', code: 'B43-LOC', type: 'store', storeId: STORE });
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('DECISIVE — receiveFromSupplier creates the balance AND an immutable journal movement', async () => {
    await svc.receiveFromSupplier({
      productId: P1, locationId: central.id, quantity: 100, reference: 'BL-42', ...actor,
    });
    expect(await svc.getBalance(P1, central.id)).toBe(100);
    const moves = await svc.getMovements(P1);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ movementType: 'supplier_receipt', toLocationId: central.id, quantity: 100 });
    // legacy products.stock_quantity mirrors STORE-floor stock only — a central
    // warehouse receipt is not yet on any shop floor, so it stays 0 (correct).
    expect((await ds.getRepository(ProductEntity).findOneByOrFail({ id: P1 })).stockQuantity).toBe(0);
  });

  it('DECISIVE — transfer central→store moves qty on both balances + a transfer movement', async () => {
    await svc.transfer({
      productId: P1, fromLocationId: central.id, toLocationId: store.id, quantity: 30, ...actor,
    });
    expect(await svc.getBalance(P1, central.id)).toBe(70);
    expect(await svc.getBalance(P1, store.id)).toBe(30);
    const moves = await svc.getMovements(P1);
    expect(moves).toHaveLength(2);
    expect(moves[0]).toMatchObject({ movementType: 'transfer', fromLocationId: central.id, toLocationId: store.id, quantity: 30 });
    // now 30 units ARE on the shop floor → legacy store stock reflects it
    expect((await ds.getRepository(ProductEntity).findOneByOrFail({ id: P1 })).stockQuantity).toBe(30);
  });

  it('getNetworkStock reports both locations for the product', async () => {
    const rows = await svc.getNetworkStock();
    const byLoc = Object.fromEntries(rows.filter((r) => r.productId === P1).map((r) => [r.locationCode, r.quantity]));
    expect(byLoc['CENTRAL-001']).toBe(70);
    expect(byLoc['B43-LOC']).toBe(30);
  });

  it('ADVERSE — transfer beyond available stock is rejected (no movement, balances unchanged)', async () => {
    await expect(
      svc.transfer({ productId: P1, fromLocationId: store.id, toLocationId: central.id, quantity: 999, ...actor }),
    ).rejects.toThrow(/Insufficient stock/);
    expect(await svc.getBalance(P1, store.id)).toBe(30); // untouched
    expect(await svc.getMovements(P1)).toHaveLength(2); // no new journal row
  });

  it('ADVERSE — duplicate location code is rejected', async () => {
    await expect(svc.createLocation({ name: 'dup', code: 'CENTRAL-001', type: 'central' })).rejects.toThrow(/already exists/);
  });

  it('SECURITY — a non-admin from another store cannot move this store\'s product (tenant guard)', async () => {
    const before = await svc.getBalance(P1, store.id);
    // A manager whose JWT store is a DIFFERENT store tries to transfer P1 (store STORE).
    await expect(
      svc.transfer({
        productId: P1, fromLocationId: store.id, toLocationId: central.id, quantity: 1,
        ...actor, actorStoreId: uuidv4(), actorRole: 'manager',
      }),
    ).rejects.toThrow(/n'appartient pas à votre magasin/);
    expect(await svc.getBalance(P1, store.id)).toBe(before); // untouched
    // The legitimate owner (same store) is still allowed.
    await svc.transfer({
      productId: P1, fromLocationId: store.id, toLocationId: central.id, quantity: 1,
      ...actor, actorStoreId: STORE, actorRole: 'manager',
    });
    expect(await svc.getBalance(P1, store.id)).toBe(before - 1);
    // An admin bypasses the store scope entirely.
    await svc.transfer({
      productId: P1, fromLocationId: central.id, toLocationId: store.id, quantity: 1,
      ...actor, actorStoreId: uuidv4(), actorRole: 'admin',
    });
    expect(await svc.getBalance(P1, store.id)).toBe(before);
  });

  it('Bloc 6.2 — recordLoss decrements the location balance + writes a loss journal movement', async () => {
    const beforeStore = await svc.getBalance(P1, store.id); // 30 on the shop floor
    const m = await svc.recordLoss({
      productId: P1, locationId: store.id, quantity: 4, lossType: 'loss_breakage', reason: 'cartons écrasés', ...actor,
    });
    expect(m.movementType).toBe('loss_breakage');
    expect(m.fromLocationId).toBe(store.id);
    expect(m.toLocationId).toBeNull();
    expect(await svc.getBalance(P1, store.id)).toBe(beforeStore - 4);
    const moves = await svc.getMovements(P1);
    expect(moves[0]).toMatchObject({ movementType: 'loss_breakage', quantity: 4, reason: 'cartons écrasés' });
  });

  it('ADVERSE — a loss without a reason, with a bad type, or over available is rejected', async () => {
    await expect(svc.recordLoss({ productId: P1, locationId: store.id, quantity: 1, lossType: 'loss_theft', reason: '  ', ...actor })).rejects.toThrow(/reason/);
    await expect(svc.recordLoss({ productId: P1, locationId: store.id, quantity: 1, lossType: 'bogus' as any, reason: 'x', ...actor })).rejects.toThrow(/Invalid loss type/);
    await expect(svc.recordLoss({ productId: P1, locationId: store.id, quantity: 9999, lossType: 'loss_theft', reason: 'vol', ...actor })).rejects.toThrow(/Insufficient stock to write off/);
  });

  it('M107 — findStockDivergences reports legacy vs balances mismatches (read-only, no mutation)', async () => {
    const pRepo = ds.getRepository(ProductEntity);
    const bRepo = ds.getRepository(StockBalanceEntity);
    // Diverged: legacy column 100 but a location balance of 70 (set directly to bypass syncLegacyStock).
    const pDiv = await pRepo.save({ id: uuidv4(), storeId: STORE, ean: 'DIV-1', name: 'Diverged', priceMinorUnits: 500, taxRate: 20, stockQuantity: 100, isActive: true } as any);
    await bRepo.save({ productId: pDiv.id, locationId: store.id, quantity: 70 } as any);
    // Aligned: legacy 50 == balance 50 → must NOT be reported.
    const pOk = await pRepo.save({ id: uuidv4(), storeId: STORE, ean: 'OK-1', name: 'Aligned', priceMinorUnits: 500, taxRate: 20, stockQuantity: 50, isActive: true } as any);
    await bRepo.save({ productId: pOk.id, locationId: store.id, quantity: 50 } as any);
    // Legacy-only (no balance row) → not a divergence, simply not multi-location.
    const pLegacy = await pRepo.save({ id: uuidv4(), storeId: STORE, ean: 'LEG-1', name: 'LegacyOnly', priceMinorUnits: 500, taxRate: 20, stockQuantity: 30, isActive: true } as any);

    const report = await svc.findStockDivergences(STORE);
    const ids = report.map((r) => r.productId);
    expect(ids).toContain(pDiv.id);
    expect(ids).not.toContain(pOk.id);
    expect(ids).not.toContain(pLegacy.id);
    const div = report.find((r) => r.productId === pDiv.id)!;
    expect(div).toMatchObject({ legacyQuantity: 100, balancesQuantity: 70, delta: 30 });
    // read-only: the report did not change the product's stock
    expect((await pRepo.findOneByOrFail({ id: pDiv.id })).stockQuantity).toBe(100);
  });
});

/**
 * D20 — the 4 movement methods used to leave NO audit trail (AuditService was
 * injected but never called). This proves each committed movement now writes an
 * applicative audit entry (out-of-band, best-effort, per D16/D17), correctly
 * tenant-scoped to the product's store, AND that an audit failure never rolls
 * back or fails a movement that already committed.
 */
describe('D20 — stock movements write an applicative audit trail', () => {
  let ds: DataSource;
  let svc: StockLocationsService;
  let auditRepo: ReturnType<DataSource['getRepository']>;
  const STORE = uuidv4();
  const P1 = uuidv4();
  let central: StockLocationEntity;
  let storeA: StockLocationEntity;
  let storeB: StockLocationEntity;
  const actor = { employeeId: uuidv4(), employeeName: 'Bob' };

  const auditsFor = async (action: string) =>
    (auditRepo as any).find({ where: { storeId: STORE, action }, order: { timestamp: 'ASC' } });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    auditRepo = ds.getRepository(AuditEntryEntity);
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'D20', isActive: true, currencyCode: 'EUR' } as any);
    await ds.getRepository(ProductEntity).save({
      id: P1, ean: '3600000009999', name: 'Réglisse', priceMinorUnits: 500, taxRate: 20, storeId: STORE,
    } as any);
    svc = new StockLocationsService(
      ds.getRepository(StockLocationEntity),
      ds.getRepository(StockBalanceEntity),
      ds.getRepository(StockMovementEntity),
      ds.getRepository(ProductEntity),
      ds,
      new AuditService(ds.getRepository(AuditEntryEntity), ds),
    );
    central = await svc.createLocation({ name: 'Entrepôt D20', code: 'D20-CENTRAL', type: 'central' });
    storeA = await svc.createLocation({ name: 'D20 A', code: 'D20-A', type: 'store', storeId: STORE });
    storeB = await svc.createLocation({ name: 'D20 B', code: 'D20-B', type: 'store', storeId: STORE });
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('receiveFromSupplier writes a stock_supplier_receipt audit entry (old/new balance, actor, tenant)', async () => {
    await svc.receiveFromSupplier({ productId: P1, locationId: central.id, quantity: 100, reference: 'BL-77', ...actor });
    const entries = await auditsFor('stock_supplier_receipt');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ storeId: STORE, employeeId: actor.employeeId, entityType: 'stock_movement' });
    expect(entries[0].details).toMatchObject({
      movementType: 'supplier_receipt', toLocationId: central.id, quantity: 100,
      oldBalance: 0, newBalance: 100, reference: 'BL-77',
    });
  });

  it('transfer writes a stock_transfer audit entry with both balances before/after', async () => {
    await svc.transfer({ productId: P1, fromLocationId: central.id, toLocationId: storeA.id, quantity: 40, ...actor });
    const entries = await auditsFor('stock_transfer');
    expect(entries).toHaveLength(1);
    expect(entries[0].details).toMatchObject({
      movementType: 'transfer', fromLocationId: central.id, toLocationId: storeA.id, quantity: 40,
      fromOldBalance: 100, fromNewBalance: 60, toOldBalance: 0, toNewBalance: 40,
    });
  });

  it('recordLoss writes a stock_loss audit entry with lossType, reason and balance delta', async () => {
    await svc.recordLoss({ productId: P1, locationId: storeA.id, quantity: 5, lossType: 'loss_breakage', reason: 'cartons écrasés', ...actor });
    const entries = await auditsFor('stock_loss');
    expect(entries).toHaveLength(1);
    expect(entries[0].details).toMatchObject({
      movementType: 'loss_breakage', lossType: 'loss_breakage', fromLocationId: storeA.id,
      quantity: 5, oldBalance: 40, newBalance: 35, reason: 'cartons écrasés',
    });
  });

  it('dispatch writes a single stock_dispatch audit entry listing all destinations', async () => {
    await svc.dispatch({
      productId: P1, fromLocationId: central.id,
      dispatches: [{ toLocationId: storeA.id, quantity: 10 }, { toLocationId: storeB.id, quantity: 20 }],
      reference: 'DISP-1', ...actor,
    });
    const entries = await auditsFor('stock_dispatch');
    expect(entries).toHaveLength(1);
    expect(entries[0].entityType).toBe('stock_movement');
    expect(entries[0].details).toMatchObject({
      movementType: 'dispatch', fromLocationId: central.id, totalQuantity: 30,
      fromOldBalance: 60, fromNewBalance: 30, reference: 'DISP-1',
    });
    expect((entries[0].details as any).dispatches).toEqual([
      { toLocationId: storeA.id, quantity: 10 }, { toLocationId: storeB.id, quantity: 20 },
    ]);
    expect((entries[0].details as any).movementIds).toHaveLength(2);
  });

  it('ADVERSE — a rejected movement (insufficient stock) writes NO audit entry', async () => {
    const before = await (auditRepo as any).count({ where: { storeId: STORE } });
    await expect(
      svc.recordLoss({ productId: P1, locationId: storeA.id, quantity: 99999, lossType: 'loss_theft', reason: 'vol', ...actor }),
    ).rejects.toThrow(/Insufficient stock/);
    expect(await (auditRepo as any).count({ where: { storeId: STORE } })).toBe(before);
  });

  it('BEST-EFFORT — an audit failure never rolls back or fails a committed movement', async () => {
    const throwingAudit = { log: jest.fn().mockRejectedValue(new Error('audit down')) } as any;
    const svc2 = new StockLocationsService(
      ds.getRepository(StockLocationEntity),
      ds.getRepository(StockBalanceEntity),
      ds.getRepository(StockMovementEntity),
      ds.getRepository(ProductEntity),
      ds,
      throwingAudit,
    );
    const balBefore = await svc2.getBalance(P1, central.id);
    // The movement must still succeed and commit despite the audit throwing.
    const m = await svc2.receiveFromSupplier({ productId: P1, locationId: central.id, quantity: 7, ...actor });
    expect(m.movementType).toBe('supplier_receipt');
    expect(await svc2.getBalance(P1, central.id)).toBe(balBefore + 7);
    expect(throwingAudit.log).toHaveBeenCalledTimes(1);
  });
});
