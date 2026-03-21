import { Module, Global } from '@nestjs/common';
import { TimewinService } from './timewin.service';
import { TimewinController } from './timewin.controller';

@Global()
@Module({
  controllers: [TimewinController],
  providers: [TimewinService],
  exports: [TimewinService],
})
export class TimewinModule {}
