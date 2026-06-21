/**
 * Decision 6 — promo codes. Shared human-readable codes with window, usage cap
 * (race-safe), product/category scope, active flag, usage history, applier audit.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { PromoCodeEntity } from '../src/database/entities/promo-code.entity';
import { PromoCodeRedemptionEntity } from '../src/database/entities/promo-code-redemption.entity';
import { AuditEntryEntity } from '../src/database/entities/audit-entry.entity';
import { AuditService } from '../src/modules/audit/audit.service';
import { PromoCodesService } from '../src/modules/promo-codes/promo-codes.service';

describe('Decision 6 — promo codes', () => {
  let ds: DataSource;
  let svc: PromoCodesService;
  const STORE = uuidv4();
  const EMP = uuidv4();

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    svc = new PromoCodesService(
      ds.getRepository(PromoCodeEntity),
      ds.getRepository(PromoCodeRedemptionEntity),
      ds,
      new AuditService(ds.getRepository(AuditEntryEntity), ds),
    );
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('create normalises the code (uppercase) and rejects duplicates / bad values', async () => {
    const c = await svc.create(STORE, { code: 'summer20', discountType: 'percentage', discountValue: 20, maxUses: 2 });
    expect(c.code).toBe('SUMMER20');
    await expect(svc.create(STORE, { code: 'SUMMER20', discountType: 'percentage', discountValue: 10 })).rejects.toThrow(/already exists/);
    await expect(svc.create(STORE, { code: 'X', discountType: 'percentage', discountValue: 150 })).rejects.toThrow(/cannot exceed 100/);
  });

  it('validate: valid code returns the discount; expired/inactive/unknown are refused', async () => {
    expect(await svc.validate('SUMMER20', STORE)).toMatchObject({ valid: true, discountType: 'percentage', discountValue: 20 });
    expect(await svc.validate('NOPE', STORE)).toMatchObject({ valid: false, reason: 'code introuvable' });
    await svc.create(STORE, { code: 'OLD', discountType: 'fixed', discountValue: 500, endsAt: new Date(Date.now() - 1000) });
    expect(await svc.validate('OLD', STORE)).toMatchObject({ valid: false, reason: 'code expiré' });
  });

  it('DECISIVE — usage cap is enforced race-safely: a 2-use code redeems twice, the 3rd is refused', async () => {
    const r1 = await svc.redeem('SUMMER20', STORE, EMP, { saleId: uuidv4(), discountAppliedMinorUnits: 400 });
    const r2 = await svc.redeem('SUMMER20', STORE, EMP, { saleId: uuidv4(), discountAppliedMinorUnits: 400 });
    expect(r1.redeemed && r2.redeemed).toBe(true);
    await expect(svc.redeem('SUMMER20', STORE, EMP, { saleId: uuidv4() })).rejects.toThrow(/limite/);
    // history + applier audit recorded
    const code = await ds.getRepository(PromoCodeEntity).findOneByOrFail({ storeId: STORE, code: 'SUMMER20' });
    expect((await svc.history(code.id, STORE)).length).toBe(2);
    const audits = await ds.getRepository(AuditEntryEntity).find({ where: { storeId: STORE, action: 'promo_code_applied' } });
    expect(audits.length).toBe(2);
  });

  // NOTE: true CONCURRENT cap enforcement is proven in promo-codes-concurrency.pg.spec
  // (gated real-PG) — pg-mem does not serialise concurrent statements, so the
  // conditional-UPDATE race cannot be tested here; the sequential cap above proves
  // the cap logic.

  it('scope: a product-restricted code only applies to that product', async () => {
    const pid = uuidv4();
    await svc.create(STORE, { code: 'SACONLY', discountType: 'percentage', discountValue: 10, productId: pid });
    expect((await svc.validate('SACONLY', STORE, { productId: pid })).valid).toBe(true);
    expect(await svc.validate('SACONLY', STORE, { productId: uuidv4() })).toMatchObject({ valid: false, reason: /produit/ });
  });

  it('reserveAtSale (decision 6 — applied at sale): writes the redemption in the caller’s transaction', async () => {
    // pg-mem mistypes `used_count + 1` (string-concats instead of integer arithmetic
    // — same class as the documented GREATEST limitation) AND mis-compares the result
    // in the WHERE, so reserveAtSale's pure conditional-UPDATE cap cannot be proven
    // here (redeem's cap test passes only thanks to redeem's extra validate() pre-check;
    // reserveAtSale is conditional-UPDATE-only by design). The numeric + concurrent cap
    // on the identical SQL is proven in promo-codes-concurrency.pg.spec (gated real-PG).
    // Here we prove the WIRING: a reserve writes a redemption row with the sale + amount.
    const code = await svc.create(STORE, { code: 'ATSALE1', discountType: 'fixed', discountValue: 300, maxUses: 5 });
    const saleA = uuidv4();
    await svc.reserveAtSale(ds.manager, { promoCodeId: code.id, storeId: STORE, employeeId: EMP, saleId: saleA, discountAppliedMinorUnits: 300 });
    const reds = await svc.history(code.id, STORE);
    expect(reds.some((r) => r.saleId === saleA && r.discountAppliedMinorUnits === 300)).toBe(true);
  });
});
