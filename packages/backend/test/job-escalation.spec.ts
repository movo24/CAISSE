/**
 * Governance chantier, commit 3 — background read-model cron failures escalate
 * to AlertService (no longer a bare log.warn). Decisive: each of the three crons
 * fires its OWN event on failure, and a healthy tick fires nothing.
 *
 * Scope boundary (ratified): ONLY the three crons' escalation lives here. Fiscal
 * chain-break detection is split OUT into its own fiscal-adjacent item.
 */
import { AlertService } from '../src/common/alert/alert.service';
import { PosProjectionRefreshService } from '../src/modules/analytics-projection/pos-projection-refresh.service';
import { AlertsEngineService } from '../src/modules/alerts-engine/alerts-engine.service';
import { NotifyDeliveryService } from '../src/modules/notify/notify-delivery.service';

// The crons only STORE their injected deps (no constructor work), and the inner
// method is stubbed — so dummy args are safe. `as any` bypasses arg-count checks.
const make = (Cls: any) => new Cls(...Array.from({ length: 12 }, () => ({})));

describe('Commit 3 — cron failures escalate to AlertService', () => {
  let fire: jest.SpyInstance;
  beforeEach(() => {
    fire = jest.spyOn(AlertService.instance, 'fire').mockImplementation(() => {});
  });
  afterEach(() => fire.mockRestore());

  it('projection refresh failure → PROJECTION_REFRESH_FAILED (and the tick does not throw)', async () => {
    const svc = make(PosProjectionRefreshService);
    jest.spyOn(svc, 'refreshAll').mockRejectedValue(new Error('db down'));
    await expect(svc.refresh()).resolves.toBeUndefined(); // swallowed, not thrown
    expect(fire).toHaveBeenCalledWith('PROJECTION_REFRESH_FAILED', expect.stringContaining('db down'));
  });

  it('alerts evaluation failure → ALERTS_EVAL_FAILED', async () => {
    const svc = make(AlertsEngineService);
    jest.spyOn(svc, 'evaluateAll').mockRejectedValue(new Error('eval boom'));
    await expect(svc.tick()).resolves.toBeUndefined();
    expect(fire).toHaveBeenCalledWith('ALERTS_EVAL_FAILED', expect.stringContaining('eval boom'));
  });

  it('notify delivery failure → NOTIFY_DELIVERY_FAILED', async () => {
    const svc = make(NotifyDeliveryService);
    jest.spyOn(svc, 'deliverAll').mockRejectedValue(new Error('deliver boom'));
    await expect(svc.tick()).resolves.toBeUndefined();
    expect(fire).toHaveBeenCalledWith('NOTIFY_DELIVERY_FAILED', expect.stringContaining('deliver boom'));
  });

  it('a HEALTHY tick escalates nothing', async () => {
    const svc = make(NotifyDeliveryService);
    jest.spyOn(svc, 'deliverAll').mockResolvedValue({ sent: 0, held: 0 });
    await svc.tick();
    expect(fire).not.toHaveBeenCalled();
  });
});
