import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimewinService } from './timewin.service';
import { TimewinController } from './timewin.controller';
import { TimewinEventEntity } from '../../database/entities/timewin-event.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([TimewinEventEntity])],
  controllers: [TimewinController],
  providers: [TimewinService],
  exports: [TimewinService],
})
export class TimewinModule {}
