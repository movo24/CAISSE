import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

/**
 * Règle de score surchargeable (mission §6). Si la table est vide, le service
 * utilise DEFAULT_SCORE_RULES (versionné dans le code). Une ligne activée ici
 * remplace le défaut pour ce type d'événement — les poids ne sont jamais codés
 * en dur côté logique.
 */
@Entity('employee_score_rules')
@Unique(['eventType'])
export class EmployeeScoreRuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'rule_code' })
  ruleCode: string;

  @Column({ name: 'event_type' })
  eventType: string;

  @Column({ type: 'varchar' })
  category: string;

  @Column({ type: 'varchar' })
  label: string;

  @Column({ name: 'points_delta', type: 'integer', default: 0 })
  pointsDelta: number;

  @Column({ type: 'varchar', default: 'info' })
  severity: string;

  @Column({ name: 'max_daily_penalty', type: 'integer', default: 0 })
  maxDailyPenalty: number;

  @Column({ type: 'boolean', default: false })
  alert: boolean;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'integer', default: 1 })
  version: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
