import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

/**
 * Supplier — catalog reference data (store-scoped). Linked from products via
 * product.supplier_id. Drives purchasing, reassort and supplier analysis
 * (grossistes / importateurs / Chine). Contact fields are optional.
 */
@Entity('suppliers')
@Index(['storeId', 'name'], { unique: true })
export class SupplierEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', nullable: true })
  country: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
