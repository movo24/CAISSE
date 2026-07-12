import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttractCampaignEntity } from '../../database/entities/attract-campaign.entity';
import { AttractMediaEntity } from '../../database/entities/attract-media.entity';
import { AttractService } from './attract.service';
import { AttractController } from './attract.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AttractCampaignEntity, AttractMediaEntity])],
  controllers: [AttractController],
  providers: [AttractService],
  exports: [AttractService],
})
export class AttractModule {}
