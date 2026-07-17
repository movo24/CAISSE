/**
 * Bug TVA-string (constaté 2026-07-18) — la colonne `products.tax_rate` est un
 * `decimal` : le driver pg la renvoie en STRING sans transformer, et le calcul
 * `li.taxRate / (100 + li.taxRate)` devient `"20.00" / "10020.00"` (concat de
 * string) → tax_total_minor_units ~100x trop faible (3490c à 20% → 7c au lieu
 * de 582c). Les specs unitaires mockent des taux NUMÉRIQUES et ne peuvent pas
 * l'attraper : seul un vrai Postgres reproduit le typage du driver — d'où cette
 * spec gated (TEST_DATABASE_URL ; skip sinon).
 *
 * La correction (transformer numeric sur les colonnes decimal tax_rate) ne vaut
 * que pour les ventes FUTURES : les ventes déjà scellées (hash v2 sur la valeur
 * historique) ne sont JAMAIS réécrites.
 *
 *   TEST_DATABASE_URL=postgresql://user@localhost:5432/caisse_taxrate \
 *     npx jest --forceExit test/sales-tax-rate-numeric.pg.spec.ts
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { loadAllEntities } from './helpers/pgmem';
import { SalesModule } from '../src/modules/sales/sales.module';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { SalesService } from '../src/modules/sales/sales.service';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';
import { SaleLineItemEntity } from '../src/database/entities/sale-line-item.entity';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

d('TVA numeric sur vrai Postgres (colonne decimal tax_rate)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  const STORE = uuidv4();
  const EMP = uuidv4();
  const EAN_20 = '3100000000020'; // écharpe 3490c, TVA 20%
  const EAN_55 = '3100000000055'; // produit 1055c, TVA 5.5%
  const snap = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ type: 'postgres', url: TEST_DB, entities: loadAllEntities() as any, synchronize: true }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, SalesModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'TVA', storeCode: 'TVA1', currencyCode: 'EUR', isActive: true } as any);
    await ds.getRepository(ProductEntity).save([
      { id: uuidv4(), storeId: STORE, ean: EAN_20, name: 'Echarpe Laine', priceMinorUnits: 3490, taxRate: 20, stockQuantity: 10, isActive: true },
      { id: uuidv4(), storeId: STORE, ean: EAN_55, name: 'Confiserie', priceMinorUnits: 1055, taxRate: 5.5, stockQuantity: 10, isActive: true },
    ] as any);
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  it('le repository relit tax_rate en NUMBER (pas la string du driver pg)', async () => {
    const p = await ds.getRepository(ProductEntity).findOneByOrFail({ ean: EAN_20, storeId: STORE });
    expect(typeof p.taxRate).toBe('number');
    expect(p.taxRate).toBe(20);
  });

  it('DECISIVE — vente 3490c à 20% : tax_total = 582c (pas 7c)', async () => {
    const sale = await sales.createSale(
      STORE, EMP,
      { items: [{ ean: EAN_20, quantity: 1 }], payments: [{ method: 'cash', amountMinorUnits: 3490 }] } as any,
      snap,
      `tva-20-${STORE}`,
    );
    // TTC → part de TVA : round(3490 × 20 / 120) = 582
    expect(sale.taxTotalMinorUnits).toBe(582);
    // La ligne persistée porte aussi le taux relu en number
    const li = await ds.getRepository(SaleLineItemEntity).findOneByOrFail({ saleId: sale.id });
    expect(Number(li.taxRate)).toBe(20);
  });

  it('taux décimal 5.5% : round(1055 × 5.5 / 105.5) = 55c', async () => {
    const sale = await sales.createSale(
      STORE, EMP,
      { items: [{ ean: EAN_55, quantity: 1 }], payments: [{ method: 'cash', amountMinorUnits: 1055 }] } as any,
      snap,
      `tva-55-${STORE}`,
    );
    expect(sale.taxTotalMinorUnits).toBe(55);
  });
});
