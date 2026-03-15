import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Records each lottery result per sale.
 * Used to enforce daily quotas and provide win history.
 */
@Entity('jackpot_wins')
@Index(['storeId', 'createdAt'])
@Index(['storeId', 'type', 'createdAt'])
export class JackpotWinEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ name: 'sale_id' })
  saleId: string;

  @Column({
    type: 'varchar',
    length: 20,
  })
  type: 'mega_jackpot' | 'small_win' | 'no_win';

  /** live_count at the time of the roll — for analytics */
  @Column({ name: 'live_count_at_roll', default: 0 })
  liveCountAtRoll: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
