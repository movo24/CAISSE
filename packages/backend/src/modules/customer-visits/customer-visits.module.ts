import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerVisitEntity } from '../../database/entities/customer-visit.entity';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { CustomerVisitsService } from './customer-visits.service';
import { CustomerVisitsController } from './customer-visits.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CustomerVisitEntity, CustomerEntity])],
  controllers: [CustomerVisitsController],
  providers: [CustomerVisitsService],
  exports: [CustomerVisitsService],
})
export class CustomerVisitsModule {}
