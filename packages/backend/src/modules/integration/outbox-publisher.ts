import { Logger } from '@nestjs/common';
import axios from 'axios';
import { IntegrationEventEntity } from '../../database/entities/integration-event.entity';
import { buildOutboxPublishRequest } from './publish-request';

/** DI token for the active outbox publisher (sink). */
export const OUTBOX_PUBLISHER = 'OUTBOX_PUBLISHER';

/**
 * A publisher delivers an outbox event to a downstream system
 * (Comptamax24 / TimeWin24 / Analytik R). Returns true on success.
 */
export interface OutboxPublisher {
  publish(event: IntegrationEventEntity): Promise<boolean>;
}

/**
 * Simulation sink — sandbox/local default. Logs the delivery and reports success.
 * NO real network, NO secrets. Swap for a real HTTP publisher in prod via the
 * OUTBOX_PUBLISHER provider (gated: TD-INT-RELAY).
 */
export class SimulationOutboxPublisher implements OutboxPublisher {
  private readonly logger = new Logger('SimulationOutboxPublisher');

  async publish(event: IntegrationEventEntity): Promise<boolean> {
    this.logger.log(
      `[SIMULATION] would deliver ${event.type} (${event.aggregateType}:${event.aggregateId}) store=${event.storeId}`,
    );
    return true;
  }
}

/**
 * Real HTTP sink (gated). POSTs the signed envelope to OUTBOX_PUBLISH_URL with an
 * HMAC header (OUTBOX_PUBLISH_SECRET). Activated ONLY when both env vars are set
 * — otherwise the factory keeps the simulation sink. No secret is embedded.
 */
export class HttpOutboxPublisher implements OutboxPublisher {
  private readonly logger = new Logger('HttpOutboxPublisher');

  constructor(
    private readonly url: string,
    private readonly secret: string,
    private readonly timeoutMs = 10_000,
  ) {}

  async publish(event: IntegrationEventEntity): Promise<boolean> {
    const req = buildOutboxPublishRequest(event as any, this.secret);
    const res = await axios.post(this.url, req.body, {
      headers: req.headers,
      timeout: this.timeoutMs,
      validateStatus: () => true,
    });
    const ok = res.status >= 200 && res.status < 300;
    if (!ok) this.logger.warn(`Publish ${event.id} → HTTP ${res.status}`);
    return ok;
  }
}

/** Choose the publisher from env: real HTTP sink when configured, else simulation. */
export function createOutboxPublisher(): OutboxPublisher {
  const url = process.env.OUTBOX_PUBLISH_URL;
  const secret = process.env.OUTBOX_PUBLISH_SECRET;
  if (url && secret) {
    return new HttpOutboxPublisher(url, secret);
  }
  return new SimulationOutboxPublisher();
}
