import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationEventEntity } from '../../database/entities/integration-event.entity';
import { PosSessionEntity } from '../../database/entities/pos-session.entity';
import { OutboxRelayService } from './outbox-relay.service';
import { OutboxQueryService } from './outbox-query.service';
import { ReconciliationService } from './reconciliation.service';
import { IntegrationController } from './integration.controller';
import { OUTBOX_PUBLISHER, SimulationOutboxPublisher } from './outbox-publisher';
import { TimewinModule } from '../timewin/timewin.module';

/**
 * Integration outbox relay module. The publisher is the simulation sink by
 * default (sandbox/local, no secrets). A real HTTP publisher is wired in prod
 * by overriding the OUTBOX_PUBLISHER provider (gated: TD-INT-RELAY).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([IntegrationEventEntity, PosSessionEntity]),
    TimewinModule,
  ],
  controllers: [IntegrationController],
  providers: [
    OutboxRelayService,
    OutboxQueryService,
    ReconciliationService,
    { provide: OUTBOX_PUBLISHER, useClass: SimulationOutboxPublisher },
  ],
  exports: [OutboxRelayService, OutboxQueryService, ReconciliationService],
})
export class IntegrationModule {}
