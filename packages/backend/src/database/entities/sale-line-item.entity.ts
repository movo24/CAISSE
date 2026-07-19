import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { SaleEntity } from './sale.entity';
import { decimalToNumber } from '../../common/utils/decimal.transformer';

@Entity('sale_line_items')
@Index(['saleId'])
@Index(['productId'])
export class SaleLineItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'sale_id' })
  saleId: string;

  @Column({ name: 'product_id' })
  productId: string;

  @Column({ name: 'product_name' })
  productName: string;

  @Column()
  ean: string;

  @Column({ type: 'integer' })
  quantity: number;

  @Column({ name: 'unit_price_minor_units', type: 'integer' })
  unitPriceMinorUnits: number;

  @Column({ name: 'discount_minor_units', type: 'integer', default: 0 })
  discountMinorUnits: number;

  @Column({ name: 'promo_id', nullable: true })
  promoId: string;

  @Column({ name: 'tax_rate', type: 'decimal', default: 20, transformer: decimalToNumber })
  taxRate: number;

  @Column({ name: 'line_total_minor_units', type: 'integer' })
  lineTotalMinorUnits: number;

  @ManyToOne(() => SaleEntity, (s) => s.lineItems)
  @JoinColumn({ name: 'sale_id' })
  sale: SaleEntity;
}
