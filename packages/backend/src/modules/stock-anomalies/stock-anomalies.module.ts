import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StockAnomalyEntity } from '../../database/entities/stock-anomaly.entity';
import { StockAnomaliesController } from './stock-anomalies.controller';
import { StockAnomaliesService } from './stock-anomalies.service';

@Module({
  imports: [TypeOrmModule.forFeature([StockAnomalyEntity])],
  controllers: [StockAnomaliesController],
  providers: [StockAnomaliesService],
  exports: [StockAnomaliesService],
})
export class StockAnomaliesModule {}
