import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';

/**
 * Agrégat journalier du score employé (cache recomputable, mission §6).
 * Recalculé chaque nuit par cron + à la volée sur demande. Une seule ligne par
 * (employee_id, score_date).
 */
@Entity('employee_score_daily')
@Unique(['employeeId', 'scoreDate'])
@Index(['storeId', 'scoreDate'])
export class EmployeeScoreDailyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'employee_id' })
  employeeId: string;

  @Column({ name: 'store_id' })
  storeId: string;

  /** Jour local (Europe/Paris) au format YYYY-MM-DD. */
  @Column({ name: 'score_date', type: 'date' })
  scoreDate: string;

  @Column({ name: 'score_total', type: 'integer', default: 100 })
  scoreTotal: number;

  @Column({ name: 'score_color', type: 'varchar', default: 'green' })
  scoreColor: string;

  @Column({ name: 'session_score', type: 'integer', default: 25 })
  sessionScore: number;

  @Column({ name: 'cash_score', type: 'integer', default: 25 })
  cashScore: number;

  @Column({ name: 'procedure_score', type: 'integer', default: 20 })
  procedureScore: number;

  @Column({ name: 'inventory_score', type: 'integer', default: 10 })
  inventoryScore: number;

  @Column({ name: 'schedule_score', type: 'integer', default: 10 })
  scheduleScore: number;

  @Column({ name: 'regularity_score', type: 'integer', default: 10 })
  regularityScore: number;

  @Column({ name: 'event_count', type: 'integer', default: 0 })
  eventCount: number;

  @Column({ name: 'calculated_at', type: 'timestamp', nullable: true })
  calculatedAt: Date | null;

  @Column({ name: 'rule_version', type: 'integer', default: 1 })
  ruleVersion: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
