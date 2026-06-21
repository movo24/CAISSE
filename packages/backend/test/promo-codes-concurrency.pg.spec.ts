/**
 * Decision 6 — promo-code usage cap under TRUE concurrency, on a REAL Postgres
 * (gated on TEST_DATABASE_URL). pg-mem does not serialise concurrent statements,
 * so the conditional-UPDATE cap (used_count < max_uses) can only be proven here.
 *
 *   TEST_DATABASE_URL=postgresql://user@localhost:5432/caisse_promo \
 *     npx jest --forceExit test/promo-codes-concurrency.pg.spec.ts
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { loadAllEntities } from './helpers/pgmem';
import { PromoCodeEntity } from '../src/database/entities/promo-code.entity';
import { PromoCodeRedemptionEntity } from '../src/database/entities/promo-code-redemption.entity';
import { AuditEntryEntity } from '../src/database/entities/audit-entry.entity';
import { AuditService } from '../src/modules/audit/audit.service';
import { PromoCodesService } from '../src/modules/promo-codes/promo-codes.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

d('Promo-code cap under concurrency (real Postgres)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let svc: PromoCodesService;
  const STORE = uuidv4();
  const EMP = uuidv4();

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({ type: 'postgres', url: TEST_DB, entities: loadAllEntities() as any, synchronize: true }),
        TypeOrmModule.forFeature([PromoCodeEntity, PromoCodeRedemptionEntity, AuditEntryEntity]),
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    svc = new PromoCodesService(
      ds.getRepository(PromoCodeEntity),
      ds.getRepository(PromoCodeRedemptionEntity),
      ds,
      new AuditService(ds.getRepository(AuditEntryEntity), ds),
    );
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  it('DECISIVE — 8 concurrent redeems on a 3-use code: exactly 3 succeed, used_count = 3', async () => {
    await svc.create(STORE, { code: 'FLASH', discountType: 'fixed', discountValue: 200, maxUses: 3 });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => svc.redeem('FLASH', STORE, EMP, { saleId: uuidv4() }).then(() => 'ok').catch(() => 'no')),
    );
    expect(results.filter((r) => r === 'ok').length).toBe(3);
    const code = await ds.getRepository(PromoCodeEntity).findOneByOrFail({ storeId: STORE, code: 'FLASH' });
    expect(code.usedCount).toBe(3); // never exceeds the cap
  });
});
