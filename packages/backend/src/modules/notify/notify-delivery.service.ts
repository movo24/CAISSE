import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { AnalyticsAlertEntity } from '../../database/entities/analytics-alert.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { NotifyDeviceTokenEntity } from '../../database/entities/notify-device-token.entity';
import { NotifyPreferenceEntity } from '../../database/entities/notify-preference.entity';
import { NotifyDeliveryEntity } from '../../database/entities/notify-delivery.entity';
import { StoreScopeResolverService } from '../analytics-projection/store-scope-resolver.service';
import { PUSH_SENDER, PushSender } from './push-sender.interface';

/**
 * Étage 4 — alert delivery engine. Fans the alert FACTS (analytics.alerts) out to
 * registered devices, scoped per recipient (INV-5 resolver: a manager never
 * receives another org's alert).
 *
 * - D-ALERTS-1 FREEZE (structural, not advisory): `store_closed_late` is excluded
 *   from delivery — its wall-clock threshold runs on the UTC stand-in, so paging a
 *   human on it would page at the wrong hour twice a year. Generation continues;
 *   delivery waits for the real store-TZ policy.
 * - Quiet hours (USER data, no invented defaults): a device in its quiet window
 *   is SKIPPED with nothing recorded — the alert stays eligible and is delivered
 *   on the first tick after the window (within the 24h sweep).
 * - INV-6: UNIQUE (alert, device) claimed at write time (insert + 23505) — a
 *   re-tick can never double-deliver.
 * - Provider behind the PUSH_SENDER seam; a send failure is WARNED and the claim
 *   kept (no retry storm — push is an enhancement, the fact stays in the cockpit).
 */
@Injectable()
export class NotifyDeliveryService {
  /** D-ALERTS-1: delivery-frozen rules (generation unaffected). */
  static readonly DELIVERY_FROZEN_RULES = ['store_closed_late'];

  private readonly logger = new Logger(NotifyDeliveryService.name);

  constructor(
    @InjectRepository(AnalyticsAlertEntity) private readonly alerts: Repository<AnalyticsAlertEntity>,
    @InjectRepository(EmployeeEntity) private readonly employees: Repository<EmployeeEntity>,
    @InjectRepository(NotifyDeviceTokenEntity) private readonly devices: Repository<NotifyDeviceTokenEntity>,
    @InjectRepository(NotifyPreferenceEntity) private readonly prefs: Repository<NotifyPreferenceEntity>,
    @InjectRepository(NotifyDeliveryEntity) private readonly deliveries: Repository<NotifyDeliveryEntity>,
    private readonly scopeResolver: StoreScopeResolverService,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
  ) {}

  // Offset cron (:04, :09, …) — runs after the alerts evaluation (2-59/5).
  @Cron('4-59/5 * * * *')
  async tick(): Promise<void> {
    try {
      await this.deliverAll(new Date());
    } catch (e: any) {
      this.logger.warn(`notify delivery failed: ${e?.message}`);
    }
  }

  async deliverAll(now: Date): Promise<{ sent: number; held: number }> {
    const since = new Date(now.getTime() - 24 * 3600 * 1000);
    const recent = await this.alerts.find({ where: { createdAt: MoreThan(since) } });
    const eligible = recent.filter(
      (a) => !NotifyDeliveryService.DELIVERY_FROZEN_RULES.includes(a.rule),
    );
    if (eligible.length === 0) return { sent: 0, held: 0 };

    const activeDevices = await this.devices.find({ where: { isActive: true } });
    let sent = 0;
    let held = 0;
    const scopeCache = new Map<string, string[]>();

    for (const device of activeDevices) {
      const pref = await this.prefs.findOne({ where: { employeeId: device.employeeId } });
      if (pref && !pref.enabled) continue; // user opted out — nothing recorded

      if (pref && inQuietWindow(pref, now)) {
        held++; // quiet hours: held, NOT recorded — delivered after the window
        continue;
      }

      let scope = scopeCache.get(device.employeeId);
      if (!scope) {
        const employee = await this.employees.findOne({ where: { id: device.employeeId } });
        if (!employee) {
          this.logger.warn(`notify: device ${device.id} has no employee ${device.employeeId} — skipped`);
          continue;
        }
        scope = await this.scopeResolver.resolveAccessibleStoreIds({
          employeeId: employee.id,
          storeId: employee.storeId,
          role: employee.role,
        });
        scopeCache.set(device.employeeId, scope);
      }

      for (const alert of eligible) {
        if (!scope.includes(alert.storeId)) continue; // INV-5 at delivery time
        if ((await this.claim(alert.id, device.id)) !== 'created') continue; // INV-6
        try {
          await this.sender.send(
            { token: device.token, platform: device.platform },
            {
              title: `Alerte ${alert.rule}`,
              body: `${alert.rule} / ${alert.thresholdBand} — ${alert.businessDay}`,
              // identifiers only — the cockpit is the numbers surface
              data: {
                alertId: alert.id,
                storeId: alert.storeId,
                rule: alert.rule,
                thresholdBand: alert.thresholdBand,
                businessDay: String(alert.businessDay),
              },
            },
          );
          sent++;
        } catch (e: any) {
          // claim kept: no retry storm — the fact remains visible in the cockpit
          this.logger.warn(`notify: send failed for device ${device.id} alert ${alert.id}: ${e?.message}`);
        }
      }
    }
    return { sent, held };
  }

  /** INV-6 prevent-at-write: the unique (alert, device) key absorbs the re-tick. */
  private async claim(alertId: string, deviceId: string): Promise<'created' | 'deduped'> {
    try {
      await this.deliveries.insert({ alertId, deviceId, channel: this.sender.channel });
      return 'created';
    } catch (e: any) {
      if (isUniqueViolation(e)) return 'deduped';
      throw e;
    }
  }
}

/** Quiet window over wall-clock hours (UTC stand-in, same convention as store_clock). */
export function inQuietWindow(
  pref: { quietStartHour: number | null; quietEndHour: number | null },
  now: Date,
): boolean {
  const start = pref.quietStartHour;
  const end = pref.quietEndHour;
  if (start == null || end == null || start === end) return false;
  const h = now.getUTCHours();
  return start < end ? h >= start && h < end : h >= start || h < end; // wraps midnight
}

const isUniqueViolation = (e: any): boolean =>
  e?.code === '23505' ||
  e?.driverError?.code === '23505' ||
  /duplicate|unique/i.test(e?.message ?? '');
