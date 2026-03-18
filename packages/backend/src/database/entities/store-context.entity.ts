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
// Types migrated to TimeWin24 — use generic Record for JSONB columns
// Original types: StoreLocationContext, StoreTransportConfig, StoreFootfallConfig

@Entity('store_contexts')
@Index(['storeId'], { unique: true })
export class StoreContextEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'varchar' })
  storeId: string;

  @Column({ name: 'location_context', type: 'jsonb', nullable: true })
  locationContext: Record<string, any> | null;

  @Column({ name: 'location_analyzed_at', type: 'timestamptz', nullable: true })
  locationAnalyzedAt: Date | null;

  @Column({ name: 'analysis_model', type: 'varchar', nullable: true })
  analysisModel: string | null;

  /** Nearby stations config (persisted, used by TimeWin24) */
  @Column({ name: 'transport_config', type: 'jsonb', nullable: true })
  transportConfig: Record<string, any> | null;

  /** Nearby places config (persisted, used by TimeWin24) */
  @Column({ name: 'footfall_config', type: 'jsonb', nullable: true })
  footfallConfig: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
