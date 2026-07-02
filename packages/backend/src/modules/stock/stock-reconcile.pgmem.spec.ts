import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { createPgMemDataSource } from '../../../test/helpers/pgmem';
import { reconcileStoreStock } from './stock-reconcile';
import { ensureStoreLocation, recordSaleMovements, recordReturnMovements } from './stock-movement-journal';
import { ProductEntity } from '../../database/entities/product.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { StockBalanceEntity } from '../../database/entities/stock-balance.entity';

// P308 (cycle F) — read-only reconciliation of the three stock views, on real SQL.

describe('reconcileStoreStock (pg-mem)', () => {
  let dataSource: DataSource;
  let storeId: string;
  let emptyStoreId: string;
  let pJournaled: string;
  let pDrifting: string;
  let pQuiet: string;

  beforeAll(async () => {
    const built = createPgMemDataSource();
    dataSource = built.dataSource;
    await dataSource.initialize();
    const stores = dataSource.getRepository(StoreEntity);
    const products = dataSource.getRepository(ProductEntity);
    storeId = (await stores.save(stores.create({ name: 'Wesley' }))).id;
    emptyStoreId = (await stores.save(stores.create({ name: 'SansLocation' }))).id;

    const mk = (name: string, qty: number) =>
      products.save(
        products.create({ ean: `E-${name}`, name, priceMinorUnits: 100, stockQuantity: qty, storeId } as Partial<ProductEntity>),
      );
    pJournaled = (await mk('journalisé', 40)).id;
    pDrifting = (await mk('en-dérive', 10)).id;
    pQuiet = (await mk('sans-mouvement', 7)).id;

    const loc = await ensureStoreLocation(dataSource.manager, storeId, 'Wesley');
    const actor = { employeeId: 'emp-1', employeeName: 'Alice' };
    // journal: -3 (vente) +1 (retour) sur pJournaled → net -2
    await recordSaleMovements(dataSource.manager, { storeId, actor, ticketNumber: 'T-R-1', items: [{ productId: pJournaled, quantity: 3 }] });
    await recordReturnMovements(dataSource.manager, { storeId, actor, creditNoteCode: 'AV-R-1', items: [{ productId: pJournaled, quantity: 1 }] });
    // balance legacy: pDrifting a une balance B = 25 alors que le compteur A = 10 → drift +15
    const balances = dataSource.getRepository(StockBalanceEntity);
    await balances.save(balances.create({ productId: pDrifting, locationId: loc.id, quantity: 25 } as Partial<StockBalanceEntity>));
    // et une balance ALIGNÉE sur pJournaled (40) → drift 0
    await balances.save(balances.create({ productId: pJournaled, locationId: loc.id, quantity: 40 } as Partial<StockBalanceEntity>));
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('exposes the three views per product: counter, journal net (P306+ only), legacy balance + drift', async () => {
    const report = await reconcileStoreStock(dataSource.manager, storeId);
    expect(report.locationId).not.toBeNull();
    const byId = Object.fromEntries(report.rows.map((r) => [r.productId, r]));

    expect(byId[pJournaled]).toMatchObject({ counter: 40, journalNet: -2, balance: 40, balanceDrift: 0 });
    expect(byId[pDrifting]).toMatchObject({ counter: 10, journalNet: null, balance: 25, balanceDrift: 15 });
    expect(byId[pQuiet]).toMatchObject({ counter: 7, journalNet: null, balance: null, balanceDrift: null });
    expect(report.driftCount).toBe(1); // seul pDrifting diverge
  });

  it('a store without any stock_location yields locationId null and only counters (no crash)', async () => {
    const products = dataSource.getRepository(ProductEntity);
    await products.save(
      products.create({ ean: 'E-lonely', name: 'Solo', priceMinorUnits: 100, stockQuantity: 3, storeId: emptyStoreId } as Partial<ProductEntity>),
    );
    const report = await reconcileStoreStock(dataSource.manager, emptyStoreId);
    expect(report.locationId).toBeNull();
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ counter: 3, journalNet: null, balance: null });
    expect(report.driftCount).toBe(0);
  });

  it("is tenant-scoped: the report never contains another store's products", async () => {
    const report = await reconcileStoreStock(dataSource.manager, storeId);
    expect(report.rows.some((r) => r.productName === 'Solo')).toBe(false);
  });
});
