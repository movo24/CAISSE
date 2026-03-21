import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { StoreEntity } from './store.entity';

@Entity('employees')
@Index(['storeId', 'isActive'])
export class EmployeeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ name: 'first_name' })
  firstName: string;

  @Column({ name: 'last_name' })
  lastName: string;

  @Column()
  email: string;

  @Column({ name: 'pin_hash' })
  pinHash: string;

  @Column({ name: 'qr_code', unique: true })
  qrCode: string;

  @Column({ default: 'cashier' })
  role: string;

  @Column({ name: 'max_discount_percent', type: 'decimal', default: 5 })
  maxDiscountPercent: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => StoreEntity, (s) => s.employees)
  @JoinColumn({ name: 'store_id' })
  store: StoreEntity;
}
