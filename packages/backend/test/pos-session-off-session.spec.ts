/**
 * Ventes HORS SESSION — visibilité de l'angle mort du contrôle de caisse.
 *
 * Une vente encaissée pendant que le terminal n'a PAS de session active part
 * avec session_id NULL (design documenté « session unknown ») : fiscalement
 * complète (hash/Z/journal) mais absente de l'attendu de TOUT comptage.
 * listOffSessionCash la rend visible : par jour, nombre de ventes, total des
 * jambes espèces capturées, tickets. Lecture seule.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource, loadAllEntities } from './helpers/pgmem';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';
import { SalesService } from '../src/modules/sales/sales.service';
import { SalesModule } from '../src/modules/sales/sales.module';
import { PosSessionService } from '../src/modules/pos-session/pos-session.service';
import { PosSessionModule } from '../src/modules/pos-session/pos-session.module';
import { ReturnsModule } from '../src/modules/returns/returns.module';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';

const SNAP = { employeeName: 'Test Cashier', employeeRole: 'cashier', maxDiscount: 0 };
const EANS = ['3000000000101', '3000000000102', '3000000000103', '3000000000104'];

describe('Ventes hors session — listOffSessionCash (lecture seule)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  let sessions: PosSessionService;

  async function seedStore() {
    const storeId = uuidv4();
    await ds.getRepository(StoreEntity).save({
      id: storeId, name: 'S', storeCode: `S-${storeId.slice(0, 8)}`, currencyCode: 'EUR', isActive: true,
    } as any);
    for (const ean of EANS) {
      await ds.getRepository(ProductEntity).save({
        id: uuidv4(), storeId, ean, name: `Article ${ean}`,
        priceMinorUnits: 500, taxRate: 20, stockQuantity: 1000, stockAlertThreshold: 5, stockCriticalThreshold: 2, isActive: true,
      } as any);
    }
    return storeId;
  }

  const saleDto = (i: number, method: 'cash' | 'card') => ({
    items: [{ ean: EANS[i], quantity: 1 }],
    payments: [{ method, amountMinorUnits: 500 }],
  });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({ type: 'postgres', entities: loadAllEntities() as any, synchronize: true }),
          dataSourceFactory: async () => (dataSource.isInitialized ? dataSource : dataSource.initialize()),
        }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, SalesModule, ReturnsModule, PosSessionModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);
    sessions = moduleRef.get(PosSessionService);
  });

  afterAll(async () => { await moduleRef?.close(); });

  it('agrège par jour les ventes SANS session (espèces capturées comptées, carte = 0 espèces)', async () => {
    const storeId = await seedStore();
    const empId = uuidv4();

    // Vente RATTACHÉE à une session (terminal avec session active) — exclue.
    const session = await sessions.openSession(storeId, empId, SNAP, { terminalId: 'T-A', openingCashMinorUnits: 0 });
    await sales.createSale(storeId, empId, saleDto(0, 'cash') as any, SNAP, undefined, 'T-A');

    // Ventes SANS terminal → session NULL : deux espèces.
    const off1 = await sales.createSale(storeId, empId, saleDto(1, 'cash') as any, SNAP);
    const off2 = await sales.createSale(storeId, empId, saleDto(2, 'cash') as any, SNAP);

    const days = await sessions.listOffSessionCash(storeId, 14);
    expect(days).toHaveLength(1);
    const d = days[0];
    expect(d.salesCount).toBe(2); // les deux hors session ; la vente en session est EXCLUE
    expect(d.cashMinorUnits).toBe(1000); // somme des jambes espèces capturées
    expect(d.ticketNumbers).toContain(off1.ticketNumber);
    expect(d.ticketNumbers).toContain(off2.ticketNumber);
    expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(session.id).toBeTruthy();
  });

  it('seules les ventes COMPLETED comptent : carte non capturée (payment_pending) exclue ; magasin vierge → []', async () => {
    const storeId = await seedStore();
    const empId = uuidv4();
    // Carte sans PaymentIntent → capture non prouvée → la vente atterrit
    // payment_pending (invariant « jamais payé sans capture ») : hors du listing.
    await sales.createSale(storeId, empId, saleDto(3, 'card') as any, SNAP);
    expect(await sessions.listOffSessionCash(storeId, 14)).toHaveLength(0);

    const emptyStore = await seedStore();
    expect(await sessions.listOffSessionCash(emptyStore, 14)).toHaveLength(0);
  });
});
