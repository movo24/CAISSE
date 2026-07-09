export { StoreEntity } from './store.entity';
// EmployeeEntity removed — managed by TimeWin24
export { ProductEntity } from './product.entity';
export { ProductCategoryEntity } from './product-category.entity';
export { CustomerEntity } from './customer.entity';
export { SaleEntity } from './sale.entity';
export { SaleLineItemEntity } from './sale-line-item.entity';
export { SalePaymentEntity } from './sale-payment.entity';
export { PromoRuleEntity } from './promo-rule.entity';
export { AuditEntryEntity } from './audit-entry.entity';
export { PriceHistoryEntity } from './price-history.entity';
export { FxRateEntity } from './fx-rate.entity';
export { ZReportEntity } from './z-report.entity';
export { SubscriptionEntity } from './subscription.entity';
// PointageEntryEntity removed — managed by TimeWin24
// StaffingSnapshotEntity removed — managed by TimeWin24
// PayrollConfigEntity removed — managed by TimeWin24
export { PosSessionEntity } from './pos-session.entity';
export { OrganizationEntity } from './organization.entity';
export { UnitEntity } from './unit.entity';
export { ConnectedAppEntity } from './connected-app.entity';
export { InventoryScanEntity } from './inventory-scan.entity';
export { JackpotConfigEntity } from './jackpot-config.entity';
export { JackpotWinEntity } from './jackpot-win.entity';
export { PaymentTerminalEntity } from './payment-terminal.entity';
export { StoreContextEntity } from './store-context.entity';
export { AiRecommendationLogEntity } from './ai-recommendation-log.entity';
export { StockLocationEntity } from './stock-location.entity';
export { StockBalanceEntity } from './stock-balance.entity';
export { StockMovementEntity } from './stock-movement.entity';
export { EmployeeStoreAccessEntity } from './employee-store-access.entity';
// EmployeeEntity kept but not re-exported — transitional (auth fallback only)

// ── Wesley Club (loyalty) entities ─────────────────────────────
export { LoyaltyCardEntity } from './loyalty-card.entity';
export { CouponEntity } from './coupon.entity';
export { CustomerVisitEntity } from './customer-visit.entity';
export { CustomerDeviceEntity } from './customer-device.entity';
export { NotificationPreferencesEntity } from './notification-preferences.entity';
export { NotificationsLogEntity } from './notifications-log.entity';
export { ProductHighlightEntity } from './product-highlight.entity';
export { ProductStoreAvailabilityEntity } from './product-store-availability.entity';
export { LoyaltyRewardCycleEntity } from './loyalty-reward-cycle.entity';
export { IdempotencyKeyEntity } from './idempotency-key.entity';

// ── Airtable Ops Layer (visual ops cockpit — PostgreSQL stays source of truth) ─
export { AirtableLinkedRecordEntity } from './airtable-linked-record.entity';
export { AirtableSyncLogEntity } from './airtable-sync-log.entity';
export { AirtableOperationEntity } from './airtable-operation.entity';

// ── Sales Guards (anti-error cockpit) ──────────────────────────────
export { SaleAnomalyLogEntity } from './sale-anomaly-log.entity';

// ── Intégration produit (scan code-barres inconnu) ─────────────────
export { ProductIntegrationRequestEntity } from './product-integration-request.entity';

// ── Employee System Score (score employé 100 % factuel) ────────────
export { EmployeeScoreEventEntity } from './employee-score-event.entity';
export { EmployeeScoreRuleEntity } from './employee-score-rule.entity';
export { EmployeeScoreDailyEntity } from './employee-score-daily.entity';

// ── Product Packs (produits composés — GO owner 2026-07-09) ────────
export { ProductComponentEntity } from './product-component.entity';
export { SaleComponentMovementEntity } from './sale-component-movement.entity';
