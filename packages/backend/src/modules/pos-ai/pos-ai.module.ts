// ── pos-ai/pos-ai.module.ts ─────────────────────────────────────
// NestJS module — isolated, optional, no impact on core POS
// ─────────────────────────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ProductEntity } from '../../database/entities/product.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { StoreContextEntity } from '../../database/entities/store-context.entity';
import { GeminiClientService } from './gemini-client';
import { EmbeddingService } from './embeddings';
import { VectorStoreService } from './vector-store';
import { ProductSearchService } from './product-search';
import { NaturalQueryService } from './natural-query';
import { AssistantService } from './assistant';
import { AnomalyInsightsService } from './anomaly-insights';
import { StoreContextService } from './store-context.service';
import { PosAiController } from './pos-ai.controller';
import { WeatherModule } from '../weather/weather.module';
import { TransportModule } from '../transport/transport.module';
import { FootfallModule } from '../footfall/footfall.module';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([ProductEntity, StoreEntity, StoreContextEntity]),
    WeatherModule,
    TransportModule,
    FootfallModule,
  ],
  controllers: [PosAiController],
  providers: [
    GeminiClientService,
    EmbeddingService,
    VectorStoreService,
    ProductSearchService,
    NaturalQueryService,
    AssistantService,
    AnomalyInsightsService,
    StoreContextService,
  ],
  exports: [
    GeminiClientService,
    EmbeddingService,
    ProductSearchService,
    StoreContextService,
  ],
})
export class PosAiModule {}
