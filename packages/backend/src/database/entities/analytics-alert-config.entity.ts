import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * ALERT CONFIG — thresholds are DATA (store-scoped, override-ready), never
 * hard-coded (same doctrine as the stores registry). Resolution: the (rule,
 * store_id) override row if present, else the (rule, NULL) default row. A rule
 * with NO resolvable config is SKIPPED with a warn — no silent built-in threshold.
 */
@Entity({ schema: 'analytics', name: 'alert_config' })
@Index(['rule', 'storeId'], { unique: true })
export class AnalyticsAlertConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** NULL = the seeded default for the rule; non-NULL = a per-store override. */
  @Column({ name: 'store_id', type: 'uuid', nullable: true })
  storeId: string | null;

  @Column({ name: 'rule', type: 'varchar' })
  rule: string;

  @Column({ name: 'params', type: 'jsonb' })
  params: Record<string, unknown>;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}
