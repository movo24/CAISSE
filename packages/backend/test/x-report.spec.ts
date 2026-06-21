/**
 * Bloc 9d (POS mission) — X-report: intra-day snapshot. Decisive properties:
 * it reads the live day totals, NEVER persists, is repeatable, and agrees with
 * the Z-report on the same day (shared aggregation). The Z stays the sealed
 * fiscal close; the X is a non-fiscal readout.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { SaleEntity } from '../src/database/entities/sale.entity';
import { SaleLineItemEntity } from '../src/database/entities/sale-line-item.entity';
import { SalePaymentEntity } from '../src/database/entities/sale-payment.entity';
import { ZReportEntity } from '../src/database/entities/z-report.entity';
import { ReportsService } from '../src/modules/reports/reports.service';

const DAY = '2026-06-15';
const at = (h: number) => new Date(`${DAY}T${String(h).padStart(2, '0')}:00:00Z`);

describe('Bloc 9d — X-report (intra-day snapshot, read-only, non-sealing)', () => {
  let ds: DataSource;
  let svc: ReportsService;
  const STORE = uuidv4();
  const EMP = uuidv4();

  const seedSale = async (over: Partial<SaleEntity>, lines: Array<{ qty: number; total: number }>, pays: Array<{ method: string; amt: number }>) => {
    const sale = await ds.getRepository(SaleEntity).save({
      id: uuidv4(), storeId: STORE, employeeId: EMP, status: 'completed',
      subtotalMinorUnits: 0, discountTotalMinorUnits: 0, taxTotalMinorUnits: 0, totalMinorUnits: 0,
      currencyCode: 'EUR', ticketNumber: `T-${uuidv4().slice(0, 6)}`, createdAt: at(10), ...over,
    } as any);
    for (const l of lines) {
      await ds.getRepository(SaleLineItemEntity).save({
        id: uuidv4(), saleId: sale.id, productId: uuidv4(), productName: 'P', ean: '3600000000017',
        quantity: l.qty, unitPriceMinorUnits: Math.round(l.total / l.qty), discountMinorUnits: 0, lineTotalMinorUnits: l.total,
      } as any);
    }
    for (const p of pays) {
      await ds.getRepository(SalePaymentEntity).save({
        id: uuidv4(), saleId: sale.id, method: p.method, amountMinorUnits: p.amt,
      } as any);
    }
    return sale;
  };

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    svc = new ReportsService(ds.getRepository(SaleEntity), ds.getRepository(ZReportEntity));
    await seedSale({ totalMinorUnits: 1000, taxTotalMinorUnits: 167, discountTotalMinorUnits: 50 }, [{ qty: 2, total: 1000 }], [{ method: 'cash', amt: 1000 }]);
    await seedSale({ totalMinorUnits: 500, taxTotalMinorUnits: 83, discountTotalMinorUnits: 0 }, [{ qty: 1, total: 500 }], [{ method: 'card', amt: 500 }]);
    await seedSale({ status: 'voided', totalMinorUnits: 300 }, [{ qty: 1, total: 300 }], [{ method: 'card', amt: 300 }]);
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('DECISIVE — reflects live day totals and persists NOTHING', async () => {
    const x = await svc.generateXReport(STORE, DAY);
    expect(x).toMatchObject({
      type: 'X', sealed: false, zReportExists: false,
      totalRevenueMinorUnits: 1500, // 1000 + 500 completed
      cashTotalMinorUnits: 1000, cardTotalMinorUnits: 500,
      transactionCount: 2, voidCount: 1, discountTotalMinorUnits: 50,
      averageBasketMinorUnits: 750,
    });
    expect(x.snapshotAt).toBeTruthy();
    // NOT persisted — no Z row written by an X
    expect(await ds.getRepository(ZReportEntity).count({ where: { storeId: STORE } })).toBe(0);
  });

  it('is repeatable: a second X returns the same totals and still writes nothing', async () => {
    const a = await svc.generateXReport(STORE, DAY);
    const b = await svc.generateXReport(STORE, DAY);
    expect(b.totalRevenueMinorUnits).toBe(a.totalRevenueMinorUnits);
    expect(await ds.getRepository(ZReportEntity).count({ where: { storeId: STORE } })).toBe(0);
  });

  it('DECISIVE — once the Z is taken, X flags zReportExists and AGREES with the Z totals', async () => {
    const z = await svc.generateZReport(STORE, DAY, EMP);
    const x = await svc.generateXReport(STORE, DAY);
    expect(x.zReportExists).toBe(true);
    expect(x.totalRevenueMinorUnits).toBe(z.totalRevenueMinorUnits);
    expect(x.cashTotalMinorUnits).toBe(z.cashTotalMinorUnits);
    expect(x.cardTotalMinorUnits).toBe(z.cardTotalMinorUnits);
    expect(x.transactionCount).toBe(z.transactionCount);
    expect(x.voidCount).toBe(z.voidCount);
    expect(x.discountTotalMinorUnits).toBe(z.discountTotalMinorUnits);
    // X still did not create a second Z (X never seals)
    expect(await ds.getRepository(ZReportEntity).count({ where: { storeId: STORE } })).toBe(1);
  });
});
