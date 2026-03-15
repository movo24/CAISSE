import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('fx_rates')
export class FxRateEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'base_currency' })
  baseCurrency: string;

  @Column({ name: 'quote_currency' })
  quoteCurrency: string;

  @Column({ type: 'decimal', precision: 12, scale: 6 })
  rate: number;

  @Column({ default: 'manual' })
  source: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  timestamp: Date;
}
