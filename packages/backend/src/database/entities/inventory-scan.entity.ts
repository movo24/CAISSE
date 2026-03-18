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
import { ProductEntity } from './product.entity';
import { EmployeeEntity } from './employee.entity';

/**
 * Inventory Scan — every barcode scan is recorded here.
 *
 * Each scan is ALWAYS tied to a specific store (store_id is NOT NULL).
 * This ensures stock updates go to the correct store.
 */
@Entity('inventory_scans')
@Index(['storeId', 'createdAt'])
@Index(['storeId', 'barcode'])
@Index(['storeId', 'status'])
export class InventoryScanEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Mandatory store association ──

  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ name: 'store_code' })
  storeCode: string;

  // ── Who scanned ──

  @Column({ name: 'employee_id' })
  employeeId: string;

  // ── What was scanned ──

  @Column()
  barcode: string;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @Column({ name: 'product_name', type: 'varchar', nullable: true })
  productName: string | null;

  // ── Scan details ──

  @Column({ type: 'integer', default: 1 })
  quantity: number;

  @Column({
    name: 'scan_type',
    type: 'varchar',
    default: 'inventory',
  })
  scanType: 'inventory' | 'receiving' | 'adjustment' | 'return';

  @Column({
    type: 'varchar',
    default: 'pending',
  })
  status: 'matched' | 'new' | 'pending' | 'applied' | 'rejected';

  @Column({ type: 'varchar', nullable: true })
  notes: string;

  // ── Session tracking ──

  @Column({ name: 'session_id', type: 'uuid', nullable: true })
  sessionId: string | null;

  // ── Timestamps ──

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // ── Relations ──

  @ManyToOne(() => StoreEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: StoreEntity;

  @ManyToOne(() => ProductEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'product_id' })
  product: ProductEntity;

  @ManyToOne(() => EmployeeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee: EmployeeEntity;
}
