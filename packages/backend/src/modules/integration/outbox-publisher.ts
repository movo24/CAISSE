import { Logger } from '@nestjs/common';
import { IntegrationEventEntity } from '../../database/entities/integration-event.entity';

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
