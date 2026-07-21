import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Journal des CONSULTATIONS (télémétrie métier). Événements fonctionnels utiles
 * uniquement — pas de frappe clavier, pas de pixel (spec §9). `metadata_json` est
 * NETTOYÉ (clés sensibles retirées) et BORNÉ. Aucun secret/token/PAN (spec §15).
 */
@Entity('user_view_events')
@Index('idx_uve_employee_time', ['employeeId', 'occurredAt'])
@Index('idx_uve_store_time', ['storeId', 'occurredAt'])
export class UserViewEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'varchar', nullable: true })
  userId: string | null;

  @Column({ name: 'employee_id', type: 'varchar', nullable: true })
  employeeId: string | null;

  @Column({ name: 'session_id', type: 'varchar', nullable: true })
  sessionId: string | null;

  @Column({ name: 'store_id', type: 'varchar', nullable: true })
  storeId: string | null;

  @Column({ name: 'module', type: 'varchar', nullable: true })
  module: string | null;

  @Column({ name: 'screen', type: 'varchar', nullable: true })
  screen: string | null;

  @Column({ name: 'entity_type', type: 'varchar', nullable: true })
  entityType: string | null;

  @Column({ name: 'entity_id', type: 'varchar', nullable: true })
  entityId: string | null;

  /** Nom d'événement métier whitelisté (ex. dashboard.kpi.revenue.open). */
  @Column({ name: 'action', type: 'varchar', length: 64 })
  action: string;

  @Column({ name: 'source_route', type: 'varchar', nullable: true })
  sourceRoute: string | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, unknown> | null;

  @Column({ name: 'ip_address', type: 'varchar', nullable: true })
  ipAddress: string | null;

  @Column({ name: 'device_type', type: 'varchar', nullable: true })
  deviceType: string | null;

  @CreateDateColumn({ name: 'occurred_at' })
  occurredAt: Date;
}
