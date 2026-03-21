import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentTerminalEntity } from '../../database/entities/payment-terminal.entity';
import { TerminalsService } from './terminals.service';
import { TerminalsController } from './terminals.controller';
import { StripeTerminalModule } from '../stripe-terminal/stripe-terminal.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentTerminalEntity]),
    StripeTerminalModule,
  ],
  controllers: [TerminalsController],
  providers: [TerminalsService],
  exports: [TerminalsService],
})
export class TerminalsModule {}
