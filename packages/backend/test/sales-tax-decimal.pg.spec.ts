/**
 * TVA sur VRAI Postgres — régression du bug « taux decimal en string ».
 *
 * Le driver pg renvoie les colonnes `decimal` (products.tax_rate) en STRING.
 * Sans normalisation, le calcul de la vente faisait `100 + '20.00'` →
 * concaténation '10020.00' → `tax_total_minor_units` ~100× trop faible
 * (constaté : 7 centimes au lieu de 582 sur une vente de 34,90 € à 20 %).
 * Les specs unitaires ne le voyaient pas (taux mockés en number) — SEUL un
 * test sur vrai Postgres reproduit le bug ; ce spec est le test-as-spec.
 *
 * CI-safety (D23) : même harnais que sales-stock-concurrency.pg.spec.ts —
 * `synchronize: true` sur la base PARTAGÉE de la chaîne CI, fixtures à ids
 * propres, PAS de runMigrations. Vérifié en chaîne complète :
 *   TEST_DATABASE_URL=… npx jest --runInBand --testPathPattern '\.pg\.spec\.ts$'
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

d('TVA de vente sur vrai Postgres (taux decimal → string driver)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  const STORE = uuidv4();
  const EMP = uuidv4();
  const EAN_55 = '3100000000055'; // 5,5 %
  const EAN_20 = '3100000000020'; // 20 %
  const snap = { employeeName: 'Tva', employeeRole: 'admin', maxDiscount: 100 };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ type: 'postgres', url: TEST_DB, entities: loadAllEntities() as any, synchronize: true, extra: { max: 30 } }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, SalesModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'TVA-FIX', storeCode: 'TVAFX', currencyCode: 'EUR', isActive: true } as any);
    await ds.getRepository(ProductEntity).save([
      { id: uuidv4(), storeId: STORE, ean: EAN_55, name: 'Guimauve', priceMinorUnits: 350, taxRate: 5.5, stockQuantity: 100, isActive: true },
      { id: uuidv4(), storeId: STORE, ean: EAN_20, name: 'Peluche', priceMinorUnits: 1300, taxRate: 20, stockQuantity: 100, isActive: true },
    ] as any);
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  it('DÉCISIF — tax_total = round(ttc×t/(100+t)) par ligne, même quand le driver renvoie le taux en string', async () => {
    jest.setTimeout(60_000);
    // Sanity : reproduire la condition du bug — le taux relu de PG EST une string.
    const raw = await ds.query(`SELECT tax_rate FROM products WHERE ean = $1`, [EAN_20]);
    expect(typeof raw[0].tax_rate).toBe('string');

    const sale = await sales.createSale(
      STORE, EMP,
      {
        items: [{ ean: EAN_55, quantity: 2 }, { ean: EAN_20, quantity: 1 }],
        payments: [{ method: 'cash', amountMinorUnits: 2000 }],
      } as any,
      snap,
      `tva-fix-${STORE.slice(0, 8)}`,
    );

    // 700 TTC à 5,5 % → 36 ; 1300 TTC à 20 % → 217 ; total = 253 (jamais 35).
    const expected =
      Math.round(700 * (5.5 / 105.5)) + Math.round(1300 * (20 / 120));
    expect(expected).toBe(253);
    expect(sale.totalMinorUnits).toBe(2000);
    expect(sale.taxTotalMinorUnits).toBe(expected);

    // La valeur PERSISTÉE (celle scellée dans le hash v2) est la bonne.
    const persisted = await ds.query(
      `SELECT tax_total_minor_units FROM sales WHERE id = $1`, [sale.id],
    );
    expect(Number(persisted[0].tax_total_minor_units)).toBe(expected);

    // Les lignes relues exposent un taux NUMÉRIQUE (transformer decimal).
    const lines = await ds.getRepository(SaleLineItemEntity).find({ where: { saleId: sale.id } });
    for (const li of lines) expect(typeof li.taxRate).toBe('number');
  });
});
