import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromotionsService } from './promotions.service';
import { PromotionsController } from './promotions.controller';
import { PromoRuleEntity } from '../../database/entities/promo-rule.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PromoRuleEntity])],
  controllers: [PromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
