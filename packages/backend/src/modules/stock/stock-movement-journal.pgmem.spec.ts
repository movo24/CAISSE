import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { createPgMemDataSource } from '../../../test/helpers/pgmem';
import {
  ensureStoreLocation,
  recordSaleMovements,
  recordReturnMovements,
  recordAdjustMovement,
  journalNetQuantities,
  storeLocationCode,
} from './stock-movement-journal';
import { StockMovementEntity } from '../../database/entities/stock-movement.entity';
import { StockLocationEntity } from '../../database/entities/stock-location.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { StoreEntity } from '../../database/entities/store.entity';

// PAQUET 306 (cycle E) — option 1 du dossier STOCK_UNIFICATION_DECISION.md :
// le journal append-only alimenté par les faits caisse, prouvé sur SQL réel.

describe('stock-movement-journal (pg-mem) — option 1', () => {
  let dataSource: DataSource;
  let storeId: string;
  let productId: string;

  beforeAll(async () => {
    const built = createPgMemDataSource();
    dataSource = built.dataSource;
    await dataSource.initialize();
    const storeRepo = dataSource.getRepository(StoreEntity);
    storeId = (await storeRepo.save(storeRepo.create({ name: 'Wesley Journal' }))).id;
    const productRepo = dataSource.getRepository(ProductEntity);
    productId = (
      await productRepo.save(
        productRepo.create({ ean: 'E-J1', name: 'Sucette journal', priceMinorUnits: 100, stockQuantity: 50, storeId } as Partial<ProductEntity>),
      )
    ).id;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('ensureStoreLocation is lazy and idempotent: one location per store, stable across calls', async () => {
    const a = await ensureStoreLocation(dataSource.manager, storeId, 'Wesley Journal');
    const b = await ensureStoreLocation(dataSource.manager, storeId);
    expect(a.id).toBe(b.id);
    expect(a.type).toBe('store');
    expect(a.storeId).toBe(storeId);
    expect(a.code).toBe(storeLocationCode(storeId));
    expect(await dataSource.getRepository(StockLocationEntity).countBy({ storeId } as any)).toBe(1);
  });

  it('sale → from=store/to=null ; return → from=null/to=store ; adjust suit le signe du delta', async () => {
    const actor = { employeeId: 'emp-1', employeeName: 'Alice' };
    await recordSaleMovements(dataSource.manager, {
      storeId, actor, ticketNumber: 'T-J-1',
      items: [{ productId, quantity: 3 }],
    });
    await recordReturnMovements(dataSource.manager, {
      storeId, actor, creditNoteCode: 'AV-J-1',
      items: [{ productId, quantity: 1 }, { productId: null, quantity: 5 }], // ligne sans produit ignorée
    });
    await recordAdjustMovement(dataSource.manager, { storeId, actor, productId, deltaQuantity: +10, reason: 'réception' });
    await recordAdjustMovement(dataSource.manager, { storeId, actor, productId, deltaQuantity: -2, reason: 'casse' });
    await recordAdjustMovement(dataSource.manager, { storeId, actor, productId, deltaQuantity: 0, reason: 'no-op' }); // rien

    const rows = await dataSource.getRepository(StockMovementEntity).find({ order: { createdAt: 'ASC' } as any });
    expect(rows).toHaveLength(4);
    const [sale, ret, plus, minus] = rows;
    expect([sale.movementType, sale.fromLocationId !== null, sale.toLocationId]).toEqual(['sale', true, null]);
    expect(sale.reference).toBe('T-J-1');
    expect([ret.movementType, ret.fromLocationId, ret.toLocationId !== null]).toEqual(['return_customer', null, true]);
    expect([plus.movementType, plus.toLocationId !== null]).toEqual(['inventory_adjust', true]);
    expect([minus.movementType, minus.fromLocationId !== null]).toEqual(['inventory_adjust', true]);
    expect(rows.every((r) => r.quantity > 0)).toBe(true); // quantités toujours positives (direction = from/to)
  });

  it('projection reconstruite : net = Σ(entrées) − Σ(sorties) par produit', async () => {
    const loc = await ensureStoreLocation(dataSource.manager, storeId);
    const net = await journalNetQuantities(dataSource.manager, loc.id);
    // -3 (vente) +1 (retour) +10 (adjust) -2 (adjust) = +6
    expect(net[productId]).toBe(6);
  });

  it('les items sans produit ou quantité nulle ne créent JAMAIS de mouvement', async () => {
    const before = await dataSource.getRepository(StockMovementEntity).count();
    await recordSaleMovements(dataSource.manager, {
      storeId, actor: { employeeId: 'e' }, ticketNumber: 'T-J-2',
      items: [{ productId: '', quantity: 3 }, { productId: uuidv4(), quantity: 0 }],
    });
    expect(await dataSource.getRepository(StockMovementEntity).count()).toBe(before);
  });
});
