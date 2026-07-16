import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Rattachement employé ↔ magasin (périmètre multi-magasins).
 *
 * ALIGNÉE STRICTEMENT sur la migration 1711 (schéma prod réel) :
 * colonnes snake_case `employee_id` / `store_id` / `granted_at`,
 * unicité (employee_id, store_id). La divergence historique (colonnes
 * camelCase + colonne `role` fantôme absente de la migration) faisait
 * échouer les suites PG dépendantes de l'ordre : la table synchronisée
 * depuis l'entité rendait le SQL brut de la migration 1711 invalide
 * (`column "employee_id" does not exist`). Corrigé — Lot 1 (partie
 * entité) du chantier accès ; les colonnes de révocation/validité
 * viendront par migration additive dédiée (1759), jamais ici en douce.
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

  @CreateDateColumn({ name: 'granted_at' })
  grantedAt: Date;
}
