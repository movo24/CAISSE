import { DataSource, Repository } from 'typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { createPgMemDataSource } from '../../../test/helpers/pgmem';
import { CustomerVisitsService } from './customer-visits.service';
import { CustomerVisitEntity } from '../../database/entities/customer-visit.entity';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { StoreEntity } from '../../database/entities/store.entity';

// PAQUET 276 — CustomerVisitsService against a real in-memory Postgres (pg-mem):
// proves the REAL anti-duplicate window query, the transactional insert +
// raw-SQL visit_count/last_visit_at update, the DESC listing, and the
// anti-IDOR ownership check of the secured frequency read.

describe('CustomerVisitsService (pg-mem)', () => {
  let dataSource: DataSource;
  let visitRepo: Repository<CustomerVisitEntity>;
  let customerRepo: Repository<CustomerEntity>;
  let service: CustomerVisitsService;

  let storeId: string;
  let otherStoreId: string;
  let customerId: string;

  beforeAll(async () => {
    const built = createPgMemDataSource();
    dataSource = built.dataSource;
    await dataSource.initialize();
    visitRepo = dataSource.getRepository(CustomerVisitEntity);
    customerRepo = dataSource.getRepository(CustomerEntity);
    const storeRepo = dataSource.getRepository(StoreEntity);
    service = new CustomerVisitsService(visitRepo, customerRepo, dataSource);

    storeId = (await storeRepo.save(storeRepo.create({ name: 'Wesley' }))).id;
    otherStoreId = (await storeRepo.save(storeRepo.create({ name: 'Other' }))).id;
    customerId = (
      await customerRepo.save(
        customerRepo.create({
          firstName: 'Ada',
          lastName: 'Lovelace',
          qrCode: 'QR-ADA-1',
          storeId,
        } as Partial<CustomerEntity>),
      )
    ).id;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('records a visit transactionally and increments visit_count + last_visit_at via raw SQL', async () => {
    const res = await service.recordVisit({ customerId, storeId });
    expect(res.isDuplicate).toBe(false);
    expect(res.visitId).toBeTruthy();

    const customer = await customerRepo.findOne({ where: { id: customerId } });
    // Number(): pg-mem returns the raw-SQL increment as text ("01") — real PG returns int.
    expect(Number(customer!.visitCount)).toBe(1);
    expect(customer!.lastVisitAt).not.toBeNull();
  });

  it('anti-duplicate window: same customer+store within 5 min → returns existing visit, no new insert, no double count', async () => {
    const res = await service.recordVisit({ customerId, storeId });
    expect(res.isDuplicate).toBe(true);

    expect(await visitRepo.count({ where: { customerId } })).toBe(1);
    const customer = await customerRepo.findOne({ where: { id: customerId } });
    expect(Number(customer!.visitCount)).toBe(1); // not incremented on duplicate
  });

  it('the 5-min window is per store: same customer at ANOTHER store is a fresh visit', async () => {
    const res = await service.recordVisit({ customerId, storeId: otherStoreId });
    expect(res.isDuplicate).toBe(false);
    expect(await visitRepo.count({ where: { customerId } })).toBe(2);
  });

  it('an old visit (outside the window) does not block a new one', async () => {
    // age the existing visits beyond 5 minutes (direct UPDATE — test fixture)
    await dataSource.query(`UPDATE customer_visits SET visited_at = now() - interval '10 minutes'`);
    const res = await service.recordVisit({ customerId, storeId });
    expect(res.isDuplicate).toBe(false);
    expect(await visitRepo.count({ where: { customerId } })).toBe(3);
  });

  it('listForCustomer returns visits newest first; frequency reads all visits (segment computed)', async () => {
    const list = await service.listForCustomer(customerId);
    expect(list).toHaveLength(3);
    const times = list.map((v) => new Date(v.visitedAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times); // DESC

    const freq = await service.getFrequency(customerId);
    expect(freq.segment).toBeDefined();
  });

  it('secured read is anti-IDOR: other-store caller forbidden, admin bypass, unknown customer 404', async () => {
    await expect(
      service.getFrequencySecured(customerId, otherStoreId, 'manager'),
    ).rejects.toThrow(ForbiddenException);
    const asAdmin = await service.getFrequencySecured(customerId, otherStoreId, 'admin');
    expect(asAdmin.segment).toBeDefined();
    const sameStore = await service.getFrequencySecured(customerId, storeId, 'manager');
    expect(sameStore.segment).toBeDefined();
    await expect(
      service.getFrequencySecured('00000000-0000-4000-8000-000000000000', storeId, 'admin'),
    ).rejects.toThrow(NotFoundException);
  });
});
