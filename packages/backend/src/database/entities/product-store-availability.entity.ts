import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('product_store_availability')
export class ProductStoreAvailabilityEntity {
  @PrimaryColumn({ name: 'product_highlight_id' })
  productHighlightId: string;

  @PrimaryColumn({ name: 'store_id' })
  storeId: string;

  @Column({ length: 20, default: 'AVAILABLE' })
  status: 'AVAILABLE' | 'LOW_STOCK' | 'SOLD_OUT';

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
