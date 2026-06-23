/**
 * NotificationsService (service / DB layer) — pg-mem.
 *
 * Exercises the REAL service against an in-memory Postgres:
 *  - getLoyaltyReminders: tenant scoping (storeId), is_verified filter,
 *    inactivity cutoff (never-visited + days-since), priority assignment
 *    (high/medium/low) including the high-points bonus, and priority ordering.
 *  - getStockNotifications: level classification (out_of_stock/critical/alert),
 *    isActive + storeId scoping, and level ordering.
 *  - getNotificationSummary: aggregation + stats counters.
 *  - generateQrReminderMessage: first-purchase vs returning message, NotFound,
 *    and tenant isolation.
 *
 * Determinism notes:
 *  - The loyalty query uses MAX(s.created_at) in a raw subquery. created_at is a
 *    @CreateDateColumn we cannot set on insert, so each sale's date is backdated
 *    via a raw UPDATE to make "daysSinceLastVisit" deterministic. We assert on
 *    direction/priority/ordering, never on a value produced by in-SQL arithmetic.
 */
import './helpers/env-setup';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { CustomerEntity } from '../src/database/entities/customer.entity';
import { SaleEntity } from '../src/database/entities/sale.entity';
import { ProductEntity } from '../src/database/entities/product.entity';
import { StoreEntity } from '../src/database/entities/store.entity';

// Product.store_id is a uuid FK to stores.id, so store ids must be valid uuids.
const STORE_A = uuidv4();
const STORE_B = uuidv4();

describe('NotificationsService (service/DB layer)', () => {
  let ds: DataSource;
  let svc: NotificationsService;

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = await dataSource.initialize();
    svc = new NotificationsService(
      ds.getRepository(CustomerEntity),
      ds.getRepository(SaleEntity),
      ds.getRepository(ProductEntity),
    );

    // products.store_id is a FK to stores.id — seed both stores once.
    const storeRepo = ds.getRepository(StoreEntity);
    await storeRepo.save({
      id: STORE_A,
      name: 'Store A',
      isActive: true,
      currencyCode: 'EUR',
    } as any);
    await storeRepo.save({
      id: STORE_B,
      name: 'Store B',
      isActive: true,
      currencyCode: 'EUR',
    } as any);
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM sales');
    await ds.query('DELETE FROM customers');
    await ds.query('DELETE FROM products');
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  async function makeCustomer(
    overrides: Partial<CustomerEntity> = {},
  ): Promise<CustomerEntity> {
    const repo = ds.getRepository(CustomerEntity);
    const c = repo.create({
      firstName: overrides.firstName ?? 'Jean',
      lastName: overrides.lastName ?? 'Dupont',
      qrCode: overrides.qrCode ?? `QR-${uuidv4()}`,
      loyaltyPoints: overrides.loyaltyPoints ?? 0,
      isFirstPurchase: overrides.isFirstPurchase ?? true,
      isVerified: overrides.isVerified ?? true,
      storeId: overrides.storeId ?? STORE_A,
    } as Partial<CustomerEntity>);
    return repo.save(c);
  }

  /** Create a completed sale for a customer and backdate created_at by N days. */
  async function makeSaleDaysAgo(
    customerId: string,
    daysAgo: number,
    opts: { storeId?: string; status?: string } = {},
  ): Promise<void> {
    const repo = ds.getRepository(SaleEntity);
    const sale = await repo.save(
      repo.create({
        storeId: opts.storeId ?? STORE_A,
        employeeId: uuidv4(),
        customerId,
        status: opts.status ?? 'completed',
        ticketNumber: `T-${uuidv4()}`,
      }),
    );
    const when = new Date();
    when.setDate(when.getDate() - daysAgo);
    await ds.query('UPDATE sales SET created_at = $1 WHERE id = $2', [
      when.toISOString(),
      sale.id,
    ]);
  }

  async function makeProduct(
    overrides: Partial<ProductEntity> = {},
  ): Promise<ProductEntity> {
    const repo = ds.getRepository(ProductEntity);
    const p = repo.create({
      ean: overrides.ean ?? `EAN-${uuidv4()}`,
      name: overrides.name ?? 'Bonbon',
      priceMinorUnits: overrides.priceMinorUnits ?? 100,
      stockQuantity: overrides.stockQuantity ?? 50,
      stockAlertThreshold: overrides.stockAlertThreshold ?? 10,
      stockCriticalThreshold: overrides.stockCriticalThreshold ?? 5,
      isActive: overrides.isActive ?? true,
      storeId: overrides.storeId ?? STORE_A,
    });
    return repo.save(p);
  }

  // ── getLoyaltyReminders ───────────────────────────────────────────────────

  describe('getLoyaltyReminders', () => {
    it('includes a customer who never purchased with priority "medium"', async () => {
      await makeCustomer({ firstName: 'Alice', loyaltyPoints: 0 });

      const reminders = await svc.getLoyaltyReminders(STORE_A, 30);

      expect(reminders).toHaveLength(1);
      expect(reminders[0].lastVisitDate).toBeNull();
      expect(reminders[0].daysSinceLastVisit).toBeNull();
      expect(reminders[0].priority).toBe('medium');
      expect(reminders[0].message).toContain('jamais');
    });

    it('excludes unverified customers', async () => {
      await makeCustomer({ isVerified: false });

      const reminders = await svc.getLoyaltyReminders(STORE_A, 30);

      expect(reminders).toHaveLength(0);
    });

    it('excludes a recently-active customer (within inactiveDays)', async () => {
      const c = await makeCustomer({ firstName: 'Bob' });
      await makeSaleDaysAgo(c.id, 5); // active 5 days ago, cutoff 30

      const reminders = await svc.getLoyaltyReminders(STORE_A, 30);

      expect(reminders).toHaveLength(0);
    });

    it('includes an inactive customer and computes a positive daysSinceLastVisit', async () => {
      const c = await makeCustomer({ firstName: 'Carol' });
      await makeSaleDaysAgo(c.id, 45);

      const reminders = await svc.getLoyaltyReminders(STORE_A, 30);

      expect(reminders).toHaveLength(1);
      expect(reminders[0].daysSinceLastVisit).toBeGreaterThanOrEqual(44);
      expect(reminders[0].priority).toBe('low'); // 30 <= days < 60
    });

    it('assigns "high" priority when inactive >= 90 days', async () => {
      const c = await makeCustomer({ firstName: 'Dan' });
      await makeSaleDaysAgo(c.id, 120);

      const reminders = await svc.getLoyaltyReminders(STORE_A, 30);

      expect(reminders).toHaveLength(1);
      expect(reminders[0].priority).toBe('high');
      expect(reminders[0].message).toContain('risque');
    });

    it('assigns "medium" priority when inactive in [60,90)', async () => {
      const c = await makeCustomer({ firstName: 'Eve' });
      await makeSaleDaysAgo(c.id, 75);

      const reminders = await svc.getLoyaltyReminders(STORE_A, 30);

      expect(reminders).toHaveLength(1);
      expect(reminders[0].priority).toBe('medium');
    });

    it('bumps a low-priority customer to "high" when loyaltyPoints >= 100', async () => {
      const c = await makeCustomer({ firstName: 'Frank', loyaltyPoints: 150 });
      await makeSaleDaysAgo(c.id, 40); // would be "low" without the bonus

      const reminders = await svc.getLoyaltyReminders(STORE_A, 30);

      expect(reminders).toHaveLength(1);
      expect(reminders[0].priority).toBe('high');
      expect(reminders[0].message).toContain('fidele');
    });

    it('does NOT mutate message for high-points customers already at "high"', async () => {
      const c = await makeCustomer({ firstName: 'Gina', loyaltyPoints: 200 });
      await makeSaleDaysAgo(c.id, 120); // already high (>= 90 days)

      const reminders = await svc.getLoyaltyReminders(STORE_A, 30);

      expect(reminders[0].priority).toBe('high');
      // the bonus suffix is only appended when priority !== 'high'
      expect(reminders[0].message).not.toContain('fidele');
    });

    it('is tenant-scoped: ignores customers and sales from other stores', async () => {
      // Customer in store B must not appear when querying store A.
      const cb = await makeCustomer({ firstName: 'Other', storeId: STORE_B });
      await makeSaleDaysAgo(cb.id, 200, { storeId: STORE_B });

      const reminders = await svc.getLoyaltyReminders(STORE_A, 30);

      expect(reminders).toHaveLength(0);
    });

    it('counts only completed sales when computing last visit', async () => {
      // A pending sale should be ignored, so the customer is treated as never-visited.
      const c = await makeCustomer({ firstName: 'Hana' });
      await makeSaleDaysAgo(c.id, 5, { status: 'pending' });

      const reminders = await svc.getLoyaltyReminders(STORE_A, 30);

      expect(reminders).toHaveLength(1);
      expect(reminders[0].lastVisitDate).toBeNull();
      expect(reminders[0].priority).toBe('medium'); // never-visited branch
    });

    it('orders reminders by priority high > medium > low', async () => {
      const high = await makeCustomer({ firstName: 'High' });
      await makeSaleDaysAgo(high.id, 120);
      const medium = await makeCustomer({ firstName: 'Medium' });
      await makeSaleDaysAgo(medium.id, 70);
      const low = await makeCustomer({ firstName: 'Low' });
      await makeSaleDaysAgo(low.id, 40);

      const reminders = await svc.getLoyaltyReminders(STORE_A, 30);

      expect(reminders.map((r) => r.priority)).toEqual([
        'high',
        'medium',
        'low',
      ]);
    });

    it('sets customerName, qrCode and loyaltyPoints from the entity', async () => {
      const c = await makeCustomer({
        firstName: 'Ivy',
        lastName: 'Stone',
        qrCode: 'QR-IVY',
        loyaltyPoints: 42,
      });

      const reminders = await svc.getLoyaltyReminders(STORE_A, 30);

      expect(reminders[0].customerId).toBe(c.id);
      expect(reminders[0].customerName).toBe('Ivy Stone');
      expect(reminders[0].qrCode).toBe('QR-IVY');
      expect(reminders[0].loyaltyPoints).toBe(42);
    });
  });

  // ── getStockNotifications ─────────────────────────────────────────────────

  describe('getStockNotifications', () => {
    it('flags out_of_stock when quantity <= 0', async () => {
      await makeProduct({ name: 'Empty', stockQuantity: 0 });

      const notes = await svc.getStockNotifications(STORE_A);

      expect(notes).toHaveLength(1);
      expect(notes[0].level).toBe('out_of_stock');
      expect(notes[0].message).toContain('rupture');
    });

    it('flags critical when quantity <= criticalThreshold (and > 0)', async () => {
      await makeProduct({
        name: 'Critical',
        stockQuantity: 5,
        stockCriticalThreshold: 5,
        stockAlertThreshold: 10,
      });

      const notes = await svc.getStockNotifications(STORE_A);

      expect(notes).toHaveLength(1);
      expect(notes[0].level).toBe('critical');
    });

    it('flags alert when quantity <= alertThreshold but > criticalThreshold', async () => {
      await makeProduct({
        name: 'Alert',
        stockQuantity: 8,
        stockCriticalThreshold: 5,
        stockAlertThreshold: 10,
      });

      const notes = await svc.getStockNotifications(STORE_A);

      expect(notes).toHaveLength(1);
      expect(notes[0].level).toBe('alert');
    });

    it('does not flag a well-stocked product', async () => {
      await makeProduct({
        name: 'Healthy',
        stockQuantity: 100,
        stockAlertThreshold: 10,
        stockCriticalThreshold: 5,
      });

      const notes = await svc.getStockNotifications(STORE_A);

      expect(notes).toHaveLength(0);
    });

    it('ignores inactive products', async () => {
      await makeProduct({ name: 'Inactive', stockQuantity: 0, isActive: false });

      const notes = await svc.getStockNotifications(STORE_A);

      expect(notes).toHaveLength(0);
    });

    it('is tenant-scoped to storeId', async () => {
      await makeProduct({ name: 'OtherStore', stockQuantity: 0, storeId: STORE_B });

      const notes = await svc.getStockNotifications(STORE_A);

      expect(notes).toHaveLength(0);
    });

    it('orders out_of_stock > critical > alert', async () => {
      await makeProduct({
        name: 'A-alert',
        stockQuantity: 8,
        stockCriticalThreshold: 5,
        stockAlertThreshold: 10,
      });
      await makeProduct({
        name: 'C-critical',
        stockQuantity: 3,
        stockCriticalThreshold: 5,
        stockAlertThreshold: 10,
      });
      await makeProduct({ name: 'O-out', stockQuantity: 0 });

      const notes = await svc.getStockNotifications(STORE_A);

      expect(notes.map((n) => n.level)).toEqual([
        'out_of_stock',
        'critical',
        'alert',
      ]);
    });

    it('returns threshold metadata on the notification', async () => {
      const p = await makeProduct({
        name: 'Meta',
        ean: 'EAN-META',
        stockQuantity: 0,
        stockAlertThreshold: 12,
        stockCriticalThreshold: 6,
      });

      const notes = await svc.getStockNotifications(STORE_A);

      expect(notes[0].productId).toBe(p.id);
      expect(notes[0].ean).toBe('EAN-META');
      expect(notes[0].alertThreshold).toBe(12);
      expect(notes[0].criticalThreshold).toBe(6);
      expect(notes[0].stockQuantity).toBe(0);
    });
  });

  // ── getNotificationSummary ────────────────────────────────────────────────

  describe('getNotificationSummary', () => {
    it('aggregates reminders + stock notifications with correct stats', async () => {
      // 1 inactive (never-visited) customer
      await makeCustomer({ firstName: 'Sum' });
      // stock: 1 alert, 1 critical, 1 out_of_stock
      await makeProduct({
        name: 'alert',
        stockQuantity: 8,
        stockCriticalThreshold: 5,
        stockAlertThreshold: 10,
      });
      await makeProduct({
        name: 'critical',
        stockQuantity: 3,
        stockCriticalThreshold: 5,
        stockAlertThreshold: 10,
      });
      await makeProduct({ name: 'out', stockQuantity: 0 });

      const summary = await svc.getNotificationSummary(STORE_A, 30);

      expect(typeof summary.generatedAt).toBe('string');
      expect(summary.stats.totalInactiveCustomers).toBe(1);
      expect(summary.stats.totalStockAlerts).toBe(1);
      // criticalStock counts both critical and out_of_stock
      expect(summary.stats.totalCriticalStock).toBe(2);
      expect(summary.loyaltyReminders).toHaveLength(1);
      expect(summary.stockNotifications).toHaveLength(3);
    });

    it('returns empty collections and zeroed stats for a clean store', async () => {
      const summary = await svc.getNotificationSummary(STORE_A, 30);

      expect(summary.loyaltyReminders).toEqual([]);
      expect(summary.stockNotifications).toEqual([]);
      expect(summary.stats).toEqual({
        totalInactiveCustomers: 0,
        totalStockAlerts: 0,
        totalCriticalStock: 0,
      });
    });
  });

  // ── generateQrReminderMessage ─────────────────────────────────────────────

  describe('generateQrReminderMessage', () => {
    it('returns a welcome message for a first-purchase customer', async () => {
      const c = await makeCustomer({
        firstName: 'New',
        isFirstPurchase: true,
        qrCode: 'QR-NEW',
      });

      const res = await svc.generateQrReminderMessage(c.id, STORE_A);

      expect(res.qrCode).toBe('QR-NEW');
      expect(res.message).toContain('-5%');
      expect(res.message).toContain('New');
    });

    it('returns a loyalty message for a returning customer', async () => {
      const c = await makeCustomer({
        firstName: 'Reg',
        isFirstPurchase: false,
        loyaltyPoints: 77,
        qrCode: 'QR-REG',
      });

      const res = await svc.generateQrReminderMessage(c.id, STORE_A);

      expect(res.qrCode).toBe('QR-REG');
      expect(res.message).toContain('77 points');
      expect(res.message).not.toContain('-5%');
    });

    it('throws when the customer does not exist', async () => {
      await expect(
        svc.generateQrReminderMessage(uuidv4(), STORE_A),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is tenant-scoped: a customer from another store is treated as not found', async () => {
      const c = await makeCustomer({ firstName: 'Foreign', storeId: STORE_B });

      await expect(
        svc.generateQrReminderMessage(c.id, STORE_A),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
