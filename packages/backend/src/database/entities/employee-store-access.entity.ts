import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Périmètre magasin d'un employé pour l'application de pilotage.
 *
 * Table créée par la migration 1711000000000 (colonnes id/employee_id/store_id/granted_at)
 * puis enrichie par 1759000000000-EnrichEmployeeStoreAccess (permissions granulaires,
 * fenêtre de validité, traçabilité, révocation soft-delete).
 *
 * ⚠️ Mapping `name:` EXPLICITE sur chaque colonne : sans SnakeNamingStrategy, TypeORM
 * mapperait `employeeId` → colonne `employeeId`, or la table réelle est en snake_case
 * (`employee_id`). L'ancienne entité était désynchronisée de sa migration ; elle est
 * corrigée ici. La révocation est un soft-delete in-place (`revoked_at`), donc
 * l'UNIQUE(employee_id, store_id) existant garantit « pas deux affectations actives ».
 */
@Entity('employee_store_access')
@Index('idx_esa_employee', ['employeeId'])
@Index('idx_esa_store', ['storeId'])
@Index('idx_esa_unique', ['employeeId', 'storeId'], { unique: true })
export class EmployeeStoreAccessEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  /** Rôle applicatif de cette affectation (STORE_MANAGER, REGIONAL_MANAGER, …). */
  @Column({ name: 'access_role', type: 'varchar', length: 50, nullable: true })
  accessRole: string | null;

  // --- Permissions granulaires par (employé, magasin) ---
  @Column({ name: 'can_view_dashboard', type: 'boolean', default: true })
  canViewDashboard: boolean;

  @Column({ name: 'can_view_financials', type: 'boolean', default: false })
  canViewFinancials: boolean;

  @Column({ name: 'can_view_employees', type: 'boolean', default: false })
  canViewEmployees: boolean;

  @Column({ name: 'can_view_alerts', type: 'boolean', default: true })
  canViewAlerts: boolean;

  @Column({ name: 'can_compare', type: 'boolean', default: false })
  canCompare: boolean;

  // --- Fenêtre de validité (accès temporaire) — null = pas de borne ---
  @Column({ name: 'valid_from', type: 'timestamp', nullable: true })
  validFrom: Date | null;

  @Column({ name: 'valid_until', type: 'timestamp', nullable: true })
  validUntil: Date | null;

  // --- Traçabilité d'attribution ---
  @Column({ name: 'granted_by', type: 'uuid', nullable: true })
  grantedBy: string | null;

  @Column({ name: 'granted_reason', type: 'text', nullable: true })
  grantedReason: string | null;

  // --- Révocation (soft-delete in-place) ---
  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'revoked_by', type: 'uuid', nullable: true })
  revokedBy: string | null;

  /** Date de création de l'affectation (colonne historique `granted_at`). */
  @CreateDateColumn({ name: 'granted_at' })
  grantedAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
