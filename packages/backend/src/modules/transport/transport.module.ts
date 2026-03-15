// ── transport/transport.module.ts ────────────────────────────────
// NestJS module — transport context (PRIM API / Ile-de-France)
// Isolated, optional, no impact on core POS
// ─────────────────────────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreEntity } from '../../database/entities/store.entity';
import { StoreContextEntity } from '../../database/entities/store-context.entity';
import { PrimClient } from './prim-client';
import { TransportService } from './transport.service';
import { TransportController } from './transport.controller';

@Module({
  imports: [TypeOrmModule.forFeature([StoreEntity, StoreContextEntity])],
  controllers: [TransportController],
  providers: [PrimClient, TransportService],
  exports: [TransportService],
})
export class TransportModule {}
