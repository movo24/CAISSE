/**
 * Decision 5 — manual discount enforcement. No free seller discount: a manual
 * cart discount REQUIRES a manager/admin approver, is capped HARD at 30% (blocked
 * above), the approver id is captured on the sale, and it is audited. A seller
 * cannot bypass it.
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcrypt';
import { createPgMemDataSource, loadAllEntities } from './helpers/pgmem';
import { SalesModule } from '../src/modules/sales/sales.module';
import { ProductsModule } from '../src/modules/products/products.module';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { SalesService } from '../src/modules/sales/sales.service';
import { SaleEntity } from '../src/database/entities/sale.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';
import { EmployeeEntity } from '../src/database/entities/employee.entity';
import { AuditEntryEntity } from '../src/database/entities/audit-entry.entity';

describe('Decision 5 — manual discount enforcement (30% cap + manager approver)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  const STORE = uuidv4();
  const SELLER = uuidv4();
  const MANAGER = uuidv4();
  const CASHIER2 = uuidv4();
  const snap = { employeeName: 'Vendeur', employeeRole: 'cashier', maxDiscount: 100 };

  const sale = (over: any = {}) => ({
    items: [{ ean: '3000000000001', quantity: 2 }], // 2 × 1000 = 2000 subtotal
    payments: [{ method: 'cash', amountMinorUnits: 2000 }],
    ...over,
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
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, ProductsModule, SalesModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);

    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'B43', storeCode: 'B43', currencyCode: 'EUR', isActive: true } as any);
    const emp = (id: string, role: string) => ({ id, storeId: STORE, firstName: role, lastName: 'x', email: `${id}@x.fr`, pinHash: 'h', qrCode: id, role, maxDiscountPercent: 100, isActive: true });
    await ds.getRepository(EmployeeEntity).save([emp(SELLER, 'cashier'), emp(MANAGER, 'manager'), emp(CASHIER2, 'cashier')] as any);
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE, ean: '3000000000001', name: 'Café', priceMinorUnits: 1000, taxRate: 20,
      stockQuantity: 1000, stockAlertThreshold: 5, stockCriticalThreshold: 1, isActive: true,
    } as any);
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  it('ADVERSE — a manual discount WITHOUT an approver is blocked (no free seller discount)', async () => {
    await expect(sales.createSale(STORE, SELLER, sale({ manualDiscountMinorUnits: 200 }) as any, snap)).rejects.toThrow(/responsable requise/);
  });

  it('ADVERSE — an approver who is NOT a manager/admin is rejected', async () => {
    await expect(
      sales.createSale(STORE, SELLER, sale({ manualDiscountMinorUnits: 200, discountApproverId: CASHIER2 }) as any, snap),
    ).rejects.toThrow(/approbateur invalide/);
  });

  it('DECISIVE — above 30% is BLOCKED even with a valid manager approver', async () => {
    await expect(
      sales.createSale(STORE, SELLER, sale({ manualDiscountMinorUnits: 700, discountApproverId: MANAGER }) as any, snap), // 35% of 2000
    ).rejects.toThrow(/plafond de 30%/);
  });

  it('DECISIVE — a ≤30% manual discount with a manager approver applies, captures the approver, and is audited', async () => {
    const s: any = await sales.createSale(
      STORE, SELLER, sale({ manualDiscountMinorUnits: 600, discountApproverId: MANAGER, payments: [{ method: 'cash', amountMinorUnits: 1400 }] }) as any, snap, `disc-${uuidv4()}`,
    );
    expect(s.discountTotalMinorUnits).toBe(600); // 30% of 2000
    expect(s.totalMinorUnits).toBe(1400); // 2000 − 600
    expect(s.discountApproverId).toBe(MANAGER); // approver captured on the sale
    const audits = await ds.getRepository(AuditEntryEntity).find({ where: { storeId: STORE, action: 'discount_applied' } });
    expect(audits.some((a) => (a.details as any).discountApproverId === MANAGER && (a.details as any).manualDiscountMinorUnits === 600)).toBe(true);
  });

  it('a sale with no manual discount is unaffected (approver null)', async () => {
    // pg-mem mis-types GREATEST(0, stock-$1) so a prior sale zeroed stock — reset.
    await ds.getRepository(ProductEntity).update({ ean: '3000000000001', storeId: STORE }, { stockQuantity: 1000 });
    const s: any = await sales.createSale(STORE, SELLER, sale() as any, snap, `nodisc-${uuidv4()}`);
    expect(s.discountTotalMinorUnits).toBe(0);
    expect(s.discountApproverId).toBeNull();
    expect(s.totalMinorUnits).toBe(2000);
  });
});
