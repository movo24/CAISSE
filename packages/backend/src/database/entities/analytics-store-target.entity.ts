import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * STORE TARGETS — the daily revenue objective per store. An INPUT datum (a
 * management decision, authored/seeded — like the stores registry), NOT a derived
 * projection: it has no computed_at; it has an author-side updated_at.
 *
 * ONE source, TWO readers (structural decision): the target_reached alert rule AND
 * the overview %atteint both read THIS table — never two copies of "the objective"
 * that can diverge, and overview is not coupled to the alerts subsystem.
 * No datum for a store = no objective: the rule stays silent and overview exposes
 * null (honest absence) — never a fabricated number (INV-3).
 */
@Entity({ schema: 'analytics', name: 'store_targets' })
export class AnalyticsStoreTargetEntity {
  @PrimaryColumn({ name: 'store_id', type: 'uuid' })
  storeId: string;

  /** Daily revenue target, integer minor units (centimes). */
  @Column({ name: 'daily_target_minor', type: 'integer' })
  dailyTargetMinor: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
