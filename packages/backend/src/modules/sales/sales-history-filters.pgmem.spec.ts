import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { createPgMemDataSource } from '../../../test/helpers/pgmem';
import { SalesService } from './sales.service';
import { SaleEntity } from '../../database/entities/sale.entity';
import { StoreEntity } from '../../database/entities/store.entity';

// P315 (cycle H) — TD-018-FILTERS-RUNTIME: the POS-018 sales-history filters
// (employeeId / from / to / status) proven against REAL SQL. Only findByStore
// is exercised → the service is built with inert fakes for its other deps.

describe('SalesService.findByStore filters (pg-mem) — TD-018', () => {
  let dataSource: DataSource;
  let saleRepo: Repository<SaleEntity>;
  let service: SalesService;

  let storeId: string;
  let otherStoreId: string;
  const EMP_A = uuidv4();
  const EMP_B = uuidv4();

  const mkSale = (over: Partial<SaleEntity>) =>
    saleRepo.save(
      saleRepo.create({
        storeId,
        employeeId: EMP_A,
        status: 'completed',
        ticketNumber: `T-${uuidv4().slice(0, 12)}`,
        totalMinorUnits: 100,
        ...over,
      } as Partial<SaleEntity>),
    );

  beforeAll(async () => {
    const built = createPgMemDataSource();
    dataSource = built.dataSource;
    await dataSource.initialize();
    saleRepo = dataSource.getRepository(SaleEntity);
    const storeRepo = dataSource.getRepository(StoreEntity);
    const inert: any = {};
    service = new SalesService(
      saleRepo,
      dataSource.getRepository('sale_line_items' as any) as any,
      dataSource.getRepository('sale_payments' as any) as any,
      dataSource.getRepository('idempotency_keys' as any) as any,
      dataSource.getRepository('employees' as any) as any,
      dataSource,
      inert, inert, inert, // products / customers / promotions (unused by findByStore)
      { log: async () => undefined } as any,
      inert, inert, inert, // stock / jackpot / timewin
      { emit: () => undefined } as any,
      { resolve: async () => null } as any,
    );

    storeId = (await storeRepo.save(storeRepo.create({ name: 'Wesley' }))).id;
    otherStoreId = (await storeRepo.save(storeRepo.create({ name: 'Other' }))).id;

    await mkSale({ createdAt: new Date('2026-06-01T10:00:00Z') } as any); // A, completed
    await mkSale({ employeeId: EMP_B, createdAt: new Date('2026-06-10T10:00:00Z') } as any); // B
    await mkSale({ status: 'voided', createdAt: new Date('2026-06-10T12:00:00Z') } as any); // A, voided
    await mkSale({ createdAt: new Date('2026-06-20T10:00:00Z') } as any); // A, completed
    await mkSale({ storeId: otherStoreId, createdAt: new Date('2026-06-10T10:00:00Z') } as any); // foreign
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('no filters: returns the store history only, newest first, with real total', async () => {
    const res = await service.findByStore(storeId);
    expect(res.meta.total).toBe(4);
    expect(res.data.every((s) => s.storeId === storeId)).toBe(true);
    const times = res.data.map((s) => new Date(s.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('employeeId filter isolates one cashier', async () => {
    const res = await service.findByStore(storeId, { employeeId: EMP_B });
    expect(res.meta.total).toBe(1);
    expect(res.data[0].employeeId).toBe(EMP_B);
  });

  it('from/to are inclusive date bounds', async () => {
    const res = await service.findByStore(storeId, { from: '2026-06-10', to: '2026-06-10' });
    expect(res.meta.total).toBe(2); // both June-10 sales, the 1st and 20th excluded
    const wide = await service.findByStore(storeId, { from: '2026-06-01', to: '2026-06-30' });
    expect(wide.meta.total).toBe(4);
  });

  it('status filter separates voided from completed; filters COMBINE (AND)', async () => {
    expect((await service.findByStore(storeId, { status: 'voided' })).meta.total).toBe(1);
    const combo = await service.findByStore(storeId, {
      employeeId: EMP_A, from: '2026-06-05', to: '2026-06-15', status: 'voided',
    });
    expect(combo.meta.total).toBe(1); // the June-10 voided sale of A only
  });
});
