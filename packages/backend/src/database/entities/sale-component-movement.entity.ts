import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

/**
 * SaleComponentMovement — snapshot FIGÉ de la composition d'un pack au moment
 * de la vente + traçabilité des mouvements de stock composants (GO Product
 * Packs, points 5/7/9).
 *
 * Une ligne par (ligne de vente × composant consommé). Append-only :
 *  - snapshot : si la composition du pack change ensuite, les anciennes ventes
 *    restent auditables avec LEUR composition (cette table fait foi, jamais
 *    product_components) ;
 *  - retours : la restauration des composants se calcule d'ici
 *    (quantityPerParent × quantité retournée), y compris en retour partiel ;
 *  - rapport : origine (vente pack), vente liée, parent, composant, quantité,
 *    magasin, session de caisse, employé.
 *
 * HORS empreinte hash des ventes (pattern session_id/terminal_id) : l'allowlist
 * saleDataForHash est inchangée, aucune vente existante n'est re-hashée.
 */
@Entity('sale_component_movements')
@Index(['saleId'])
@Index(['saleLineItemId'])
@Index(['storeId', 'componentProductId', 'createdAt'])
export class SaleComponentMovementEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'sale_id', type: 'uuid' })
  saleId: string;

  @Column({ name: 'sale_line_item_id', type: 'uuid' })
  saleLineItemId: string;

  @Column({ name: 'parent_product_id', type: 'uuid' })
  parentProductId: string;

  @Column({ name: 'component_product_id', type: 'uuid' })
  componentProductId: string;

  // Ratio figé au moment de la vente (composant par unité de parent).
  @Column({ name: 'quantity_per_parent', type: 'integer' })
  quantityPerParent: number;

  // Total réellement sorti du stock = quantityPerParent × qty vendue.
  @Column({ name: 'quantity_consumed', type: 'integer' })
  quantityConsumed: number;

  @Column({ name: 'employee_id', type: 'uuid', nullable: true })
  employeeId: string | null;

  @Column({ name: 'session_id', type: 'uuid', nullable: true })
  sessionId: string | null;

  @Column({ name: 'terminal_id', type: 'varchar', nullable: true })
  terminalId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
