/**
 * Decision 7 — inventory reconciliation. A shortage ≥ 20% between theoretical and
 * physical stock is FLAGGED for human review and NOT auto-corrected; the manager
 * confirms the real quantity with a mandatory reason and validates. Smaller
 * variances/overages apply directly. Everything is audited.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { ProductEntity } from '../src/database/entities/product.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { StockVarianceEntity } from '../src/database/entities/stock-variance.entity';
import { AuditEntryEntity } from '../src/database/entities/audit-entry.entity';
import { AuditService } from '../src/modules/audit/audit.service';
import { StockService } from '../src/modules/stock/stock.service';
import { StockReconciliationService } from '../src/modules/stock-reconciliation/stock-reconciliation.service';

describe('Decision 7 — stock variance ≥20% requires human intervention', () => {
  let ds: DataSource;
  let svc: StockReconciliationService;
  const STORE = uuidv4();
  const EMP = uuidv4();
  const MANAGER = uuidv4();

  const seedProduct = async (stock: number) => {
    const id = uuidv4();
    await ds.getRepository(ProductEntity).save({
      id, storeId: STORE, ean: `36${Math.floor(Math.random() * 1e10)}`, name: 'Bonbon',
      priceMinorUnits: 500, taxRate: 20, stockQuantity: stock, isActive: true,
    } as any);
    return id;
  };
  const stockOf = async (id: string) => (await ds.getRepository(ProductEntity).findOneByOrFail({ id })).stockQuantity;

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'B43', isActive: true, currencyCode: 'EUR' } as any);
    const audit = new AuditService(ds.getRepository(AuditEntryEntity), ds);
    const stock = new StockService(ds.getRepository(ProductEntity), audit, ds);
    svc = new StockReconciliationService(ds.getRepository(ProductEntity), ds.getRepository(StockVarianceEntity), stock, audit);
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('DECISIVE — a 30% shortage is FLAGGED (pending review), stock NOT touched', async () => {
    const pid = await seedProduct(100);
    const r = await svc.submitCount(STORE, pid, 70, EMP); // -30%
    expect(r.requiresReview).toBe(true);
    expect(await stockOf(pid)).toBe(100); // NOT auto-corrected
    const pending = await svc.listPending(STORE);
    expect(pending.find((v) => v.productId === pid)).toMatchObject({ status: 'pending_review', theoreticalQty: 100, physicalQty: 70 });
    // a high-variance alert was raised + an audit entry written
    const audits = await ds.getRepository(AuditEntryEntity).find({ where: { storeId: STORE, entityId: pid } });
    expect(audits.some((a) => a.action === 'stock_variance_flagged')).toBe(true);
  });

  it('a small shortage (<20%) applies directly — no review needed', async () => {
    const pid = await seedProduct(100);
    const r = await svc.submitCount(STORE, pid, 90, EMP); // -10%
    expect(r.requiresReview).toBe(false);
    expect(await stockOf(pid)).toBe(90);
    expect((await svc.listPending(STORE)).find((v) => v.productId === pid)).toBeUndefined();
  });

  it('an overage applies directly (decision targets shortages only)', async () => {
    const pid = await seedProduct(100);
    const r = await svc.submitCount(STORE, pid, 130, EMP);
    expect(r.requiresReview).toBe(false);
    expect(await stockOf(pid)).toBe(130);
  });

  it('DECISIVE — the manager confirms with a mandatory reason → correction applied + closed', async () => {
    const pid = await seedProduct(100);
    const { variance } = (await svc.submitCount(STORE, pid, 60, EMP)) as any; // -40% → flagged
    expect(await stockOf(pid)).toBe(100); // still untouched

    const corrected = await svc.confirmCorrection(variance.id, STORE, 60, 'vol', MANAGER);
    expect(corrected.status).toBe('corrected');
    expect(corrected.reason).toBe('vol');
    expect(corrected.reviewedBy).toBe(MANAGER);
    expect(await stockOf(pid)).toBe(60); // NOW corrected, by the manager
    const audits = await ds.getRepository(AuditEntryEntity).find({ where: { storeId: STORE, entityId: pid } });
    expect(audits.some((a) => a.action === 'stock_variance_corrected')).toBe(true);
  });

  it('ADVERSE — confirm without a valid reason is rejected (no silent correction)', async () => {
    const pid = await seedProduct(100);
    const { variance } = (await svc.submitCount(STORE, pid, 50, EMP)) as any;
    await expect(svc.confirmCorrection(variance.id, STORE, 50, 'whatever', MANAGER)).rejects.toThrow(/reason must be one of/);
    expect(await stockOf(pid)).toBe(100); // untouched — bad reason blocked the correction
    // and a double-confirm is refused
    await svc.confirmCorrection(variance.id, STORE, 50, 'casse', MANAGER);
    await expect(svc.confirmCorrection(variance.id, STORE, 50, 'casse', MANAGER)).rejects.toThrow(/already corrected/);
  });
});
