import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsStoreRegistryEntity } from '../../database/entities/analytics-store-registry.entity';
import { AnalyticsStoreDailyEntity } from '../../database/entities/analytics-store-daily.entity';
import { AnalyticsStoreSessionsEntity } from '../../database/entities/analytics-store-sessions.entity';
import { AnalyticsStorePresenceEntity } from '../../database/entities/analytics-store-presence.entity';
import { AnalyticsStoreStockEntity } from '../../database/entities/analytics-store-stock.entity';
import { AnalyticsAlertEntity } from '../../database/entities/analytics-alert.entity';
import { AnalyticsAlertConfigEntity } from '../../database/entities/analytics-alert-config.entity';
import { AnalyticsAlertCursorEntity } from '../../database/entities/analytics-alert-cursor.entity';
import { AnalyticsStoreTargetEntity } from '../../database/entities/analytics-store-target.entity';
import { AlertsEngineService } from './alerts-engine.service';
import { ALERT_RULES, AlertRule } from './alert-rule.interface';
import { VoidRateRule } from './rules/void-rate.rule';
import { StockLowRule } from './rules/stock-low.rule';
import { SalesDropRule } from './rules/sales-drop.rule';
import { StoreClosedLateRule } from './rules/store-closed-late.rule';
import { DiscountRateRule } from './rules/discount-rate.rule';
import { TargetReachedRule } from './rules/target-reached.rule';

/**
 * Étage 2 — alerts engine. Socle: tables + runner + computed_at gate, ZERO rule
 * wired (rules are registered on ALERT_RULES, one per commit). Reads analytics.*
 * only; no delivery (étage 4).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AnalyticsStoreRegistryEntity,
      AnalyticsStoreDailyEntity,
      AnalyticsStoreSessionsEntity,
      AnalyticsStorePresenceEntity,
      AnalyticsStoreStockEntity,
      AnalyticsAlertEntity,
      AnalyticsAlertConfigEntity,
      AnalyticsAlertCursorEntity,
      AnalyticsStoreTargetEntity,
    ]),
  ],
  providers: [
    VoidRateRule,
    StockLowRule,
    SalesDropRule,
    StoreClosedLateRule,
    DiscountRateRule,
    TargetReachedRule,
    {
      provide: ALERT_RULES,
      useFactory: (...rules: AlertRule[]) => rules,
      inject: [VoidRateRule, StockLowRule, SalesDropRule, StoreClosedLateRule, DiscountRateRule, TargetReachedRule],
    },
    AlertsEngineService,
  ],
  exports: [AlertsEngineService],
})
export class AlertsEngineModule {}
