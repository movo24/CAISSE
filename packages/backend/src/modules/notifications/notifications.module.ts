import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { SaleEntity } from '../../database/entities/sale.entity';
import { ProductEntity } from '../../database/entities/product.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([CustomerEntity, SaleEntity, ProductEntity]),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
