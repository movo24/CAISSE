import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromoCodeEntity } from '../../database/entities/promo-code.entity';
import { PromoCodeRedemptionEntity } from '../../database/entities/promo-code-redemption.entity';
import { AuditModule } from '../audit/audit.module';
import { PromoCodesService } from './promo-codes.service';
import { PromoCodesController } from './promo-codes.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PromoCodeEntity, PromoCodeRedemptionEntity]), AuditModule],
  controllers: [PromoCodesController],
  providers: [PromoCodesService],
  exports: [PromoCodesService],
})
export class PromoCodesModule {}
