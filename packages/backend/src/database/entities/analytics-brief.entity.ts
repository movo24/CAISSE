import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

/**
 * ANALYTICS BRIEFS — the persisted daily narrative brief (étage 3). One row per
 * (scope_key, business_day); regenerated ONLY when the projection freshness
 * advances (computed_at cache anchor, same monotonic gate as alerts) — the LLM is
 * not re-called on every request and the prose is stable within a refresh window.
 * Only provenance-verified text is ever persisted/served (INV-3).
 */
@Entity({ schema: 'analytics', name: 'briefs' })
@Index(['scopeKey', 'businessDay'], { unique: true })
export class AnalyticsBriefEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Deterministic key of the store scope (sha256 of the sorted store ids). */
  @Column({ name: 'scope_key', type: 'varchar', length: 64 })
  scopeKey: string;

  @Column({ name: 'business_day', type: 'date' })
  businessDay: string;

  /** The projection freshness the brief was built from (the cache anchor). */
  @Column({ name: 'computed_at', type: 'timestamptz' })
  computedAt: Date;

  /** The deterministic findings the text was rendered from (audit trail). */
  @Column({ name: 'findings', type: 'jsonb' })
  findings: Record<string, unknown>;

  @Column({ name: 'text', type: 'text' })
  text: string;

  /** 'rendered' (narrator output passed the guard) | 'fallback' (template served). */
  @Column({ name: 'status', type: 'varchar' })
  status: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
