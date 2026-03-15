import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionEntity } from '../../database/entities/subscription.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SubscriptionEntity,
      StoreEntity,
      ProductEntity,
      EmployeeEntity,
    ]),
    AuditModule,
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
