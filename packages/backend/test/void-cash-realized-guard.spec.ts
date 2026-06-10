/**
 * Fix sécurité — guard void-après-cash-réalisé.
 *
 * Une vente cash encaissée a eu lieu fiscalement ; l'effacer (void) serait
 * une fausse déclaration. L'annulation doit passer par createReturn.
 *
 * Le guard clé sur la présence d'un leg cash réalisé (amountMinorUnits > 0),
 * pas sur sale.status. Indépendant du rôle (un caissier non-manager qui
 * essaie de voider une vente cash est rejeté, parce que l'authZ-cap actuel
 * ne gate que les managers — la dette d'authZ est nommée à part).
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { ConflictException } from '@nestjs/common';

import { createPgMemDataSource, loadAllEntities } from './helpers/pgmem';
import { SalesModule } from '../src/modules/sales/sales.module';
import { ReturnsModule } from '../src/modules/returns/returns.module';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { SalesService } from '../src/modules/sales/sales.service';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';

describe('Sécurité — void-after-cash-realized guard', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  const STORE_ID = uuidv4();
  const EMP_ID = uuidv4();
  const SNAP_ADMIN = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({ type: 'postgres', entities: loadAllEntities() as any, synchronize: true }),
          dataSourceFactory: async () => (dataSource.isInitialized ? dataSource : dataSource.initialize()),
        }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, SalesModule, ReturnsModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);

    await ds.getRepository(StoreEntity).save({
      id: STORE_ID, name: 'S', storeCode: 'S1', currencyCode: 'EUR', isActive: true,
    } as any);
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE_ID, ean: '5000000000001', name: 'Article 5€',
      priceMinorUnits: 500, taxRate: 20, stockQuantity: 1000, stockAlertThreshold: 5, stockCriticalThreshold: 2, isActive: true,
    } as any);
  });

  afterAll(async () => { await moduleRef?.close(); });

  // pg-mem mis-types GREATEST → replenish stock before each createSale.
  const freshStock = () => ds.getRepository(ProductEntity).update({ storeId: STORE_ID }, { stockQuantity: 1000 });

  it('refuse le void d\'une vente cash pure (409 Conflict)', async () => {
    await freshStock();
    const dto = {
      items: [{ ean: '5000000000001', quantity: 1 }],
      payments: [{ method: 'cash', amountMinorUnits: 500 }],
    };
    const sale: any = await sales.createSale(STORE_ID, EMP_ID, dto as any, SNAP_ADMIN);
    await expect(
      sales.voidSale(sale.id, EMP_ID, STORE_ID, 'admin'),
    ).rejects.toThrow(ConflictException);
  });

  it('refuse le void d\'une vente mixte avec leg cash > 0 (409 Conflict)', async () => {
    await freshStock();
    // 2 articles à 5€ = 1000 ; payés 600 cash + 400 carte
    const dto = {
      items: [{ ean: '5000000000001', quantity: 2 }],
      payments: [
        { method: 'cash', amountMinorUnits: 600 },
        { method: 'card', amountMinorUnits: 400 },
      ],
    };
    const sale: any = await sales.createSale(STORE_ID, EMP_ID, dto as any, SNAP_ADMIN);
    await expect(
      sales.voidSale(sale.id, EMP_ID, STORE_ID, 'admin'),
    ).rejects.toThrow(ConflictException);
  });

  it('autorise le void d\'une vente carte pure (hors scope du guard cash)', async () => {
    // Hors scope : void-après-carte-settled relève d'un follow-up (guard
    // unifié réversibilité alimenté par signal PSP). Cette PR ne traite que
    // l'exfil cash ; une vente carte pure passe le guard et le void aboutit.
    await freshStock();
    const dto = {
      items: [{ ean: '5000000000001', quantity: 1 }],
      payments: [{ method: 'card', amountMinorUnits: 500 }],
    };
    const sale: any = await sales.createSale(STORE_ID, EMP_ID, dto as any, SNAP_ADMIN);
    const voided: any = await sales.voidSale(sale.id, EMP_ID, STORE_ID, 'admin');
    expect(voided.status).toBe('voided');
  });

  it('refuse le void par un caissier (non-manager) d\'une vente cash réalisée (guard role-independent)', async () => {
    // L'authZ actuel (manager-cap) ne gate pas les caissiers : sans le guard
    // sécurité, n'importe quel employé authentifié pourrait voider. Le guard
    // structurel sur l'opération ferme l'exfil cash quel que soit le rôle —
    // c'est précisément l'acteur-menace principal (caissier) qui est stoppé
    // par le guard structurel, pas par un check de rôle qui n'existe pas.
    await freshStock();
    const dto = {
      items: [{ ean: '5000000000001', quantity: 1 }],
      payments: [{ method: 'cash', amountMinorUnits: 500 }],
    };
    const sale: any = await sales.createSale(STORE_ID, EMP_ID, dto as any, SNAP_ADMIN);
    // Caissier (rôle 'cashier' ou tout non-manager) tente le void
    await expect(
      sales.voidSale(sale.id, EMP_ID, STORE_ID, 'cashier'),
    ).rejects.toThrow(ConflictException);
  });
});
