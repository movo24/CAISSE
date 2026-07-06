import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { StoreEntity } from './store.entity';

/**
 * Demande d'intégration produit — trace de chaque code-barres inconnu pour
 * lequel une création de fiche est demandée.
 *
 * Règle métier : la caisse ne crée JAMAIS de produit ; elle ne peut créer
 * qu'une demande (source = 'pos'). La fiche produit est ensuite créée depuis
 * le Dashboard / module Inventaire par un opérateur autorisé.
 */
@Entity('product_integration_requests')
@Index(['storeId', 'status'])
@Index(['storeId', 'barcode'])
export class ProductIntegrationRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id' })
  storeId: string;

  @Column()
  barcode: string;

  /** D'où vient la demande : caisse, dashboard, module inventaire, mobile. */
  @Column({ type: 'varchar', default: 'pos' })
  source: 'pos' | 'dashboard' | 'inventory' | 'mobile';

  @Column({ name: 'terminal_id', type: 'varchar', nullable: true })
  terminalId: string | null;

  /** Employé connecté qui a déclenché la demande. */
  @Column({ name: 'requested_by' })
  requestedBy: string;

  @Column({ type: 'varchar', default: 'pending' })
  status: 'pending' | 'converted' | 'rejected';

  /**
   * Fiche produit proposée (préremplie côté Inventaire/Dashboard) :
   * { name, brandName, categoryName, supplierName, costMinorUnits,
   *   priceMinorUnits, taxRate, unitType, imageUrl, initialStock, sku }
   */
  @Column({ type: 'jsonb', nullable: true })
  proposal: Record<string, unknown> | null;

  @Column({ type: 'varchar', nullable: true })
  comment: string | null;

  // ── Décision (approbation / rejet) ──

  @Column({ name: 'decided_by', type: 'varchar', nullable: true })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'timestamp', nullable: true })
  decidedAt: Date | null;

  @Column({ name: 'rejection_reason', type: 'varchar', nullable: true })
  rejectionReason: string | null;

  /** Produit créé à partir de cette demande (si convertie). */
  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => StoreEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: StoreEntity;
}
