import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
  ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { ProductEntity } from './product.entity';

/**
 * ProductComponent — composition d'un pack / produit composé (GO Product Packs).
 *
 * Le produit PARENT est le produit facturé (une seule ligne ticket, tout le CA).
 * Chaque composant sort du stock automatiquement à la vente du parent
 * (quantityPerParent × quantité vendue) et y revient au retour.
 *
 * Cette table décrit la composition COURANTE (modifiable). La composition
 * utilisée par une vente donnée est figée à part dans sale_component_movements
 * — supprimer/modifier une ligne ici ne touche donc jamais l'historique.
 *
 * Invariants (aussi en CHECK SQL côté migration) :
 *  - quantityPerParent > 0 ;
 *  - parentProductId ≠ componentProductId ;
 *  - unicité (storeId, parent, composant) ;
 *  - aucune boucle directe ou indirecte (garde BFS dans ProductsService).
 */
@Entity('product_components')
@Index('idx_product_components_store_parent_component', ['storeId', 'parentProductId', 'componentProductId'], { unique: true })
@Index(['parentProductId'])
@Index(['componentProductId'])
export class ProductComponentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'parent_product_id', type: 'uuid' })
  parentProductId: string;

  @Column({ name: 'component_product_id', type: 'uuid' })
  componentProductId: string;

  // Quantité de composant consommée par UNE unité de parent vendue.
  @Column({ name: 'quantity_per_parent', type: 'integer' })
  quantityPerParent: number;

  // Inactif = ignoré par le moteur de vente, sans perdre le paramétrage.
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => ProductEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_product_id' })
  parentProduct: ProductEntity;

  @ManyToOne(() => ProductEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'component_product_id' })
  componentProduct: ProductEntity;
}
