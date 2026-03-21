import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('staffing_snapshots')
@Index(['storeId', 'createdAt'])
export class StaffingSnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ default: 'unknown' })
  level: string; // optimal | tension | surcharge | sous_effectif | unknown

  @Column({ name: 'active_cashiers_count', default: 0 })
  activeCashiersCount: number;

  @Column({ name: 'current_hour_tx', default: 0 })
  currentHourTx: number;

  @Column({ name: 'current_hour_revenue', default: 0 })
  currentHourRevenue: number;

  @Column({ type: 'jsonb', name: 'active_cashiers', default: '[]' })
  activeCashiers: any[];

  @Column({ type: 'jsonb', name: 'hourly_snapshots', default: '[]' })
  hourlySnapshots: any[];

  @Column({ type: 'jsonb', name: 'last_recommendation', nullable: true })
  lastRecommendation: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
