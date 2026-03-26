import {
  Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn,
  ManyToOne, JoinColumn, Index, Unique,
} from 'typeorm';
import { ProductEntity } from './product.entity';
import { StockLocationEntity } from './stock-location.entity';

/**
 * StockBalance — current stock quantity per product per location.
 *
 * This is the "current state" — always derivable from stock_movements
 * but maintained here for fast reads.
 */
@Entity('stock_balances')
@Unique(['productId', 'locationId'])
@Index(['locationId'])
@Index(['productId'])
export class StockBalanceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'location_id', type: 'uuid' })
  locationId: string;

  @Column({ type: 'integer', default: 0 })
  quantity: number;

  @Column({ name: 'alert_threshold', type: 'integer', default: 10 })
  alertThreshold: number;

  @Column({ name: 'critical_threshold', type: 'integer', default: 5 })
  criticalThreshold: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => ProductEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: ProductEntity;

  @ManyToOne(() => StockLocationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'location_id' })
  location: StockLocationEntity;
}
