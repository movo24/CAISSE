import { Module } from '@nestjs/common';
import { PlanningController } from './planning.controller';

@Module({
  controllers: [PlanningController],
})
export class PlanningModule {}
