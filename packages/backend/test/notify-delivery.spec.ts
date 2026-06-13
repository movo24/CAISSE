/**
 * Étage 4 — delivery engine. DECISIVE cases:
 *  - store_closed_late is NEVER delivered (D-ALERTS-1 freeze, structural);
 *  - recipient scope at delivery time (another org's device gets nothing);
 *  - INV-6: a re-tick never double-delivers (unique (alert, device) claim);
 *  - quiet hours (user data): held with NOTHING recorded, delivered after the window;
 *  - disabled preferences: nothing sent.
 * Provider = a capturing sender behind the PUSH_SENDER seam (no network).
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { OrganizationEntity } from '../src/database/entities/organization.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { EmployeeEntity } from '../src/database/entities/employee.entity';
import { EmployeeStoreAccessEntity } from '../src/database/entities/employee-store-access.entity';
import { AnalyticsAlertEntity } from '../src/database/entities/analytics-alert.entity';
import { AnalyticsStoreClockEntity } from '../src/database/entities/analytics-store-clock.entity';
import { NotifyDeviceTokenEntity } from '../src/database/entities/notify-device-token.entity';
import { NotifyPreferenceEntity } from '../src/database/entities/notify-preference.entity';
import { NotifyDeliveryEntity } from '../src/database/entities/notify-delivery.entity';
import { StoreScopeResolverService } from '../src/modules/analytics-projection/store-scope-resolver.service';
import { NotifyDeliveryService, inQuietWindow } from '../src/modules/notify/notify-delivery.service';
import { PushPayload, PushSender } from '../src/modules/notify/push-sender.interface';

class CapturingSender implements PushSender {
  readonly channel = 'test';
  sent: Array<{ token: string; payload: PushPayload }> = [];
  async send(device: { token: string; platform: string }, payload: PushPayload): Promise<void> {
    this.sent.push({ token: device.token, payload });
  }
}

describe('Étage 4 — notify delivery engine', () => {
  let ds: DataSource;
  let svc: NotifyDeliveryService;
  let sender: CapturingSender;
  const ORG_A = uuidv4();
  const ORG_B = uuidv4();
  const S1 = uuidv4(); // org A
  const S4 = uuidv4(); // org B
  const MANAGER = uuidv4(); // home S1
  const OUTSIDER = uuidv4(); // home S4 (other org)
  let voidAlertId: string;
  let frozenAlertId: string;

  const seedAlert = async (rule: string, band = 'warning', storeId = S1) => {
    const row = await ds.getRepository(AnalyticsAlertEntity).save({
      storeId, rule, businessDay: new Date().toISOString().slice(0, 10), thresholdBand: band, payload: {}, computedAt: new Date(),
    } as any);
    return row.id;
  };

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    await ds.getRepository(OrganizationEntity).save([{ id: ORG_A, name: 'Wesley' }, { id: ORG_B, name: 'Other' }] as any);
    await ds.getRepository(StoreEntity).save([
      { id: S1, name: 'B43', organizationId: ORG_A, isActive: true, currencyCode: 'EUR' },
      { id: S4, name: 'Évry', organizationId: ORG_B, isActive: true, currencyCode: 'EUR' },
    ] as any);
    const emp = (id: string, storeId: string, role: string) => ({
      id, storeId, firstName: 'T', lastName: 'U', email: `${id}@x.fr`, pinHash: 'h', qrCode: id, role,
    });
    await ds.getRepository(EmployeeEntity).save([emp(MANAGER, S1, 'manager'), emp(OUTSIDER, S4, 'cashier')] as any);
    await ds.getRepository(NotifyDeviceTokenEntity).save([
      { employeeId: MANAGER, platform: 'ios', token: 'tok-manager', isActive: true },
      { employeeId: OUTSIDER, platform: 'android', token: 'tok-outsider', isActive: true },
    ] as any);

    voidAlertId = await seedAlert('void_rate');
    frozenAlertId = await seedAlert('store_closed_late', 'open_after_close');

    sender = new CapturingSender();
    svc = new NotifyDeliveryService(
      ds.getRepository(AnalyticsAlertEntity),
      ds.getRepository(EmployeeEntity),
      ds.getRepository(NotifyDeviceTokenEntity),
      ds.getRepository(NotifyPreferenceEntity),
      ds.getRepository(NotifyDeliveryEntity),
      ds.getRepository(AnalyticsStoreClockEntity),
      new StoreScopeResolverService(ds.getRepository(StoreEntity), ds.getRepository(EmployeeStoreAccessEntity)),
      sender,
    );
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('DECISIVE — delivers the in-scope fact, NEVER store_closed_late (D-ALERTS-1), nothing out of scope', async () => {
    const r = await svc.deliverAll(new Date());
    expect(r.sent).toBe(1); // void_rate → the manager's device, and nothing else
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].token).toBe('tok-manager');
    expect(sender.sent[0].payload.data.rule).toBe('void_rate');
    // the frozen rule never crossed the seam nor the ledger:
    expect(sender.sent.some((s) => s.payload.data.rule === 'store_closed_late')).toBe(false);
    expect(await ds.getRepository(NotifyDeliveryEntity).count({ where: { alertId: frozenAlertId } })).toBe(0);
    // the outsider's device (other org) got nothing:
    expect(sender.sent.some((s) => s.token === 'tok-outsider')).toBe(false);
  });

  it('DECISIVE INV-6 — a re-tick never double-delivers (the unique claim absorbs it)', async () => {
    const r = await svc.deliverAll(new Date());
    expect(r.sent).toBe(0);
    expect(await ds.getRepository(NotifyDeliveryEntity).count({ where: { alertId: voidAlertId } })).toBe(1);
    expect(sender.sent).toHaveLength(1); // unchanged
  });

  it('DECISIVE quiet hours — held with NOTHING recorded, then delivered after the window', async () => {
    const now = new Date();
    const h = now.getUTCHours();
    // a window covering "now" (wraps midnight when h >= 22 — exercises the wrap)
    await ds.getRepository(NotifyPreferenceEntity).save({
      employeeId: MANAGER, enabled: true, quietStartHour: h, quietEndHour: (h + 2) % 24,
    } as any);
    const quietAlertId = await seedAlert('stock_low', 'rupture');

    const held = await svc.deliverAll(now);
    expect(held.sent).toBe(0);
    expect(held.held).toBeGreaterThanOrEqual(1);
    expect(await ds.getRepository(NotifyDeliveryEntity).count({ where: { alertId: quietAlertId } })).toBe(0); // nothing recorded

    // window moved away from "now" → the held alert goes out on the next tick
    await ds.getRepository(NotifyPreferenceEntity).save({
      employeeId: MANAGER, enabled: true, quietStartHour: (h + 5) % 24, quietEndHour: (h + 7) % 24,
    } as any);
    const after = await svc.deliverAll(now);
    expect(after.sent).toBe(1);
    expect(await ds.getRepository(NotifyDeliveryEntity).count({ where: { alertId: quietAlertId } })).toBe(1);
  });

  it('disabled preferences → nothing sent (user opt-out, nothing recorded)', async () => {
    await ds.getRepository(NotifyPreferenceEntity).save({
      employeeId: MANAGER, enabled: false, quietStartHour: null, quietEndHour: null,
    } as any);
    const optOutAlertId = await seedAlert('discount_rate');
    const r = await svc.deliverAll(new Date());
    expect(r.sent).toBe(0);
    expect(await ds.getRepository(NotifyDeliveryEntity).count({ where: { alertId: optOutAlertId } })).toBe(0);
  });

  it('inQuietWindow — straight and midnight-wrapping windows, degenerate = none', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 5, 12, h, 0, 0));
    const UTC = 'Etc/UTC';
    expect(inQuietWindow({ quietStartHour: 9, quietEndHour: 17 }, at(12), UTC)).toBe(true);
    expect(inQuietWindow({ quietStartHour: 9, quietEndHour: 17 }, at(18), UTC)).toBe(false);
    expect(inQuietWindow({ quietStartHour: 22, quietEndHour: 7 }, at(23), UTC)).toBe(true); // wrap
    expect(inQuietWindow({ quietStartHour: 22, quietEndHour: 7 }, at(3), UTC)).toBe(true); // wrap
    expect(inQuietWindow({ quietStartHour: 22, quietEndHour: 7 }, at(12), UTC)).toBe(false);
    expect(inQuietWindow({ quietStartHour: null, quietEndHour: null }, at(12), UTC)).toBe(false);
    expect(inQuietWindow({ quietStartHour: 8, quietEndHour: 8 }, at(8), UTC)).toBe(false); // degenerate
  });

  it('A1 DECISIVE — quiet hours are LOCAL: 21:00Z = 23:00 Paris is INSIDE a 22h–7h window (UTC hour 21 was not)', () => {
    const w = { quietStartHour: 22, quietEndHour: 7 };
    const summerNight = new Date('2026-06-12T21:00:00Z'); // 23:00 Paris (UTC+2)
    expect(inQuietWindow(w, summerNight, 'Europe/Paris')).toBe(true);
    expect(inQuietWindow(w, summerNight, 'Etc/UTC')).toBe(false); // the old stand-in would have paged
  });
});
