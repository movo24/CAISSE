import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

/**
 * ANALYTICS BRIEFS — the persisted daily narrative brief (étage 3). One row per
 * (scope_key, business_day, beat); regenerated only AT a beat (scheduled hours
 * from analytics.store_clock), stable between beats — the LLM is called at most
 * once per beat and the executive never sees the prose move between refreshes.
 * Only provenance-verified text is ever persisted/served (INV-3).
 */
@Entity({ schema: 'analytics', name: 'briefs' })
@Index(['scopeKey', 'businessDay', 'beat'], { unique: true })
export class AnalyticsBriefEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Deterministic key of the store scope (sha256 of the sorted store ids). */
  @Column({ name: 'scope_key', type: 'varchar', length: 64 })
  scopeKey: string;

  @Column({ name: 'business_day', type: 'date' })
  businessDay: string;

  /**
   * The BEAT (wall-clock hour from analytics.store_clock) this brief belongs to.
   * Ratified: a brief regenerates only at a beat (12h/17h/fermeture — UTC stand-in
   * 10/15/close), stable in between; the (scope, day, beat) key makes the
   * stability structural. A failed beat persists the template fallback under the
   * same key — held until the NEXT beat, never retried.
   */
  @Column({ name: 'beat', type: 'integer', default: 0 })
  beat: number;

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
