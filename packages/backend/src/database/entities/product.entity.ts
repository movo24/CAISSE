import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { StoreEntity } from './store.entity';

@Entity('products')
@Index(['ean', 'storeId'], { unique: true })
@Index(['storeId', 'isActive'])
export class ProductEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  ean: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'category_id', nullable: true })
  categoryId: string;

  @Column({ name: 'unit_type', default: 'unit' })
  unitType: string;

  @Column({ name: 'price_minor_units', type: 'integer' })
  priceMinorUnits: number;

  @Column({ name: 'old_price_minor_units', type: 'integer', nullable: true })
  oldPriceMinorUnits: number | null;

  @Column({ name: 'currency_code', default: 'EUR' })
  currencyCode: string;

  @Column({ name: 'cost_minor_units', type: 'integer', nullable: true })
  costMinorUnits: number;

  @Column({ name: 'tax_rate', type: 'decimal', default: 20.0 })
  taxRate: number;

  @Column({ name: 'image_url', nullable: true, type: 'text' })
  imageUrl: string | null;

  @Column({ name: 'stock_quantity', type: 'integer', default: 0 })
  stockQuantity: number;

  @Column({ name: 'stock_alert_threshold', type: 'integer', default: 10 })
  stockAlertThreshold: number;

  @Column({ name: 'stock_critical_threshold', type: 'integer', default: 5 })
  stockCriticalThreshold: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'store_id' })
  storeId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => StoreEntity, (s) => s.products)
  @JoinColumn({ name: 'store_id' })
  store: StoreEntity;
}
