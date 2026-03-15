import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JackpotService } from './jackpot.service';
import { JackpotController } from './jackpot.controller';
import { JackpotConfigEntity } from '../../database/entities/jackpot-config.entity';
import { JackpotWinEntity } from '../../database/entities/jackpot-win.entity';
import { OccupancyModule } from '../occupancy/occupancy.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([JackpotConfigEntity, JackpotWinEntity]),
    OccupancyModule,
  ],
  controllers: [JackpotController],
  providers: [JackpotService],
  exports: [JackpotService],
})
export class JackpotModule {}
