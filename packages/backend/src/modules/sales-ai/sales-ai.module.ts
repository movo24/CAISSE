import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { SalesAiService } from './sales-ai.service';
import { SalesAiController } from './sales-ai.controller';
import { ExternalContextService } from './external-context.service';
import { AiLearningService } from './ai-learning.service';
import { AiRecommendationLogEntity } from '../../database/entities/ai-recommendation-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([SaleEntity, SaleLineItemEntity, ProductEntity, AiRecommendationLogEntity]),
  ],
  controllers: [SalesAiController],
  providers: [SalesAiService, ExternalContextService, AiLearningService],
  exports: [SalesAiService, ExternalContextService, AiLearningService],
})
export class SalesAiModule {}
