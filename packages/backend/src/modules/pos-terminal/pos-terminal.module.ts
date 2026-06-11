import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PosTerminalEntity } from '../../database/entities/pos-terminal.entity';
import { PosTerminalService } from './pos-terminal.service';
import { PosTerminalController } from './pos-terminal.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PosTerminalEntity])],
  controllers: [PosTerminalController],
  providers: [PosTerminalService],
  // Exported so the binding brick (sale/void/return) and the pos-session
  // open path can consume validateClaim() for the cross-store check.
  exports: [PosTerminalService],
})
export class PosTerminalModule {}
