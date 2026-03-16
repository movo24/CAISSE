import { Module } from '@nestjs/common';
import { StripeTerminalService } from './stripe-terminal.service';
import { StripeTerminalController } from './stripe-terminal.controller';

@Module({
  controllers: [StripeTerminalController],
  providers: [StripeTerminalService],
  exports: [StripeTerminalService],
})
export class StripeTerminalModule {}
