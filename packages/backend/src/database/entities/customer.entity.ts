import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('customers')
@Index(['storeId'])
@Index(['qrCode'])
@Index(['storeId', 'updatedAt'])
export class CustomerEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'first_name' })
  firstName: string;

  @Column({ name: 'last_name' })
  lastName: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  email: string;

  @Column({ name: 'qr_code', unique: true })
  qrCode: string;

  @Column({ name: 'loyalty_points', type: 'integer', default: 0 })
  loyaltyPoints: number;

  @Column({ name: 'is_first_purchase', default: true })
  isFirstPurchase: boolean;

  @Column({ name: 'is_verified', default: false })
  isVerified: boolean;

  @Column({ name: 'store_id' })
  storeId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
