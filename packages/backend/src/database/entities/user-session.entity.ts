import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * Session d'AUTHENTIFICATION (distincte de pos_sessions, qui est comptable-caisse).
 * Permet « lister / révoquer les sessions actives » (spec §7/§13). Aucun token stocké.
 */
@Entity('user_sessions')
@Index('idx_us_employee_started', ['employeeId', 'startedAt'])
export class UserSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'varchar', nullable: true })
  userId: string | null;

  @Column({ name: 'employee_id', type: 'varchar', nullable: true })
  employeeId: string | null;

  @Column({ name: 'started_at', type: 'timestamp', default: () => 'now()' })
  startedAt: Date;

  @Column({ name: 'last_activity_at', type: 'timestamp', nullable: true })
  lastActivityAt: Date | null;

  @Column({ name: 'ended_at', type: 'timestamp', nullable: true })
  endedAt: Date | null;

  @Column({ name: 'end_reason', type: 'varchar', nullable: true })
  endReason: string | null;

  @Column({ name: 'ip_address', type: 'varchar', nullable: true })
  ipAddress: string | null;

  @Column({ name: 'country_code', type: 'varchar', length: 8, nullable: true })
  countryCode: string | null;

  @Column({ name: 'region', type: 'varchar', nullable: true })
  region: string | null;

  @Column({ name: 'city', type: 'varchar', nullable: true })
  city: string | null;

  @Column({ name: 'device_fingerprint', type: 'varchar', nullable: true })
  deviceFingerprint: string | null;

  @Column({ name: 'device_type', type: 'varchar', nullable: true })
  deviceType: string | null;

  @Column({ name: 'operating_system', type: 'varchar', nullable: true })
  operatingSystem: string | null;

  @Column({ name: 'browser', type: 'varchar', nullable: true })
  browser: string | null;

  @Column({ name: 'application_version', type: 'varchar', nullable: true })
  applicationVersion: string | null;

  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'revoked_by', type: 'varchar', nullable: true })
  revokedBy: string | null;

  @Column({ name: 'revoke_reason', type: 'varchar', nullable: true })
  revokeReason: string | null;
}
