import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimewinService } from './timewin.service';
import { TimewinController } from './timewin.controller';
import { TimewinEventEntity } from '../../database/entities/timewin-event.entity';
import { StoreEntity } from '../../database/entities/store.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([TimewinEventEntity, StoreEntity])],
  controllers: [TimewinController],
  providers: [TimewinService],
  exports: [TimewinService],
})
export class TimewinModule {}
