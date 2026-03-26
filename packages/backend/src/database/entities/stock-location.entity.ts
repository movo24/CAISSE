import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { StoreEntity } from './store.entity';

/**
 * StockLocation — physical or logical place where stock is held.
 *
 * Types:
 * - 'central'  → main warehouse / entrepôt
 * - 'store'    → point of sale (linked to a StoreEntity)
 * - 'transit'  → stock being transferred (future)
 * - 'loss'     → written off (casse, vol, périmé)
 */
@Entity('stock_locations')
@Index(['type'])
export class StockLocationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 20, unique: true })
  code: string; // e.g. CENTRAL-001, PAR-CHATELET

  @Column({
    type: 'varchar',
    length: 20,
    default: 'store',
  })
  type: 'central' | 'store' | 'transit' | 'loss';

  // If type = 'store', link to which store
  @Column({ name: 'store_id', type: 'uuid', nullable: true })
  storeId: string | null;

  @ManyToOne(() => StoreEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'store_id' })
  store: StoreEntity;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'varchar', nullable: true })
  address: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
