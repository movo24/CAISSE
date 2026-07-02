import { DataSource } from 'typeorm';

import { createPgMemDataSource } from './helpers/pgmem';
import {
  planNormalizedNameBackfill,
  applyNormalizedNameBackfill,
} from '../src/scripts/backfill-normalized-names';
import { ProductEntity } from '../src/database/entities/product.entity';
import { StoreEntity } from '../src/database/entities/store.entity';

// P309 (cycle F) — TD-066-LEGACY-BACKFILL proven on real SQL: legacy rows with
// the weak lower(trim()) normalization get the accent-folded normalizeName(),
// idempotently, and SAME-STORE collisions are reported, never silently merged.

describe('backfill-normalized-names (pg-mem)', () => {
  let dataSource: DataSource;
  let storeId: string;
  let otherStoreId: string;

  beforeAll(async () => {
    const built = createPgMemDataSource();
    dataSource = built.dataSource;
    await dataSource.initialize();
    const stores = dataSource.getRepository(StoreEntity);
    storeId = (await stores.save(stores.create({ name: 'Wesley' }))).id;
    otherStoreId = (await stores.save(stores.create({ name: 'Other' }))).id;

    const products = dataSource.getRepository(ProductEntity);
    const mk = (over: Partial<ProductEntity>) =>
      products.save(products.create({ priceMinorUnits: 100, storeId, ...over } as Partial<ProductEntity>));

    // legacy 1722-style backfill: lower(trim(name)) — accents NOT folded
    await mk({ ean: 'L-1', name: 'Café Grand', normalizedName: 'café grand' } as any); // to fix → 'cafe grand'
    await mk({ ean: 'L-2', name: 'Nougat', normalizedName: 'nougat' } as any); // already correct
    await mk({ ean: 'L-3', name: 'Praliné  Doré', normalizedName: null } as any); // null → fix
    // SAME-STORE collision once accents fold: 'Berlingot' vs ' berlingot ' vs 'Bérlingot'
    await mk({ ean: 'L-4', name: 'Bérlingot', normalizedName: 'bérlingot' } as any);
    await mk({ ean: 'L-5', name: 'Berlingot', normalizedName: 'berlingot' } as any);
    // same name in ANOTHER store: NOT a collision (dedup is per store)
    await mk({ ean: 'L-6', name: 'Bérlingot', normalizedName: 'bérlingot', storeId: otherStoreId } as any);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('plans accent-folded fixes, counts correct rows, and quarantines same-store collisions', async () => {
    const plan = await planNormalizedNameBackfill(dataSource.manager);

    const fixes = Object.fromEntries(plan.toFix.map((f) => [f.name, f.to]));
    expect(fixes['Café Grand']).toBe('cafe grand');
    expect(fixes['Praliné  Doré']).toBe('praline dore'); // accents + whitespace folded
    expect(plan.alreadyCorrect).toBeGreaterThanOrEqual(1); // 'Nougat'

    // the two same-store Berlingot rows collide once folded → reported, NOT in toFix
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].normalized).toBe('berlingot');
    expect(plan.conflicts[0].ids).toHaveLength(2);
    expect(plan.toFix.some((f) => f.name.toLowerCase().includes('berlingot'))).toBe(false);
    // the other-store Bérlingot is fixable (no collision there)
    expect(plan.toFix.some((f) => f.storeId === otherStoreId)).toBe(true);
  });

  it('apply is idempotent: second run finds nothing left to fix (outside quarantined collisions)', async () => {
    const plan = await planNormalizedNameBackfill(dataSource.manager);
    const updated = await applyNormalizedNameBackfill(dataSource.manager, plan);
    expect(updated).toBe(plan.toFix.length);

    const again = await planNormalizedNameBackfill(dataSource.manager);
    expect(again.toFix).toHaveLength(0); // everything fixable is fixed
    expect(again.conflicts).toHaveLength(1); // collisions still quarantined for humans

    const cafe = await dataSource
      .getRepository(ProductEntity)
      .findOneBy({ ean: 'L-1' } as any);
    expect((cafe as any).normalizedName).toBe('cafe grand');
  });
});
