import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * ANALYTICS PROJECTION — current POS-session snapshot per store (read model).
 * INV-2: separate read-model table, cockpit-read-only, jobs-only writer.
 * INV-4: derived from `pos_sessions` (the source of truth for sessions/terminals).
 * INV-5: `store_id` is the query-layer scoping key.
 */
@Entity({ schema: 'analytics', name: 'store_sessions' })
@Index(['storeId'], { unique: true })
export class AnalyticsStoreSessionsEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'open_sessions', type: 'integer', default: 0 })
  openSessions: number;

  @Column({ name: 'active_terminals', type: 'integer', default: 0 })
  activeTerminals: number;

  @Column({ name: 'computed_at', type: 'timestamptz' })
  computedAt: Date;
}
