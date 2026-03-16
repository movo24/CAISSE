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
import { EmployeesModule } from './modules/employees/employees.module';
import { CustomersModule } from './modules/customers/customers.module';
import { StoresModule } from './modules/stores/stores.module';
import { ReportsModule } from './modules/reports/reports.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { StockModule } from './modules/stock/stock.module';
import { AuditModule } from './modules/audit/audit.module';
import { IaModule } from './modules/ia/ia.module';
import { CurrencyModule } from './modules/currency/currency.module';
import { SyncModule } from './modules/sync/sync.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { OccupancyModule } from './modules/occupancy/occupancy.module';
import { JackpotModule } from './modules/jackpot/jackpot.module';
import { LivePerformanceModule } from './modules/live-performance/live-performance.module';
import { HealthModule } from './modules/health/health.module';
import { PlanningModule } from './modules/planning/planning.module';
import { PointageModule } from './modules/pointage/pointage.module';
import { StaffingModule } from './modules/staffing/staffing.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { PosAiModule } from './modules/pos-ai/pos-ai.module';
import { WeatherModule } from './modules/weather/weather.module';
import { TransportModule } from './modules/transport/transport.module';
import { FootfallModule } from './modules/footfall/footfall.module';
import { DecisionEngineModule } from './modules/decision-engine/decision-engine.module';
import { CacheModule } from './common/cache/cache.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { UnitsModule } from './modules/units/units.module';
import { ConnectedAppsModule } from './modules/connected-apps/connected-apps.module';

const isProd = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),

    // --- Database ---
    TypeOrmModule.forRoot({
      type: 'postgres',
      url:
        process.env.DATABASE_URL ||
        'postgresql://caisse:caisse@localhost:5432/caisse',
      autoLoadEntities: true,
      // CRITICAL: synchronize=false by default. Only enable explicitly.
      // Use TYPEORM_SYNCHRONIZE=true ONLY for initial dev schema creation.
      // In production, ALWAYS use migrations.
      synchronize: process.env.TYPEORM_SYNCHRONIZE === 'true',
      migrationsRun: isProd,
      migrations: ['dist/database/migrations/*.js'],
      logging: !isProd,
    }),

    // --- Rate limiting: 3-tier (per IP) ---
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },      // 10 req/sec
      { name: 'medium', ttl: 60000, limit: 100 },    // 100 req/min
      { name: 'long', ttl: 3600000, limit: 2000 },   // 2000 req/hour
    ]),

    // --- Cache (in-memory now, swap to Redis for multi-instance) ---
    CacheModule,

    // --- Feature modules ---
    AuthModule,
    ProductsModule,
    SalesModule,
    EmployeesModule,
    CustomersModule,
    StoresModule,
    ReportsModule,
    PromotionsModule,
    StockModule,
    AuditModule,
    IaModule,
    CurrencyModule,
    SyncModule,
    NotificationsModule,
    SubscriptionsModule,
    OccupancyModule,
    JackpotModule,
    LivePerformanceModule,
    HealthModule,
    PlanningModule,
    PointageModule,
    StaffingModule,
    PayrollModule,
    PosAiModule,
    WeatherModule,
    TransportModule,
    FootfallModule,
    DecisionEngineModule,
    OrganizationsModule,
    UnitsModule,
    ConnectedAppsModule,
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
