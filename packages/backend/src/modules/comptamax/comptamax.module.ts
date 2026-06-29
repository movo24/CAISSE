import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationEventEntity } from '../../database/entities/integration-event.entity';
import { ComptamaxService } from './comptamax.service';
import { ComptamaxController } from './comptamax.controller';
import { TimewinModule } from '../timewin/timewin.module';

@Module({
  imports: [TypeOrmModule.forFeature([IntegrationEventEntity]), TimewinModule],
  controllers: [ComptamaxController],
  providers: [ComptamaxService],
  exports: [ComptamaxService],
})
export class ComptamaxModule {}
