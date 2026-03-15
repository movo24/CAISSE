import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('z_reports')
@Index(['storeId', 'date'], { unique: true })
export class ZReportEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ name: 'employee_id' })
  employeeId: string;

  @Column({ name: 'total_revenue_minor_units', type: 'integer' })
  totalRevenueMinorUnits: number;

  @Column({ name: 'total_tax_minor_units', type: 'integer' })
  totalTaxMinorUnits: number;

  @Column({ name: 'currency_code', default: 'EUR' })
  currencyCode: string;

  @Column({ name: 'cash_total_minor_units', type: 'integer' })
  cashTotalMinorUnits: number;

  @Column({ name: 'card_total_minor_units', type: 'integer' })
  cardTotalMinorUnits: number;

  @Column({ name: 'transaction_count', type: 'integer' })
  transactionCount: number;

  @Column({ name: 'average_basket_minor_units', type: 'integer' })
  averageBasketMinorUnits: number;

  @Column({ name: 'top_products', type: 'jsonb', default: '[]' })
  topProducts: any[];

  @Column({ name: 'void_count', type: 'integer', default: 0 })
  voidCount: number;

  @Column({ name: 'discount_total_minor_units', type: 'integer', default: 0 })
  discountTotalMinorUnits: number;

  @Column({ name: 'peak_hours', type: 'jsonb', default: '[]' })
  peakHours: any[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
