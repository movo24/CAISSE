import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

/**
 * ANALYTICS PROJECTION — denormalized store registry for the cockpit (read model).
 * INV-2: so the cockpit reads NOTHING from the source `stores`/`organizations`/
 * `units` tables — even the store name/hierarchy comes through the projection.
 * INV-4: derived from the `stores` registry (org → unit → store hierarchy), which
 * is the source of truth for the store list. store = DATA (a row), never a constant.
 * INV-5: `organization_id` + `store_id` are the scoping keys the resolver maps onto
 * (owner = whole organization, manager = explicit store list).
 */
@Entity({ schema: 'analytics', name: 'store_registry' })
@Index(['organizationId'])
export class AnalyticsStoreRegistryEntity {
  /** = stores.id (the projection mirrors the source key, no surrogate). */
  @PrimaryColumn({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'name', type: 'varchar' })
  name: string;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'computed_at', type: 'timestamptz' })
  computedAt: Date;
}
