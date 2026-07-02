import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { NotFoundException } from '@nestjs/common';

import { createPgMemDataSource } from '../../../test/helpers/pgmem';
import { ReturnsService } from './returns.service';
import { CreditNoteEntity } from '../../database/entities/credit-note.entity';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { IdempotencyKeyEntity } from '../../database/entities/idempotency-key.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { normalizeCreditCode } from './credit-code';

// PAQUET 302 (bloc D2) — ReturnsService READ paths against a real in-memory
// Postgres: tenant isolation of avoirs (findOne/lookup 404 cross-store),
// spendable rules on real rows, returned-quantities grouped SQL (cancelled
// notes excluded), DESC pagination. The NF525 WRITE chains (createReturn)
// are already covered by avoir-m1-m3 / e2e-money-flow / fiscal suites.

describe('ReturnsService read paths (pg-mem)', () => {
  let dataSource: DataSource;
  let cnRepo: Repository<CreditNoteEntity>;
  let service: ReturnsService;

  let storeId: string;
  let otherStoreId: string;
  let saleId: string;
  let lineId: string;

  beforeAll(async () => {
    const built = createPgMemDataSource();
    dataSource = built.dataSource;
    await dataSource.initialize();
    cnRepo = dataSource.getRepository(CreditNoteEntity);
    const saleRepo = dataSource.getRepository(SaleEntity);
    const lineRepo = dataSource.getRepository(SaleLineItemEntity);
    const storeRepo = dataSource.getRepository(StoreEntity);
    service = new ReturnsService(
      cnRepo,
      saleRepo,
      dataSource.getRepository(IdempotencyKeyEntity),
      dataSource,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      { resolve: async () => null } as any,
    );

    storeId = (await storeRepo.save(storeRepo.create({ name: 'Wesley' }))).id;
    otherStoreId = (await storeRepo.save(storeRepo.create({ name: 'Other' }))).id;

    const sale = await saleRepo.save(
      saleRepo.create({
        storeId, employeeId: uuidv4(), status: 'completed',
        ticketNumber: 'T-RET-1', totalMinorUnits: 1000,
      } as Partial<SaleEntity>),
    );
    saleId = sale.id;
    lineId = (
      await lineRepo.save(
        lineRepo.create({
          saleId, productId: uuidv4(), productName: 'Guimauve', ean: 'E-RET',
          quantity: 5, unitPriceMinorUnits: 200, lineTotalMinorUnits: 1000,
        } as Partial<SaleLineItemEntity>),
      )
    ).id;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  const mkNote = (over: Partial<CreditNoteEntity> = {}) =>
    cnRepo.save(
      cnRepo.create({
        code: normalizeCreditCode(`AV-${Math.random().toString(16).slice(2, 10)}`),
        storeId,
        employeeId: uuidv4(),
        type: 'store_credit',
        status: 'active',
        totalMinorUnits: 500,
        remainingMinorUnits: 500,
        ...over,
      } as Partial<CreditNoteEntity>),
    );

  it('findOne is tenant-scoped: the avoir of another store is a 404, not a leak', async () => {
    const note = await mkNote();
    await expect(service.findOne(note.id, otherStoreId)).rejects.toThrow(NotFoundException);
    expect((await service.findOne(note.id, storeId)).id).toBe(note.id);
  });

  it('lookupSpendable: active store-credit with balance = spendable; refund-type and exhausted notes are NOT', async () => {
    const good = await mkNote();
    const refund = await mkNote({ type: 'refund' });
    const empty = await mkNote({ status: 'redeemed', remainingMinorUnits: 0 });

    expect((await service.lookupSpendable(good.code, storeId)).spendable).toBe(true);
    expect((await service.lookupSpendable(refund.code, storeId)).spendable).toBe(false);
    expect((await service.lookupSpendable(empty.code, storeId)).spendable).toBe(false);
    // cross-store code → 404 (no cross-tenant redemption)
    await expect(service.lookupSpendable(good.code, otherStoreId)).rejects.toThrow(NotFoundException);
  });

  it('getReturnedQuantities aggregates per line via real grouped SQL and EXCLUDES cancelled notes', async () => {
    const n1 = await mkNote({ originalSaleId: saleId } as any);
    const n2 = await mkNote({ originalSaleId: saleId, status: 'cancelled' } as any);
    const pid = uuidv4();
    await dataSource.query(
      `INSERT INTO credit_note_lines (id, credit_note_id, original_line_item_id, product_id, product_name, quantity, unit_price_minor_units, line_total_minor_units)
       VALUES ($1,$2,$3,$7,'Guimauve',2,200,400), ($4,$5,$6,$7,'Guimauve',9,200,1800)`,
      [uuidv4(), n1.id, lineId, uuidv4(), n2.id, lineId, pid],
    );

    const returned = await service.getReturnedQuantities(saleId);
    expect(returned[lineId]).toBe(2); // the cancelled note's 9 units are excluded

    const returnable = await service.getReturnableForSale(saleId, storeId);
    const line = returnable.lines.find((l) => l.lineItemId === lineId)!;
    expect(line.soldQty).toBe(5);
    expect(line.returnedQty).toBe(2);
    expect(line.returnableQty).toBe(3);
    await expect(service.getReturnableForSale(saleId, otherStoreId)).rejects.toThrow(NotFoundException);
  });

  it('listForStore paginates newest-first and never mixes tenants', async () => {
    await mkNote({ storeId: otherStoreId });
    const page = await service.listForStore(storeId, { page: 1, limit: 3 });
    expect(page.data.length).toBeLessThanOrEqual(3);
    expect(page.data.every((n) => n.storeId === storeId)).toBe(true);
    const times = page.data.map((n) => new Date(n.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(page.meta.total).toBeGreaterThanOrEqual(4);
  });
});
