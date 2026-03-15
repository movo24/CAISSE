// ── store-context.entity.ts ─────────────────────────────────────
// Persists AI-generated commercial intelligence per store
// Location analysis stored as JSONB, calendar context is ephemeral
// ─────────────────────────────────────────────────────────────────

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { StoreLocationContext } from '../../modules/pos-ai/store-context.types';
import type { StoreTransportConfig } from '../../modules/transport/transport.types';
import type { StoreFootfallConfig } from '../../modules/footfall/footfall.types';

@Entity('store_contexts')
@Index(['storeId'], { unique: true })
export class StoreContextEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'varchar' })
  storeId: string;

  @Column({ name: 'location_context', type: 'jsonb', nullable: true })
  locationContext: StoreLocationContext | null;

  @Column({ name: 'location_analyzed_at', type: 'timestamptz', nullable: true })
  locationAnalyzedAt: Date | null;

  @Column({ name: 'analysis_model', type: 'varchar', nullable: true })
  analysisModel: string | null;

  /** Nearby stations config discovered via PRIM API (persisted) */
  @Column({ name: 'transport_config', type: 'jsonb', nullable: true })
  transportConfig: StoreTransportConfig | null;

  /** Nearby places config discovered via Google Places API (persisted) */
  @Column({ name: 'footfall_config', type: 'jsonb', nullable: true })
  footfallConfig: StoreFootfallConfig | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
