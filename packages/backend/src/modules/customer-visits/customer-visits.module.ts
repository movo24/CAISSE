import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerVisitEntity } from '../../database/entities/customer-visit.entity';
import { CustomerVisitsService } from './customer-visits.service';

@Module({
  imports: [TypeOrmModule.forFeature([CustomerVisitEntity])],
  providers: [CustomerVisitsService],
  exports: [CustomerVisitsService],
})
export class CustomerVisitsModule {}
