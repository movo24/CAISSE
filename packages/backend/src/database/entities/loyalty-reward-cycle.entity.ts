import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('loyalty_reward_cycles')
export class LoyaltyRewardCycleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** NULL = global default cycle. Set per-store to override. */
  @Column({ name: 'store_id', type: 'uuid', nullable: true })
  storeId: string | null;

  @Column({ type: 'int' })
  rank: number;

  @Column({ name: 'discount_percent', type: 'int' })
  discountPercent: number;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
