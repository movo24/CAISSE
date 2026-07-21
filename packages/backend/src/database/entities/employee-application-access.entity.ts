import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Accès applicatif de pilotage d'un employé (dimension séparée du rôle POS).
 *
 * Une ligne par employé (index unique sur employee_id). Détermine SI l'employé peut
 * utiliser l'application de pilotage et AVEC QUEL rôle applicatif. Le périmètre magasin
 * et les permissions granulaires vivent dans `employee_store_access`.
 *
 * Mapping `name:` explicite obligatoire (pas de SnakeNamingStrategy dans ce projet).
 */
@Entity('employee_application_access')
@Index('idx_eaa_employee', ['employeeId'], { unique: true })
export class EmployeeApplicationAccessEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  /** Interrupteur global d'accès à l'application. */
  @Column({ name: 'application_enabled', type: 'boolean', default: true })
  applicationEnabled: boolean;

  /** Rôle applicatif (STORE_MANAGER … TECHNICAL_ADMIN, CUSTOM_READ_ONLY). */
  @Column({ name: 'application_role', type: 'varchar', length: 40 })
  applicationRole: string;

  /** Niveau de permission auxiliaire (tier grossier ; 0 par défaut). */
  @Column({ name: 'permission_level', type: 'int', default: 0 })
  permissionLevel: number;

  @Column({ name: 'primary_store_id', type: 'uuid', nullable: true })
  primaryStoreId: string | null;

  // --- Fenêtre de validité (accès temporaire) — null = pas de borne ---
  @Column({ name: 'valid_from', type: 'timestamp', nullable: true })
  validFrom: Date | null;

  @Column({ name: 'valid_until', type: 'timestamp', nullable: true })
  validUntil: Date | null;

  // --- Suspension immédiate ---
  @Column({ name: 'suspended_at', type: 'timestamp', nullable: true })
  suspendedAt: Date | null;

  @Column({ name: 'suspended_by', type: 'uuid', nullable: true })
  suspendedBy: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
