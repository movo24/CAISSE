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
});
