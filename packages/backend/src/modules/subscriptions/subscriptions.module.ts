import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionsService } from './subscriptions.service';
import { StripeBillingService } from './stripe-billing.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionEntity } from '../../database/entities/subscription.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { ProductEntity } from '../../database/entities/product.entity';
// EmployeeEntity removed — employees managed by TimeWin24
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SubscriptionEntity,
      StoreEntity,
      ProductEntity,
    ]),
    AuditModule,
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, StripeBillingService],
  exports: [SubscriptionsService, StripeBillingService],
})
export class SubscriptionsModule {}
