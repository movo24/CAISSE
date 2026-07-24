/**
 * Chantier 4 — stock négatif autorisé : le stock informatique ne bloque JAMAIS
 * une vente en caisse.
 *
 * Règle métier prouvée ici (pg-mem ; la concurrence réelle est prouvée sur
 * PostgreSQL réel dans sales-stock-concurrency.pg.spec.ts) :
 *  - stock 0, vente 1  → stock -1 (vente validée) ;
 *  - stock 2, vente 5  → stock -3 ;
 *  - stock -1, vente 2 → stock -3 ;
 *  - réception delta +10 sur -3 → 7 (compensation naturelle de la dette) ;
 *  - chaque vente finalisée à stock insuffisant crée UNE anomalie de stock
 *    (regroupant tous les produits concernés) statut « À contrôler » ;
 *  - un panier abandonné / une vente rejetée ne crée AUCUNE anomalie ;
 *  - un replay idempotent (retry réseau / resynchronisation offline) ne crée
 *    NI seconde vente NI seconde anomalie ;
 *  - la régularisation du stock n'efface pas l'anomalie (fait historique) ;
 *  - le responsable la marque « contrôlée » avec justification obligatoire.
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createPgMemDataSource, loadAllEntities } from './helpers/pgmem';
import { SalesModule } from '../src/modules/sales/sales.module';
import { StockModule } from '../src/modules/stock/stock.module';
import { StockAnomaliesModule } from '../src/modules/stock-anomalies/stock-anomalies.module';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { SalesService } from '../src/modules/sales/sales.service';
import { StockService } from '../src/modules/stock/stock.service';
import { StockAnomaliesService } from '../src/modules/stock-anomalies/stock-anomalies.service';
import { SaleEntity } from '../src/database/entities/sale.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';
import { StockAnomalyEntity } from '../src/database/entities/stock-anomaly.entity';

describe('Chantier 4 — vente jamais bloquée par le stock, anomalies BackOffice', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  let stock: StockService;
  let anomaliesSvc: StockAnomaliesService;
  const STORE = uuidv4();
  const EMP = uuidv4();
  const snap = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };

  const EAN_A = '4000000000001';
  const EAN_B = '4000000000002';
  let productAId: string;
  let productBId: string;

  const anomalyRepo = () => ds.getRepository(StockAnomalyEntity);
  const setStock = (id: string, q: number) =>
    ds.query(`UPDATE products SET stock_quantity = $1 WHERE id = $2`, [q, id]);
  const stockOf = async (ean: string) =>
    (await ds.getRepository(ProductEntity).findOneByOrFail({ ean, storeId: STORE })).stockQuantity;

  const sell = (items: { ean: string; quantity: number }[], idemKey?: string) => {
    const total = items.reduce((s, i) => s + i.quantity * 500, 0);
    return sales.createSale(
      STORE, EMP,
      { items, payments: [{ method: 'cash', amountMinorUnits: total }] } as any,
      snap, idemKey,
    );
  };

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({ type: 'postgres', entities: loadAllEntities() as any, synchronize: true }),
          dataSourceFactory: async () => (dataSource.isInitialized ? dataSource : dataSource.initialize()),
        }),
        CacheModule,
        MessagingModule,
        RealtimeModule,
        TimewinModule,
        SalesModule,
        StockModule,
        StockAnomaliesModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);
    stock = moduleRef.get(StockService);
    anomaliesSvc = moduleRef.get(StockAnomaliesService);

    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'B44', storeCode: 'B44', currencyCode: 'EUR', isActive: true } as any);
    productAId = uuidv4();
    productBId = uuidv4();
    await ds.getRepository(ProductEntity).save([
      { id: productAId, storeId: STORE, ean: EAN_A, sku: 'SKU-A', name: 'Dragibus', priceMinorUnits: 500, taxRate: 20, stockQuantity: 0, stockAlertThreshold: 2, stockCriticalThreshold: 1, isActive: true },
      { id: productBId, storeId: STORE, ean: EAN_B, sku: 'SKU-B', name: 'Tagada', priceMinorUnits: 500, taxRate: 20, stockQuantity: 2, stockAlertThreshold: 2, stockCriticalThreshold: 1, isActive: true },
    ] as any);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM stock_anomalies');
    await ds.query('DELETE FROM idempotency_keys');
  });

  it('stock 0, vente 1 → -1 : vente validée + anomalie complète (magasin, vente, employé, produit, avant/après)', async () => {
    await setStock(productAId, 0);
    const sale: any = await sell([{ ean: EAN_A, quantity: 1 }]);
    expect(sale.status).toBe('completed');
    expect(await stockOf(EAN_A)).toBe(-1);

    const anomalies = await anomalyRepo().find({ where: { storeId: STORE } });
    expect(anomalies).toHaveLength(1);
    const a = anomalies[0];
    expect(a.saleId).toBe(sale.id);
    expect(a.ticketNumber).toBe(sale.ticketNumber);
    expect(a.storeId).toBe(STORE);
    expect(a.employeeId).toBe(EMP);
    expect(a.employeeName).toBe('Alice');
    expect(a.occurredAt).toBeTruthy();
    expect(a.status).toBe('a_controler');
    expect(a.items).toEqual([
      expect.objectContaining({
        productId: productAId,
        productName: 'Dragibus',
        ean: EAN_A,
        sku: 'SKU-A',
        isPackComponent: false,
        stockBefore: 0,
        quantitySold: 1,
        stockAfter: -1,
      }),
    ]);

    // La caisse est informée SANS blocage : avertissement dédié dans la réponse.
    const alert = (sale.stockAlerts ?? []).find((x: any) => x.level === 'negative_stock');
    expect(alert).toBeDefined();
    expect(alert.message).toContain('Vente autorisée et anomalie transmise au BackOffice');
    expect(alert.message).toContain('Nouveau stock : -1');
  });

  it('stock 2, vente 5 → -3 ; puis stock -1, vente 2 → -3 (chaque vente = sa propre anomalie)', async () => {
    await setStock(productBId, 2);
    const s1: any = await sell([{ ean: EAN_B, quantity: 5 }]);
    expect(await stockOf(EAN_B)).toBe(-3);
    const a1 = await anomalyRepo().findOneByOrFail({ saleId: s1.id });
    expect(a1.items[0]).toMatchObject({ stockBefore: 2, quantitySold: 5, stockAfter: -3 });

    await setStock(productBId, -1);
    const s2: any = await sell([{ ean: EAN_B, quantity: 2 }]);
    expect(await stockOf(EAN_B)).toBe(-3);
    const a2 = await anomalyRepo().findOneByOrFail({ saleId: s2.id });
    expect(a2.items[0]).toMatchObject({ stockBefore: -1, quantitySold: 2, stockAfter: -3 });
    expect(await anomalyRepo().count({ where: { storeId: STORE } })).toBe(2);
  });

  it('plusieurs produits indisponibles dans UNE vente → UNE anomalie regroupant les deux items', async () => {
    await setStock(productAId, 0);
    await setStock(productBId, 1);
    const sale: any = await sell([
      { ean: EAN_A, quantity: 2 },
      { ean: EAN_B, quantity: 3 },
    ]);
    expect(sale.status).toBe('completed');
    expect(await stockOf(EAN_A)).toBe(-2);
    expect(await stockOf(EAN_B)).toBe(-2);

    const anomalies = await anomalyRepo().find({ where: { storeId: STORE } });
    expect(anomalies).toHaveLength(1); // une notification par vente finalisée
    expect(anomalies[0].items).toHaveLength(2);
    const eans = anomalies[0].items.map((i) => i.ean).sort();
    expect(eans).toEqual([EAN_A, EAN_B]);
  });

  it('vente rejetée (paiement insuffisant) / panier abandonné → AUCUNE anomalie, stock intact', async () => {
    await setStock(productAId, 0);
    await expect(
      sales.createSale(
        STORE, EMP,
        { items: [{ ean: EAN_A, quantity: 1 }], payments: [{ method: 'cash', amountMinorUnits: 1 }] } as any,
        snap,
      ),
    ).rejects.toThrow(/< sale total/);
    expect(await stockOf(EAN_A)).toBe(0); // rollback complet
    expect(await anomalyRepo().count({ where: { storeId: STORE } })).toBe(0);
  });

  it('idempotence — replay de la même vente (retry réseau / resync offline) : 1 vente, 1 anomalie, stock décrémenté UNE fois', async () => {
    await setStock(productAId, 0);
    const key = `idem-${uuidv4()}`;
    const salesBefore = await ds.getRepository(SaleEntity).count({ where: { storeId: STORE } });

    const first: any = await sell([{ ean: EAN_A, quantity: 1 }], key);
    const replay: any = await sell([{ ean: EAN_A, quantity: 1 }], key);

    expect(replay.id).toBe(first.id);
    expect(await ds.getRepository(SaleEntity).count({ where: { storeId: STORE } })).toBe(salesBefore + 1);
    expect(await stockOf(EAN_A)).toBe(-1); // pas de double décrément
    expect(await anomalyRepo().count({ where: { storeId: STORE } })).toBe(1); // pas de doublon
  });

  it('régularisation — réception +10 sur dette -3 → stock 7 ; l’anomalie RESTE traçable, statut inchangé', async () => {
    await setStock(productBId, 2);
    const sale: any = await sell([{ ean: EAN_B, quantity: 5 }]); // → -3 + anomalie
    expect(await stockOf(EAN_B)).toBe(-3);

    const adjusted = await stock.adjustStock(productBId, 10, STORE, EMP, 'réception marchandises', 'delta');
    expect(adjusted.stockQuantity).toBe(7); // -3 + 10, dette compensée naturellement

    const anomaly = await anomalyRepo().findOneByOrFail({ saleId: sale.id });
    expect(anomaly.status).toBe('a_controler'); // l'historique n'est pas effacé
    expect(anomaly.items[0].stockAfter).toBe(-3); // snapshot figé au moment de la vente
  });

  it('contrôle responsable — justification obligatoire, passage à « contrôlée », pas de re-contrôle silencieux', async () => {
    await setStock(productAId, 0);
    const sale: any = await sell([{ ean: EAN_A, quantity: 1 }]);
    const anomaly = await anomalyRepo().findOneByOrFail({ saleId: sale.id });

    // Sans justification → refus
    await expect(
      anomaliesSvc.markControlled(anomaly.id, STORE, EMP, 'Alice', '   '),
    ).rejects.toThrow(BadRequestException);

    const controlled = await anomaliesSvc.markControlled(
      anomaly.id, STORE, EMP, 'Alice', 'Inventaire physique vérifié, écart réel confirmé',
    );
    expect(controlled.status).toBe('controlee');
    expect(controlled.controlledBy).toBe(EMP);
    expect(controlled.controlledByName).toBe('Alice');
    expect(controlled.controlledAt).toBeTruthy();
    expect(controlled.justification).toContain('Inventaire physique');

    // Déjà contrôlée → pas de ré-écriture silencieuse de l'historique
    await expect(
      anomaliesSvc.markControlled(anomaly.id, STORE, EMP, 'Alice', 'encore'),
    ).rejects.toThrow(BadRequestException);

    // Tenant/inconnu → NotFound
    await expect(
      anomaliesSvc.markControlled(uuidv4(), STORE, EMP, 'Alice', 'x'),
    ).rejects.toThrow(NotFoundException);
  });

  it('listing responsable/Central — filtre statut + compteur À contrôler', async () => {
    await setStock(productAId, 0);
    await setStock(productBId, 0);
    const s1: any = await sell([{ ean: EAN_A, quantity: 1 }]);
    await sell([{ ean: EAN_B, quantity: 1 }]);

    let res = await anomaliesSvc.list(STORE, {});
    expect(res.total).toBe(2);
    expect(res.pendingCount).toBe(2);

    const a1 = await anomalyRepo().findOneByOrFail({ saleId: s1.id });
    await anomaliesSvc.markControlled(a1.id, STORE, EMP, 'Alice', 'vérifié');

    res = await anomaliesSvc.list(STORE, { status: 'a_controler' });
    expect(res.items).toHaveLength(1);
    expect(res.pendingCount).toBe(1);
    expect(await anomaliesSvc.countPending(STORE)).toBe(1);
  });
});
