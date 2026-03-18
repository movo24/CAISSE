// ── decision-engine/decision-engine.module.ts ───────────────────
// NestJS module — Deterministic decision engine
// Separated from IA: rules decide, IA explains
// ─────────────────────────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreEntity } from '../../database/entities/store.entity';
import { SaleEntity } from '../../database/entities/sale.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { PromoRuleEntity } from '../../database/entities/promo-rule.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { PointageEntryEntity } from '../../database/entities/pointage-entry.entity';
import { WeatherModule } from '../weather/weather.module';
import { TransportModule } from '../transport/transport.module';
import { FootfallModule } from '../footfall/footfall.module';
import { PosAiModule } from '../pos-ai/pos-ai.module';
import { ContextCollector } from './context-collector';
import { ActionsService } from './actions.service';
import { AuditLogger } from './audit.logger';
import { DecisionEngineService } from './decision-engine.service';
import { DecisionEngineController } from './decision-engine.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StoreEntity,
      SaleEntity,
      ProductEntity,
      PromoRuleEntity,
      EmployeeEntity,
      PointageEntryEntity,
    ]),
    WeatherModule,
    TransportModule,
    FootfallModule,
    PosAiModule,
  ],
  controllers: [DecisionEngineController],
  providers: [
    ContextCollector,
    ActionsService,
    AuditLogger,
    DecisionEngineService,
  ],
  exports: [DecisionEngineService],
})
export class DecisionEngineModule {}
