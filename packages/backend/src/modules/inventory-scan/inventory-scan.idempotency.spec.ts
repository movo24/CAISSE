import { DataSource, Repository } from 'typeorm';
import { createPgMemDataSource } from '../../../test/helpers/pgmem';
import { InventoryScanService } from './inventory-scan.service';
import { InventoryScanEntity } from '../../database/entities/inventory-scan.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { StoreEntity } from '../../database/entities/store.entity';

/**
 * Idempotence serveur des scans offline : rejouer le même clientEntryId ne crée
 * pas de doublon (cas « réponse 2xx perdue après commit serveur »).
 */
describe('InventoryScanService — idempotence (clientEntryId)', () => {
  let ds: DataSource;
  let service: InventoryScanService;
  let scanRepo: Repository<InventoryScanEntity>;
  let storeId: string;

  beforeAll(async () => {
    ({ dataSource: ds } = createPgMemDataSource());
    await ds.initialize();
    scanRepo = ds.getRepository(InventoryScanEntity);
    const storeRepo = ds.getRepository(StoreEntity);
    const productRepo = ds.getRepository(ProductEntity);

    const store: StoreEntity = await storeRepo.save({
      name: 'Boutique Test',
      storeCode: 'TST-001',
      currencyCode: 'EUR',
    } as Partial<StoreEntity> as StoreEntity);
    storeId = store.id;

    service = new InventoryScanService(scanRepo, productRepo, storeRepo, null as any, ds);
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('rejouer le même clientEntryId renvoie le même scan, sans doublon', async () => {
    const dto = { barcode: '3760001000001', quantity: 2, clientEntryId: 'queue-entry-1' };

    const first = await service.recordScan(storeId, 'emp-1', dto as any);
    const second = await service.recordScan(storeId, 'emp-1', dto as any);

    expect(second.id).toBe(first.id); // idempotent
    expect(await scanRepo.count()).toBe(1); // un seul enregistrement
  });

  it('des clientEntryId différents créent des scans distincts', async () => {
    await service.recordScan(storeId, 'emp-1', { barcode: 'A', clientEntryId: 'queue-entry-2' } as any);
    await service.recordScan(storeId, 'emp-1', { barcode: 'B', clientEntryId: 'queue-entry-3' } as any);
    expect(await scanRepo.count()).toBe(3); // 1 (test précédent) + 2
  });

  it('un scan sans clientEntryId reste créé normalement (online)', async () => {
    await service.recordScan(storeId, 'emp-1', { barcode: 'C' } as any);
    expect(await scanRepo.count()).toBe(4);
  });
});
