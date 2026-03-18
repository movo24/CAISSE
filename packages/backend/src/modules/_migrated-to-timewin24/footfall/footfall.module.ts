// ── footfall/footfall.module.ts ──────────────────────────────────
// NestJS module — Google Places foot traffic estimation
// ─────────────────────────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreEntity } from '../../database/entities/store.entity';
import { StoreContextEntity } from '../../database/entities/store-context.entity';
import { FootfallClient } from './footfall-client';
import { FootfallService } from './footfall.service';
import { FootfallController } from './footfall.controller';

@Module({
  imports: [TypeOrmModule.forFeature([StoreEntity, StoreContextEntity])],
  controllers: [FootfallController],
  providers: [FootfallClient, FootfallService],
  exports: [FootfallService],
})
export class FootfallModule {}
