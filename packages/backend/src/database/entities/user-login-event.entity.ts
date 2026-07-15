import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Journal des connexions (append-only, non hash-chaîné — c'est de la télémétrie, pas
 * l'audit des droits). JAMAIS de mot de passe / PIN / token / donnée bancaire (spec §9/§15).
 * Géolocalisation approximative dérivée de l'IP uniquement, jamais de GPS continu (§10).
 */
@Entity('user_login_events')
@Index('idx_ule_employee_time', ['employeeId', 'occurredAt'])
@Index('idx_ule_success_time', ['success', 'occurredAt'])
export class UserLoginEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'varchar', nullable: true })
  userId: string | null;

  @Column({ name: 'employee_id', type: 'varchar', nullable: true })
  employeeId: string | null;

  @Column({ name: 'session_id', type: 'varchar', nullable: true })
  sessionId: string | null;

  /** LOGIN_SUCCESS / LOGIN_FAILED / LOGOUT / SESSION_EXPIRED / SESSION_REVOKED / TOKEN_REFRESH / NEW_DEVICE */
  @Column({ name: 'event_type', type: 'varchar', length: 32 })
  eventType: string;

  @Column({ name: 'success', type: 'boolean', default: true })
  success: boolean;

  @Column({ name: 'failure_reason', type: 'varchar', nullable: true })
  failureReason: string | null;

  @Column({ name: 'authentication_method', type: 'varchar', length: 32, nullable: true })
  authenticationMethod: string | null;

  @Column({ name: 'ip_address', type: 'varchar', nullable: true })
  ipAddress: string | null;

  /** Hash de l'IP pour vues masquées (spec §15). */
  @Column({ name: 'ip_hash', type: 'varchar', nullable: true })
  ipHash: string | null;

  @Column({ name: 'country_code', type: 'varchar', length: 8, nullable: true })
  countryCode: string | null;

  @Column({ name: 'region', type: 'varchar', nullable: true })
  region: string | null;

  @Column({ name: 'city', type: 'varchar', nullable: true })
  city: string | null;

  @Column({ name: 'approximate_latitude', type: 'float', nullable: true })
  approximateLatitude: number | null;

  @Column({ name: 'approximate_longitude', type: 'float', nullable: true })
  approximateLongitude: number | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string | null;

  @Column({ name: 'device_type', type: 'varchar', nullable: true })
  deviceType: string | null;

  @Column({ name: 'device_name', type: 'varchar', nullable: true })
  deviceName: string | null;

  @Column({ name: 'operating_system', type: 'varchar', nullable: true })
  operatingSystem: string | null;

  @Column({ name: 'browser', type: 'varchar', nullable: true })
  browser: string | null;

  @Column({ name: 'application_version', type: 'varchar', nullable: true })
  applicationVersion: string | null;

  @Column({ name: 'is_new_device', type: 'boolean', default: false })
  isNewDevice: boolean;

  @Column({ name: 'risk_score', type: 'int', default: 0 })
  riskScore: number;

  @CreateDateColumn({ name: 'occurred_at' })
  occurredAt: Date;
}
