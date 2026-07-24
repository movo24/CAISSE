import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Un produit concerné par une vente à stock insuffisant (stock après vente < 0).
 * Snapshot figé au moment de la vente — reste vrai même après régularisation
 * ultérieure du stock (l'anomalie est un fait historique, pas un état courant).
 */
export interface StockAnomalyItem {
  productId: string;
  productName: string;
  ean: string;
  sku: string | null;
  /** True si le produit est un composant de pack (règle identique aux parents). */
  isPackComponent: boolean;
  stockBefore: number;
  quantitySold: number;
  stockAfter: number;
}

/**
 * Anomalie de stock — « vente autorisée malgré indisponibilité ».
 *
 * Règle métier (chantier 4, stock négatif) : le stock informatique ne bloque
 * JAMAIS une vente en caisse. Quand une vente finalisée fait passer un stock
 * en négatif, elle crée UNE anomalie (une ligne par vente, regroupant tous les
 * produits concernés) visible du responsable magasin et du Central, statut
 * « À contrôler » jusqu'à justification.
 *
 * Idempotence : `sale_id` UNIQUE — un replay réseau/resync de la même vente ne
 * peut pas créer de doublon (la vente elle-même est dédupliquée par
 * IdempotencyKey en amont ; la contrainte est la défense en profondeur).
 * L'anomalie est écrite dans la MÊME transaction que la vente : pas de vente
 * committée sans son anomalie, pas d'anomalie sans vente (panier abandonné ou
 * vente rejetée = aucune anomalie).
 */
@Entity('stock_anomalies')
@Index(['storeId', 'status'])
@Index(['storeId', 'occurredAt'])
export class StockAnomalyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id' })
  storeId: string;

  /** Vente à l'origine de l'anomalie — UNIQUE (anti-doublon replay/resync). */
  @Column({ name: 'sale_id', type: 'uuid', unique: true })
  saleId: string;

  @Column({ name: 'ticket_number' })
  ticketNumber: string;

  @Column({ name: 'terminal_id', type: 'varchar', nullable: true })
  terminalId: string | null;

  @Column({ name: 'session_id', type: 'uuid', nullable: true })
  sessionId: string | null;

  @Column({ name: 'employee_id' })
  employeeId: string;

  @Column({ name: 'employee_name', type: 'varchar', nullable: true })
  employeeName: string | null;

  /** Date/heure métier de la vente (offline : heure réelle, pas heure de sync). */
  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;

  /** Produits concernés (snapshot figé) — voir StockAnomalyItem. */
  @Column({ type: 'jsonb' })
  items: StockAnomalyItem[];

  /** 'a_controler' (défaut) → 'controlee' (responsable, avec justification). */
  @Column({ type: 'varchar', default: 'a_controler' })
  status: 'a_controler' | 'controlee';

  @Column({ name: 'controlled_by', type: 'varchar', nullable: true })
  controlledBy: string | null;

  @Column({ name: 'controlled_by_name', type: 'varchar', nullable: true })
  controlledByName: string | null;

  @Column({ name: 'controlled_at', type: 'timestamptz', nullable: true })
  controlledAt: Date | null;

  @Column({ type: 'text', nullable: true })
  justification: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
