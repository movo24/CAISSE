import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperatorAttributionEntity } from '../../database/entities/operator-attribution.entity';
import { OperatorAttributionService } from './operator-attribution.service';

@Module({
  imports: [TypeOrmModule.forFeature([OperatorAttributionEntity])],
  providers: [OperatorAttributionService],
  // Exported so the sale/void/return paths can record attribution within
  // their own transactions, and reports can read the divergence metric.
  exports: [OperatorAttributionService],
})
export class OperatorAttributionModule {}
