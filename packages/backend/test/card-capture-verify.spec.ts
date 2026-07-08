/**
 * GO WisePad 3 / Stripe prod — vérification SERVEUR des captures carte.
 *
 * Un leg carte « capturé » n'est plus cru sur parole : le PaymentIntent est
 * vérifié contre Stripe (statut succeeded, magasin propriétaire, montant reçu).
 * PI fabriqué / étranger / non payé / insuffisant → VENTE REFUSÉE (la
 * marchandise ne sort pas sur un paiement fictif). Invérifiable (pas de PI,
 * Stripe absent, réseau down) → payment_pending honnête, jamais « payé ».
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Global, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource, loadAllEntities } from './helpers/pgmem';
import { SalesModule } from '../src/modules/sales/sales.module';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { SalesService } from '../src/modules/sales/sales.service';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';

const retrieve = jest.fn();
const stripeMock = { paymentIntents: { retrieve } };

// Miroir du vrai StripeModule (@Global) — le token 'STRIPE' est visible partout.
@Global()
@Module({ providers: [{ provide: 'STRIPE', useValue: stripeMock }], exports: ['STRIPE'] })
class StripeMockModule {}

describe('GO WisePad3 — vérification serveur des captures carte (PI réel exigé)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  const STORE = uuidv4();
  const EMP = uuidv4();
  const EAN = '4000000000001';
  const SNAP = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({ type: 'postgres', entities: loadAllEntities() as any, synchronize: true }),
          dataSourceFactory: async () => (dataSource.isInitialized ? dataSource : dataSource.initialize()),
        }),
        StripeMockModule, CacheModule, MessagingModule, RealtimeModule, TimewinModule, SalesModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'S', storeCode: 'SW', currencyCode: 'EUR', isActive: true } as any);
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE, ean: EAN, name: 'Article 10€',
      priceMinorUnits: 1000, taxRate: 20, stockQuantity: 1000, stockAlertThreshold: 5, stockCriticalThreshold: 2, isActive: true,
    } as any);
  });

  afterAll(async () => { await moduleRef?.close(); });

  beforeEach(async () => {
    retrieve.mockReset();
    // pg-mem GREATEST quirk — replenish stock before each sale.
    await ds.getRepository(ProductEntity).update({ storeId: STORE }, { stockQuantity: 1000 });
  });

  const cardDto = (pi?: string) => ({
    items: [{ ean: EAN, quantity: 1 }],
    payments: [{ method: 'card', amountMinorUnits: 1000, ...(pi ? { stripePaymentIntentId: pi } : {}) }],
  });
  const goodPi = (over: Record<string, unknown> = {}) => ({
    id: 'pi_ok', status: 'succeeded', amount: 1000, amount_received: 1000,
    metadata: { storeId: STORE }, ...over,
  });

  it('PI vérifié (succeeded, bon magasin, montant reçu) → vente COMPLETED', async () => {
    retrieve.mockResolvedValue(goodPi());
    const s: any = await sales.createSale(STORE, EMP, cardDto('pi_ok') as any, SNAP, `v1-${uuidv4()}`);
    expect(retrieve).toHaveBeenCalledWith('pi_ok');
    expect(s.status).toBe('completed');
  });

  it('PI INEXISTANT (resource_missing) → vente REFUSÉE, rien ne sort', async () => {
    retrieve.mockRejectedValue(Object.assign(new Error('No such payment_intent'), { code: 'resource_missing', statusCode: 404 }));
    await expect(sales.createSale(STORE, EMP, cardDto('pi_fake') as any, SNAP)).rejects.toThrow(/introuvable/);
    const count = await ds.getRepository('sales').count({ where: { storeId: STORE, status: 'completed' } } as any);
    // aucune vente créée par cette tentative (le compte n'inclut que le test précédent)
    expect(count).toBeLessThanOrEqual(1);
  });

  it('PI d\'un AUTRE magasin → vente REFUSÉE (cross-store)', async () => {
    retrieve.mockResolvedValue(goodPi({ metadata: { storeId: 'other-store' } }));
    await expect(sales.createSale(STORE, EMP, cardDto('pi_foreign') as any, SNAP)).rejects.toThrow(/autre magasin/);
  });

  it('PI NON capturé (requires_payment_method / processing / canceled) → vente REFUSÉE', async () => {
    for (const status of ['requires_payment_method', 'processing', 'canceled']) {
      retrieve.mockResolvedValue(goodPi({ status }));
      await expect(sales.createSale(STORE, EMP, cardDto('pi_unpaid') as any, SNAP)).rejects.toThrow(/non capturé/);
    }
  });

  it('montant reçu INSUFFISANT → vente REFUSÉE', async () => {
    retrieve.mockResolvedValue(goodPi({ amount_received: 400 }));
    await expect(sales.createSale(STORE, EMP, cardDto('pi_short') as any, SNAP)).rejects.toThrow(/insuffisant/);
  });

  it('Stripe INJOIGNABLE (réseau/5xx) → mode dégradé : payment_pending, jamais « payé »', async () => {
    retrieve.mockRejectedValue(Object.assign(new Error('ECONNRESET'), { statusCode: 500 }));
    const s: any = await sales.createSale(STORE, EMP, cardDto('pi_net') as any, SNAP, `deg-${uuidv4()}`);
    expect(s.status).toBe('payment_pending'); // la vente continue, l'encaissement se régularise
  });

  it('claim de capture SANS PaymentIntent → payment_pending (jamais cru sur parole)', async () => {
    const s: any = await sales.createSale(STORE, EMP, cardDto() as any, SNAP, `nopi-${uuidv4()}`);
    expect(retrieve).not.toHaveBeenCalled();
    expect(s.status).toBe('payment_pending');
  });

  it('leg DÉMO (pendingCapture:true) → inchangé : payment_pending sans appel Stripe', async () => {
    const dto = {
      items: [{ ean: EAN, quantity: 1 }],
      payments: [{ method: 'card', amountMinorUnits: 1000, pendingCapture: true }],
    };
    const s: any = await sales.createSale(STORE, EMP, dto as any, SNAP, `demo-${uuidv4()}`);
    expect(retrieve).not.toHaveBeenCalled();
    expect(s.status).toBe('payment_pending');
  });

  it('les ventes CASH ne passent jamais par Stripe', async () => {
    const dto = { items: [{ ean: EAN, quantity: 1 }], payments: [{ method: 'cash', amountMinorUnits: 1000 }] };
    const s: any = await sales.createSale(STORE, EMP, dto as any, SNAP, `cash-${uuidv4()}`);
    expect(retrieve).not.toHaveBeenCalled();
    expect(s.status).toBe('completed');
  });
});
