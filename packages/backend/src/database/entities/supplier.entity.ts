import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * P327 (cycle K — variantes option A, PRODUCT_VARIANTS_DECISION.md).
 * Référentiel fournisseur MINIMAL, tenant-scoped (un fournisseur par magasin —
 * l'éventuelle mutualisation réseau est une évolution, pas un besoin actuel).
 * La MARQUE reste déclarative (colonne texte sur products) ; le FOURNISSEUR est
 * référencé car il porte un cycle de vie (contact, actif/inactif, réassort).
 */
@Entity('suppliers')
@Index(['storeId'])
@Index(['storeId', 'name'], { unique: true })
export class SupplierEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  contact: string | null; // téléphone / email / libre

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
