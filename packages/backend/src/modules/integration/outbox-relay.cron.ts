import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OutboxRelayService } from './outbox-relay.service';
import { isRelayCronEnabled } from '../../common/integration/outbox-relay';

/**
 * Automatic outbox relay (POS-INT-85). Publishes pending/retryable integration
 * events out-of-band, every 5 minutes. DISABLED by default — set
 * OUTBOX_RELAY_ENABLED=true (prod, with a real publisher) to activate.
 * Never in the caisse path; failures are logged, never thrown.
 */
@Injectable()
export class OutboxRelayCron {
  private readonly logger = new Logger(OutboxRelayCron.name);

  constructor(private readonly relay: OutboxRelayService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'outbox-relay', timeZone: 'Europe/Paris' })
  async handle(): Promise<void> {
    if (!isRelayCronEnabled(process.env.OUTBOX_RELAY_ENABLED)) return;
    try {
      const report = await this.relay.relayBatch(500);
      if (report.processed > 0) {
        this.logger.log(
          `Outbox relay: processed=${report.processed} published=${report.published} pending=${report.pending} failed=${report.failed}`,
        );
      }
    } catch (e: any) {
      this.logger.warn(`Outbox relay cron failed: ${e?.message}`);
    }
  }
}
