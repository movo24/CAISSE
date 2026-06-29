import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationEventEntity } from '../../database/entities/integration-event.entity';
import { ComptamaxService } from './comptamax.service';
import { ComptamaxController } from './comptamax.controller';

@Module({
  imports: [TypeOrmModule.forFeature([IntegrationEventEntity])],
  controllers: [ComptamaxController],
  providers: [ComptamaxService],
  exports: [ComptamaxService],
})
export class ComptamaxModule {}
