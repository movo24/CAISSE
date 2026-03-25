import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';
import { AuthModule } from './modules/auth/auth.module';
import { ProductsModule } from './modules/products/products.module';
import { SalesModule } from './modules/sales/sales.module';
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
import { StripeModule } from './common/stripe/stripe.module';
import { StripeTerminalModule } from './modules/stripe-terminal/stripe-terminal.module';
import { TerminalsModule } from './modules/terminals/terminals.module';
import { TimewinModule } from './modules/timewin/timewin.module';
import { SalesAiModule } from './modules/sales-ai/sales-ai.module';
// ── RH MODULES REMOVED — All managed by TimeWin24 ──
// EmployeesModule, PointageModule, PayrollModule, PlanningModule, StaffingModule
// IaModule, PosAiModule, WeatherModule, TransportModule, FootfallModule, DecisionEngineModule

const isProd = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),

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
    StripeModule,
    StripeTerminalModule,
    TerminalsModule,
    TimewinModule,
    SalesAiModule,
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
