import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';
import { MessagingModule } from './common/messaging/messaging.module';
import { RealtimeModule } from './common/realtime/realtime.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProductsModule } from './modules/products/products.module';
import { SalesModule } from './modules/sales/sales.module';
import { PosSessionModule } from './modules/pos-session/pos-session.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { PilotageAccessModule } from './modules/pilotage-access/pilotage-access.module';
import { ActivityAuditModule } from './modules/activity-audit/activity-audit.module';
import { CustomersModule } from './modules/customers/customers.module';
import { StoresModule } from './modules/stores/stores.module';
import { ReportsModule } from './modules/reports/reports.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { StockModule } from './modules/stock/stock.module';
import { AuditModule } from './modules/audit/audit.module';
import { CurrencyModule } from './modules/currency/currency.module';
import { SyncModule } from './modules/sync/sync.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { OccupancyModule } from './modules/occupancy/occupancy.module';
import { JackpotModule } from './modules/jackpot/jackpot.module';
import { HealthModule } from './modules/health/health.module';
import { CacheModule } from './common/cache/cache.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { UnitsModule } from './modules/units/units.module';
import { ConnectedAppsModule } from './modules/connected-apps/connected-apps.module';
import { InventoryScanModule } from './modules/inventory-scan/inventory-scan.module';
import { ProductIntegrationModule } from './modules/product-integration/product-integration.module';
import { MachineEnrollmentModule } from './modules/machine-enrollment/machine-enrollment.module';
import { EmployeeScoreModule } from './modules/employee-score/employee-score.module';
import { StockLocationsModule } from './modules/stock-locations/stock-locations.module';
import { StockReconciliationModule } from './modules/stock-reconciliation/stock-reconciliation.module';
import { PromoCodesModule } from './modules/promo-codes/promo-codes.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { StripeModule } from './common/stripe/stripe.module';
import { StripeTerminalModule } from './modules/stripe-terminal/stripe-terminal.module';
import { TerminalsModule } from './modules/terminals/terminals.module';
import { TimewinModule } from './modules/timewin/timewin.module';
import { ShiftRemindersModule } from './modules/shift-reminders/shift-reminders.module';
import { SalesAiModule } from './modules/sales-ai/sales-ai.module';
import { ReceiptsModule } from './modules/receipts/receipts.module';
import { PublicTicketModule } from './modules/public-ticket/public-ticket.module';
import { EmployeesModule } from './modules/employees/employees.module';
// ── Wesley Club (loyalty mobile app) ──
import { MobileAuthModule } from './modules/mobile-auth/mobile-auth.module';
import { LoyaltyCardModule } from './modules/loyalty-card/loyalty-card.module';
import { CouponModule } from './modules/coupon/coupon.module';
import { CustomerVisitsModule } from './modules/customer-visits/customer-visits.module';
import { PosIntegrationModule } from './modules/pos-integration/pos-integration.module';
import { LoyaltyAdminModule } from './modules/loyalty-admin/loyalty-admin.module';
import { AirtableOpsModule } from './modules/airtable-ops/airtable-ops.module';
import { SalesGuardsModule } from './modules/sales-guards/sales-guards.module';
import { AttractModule } from './modules/attract/attract.module';
// ── RH MODULES (employees re-activated for local fallback) ──
// PointageModule, PayrollModule, PlanningModule, StaffingModule → still in TimeWin24

const isProd = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    MessagingModule,
    RealtimeModule,

    // --- Database ---
    TypeOrmModule.forRoot({
      type: 'postgres',
      url:
        process.env.DATABASE_URL,
      autoLoadEntities: true,
      // CRITICAL: synchronize=false by default. Only enable explicitly.
      // Use TYPEORM_SYNCHRONIZE=true ONLY for initial dev schema creation.
      // In production, ALWAYS use migrations.
      synchronize: process.env.TYPEORM_SYNCHRONIZE === 'true',
      migrationsRun: isProd,
      migrations: ['dist/database/migrations/*.js'],
      logging: !isProd,
      // Connection pool: sized for POS high-concurrency
      extra: {
        max: 30, // max connections (default 10 is too low for POS)
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
      },
    }),

    // --- Rate limiting: 3-tier (per IP), configurable via env ---
    ThrottlerModule.forRoot([
      { name: 'short', ttl: parseInt(process.env.RATE_LIMIT_SHORT_TTL || '1000'), limit: parseInt(process.env.RATE_LIMIT_SHORT_MAX || '50') },
      { name: 'medium', ttl: parseInt(process.env.RATE_LIMIT_MEDIUM_TTL || '60000'), limit: parseInt(process.env.RATE_LIMIT_MEDIUM_MAX || '1000') },
      { name: 'long', ttl: parseInt(process.env.RATE_LIMIT_LONG_TTL || '3600000'), limit: parseInt(process.env.RATE_LIMIT_LONG_MAX || '30000') },
    ]),

    // --- Cache (in-memory now, swap to Redis for multi-instance) ---
    CacheModule,

    // --- Feature modules ---
    AuthModule,
    ProductsModule,
    SalesModule,
    PosSessionModule,
    CustomersModule,
    StoresModule,
    ReportsModule,
    PromotionsModule,
    StockModule,
    AuditModule,
    CurrencyModule,
    SyncModule,
    NotificationsModule,
    SubscriptionsModule,
    OccupancyModule,
    JackpotModule,
    HealthModule,
    OrganizationsModule,
    UnitsModule,
    ConnectedAppsModule,
    InventoryScanModule,
    ProductIntegrationModule,
    MachineEnrollmentModule,
    EmployeeScoreModule,
    StockLocationsModule,
    StockReconciliationModule,
    PromoCodesModule,
    AttractModule,
    DocumentsModule,
    StripeModule,
    StripeTerminalModule,
    TerminalsModule,
    TimewinModule,
    ShiftRemindersModule,
    SalesAiModule,
    ReceiptsModule,
    PublicTicketModule,
    EmployeesModule,
    // Wesley Club
    MobileAuthModule,
    LoyaltyCardModule,
    CouponModule,
    CustomerVisitsModule,
    PosIntegrationModule,
    LoyaltyAdminModule,
    // Airtable Ops Layer (AIRTABLE_ENABLED=false → no-op in prod until configured)
    AirtableOpsModule,
    // Sales Guards (anti-error engine — read-only, separate audit table)
    SalesGuardsModule,
    ReturnsModule,
    // Pilotage — RBAC applicatif (accès magasins + périmètre + permissions)
    PilotageAccessModule,
    // Télémétrie — connexions, sessions, consultations
    ActivityAuditModule,
  ],
  providers: [
    // Apply rate limiting globally to ALL endpoints
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
